import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, type ThreeEvent, useFrame, useLoader } from "@react-three/fiber";
import {
  Body,
  DistanceConstraint,
  GSSolver,
  PointToPointConstraint,
  SAPBroadphase,
  Sphere,
  Vec3,
  World,
} from "cannon-es";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  Object3D,
  Plane,
  Vector3,
} from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const PARTICLE_MASS = 0.12;
const FIXED_TIME_STEP = 1 / 60;
const LINEAR_DAMPING = 0.48;
const RELEASE_VELOCITY_RETENTION = 0.22;

type ClothPoint = {
  x: number;
  y: number;
  z: number;
};

type ShirtSimulation = {
  bodies: Body[];
  cursorBody: Body;
  geometry: BufferGeometry;
  points: ClothPoint[];
  world: World;
};

type PointerCaptureTarget = EventTarget & {
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
  setPointerCapture(pointerId: number): void;
};

function prepareShirtGeometry(scene: Object3D) {
  let shirtMesh: Mesh | null = null;
  let largestMeshVertexCount = 0;
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || mesh.geometry.attributes.position.count <= largestMeshVertexCount) {
      return;
    }
    shirtMesh = mesh;
    largestMeshVertexCount = mesh.geometry.attributes.position.count;
  });

  const selectedShirtMesh = shirtMesh as Mesh | null;
  if (!selectedShirtMesh) throw new Error("tshirt.glb does not contain a mesh.");

  scene.traverse((object) => object.updateMatrixWorld());
  const geometry = selectedShirtMesh.geometry.clone();
  geometry.applyMatrix4(selectedShirtMesh.matrixWorld);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) throw new Error("Unable to calculate tshirt.glb bounds.");

  // Center and size the imported model for the existing camera and floor.
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const scale = 4.4 / Math.max(size.x, size.y);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(scale, scale, scale);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createShirtSimulation(sourceGeometry: BufferGeometry): ShirtSimulation {
  const world = new World({ gravity: new Vec3(0, -12.5, 0) });
  world.allowSleep = false;
  world.broadphase = new SAPBroadphase(world);
  world.defaultContactMaterial.friction = 0.1;
  world.defaultContactMaterial.restitution = 0;

  const solver = new GSSolver();
  solver.iterations = 16;
  solver.tolerance = 0.001;
  world.solver = solver;

  const geometry = sourceGeometry.clone();
  const position = geometry.getAttribute("position") as BufferAttribute;
  const points = Array.from({ length: position.count }, (_, index) => ({
    x: position.getX(index),
    y: position.getY(index),
    z: position.getZ(index),
  }));
  const index = geometry.getIndex();
  const indices = index
    ? Array.from(index.array)
    : Array.from({ length: position.count }, (_, vertexIndex) => vertexIndex);

  if (indices.length % 3 !== 0) {
    throw new Error("tshirt.glb must contain triangle geometry.");
  }

  let totalEdgeLength = 0;
  let edgeCount = 0;
  const uniqueEdges = new Set<string>();
  for (let triangleStart = 0; triangleStart < indices.length; triangleStart += 3) {
    const triangle = indices.slice(triangleStart, triangleStart + 3);
    for (const [first, second] of [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ]) {
      const low = Math.min(first, second);
      const high = Math.max(first, second);
      const edgeKey = `${low}:${high}`;
      if (uniqueEdges.has(edgeKey)) continue;
      uniqueEdges.add(edgeKey);
      totalEdgeLength += Math.hypot(
        points[first].x - points[second].x,
        points[first].y - points[second].y,
        points[first].z - points[second].z,
      );
      edgeCount += 1;
    }
  }
  const collisionRadius = (totalEdgeLength / edgeCount) * 0.35;
  const highestY = Math.max(...points.map((point) => point.y));
  const shoulderPoints = points
    .map((point, pointIndex) => ({ point, pointIndex }))
    .filter(({ point }) => point.y > highestY - 0.15);
  const pinnedPointIndices = new Set([
    shoulderPoints.reduce((left, candidate) =>
      candidate.point.x < left.point.x ? candidate : left,
    ).pointIndex,
    shoulderPoints.reduce((right, candidate) =>
      candidate.point.x > right.point.x ? candidate : right,
    ).pointIndex,
  ]);

  const bodies = points.map((point, pointIndex) => {
    const body = new Body({
      mass: pinnedPointIndices.has(pointIndex) ? 0 : PARTICLE_MASS,
      linearDamping: LINEAR_DAMPING,
      fixedRotation: true,
      position: new Vec3(point.x, point.y, point.z),
      shape: new Sphere(collisionRadius),
    });

    world.addBody(body);
    return body;
  });

  const connectedPairs = new Set<string>();
  const connect = (first: number, second: number, stiffness = 1e5) => {
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    const pairKey = `${low}:${high}`;
    if (connectedPairs.has(pairKey)) return;
    connectedPairs.add(pairKey);

    const firstPoint = points[first];
    const secondPoint = points[second];
    const distance = Math.hypot(
      firstPoint.x - secondPoint.x,
      firstPoint.y - secondPoint.y,
      firstPoint.z - secondPoint.z,
    );
    const constraint = new DistanceConstraint(
      bodies[first],
      bodies[second],
      distance,
      stiffness,
    );
    // Connected vertices must be free to approach each other as the cloth folds.
    constraint.collideConnected = false;
    world.addConstraint(constraint);
  };

  for (let triangleStart = 0; triangleStart < indices.length; triangleStart += 3) {
    const first = indices[triangleStart];
    const second = indices[triangleStart + 1];
    const third = indices[triangleStart + 2];
    connect(first, second);
    connect(second, third);
    connect(third, first);
  }

  const cursorBody = new Body({
    collisionResponse: false,
    mass: 0,
    type: Body.KINEMATIC,
  });
  world.addBody(cursorBody);

  return { bodies, cursorBody, geometry, points, world };
}

