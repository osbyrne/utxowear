import { useEffect, useMemo, useRef } from "react";
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
  DoubleSide,
  Plane,
  PlaneGeometry,
  Vector3,
} from "three";

const X_SEGMENTS = 20;
const Y_SEGMENTS = 20;
const CLOTH_WIDTH = 3;
const CLOTH_HEIGHT = 3;
const PARTICLE_MASS = 0.8;
const FIXED_TIME_STEP = 1 / 60;
const LINEAR_DAMPING = 0.45;
const RELEASE_VELOCITY_RETENTION = 0.25;

type ClothSimulation = {
  bodies: Body[];
  cursorBody: Body;
  world: World;
};

type PointerCaptureTarget = EventTarget & {
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
  setPointerCapture(pointerId: number): void;
};

function createClothSimulation(): ClothSimulation {
  const world = new World({ gravity: new Vec3(0, -9.81 * 1.4, 0) });
  world.allowSleep = false;
  world.broadphase = new SAPBroadphase(world);

  const solver = new GSSolver();
  solver.iterations = 18;
  solver.tolerance = 0.001;
  world.solver = solver;

  const bodies: Body[] = [];
  const horizontalSpacing = CLOTH_WIDTH / X_SEGMENTS;
  const verticalSpacing = CLOTH_HEIGHT / Y_SEGMENTS;
  const index = (x: number, y: number) => x + y * (X_SEGMENTS + 1);

  for (let y = 0; y <= Y_SEGMENTS; y += 1) {
    for (let x = 0; x <= X_SEGMENTS; x += 1) {
      const pinned = y === 0;
      const body = new Body({
        mass: pinned ? 0 : PARTICLE_MASS,
        linearDamping: LINEAR_DAMPING,
        position: new Vec3(
          (x / X_SEGMENTS - 0.5) * CLOTH_WIDTH,
          1.8 - (y / Y_SEGMENTS) * CLOTH_HEIGHT,
          0,
        ),
        shape: new Particle(),
      });

      bodies.push(body);
      world.addBody(body);
    }
  }

  const connect = (first: number, second: number, distance: number) => {
    world.addConstraint(
      new DistanceConstraint(bodies[first], bodies[second], distance, 1e5),
    );
  };

  for (let y = 0; y <= Y_SEGMENTS; y += 1) {
    for (let x = 0; x <= X_SEGMENTS; x += 1) {
      if (x < X_SEGMENTS) {
        connect(index(x, y), index(x + 1, y), horizontalSpacing);
      }
      if (y < Y_SEGMENTS) {
        connect(index(x, y), index(x, y + 1), verticalSpacing);
      }
    }
  }

  const cursorBody = new Body({
    collisionResponse: false,
    mass: 0,
    type: Body.KINEMATIC,
  });
  world.addBody(cursorBody);

  return { bodies, cursorBody, world };
}

function Cloth() {
  const simulation = useMemo(createClothSimulation, []);
  const dragConstraint = useRef<PointToPointConstraint | null>(null);
  const draggedBody = useRef<Body | null>(null);
  const dragPlane = useRef(new Plane());
  const dragPoint = useRef(new Vector3());
  const cameraDirection = useRef(new Vector3());
  const geometry = useMemo(
    () => new PlaneGeometry(CLOTH_WIDTH, CLOTH_HEIGHT, X_SEGMENTS, Y_SEGMENTS),
    [],
  );
  useEffect(() => {
    return () => {
      if (dragConstraint.current) {
        simulation.world.removeConstraint(dragConstraint.current);
      }
      geometry.dispose();
    };
  }, [geometry, simulation]);

  const releaseDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!dragConstraint.current) return;

    simulation.world.removeConstraint(dragConstraint.current);
    dragConstraint.current = null;
    if (draggedBody.current) {
      draggedBody.current.velocity.scale(
        RELEASE_VELOCITY_RETENTION,
        draggedBody.current.velocity,
      );
    }
    draggedBody.current = null;
    const target = event.target as PointerCaptureTarget;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  const startDrag = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const target = event.target as PointerCaptureTarget;
    target.setPointerCapture(event.pointerId);

    let closestBody: Body | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const body of simulation.bodies) {
      if (body.mass === 0) continue;

      const dx = body.position.x - event.point.x;
      const dy = body.position.y - event.point.y;
      const dz = body.position.z - event.point.z;
      const distance = dx * dx + dy * dy + dz * dz;

      if (distance < closestDistance) {
        closestDistance = distance;
        closestBody = body;
      }
    }

    if (!closestBody) return;

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
    if (!dragConstraint.current || !draggedBody.current) return;

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

  useFrame((_, delta) => {
    const positionAttribute = geometry.getAttribute(
      "position",
    ) as BufferAttribute;

    simulation.world.step(FIXED_TIME_STEP, Math.min(delta, 0.05), 3);

    simulation.bodies.forEach((body, index) => {
      positionAttribute.setXYZ(
        index,
        body.position.x,
        body.position.y,
        body.position.z,
      );
    });

    positionAttribute.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  return (
    <mesh
      geometry={geometry}
      castShadow
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={releaseDrag}
      onPointerCancel={releaseDrag}
    >
      <meshStandardMaterial
        color="#f4f4f5"
        roughness={0.9}
        metalness={0}
        side={DoubleSide}
      />
    </mesh>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={1.1} />
      <directionalLight
        position={[1, 1, 1]}
        intensity={2.2}
        color="#fff8ec"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <Cloth />
    </>
  );
}

export default function Shirt() {
  return (
    <div
      id="canvas-container"
      style={{
        width: "100%",
        height: "clamp(28rem, 68vh, 46rem)",
        overflow: "hidden",
        borderRadius: "1.5rem",
      }}
    >
      <Canvas
        camera={{ position: [4, 1, 7], fov: 35, near: 0.1, far: 50 }}
        dpr={[1, 2]}
        shadows
        style={{ cursor: "grab", touchAction: "none" }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
