import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import {
  Body,
  DistanceConstraint,
  GSSolver,
  Particle,
  PointToPointConstraint,
  SAPBroadphase,
  Vec3,
  World,
} from "cannon-es";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Plane,
  Vector3,
} from "three";

const COLUMNS = 24;
const ROWS = 26;
const SHIRT_WIDTH = 4.4;
const SHIRT_HEIGHT = 4.4;
const PARTICLE_MASS = 0.12;
const FIXED_TIME_STEP = 1 / 60;
const LINEAR_DAMPING = 0.48;
const RELEASE_VELOCITY_RETENTION = 0.22;

type GridPoint = {
  column: number;
  row: number;
  x: number;
  y: number;
  z: number;
};

type ShirtSimulation = {
  bodies: Body[];
  cursorBody: Body;
  geometry: BufferGeometry;
  points: GridPoint[];
  world: World;
};

type PointerCaptureTarget = EventTarget & {
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
  setPointerCapture(pointerId: number): void;
};

function createShirtSimulation(): ShirtSimulation {
  const world = new World({ gravity: new Vec3(0, -12.5, 0) });
  world.allowSleep = false;
  world.broadphase = new SAPBroadphase(world);

  const solver = new GSSolver();
  solver.iterations = 16;
  solver.tolerance = 0.001;
  world.solver = solver;

  const columnStep = SHIRT_WIDTH / COLUMNS;
  const rowStep = SHIRT_HEIGHT / ROWS;
  const nodeIndex = (column: number, row: number) => row * (COLUMNS + 1) + column;

  const points: GridPoint[] = [];

  for (let row = 0; row <= ROWS; row += 1) {
    for (let column = 0; column <= COLUMNS; column += 1) {
      const x = -SHIRT_WIDTH / 2 + column * columnStep;
      const y = SHIRT_HEIGHT / 2 - row * rowStep;
      const z =
        0.035 * Math.cos(x * 3.1) * Math.sin((y + 2.2) * 2.4) -
        0.025 * (x / 2.2) ** 2;

      points.push({ column, row, x, y, z });
    }
  }

  const bodies = points.map((point) => {
    const pinnedAtTopCorner =
      point.row === 0 && (point.column === 0 || point.column === COLUMNS);
    const body = new Body({
      mass: pinnedAtTopCorner ? 0 : PARTICLE_MASS,
      linearDamping: LINEAR_DAMPING,
      position: new Vec3(point.x, point.y, point.z),
      shape: new Particle(),
    });

    world.addBody(body);
    return body;
  });

  const indices: number[] = [];
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
    world.addConstraint(
      new DistanceConstraint(
        bodies[first],
        bodies[second],
        distance,
        stiffness,
      ),
    );
  };

  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const topLeft = nodeIndex(column, row);
      const topRight = nodeIndex(column + 1, row);
      const bottomLeft = nodeIndex(column, row + 1);
      const bottomRight = nodeIndex(column + 1, row + 1);

      // Alternating diagonals avoid a visible directional bias in the fabric.
      if ((column + row) % 2 === 0) {
        indices.push(topLeft, bottomLeft, topRight);
        indices.push(topRight, bottomLeft, bottomRight);
        connect(topLeft, bottomRight);
      } else {
        indices.push(topLeft, bottomLeft, bottomRight);
        indices.push(topLeft, bottomRight, topRight);
        connect(topRight, bottomLeft);
      }

      connect(topLeft, topRight);
      connect(topLeft, bottomLeft);
      connect(topRight, bottomRight);
      connect(bottomLeft, bottomRight);
    }
  }

  // Longer, softer links resist collapsing while still allowing broad folds.
  points.forEach((point, pointIndex) => {
    if (point.column + 2 <= COLUMNS) {
      connect(pointIndex, nodeIndex(point.column + 2, point.row), 2.5e4);
    }
    if (point.row + 2 <= ROWS) {
      connect(pointIndex, nodeIndex(point.column, point.row + 2), 2.5e4);
    }
  });

  const positions = new Float32Array(points.length * 3);
  const uvs = new Float32Array(points.length * 2);
  points.forEach((point, index) => {
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = point.y;
    positions[index * 3 + 2] = point.z;
    uvs[index * 2] = (point.x + SHIRT_WIDTH / 2) / SHIRT_WIDTH;
    uvs[index * 2 + 1] = (point.y + SHIRT_HEIGHT / 2) / SHIRT_HEIGHT;
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const cursorBody = new Body({
    collisionResponse: false,
    mass: 0,
    type: Body.KINEMATIC,
  });
  world.addBody(cursorBody);

  return { bodies, cursorBody, geometry, points, world };
}

function ClothShirt() {
  const simulation = useMemo(createShirtSimulation, []);
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
      aria-label="Interactive rectangular cloth. Drag the fabric to move it."
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
