<script lang="ts">
    import { T, useTask } from "@threlte/core";
    import { OrbitControls, Grid } from "@threlte/extras";
    import * as THREE from "three";
    import { onMount } from "svelte";

    // Cloth simulation parameters
    const clothWidth = 2;
    const clothHeight = 2.5;
    const clothSegments = 20;
    const mass = 0.1;
    const damping = 0.03;
    const windStrength = 2;
    const windVariation = 1;

    type Particle = {
        position: THREE.Vector3;
        previous: THREE.Vector3;
        original: THREE.Vector3;
        acceleration: THREE.Vector3;
        mass: number;
        invMass: number;
        fixed: boolean;
    };

    let clothGeometry: THREE.BufferGeometry;
    let particles: Particle[] = [];
    let constraints: { a: number; b: number; restDistance: number }[] = [];

    // Initialize cloth
    function initCloth() {
        const particles: Particle[] = [];
        const segmentsX = clothSegments;
        const segmentsY = Math.floor(
            clothSegments * (clothHeight / clothWidth),
        );

        // Create particles
        for (let y = 0; y <= segmentsY; y++) {
            for (let x = 0; x <= segmentsX; x++) {
                const u = x / segmentsX;
                const v = y / segmentsY;

                const px = (u - 0.5) * clothWidth;
                const py = 2 - v * clothHeight;
                const pz = 0;

                const pos = new THREE.Vector3(px, py, pz);

                particles.push({
                    position: pos.clone(),
                    previous: pos.clone(),
                    original: pos.clone(),
                    acceleration: new THREE.Vector3(),
                    mass,
                    invMass: 1 / mass,
                    fixed: y === segmentsY, // Fix top row
                });
            }
        }

        // Create constraints (springs)
        const constraints: { a: number; b: number; restDistance: number }[] =
            [];

        for (let y = 0; y <= segmentsY; y++) {
            for (let x = 0; x <= segmentsX; x++) {
                const index = y * (segmentsX + 1) + x;

                // Structural constraints
                if (x < segmentsX) {
                    const right = index + 1;
                    constraints.push({
                        a: index,
                        b: right,
                        restDistance: particles[index].position.distanceTo(
                            particles[right].position,
                        ),
                    });
                }

                if (y < segmentsY) {
                    const down = index + segmentsX + 1;
                    constraints.push({
                        a: index,
                        b: down,
                        restDistance: particles[index].position.distanceTo(
                            particles[down].position,
                        ),
                    });
                }

                // Shear constraints
                if (x < segmentsX && y < segmentsY) {
                    const rightDown = index + segmentsX + 2;
                    constraints.push({
                        a: index,
                        b: rightDown,
                        restDistance: particles[index].position.distanceTo(
                            particles[rightDown].position,
                        ),
                    });
                }

                if (x > 0 && y < segmentsY) {
                    const leftDown = index + segmentsX;
                    constraints.push({
                        a: index,
                        b: leftDown,
                        restDistance: particles[index].position.distanceTo(
                            particles[leftDown].position,
                        ),
                    });
                }
            }
        }

        return { particles, constraints, segmentsX, segmentsY };
    }

    // Create geometry
    const {
        particles: initialParticles,
        constraints: initialConstraints,
        segmentsX,
        segmentsY,
    } = initCloth();
    particles = initialParticles;
    constraints = initialConstraints;

    // Create geometry
    clothGeometry = new THREE.PlaneGeometry(
        clothWidth,
        clothHeight,
        clothSegments,
        Math.floor(clothSegments * (clothHeight / clothWidth)),
    );
    clothGeometry.rotateY(0);

    // Update cloth physics
    let time = 0;
    useTask((delta) => {
        time += delta;
        const deltaTime = Math.min(delta, 0.016); // Cap at ~60fps

        // Apply forces
        const gravity = new THREE.Vector3(0, -9.8, 0);
        const wind = new THREE.Vector3(
            Math.sin(time * 0.5) * windStrength +
                Math.sin(time * 2) * windVariation,
            Math.cos(time * 0.7) * windVariation * 0.5,
            Math.cos(time * 0.3) * windStrength * 0.5,
        );

        particles.forEach((particle) => {
            if (particle.fixed) return;

            // Reset acceleration
            particle.acceleration.set(0, 0, 0);

            // Add gravity
            particle.acceleration.add(
                gravity.clone().multiplyScalar(particle.mass),
            );

            // Add wind (more effect on outer edges)
            const distFromCenter = particle.original.x / (clothWidth / 2);
            const windEffect = wind
                .clone()
                .multiplyScalar(1 + Math.abs(distFromCenter) * 0.5);
            particle.acceleration.add(windEffect);
        });

        // Verlet integration
        particles.forEach((particle) => {
            if (particle.fixed) return;

            const vel = particle.position.clone().sub(particle.previous);
            particle.previous.copy(particle.position);

            // Add velocity damping
            vel.multiplyScalar(1 - damping);

            // Add acceleration
            const acceleration = particle.acceleration
                .clone()
                .multiplyScalar(deltaTime * deltaTime);

            particle.position.add(vel).add(acceleration);
        });

        // Satisfy constraints (multiple iterations for stability)
        for (let iter = 0; iter < 3; iter++) {
            constraints.forEach((constraint) => {
                const pa = particles[constraint.a];
                const pb = particles[constraint.b];

                const diff = pb.position.clone().sub(pa.position);
                const dist = diff.length();

                if (dist === 0) return;

                const correction = diff.multiplyScalar(
                    1 - constraint.restDistance / dist,
                );
                const correctionHalf = correction.multiplyScalar(0.5);

                if (!pa.fixed) {
                    pa.position.add(correctionHalf);
                }
                if (!pb.fixed) {
                    pb.position.sub(correctionHalf);
                }
            });
        }

        // Update geometry
        const positions = clothGeometry.attributes.position;
        particles.forEach((particle, i) => {
            positions.setXYZ(
                i,
                particle.position.x,
                particle.position.y,
                particle.position.z,
            );
        });

        positions.needsUpdate = true;
        clothGeometry.computeVertexNormals();
    });
</script>

<T.PerspectiveCamera makeDefault position={[3, 2, 5]} fov={50}>
    <OrbitControls enableDamping autoRotate autoRotateSpeed={0.5} />
</T.PerspectiveCamera>

<T.DirectionalLight position={[5, 10, 5]} intensity={1.5} castShadow />
<T.DirectionalLight position={[-5, 5, -5]} intensity={0.5} />
<T.AmbientLight intensity={0.4} />

<T.Mesh geometry={clothGeometry} castShadow receiveShadow>
    <T.MeshStandardMaterial
        color="#4a90e2"
        side={THREE.DoubleSide}
        roughness={0.5}
        metalness={0.1}
    />
</T.Mesh>

<Grid
    position={[0, -1, 0]}
    cellColor="#666666"
    sectionColor="#888888"
    fadeDistance={20}
    cellSize={0.5}
    sectionSize={2}
/>