function ClothShirt() {
  const gltf = useLoader(GLTFLoader, "/tshirt.glb", (loader) => {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("/draco/");
    loader.setDRACOLoader(dracoLoader);
  });
  const sourceGeometry = useMemo(() => prepareShirtGeometry(gltf.scene), [gltf]);
  const simulation = useMemo(
    () => createShirtSimulation(sourceGeometry),
    [sourceGeometry],
  );
  const dragConstraint = useRef<PointToPointConstraint | null>(null);
  const draggedBody = useRef<Body | null>(null);
  const activePointerId = useRef<number | null>(null);
  const captureTarget = useRef<PointerCaptureTarget | null>(null);
  const dragPlane = useRef(new Plane());
  const dragPoint = useRef(new Vector3());
  const cameraDirection = useRef(new Vector3());

  const finishDrag = useCallback(
    (pointerId?: number) => {
      if (
        activePointerId.current === null ||
        (pointerId !== undefined && pointerId !== activePointerId.current)
      ) {
        return;
      }

      if (dragConstraint.current) {
        simulation.world.removeConstraint(dragConstraint.current);
        dragConstraint.current = null;
      }
      if (draggedBody.current) {
        draggedBody.current.velocity.scale(
          RELEASE_VELOCITY_RETENTION,
          draggedBody.current.velocity,
        );
        draggedBody.current = null;
      }

      const capturedPointerId = activePointerId.current;
      const target = captureTarget.current;
      if (target?.hasPointerCapture(capturedPointerId)) {
        target.releasePointerCapture(capturedPointerId);
      }
      activePointerId.current = null;
      captureTarget.current = null;
    },
    [simulation],
  );

  useEffect(() => {
    const handlePointerEnd = (event: PointerEvent) =>
      finishDrag(event.pointerId);
    const handleWindowBlur = () => finishDrag();

    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("blur", handleWindowBlur);
      finishDrag();
      simulation.geometry.dispose();
    };
  }, [finishDrag, simulation]);

  const finishPointerDrag = (event: ThreeEvent<PointerEvent>) => {
    finishDrag(event.pointerId);
  };

  const startDrag = (event: ThreeEvent<PointerEvent>) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      activePointerId.current !== null
    ) {
      return;
    }

    event.stopPropagation();

    let closestBody: Body | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const body of simulation.bodies) {
      if (body.mass === 0) continue;
      const distance =
        (body.position.x - event.point.x) ** 2 +
        (body.position.y - event.point.y) ** 2 +
        (body.position.z - event.point.z) ** 2;
      if (distance < closestDistance) {
        closestDistance = distance;
        closestBody = body;
      }
    }
    if (!closestBody) return;

    const target = event.target as PointerCaptureTarget;
    target.setPointerCapture(event.pointerId);
    activePointerId.current = event.pointerId;
    captureTarget.current = target;

    event.camera.getWorldDirection(cameraDirection.current);
    dragPlane.current.setFromNormalAndCoplanarPoint(
      cameraDirection.current,
      event.point,
    );
    simulation.cursorBody.position.set(
      event.point.x,
      event.point.y,
      event.point.z,
    );
    simulation.cursorBody.velocity.setZero();

    const constraint = new PointToPointConstraint(
      simulation.cursorBody,
      new Vec3(),
      closestBody,
      new Vec3(),
      1e5,
    );
    simulation.world.addConstraint(constraint);
    dragConstraint.current = constraint;
    draggedBody.current = closestBody;
    closestBody.wakeUp();
  };

  const moveDrag = (event: ThreeEvent<PointerEvent>) => {
    if (
      event.pointerId !== activePointerId.current ||
      !dragConstraint.current ||
      !draggedBody.current
    ) {
      return;
    }

    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
      finishDrag(event.pointerId);
      return;
    }

    event.stopPropagation();
    if (!event.ray.intersectPlane(dragPlane.current, dragPoint.current)) return;

    simulation.cursorBody.position.set(
      dragPoint.current.x,
      dragPoint.current.y,
      dragPoint.current.z,
    );
    simulation.cursorBody.velocity.setZero();
    simulation.cursorBody.aabbNeedsUpdate = true;
    draggedBody.current.wakeUp();
  };

  useFrame(({ clock }, delta) => {
    const elapsed = clock.getElapsedTime();
    const positions = simulation.geometry.getAttribute(
      "position",
    ) as BufferAttribute;

    simulation.bodies.forEach((body, index) => {
      if (body.mass === 0 || body === draggedBody.current) return;
      const point = simulation.points[index];
      const breeze =
        Math.sin(elapsed * 1.15 + point.x * 1.7 + point.y * 0.55) * 0.018 +
        Math.sin(elapsed * 0.62 - point.y * 2.1) * 0.01;
      body.force.z += breeze;
      body.force.x += breeze * 0.08;
    });

    simulation.world.step(FIXED_TIME_STEP, Math.min(delta, 0.05), 3);
    simulation.bodies.forEach((body, index) => {
      positions.setXYZ(
        index,
        body.position.x,
        body.position.y,
        body.position.z,
      );
    });
    positions.needsUpdate = true;
    simulation.geometry.computeVertexNormals();
  });

  return (
    <mesh
      geometry={simulation.geometry}
      castShadow
      frustumCulled={false}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
    >
      <meshPhysicalMaterial
        color="#f6f3ed"
        roughness={0.88}
        metalness={0}
        sheen={0.72}
        sheenColor="#d8cec0"
        sheenRoughness={0.82}
        side={DoubleSide}
      />
    </mesh>
  );
}

function Scene() {
  return (
    <>
      <hemisphereLight />
      <directionalLight
        position={[3.5, 5, 5]}
        intensity={2.6}
        color="#fff4df"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-4, 1, 3]} intensity={1} color="#fffaff" />
      <ClothShirt />
      <mesh position={[0, 0, -1]} receiveShadow>
        <planeGeometry args={[7, 7]} />
        <meshStandardMaterial color="#e9e5df" roughness={1} />
      </mesh>
    </>
  );
}

export default function Shirt() {
  return (
    <div
      id="canvas-container"
      aria-label="Interactive 3D T-shirt cloth. Drag the fabric to move it."
      role="img"
      style={{
        width: "100%",
        height: "clamp(28rem, 68vh, 46rem)",
        overflow: "hidden",
        borderRadius: "1.5rem",
      }}
    >
      <Canvas
        camera={{ position: [3.7, 0.25, 8.6], fov: 34, near: 0.1, far: 50 }}
        dpr={[1, 1.75]}
        shadows
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ cursor: "grab", touchAction: "grab" }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
