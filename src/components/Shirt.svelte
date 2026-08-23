<script lang="ts">
    import { T, useTask, useThrelte } from "@threlte/core";
    import * as THREE from "three";
    import { onMount } from "svelte";

    // Cloth simulation physics parameters
    const mass = 0.08;
    const damping = 0.032;
    const windStrength = 0.35;
    const windSpeed = 1.1;

    type Particle = {
        position: THREE.Vector3;
        previous: THREE.Vector3;
        original: THREE.Vector3;
        acceleration: THREE.Vector3;
        mass: number;
        invMass: number;
        fixed: boolean;
        isCollar?: boolean;
    };

    type Constraint = {
        a: number;
        b: number;
        restDistance: number;
        stiffness: number;
    };

    let clothGeometry: THREE.BufferGeometry;
    let clothMesh: THREE.Mesh | undefined = $state();
    let particles: Particle[] = [];
    let constraints: Constraint[] = [];
    let shirtTexture = $state<THREE.CanvasTexture | null>(null);

    // Interaction state
    let isDragging = $state(false);
    let isHovered = $state(false);
    let draggedIndex = -1;
    let dragTarget = new THREE.Vector3();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const { camera, renderer } = useThrelte();

    // 1. Generate accurate T-shirt silhouette and particle mesh
    function createShirtGeometry() {
        const resX = 42;
        const resY = 50;
        const minX = -1.35,
            maxX = 1.35;
        const minY = -1.30,
            maxY = 1.15;

        function isInsideShirt(x: number, y: number): boolean {
            const ax = Math.abs(x);
            const w_neck = 0.28;
            if (y > 1.06) return false;

            // Crew neckline cutout
            if (ax < w_neck) {
                const y_collar = 0.85 + 0.21 * Math.pow(ax / w_neck, 2);
                if (y > y_collar) return false;
            }

            // Shoulder and top sleeve seam
            let y_top: number;
            if (ax <= 0.70) {
                y_top = 1.06 - (ax - w_neck) * (0.12 / (0.70 - w_neck));
            } else if (ax <= 1.28) {
                y_top = 0.94 - (ax - 0.70) * (0.29 / (1.28 - 0.70));
            } else {
                return false;
            }
            if (y > y_top) return false;

            // Short sleeve opening and underarm
            if (ax > 0.58) {
                if (ax > 1.28) return false;
                // Sleeve cuff: from (1.28, 0.65) to (1.10, 0.26)
                if (ax >= 1.10) {
                    const y_cuff = 0.26 + (ax - 1.10) * (0.39 / 0.18);
                    if (y < y_cuff) return false;
                } else {
                    // Underarm: from (1.10, 0.26) to (0.58, 0.35)
                    const y_under = 0.35 - (ax - 0.58) * (0.09 / 0.52);
                    if (y < y_under) return false;
                }
            } else {
                // Torso / waist contour
                const w_torso = 0.58 + 0.04 * Math.pow((y + 0.3) / 0.95, 2);
                if (ax > w_torso) return false;
            }

            // Curved bottom hem
            const y_bottom =
                -1.25 - 0.02 * Math.cos((ax / 0.62) * Math.PI * 0.5);
            if (y < y_bottom) return false;

            return true;
        }

        const grid: number[][] = [];
        const parts: Particle[] = [];
        const uvs: number[] = [];

        for (let j = 0; j <= resY; j++) {
            const row: number[] = [];
            const v = j / resY;
            const y = minY + v * (maxY - minY);
            for (let i = 0; i <= resX; i++) {
                const u = i / resX;
                const x = minX + u * (maxX - minX);
                if (isInsideShirt(x, y)) {
                    const idx = parts.length;
                    const ax = Math.abs(x);

                    // Natural 3D body curvature around chest/torso
                    let z = 0;
                    if (ax <= 0.65) {
                        z = 0.07 * Math.cos((ax / 0.65) * (Math.PI / 2));
                    }

                    // Fix points along the hanger / shoulder line
                    const isShoulderFixed =
                        y >= 0.88 && ax >= 0.26 && ax <= 0.70;

                    const pos = new THREE.Vector3(x, y, z);
                    parts.push({
                        position: pos.clone(),
                        previous: pos.clone(),
                        original: pos.clone(),
                        acceleration: new THREE.Vector3(),
                        fixed: isShoulderFixed,
                        mass,
                        invMass: isShoulderFixed ? 0 : 1 / mass,
                        isCollar: y >= 0.82 && ax <= 0.32,
                    });

                    // Normalized UV mapping
                    uvs.push(
                        (x - minX) / (maxX - minX),
                        (y - minY) / (maxY - minY),
                    );
                    row.push(idx);
                } else {
                    row.push(-1);
                }
            }
            grid.push(row);
        }

        // Generate triangles
        const indices: number[] = [];
        for (let j = 0; j < resY; j++) {
            for (let i = 0; i < resX; i++) {
                const p00 = grid[j][i];
                const p10 = grid[j][i + 1];
                const p01 = grid[j + 1][i];
                const p11 = grid[j + 1][i + 1];

                if (p00 !== -1 && p10 !== -1 && p01 !== -1) {
                    indices.push(p00, p10, p01);
                }
                if (p10 !== -1 && p11 !== -1 && p01 !== -1) {
                    indices.push(p10, p11, p01);
                }
            }
        }

        // Generate cloth structural, shear and bending springs
        const constrs: Constraint[] = [];
        function addConstraint(p1: number, p2: number, stiffness = 1.0) {
            if (
                p1 !== -1 &&
                p2 !== -1 &&
                p1 !== undefined &&
                p2 !== undefined
            ) {
                const dist = parts[p1].position.distanceTo(parts[p2].position);
                constrs.push({ a: p1, b: p2, restDistance: dist, stiffness });
            }
        }

        for (let j = 0; j <= resY; j++) {
            for (let i = 0; i <= resX; i++) {
                const p = grid[j][i];
                if (p === -1) continue;
                // Structural constraints
                if (i + 1 <= resX) addConstraint(p, grid[j][i + 1], 1.0);
                if (j + 1 <= resY) addConstraint(p, grid[j + 1][i], 1.0);
                // Shear constraints
                if (i + 1 <= resX && j + 1 <= resY)
                    addConstraint(p, grid[j + 1][i + 1], 0.75);
                if (i - 1 >= 0 && j + 1 <= resY)
                    addConstraint(p, grid[j + 1][i - 1], 0.75);
                // Bending constraints (fabric stiffness against crumpling)
                if (i + 2 <= resX) addConstraint(p, grid[j][i + 2], 0.45);
                if (j + 2 <= resY) addConstraint(p, grid[j + 2][i], 0.45);
            }
        }

        const geom = new THREE.BufferGeometry();
        const posArray = new Float32Array(parts.length * 3);
        parts.forEach((p, i) => {
            posArray[i * 3] = p.position.x;
            posArray[i * 3 + 1] = p.position.y;
            posArray[i * 3 + 2] = p.position.z;
        });
        geom.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
        geom.setAttribute(
            "uv",
            new THREE.BufferAttribute(new Float32Array(uvs), 2),
        );
        geom.setIndex(indices);
        geom.computeVertexNormals();

        return { geom, parts, constrs };
    }

    const { geom, parts, constrs } = createShirtGeometry();
    clothGeometry = geom;
    particles = parts;
    constraints = constrs;

    // 2. Generate high-resolution fabric texture with UTXO branding & seams
    function createFabricTexture(): THREE.CanvasTexture | null {
        if (typeof document === "undefined") return null;
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        // Dark charcoal obsidian fabric base
        ctx.fillStyle = "#181a20";
        ctx.fillRect(0, 0, 1024, 1024);

        // Cotton micro-weave texture
        const imgData = ctx.getImageData(0, 0, 1024, 1024);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const noise = (Math.random() - 0.5) * 16;
            data[i] = Math.min(255, Math.max(0, data[i] + noise));
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
        }
        ctx.putImageData(imgData, 0, 0);

        // Collar ribbing line
        ctx.strokeStyle = "#252833";
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(512, 905, 120, 0, Math.PI);
        ctx.stroke();

        // Bottom hem stitching
        ctx.strokeStyle = "#2a2e3b";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(180, 36);
        ctx.lineTo(844, 36);
        ctx.moveTo(180, 45);
        ctx.lineTo(844, 45);
        ctx.stroke();

        // Sleeve cuff stitching
        ctx.beginPath();
        ctx.moveTo(40, 715);
        ctx.lineTo(100, 620);
        ctx.moveTo(984, 715);
        ctx.lineTo(924, 620);
        ctx.stroke();
        ctx.setLineDash([]);

        // Chest graphic typography: UTXO WEAR
        const chestX = 512;
        const chestY = 670;

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Modern glowing clean streetwear logo
        ctx.fillStyle = "#f8fafc";
        ctx.font = "900 46px system-ui, -apple-system, sans-serif";
        ctx.letterSpacing = "6px";
        ctx.fillText("UTXO", chestX, chestY - 12);

        ctx.font = "600 15px system-ui, -apple-system, sans-serif";
        ctx.letterSpacing = "10px";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("WEAR", chestX + 4, chestY + 28);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        return tex;
    }

    onMount(() => {
        shirtTexture = createFabricTexture();

        const canvasEl = renderer.domElement;

        function updateMouse(e: PointerEvent) {
            const rect = canvasEl.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        }

        function onPointerDown(e: PointerEvent) {
            if (!clothMesh) return;
            updateMouse(e);
            raycaster.setFromCamera(mouse, camera.current);
            const intersects = raycaster.intersectObject(clothMesh);
            if (intersects.length > 0) {
                const hitPoint = intersects[0].point;
                let closestIdx = -1;
                let minDist = Infinity;
                particles.forEach((p, idx) => {
                    if (p.fixed) return;
                    const d = p.position.distanceTo(hitPoint);
                    if (d < minDist) {
                        minDist = d;
                        closestIdx = idx;
                    }
                });

                if (closestIdx !== -1 && minDist < 0.7) {
                    isDragging = true;
                    draggedIndex = closestIdx;
                    dragPlane.setFromNormalAndCoplanarPoint(
                        new THREE.Vector3(0, 0, 1),
                        particles[closestIdx].position,
                    );
                    dragTarget.copy(particles[closestIdx].position);
                    canvasEl.setPointerCapture?.(e.pointerId);
                }
            }
        }

        function onPointerMove(e: PointerEvent) {
            updateMouse(e);
            if (isDragging && draggedIndex !== -1) {
                raycaster.setFromCamera(mouse, camera.current);
                const target = new THREE.Vector3();
                if (raycaster.ray.intersectPlane(dragPlane, target)) {
                    dragTarget.copy(target);
                }
            } else if (clothMesh) {
                raycaster.setFromCamera(mouse, camera.current);
                const intersects = raycaster.intersectObject(clothMesh);
                isHovered = intersects.length > 0;
            }
        }

        function onPointerUp(e: PointerEvent) {
            if (isDragging) {
                isDragging = false;
                draggedIndex = -1;
                try {
                    canvasEl.releasePointerCapture?.(e.pointerId);
                } catch {}
            }
        }

        canvasEl.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);

        return () => {
            canvasEl.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerUp);
            if (shirtTexture) shirtTexture.dispose();
            clothGeometry.dispose();
        };
    });

    // 3. Realistic cloth physics simulation
    let time = 0;
    useTask((delta) => {
        time += delta;
        const deltaTime = Math.min(delta, 0.016);

        // Ambient natural cloth wave and subtle draft
        const gravity = new THREE.Vector3(0, -9.8, 0);

        particles.forEach((particle) => {
            if (particle.fixed) return;

            particle.acceleration.set(0, 0, 0);

            // Gravity
            particle.acceleration.add(
                gravity.clone().multiplyScalar(particle.mass),
            );

            // Gentle organic wave / breeze effect across the fabric
            const distFromTop = (1.1 - particle.original.y) / 2.3;
            const waveX = Math.sin(
                time * windSpeed * 1.5 + particle.original.y * 2.5,
            );
            const waveZ = Math.cos(
                time * windSpeed +
                    particle.original.x * 2.0 +
                    particle.original.y * 1.5,
            );

            const wind = new THREE.Vector3(
                waveX * 0.08 * distFromTop,
                -0.02 * distFromTop,
                (waveZ * 0.28 + 0.12) * windStrength * Math.pow(distFromTop, 1.2),
            );

            particle.acceleration.add(wind);
        });

        // Verlet integration
        particles.forEach((particle) => {
            if (particle.fixed) return;

            const vel = particle.position.clone().sub(particle.previous);
            particle.previous.copy(particle.position);

            // Damping
            vel.multiplyScalar(1 - damping);

            const acc = particle.acceleration
                .clone()
                .multiplyScalar(deltaTime * deltaTime);
            particle.position.add(vel).add(acc);
        });

        // Interactive mouse drag pull
        if (isDragging && draggedIndex !== -1) {
            const p = particles[draggedIndex];
            p.position.lerp(dragTarget, 0.5);
            p.previous.copy(p.position);

            // Influence neighboring vertices with smooth falloff
            const radius = 0.55;
            particles.forEach((other, idx) => {
                if (idx === draggedIndex || other.fixed) return;
                const d = other.original.distanceTo(p.original);
                if (d < radius) {
                    const factor = Math.pow(1 - d / radius, 2) * 0.28;
                    other.position.add(
                        dragTarget
                            .clone()
                            .sub(p.original)
                            .multiplyScalar(factor),
                    );
                }
            });
        }

        // Spring relaxation iterations
        for (let iter = 0; iter < 4; iter++) {
            constraints.forEach((constraint) => {
                const pa = particles[constraint.a];
                const pb = particles[constraint.b];

                const diff = pb.position.clone().sub(pa.position);
                const dist = diff.length();
                if (dist === 0) return;

                const diffNormalized = diff.clone().divideScalar(dist);
                const deltaDist = (dist - constraint.restDistance) * constraint.stiffness;

                if (!pa.fixed && !pb.fixed) {
                    pa.position.add(
                        diffNormalized.clone().multiplyScalar(deltaDist * 0.5),
                    );
                    pb.position.sub(
                        diffNormalized.clone().multiplyScalar(deltaDist * 0.5),
                    );
                } else if (!pa.fixed) {
                    pa.position.add(
                        diffNormalized.clone().multiplyScalar(deltaDist),
                    );
                } else if (!pb.fixed) {
                    pb.position.sub(
                        diffNormalized.clone().multiplyScalar(deltaDist),
                    );
                }
            });
        }

        // Update geometry positions and compute normals
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

    // Sleek hanger geometry parameters
    const hangerColor = "#262320"; // Dark polished walnut
    const hookColor = "#94a3b8"; // Brushed metallic silver
</script>

<!-- Fixed front-facing camera (no rotating plane / stable display) -->
<T.PerspectiveCamera makeDefault position={[0, -0.05, 3.75]} fov={45} />

<!-- Studio Lighting -->
<T.DirectionalLight position={[2, 4, 3.5]} intensity={1.8} castShadow />
<T.DirectionalLight position={[-2, -1, 2.5]} intensity={0.7} />
<T.DirectionalLight position={[0, 4, -2]} intensity={0.5} />
<T.AmbientLight intensity={0.65} />

<!-- Sleek Minimalist Hanger Group -->
<T.Group position={[0, 0, 0]}>
    <!-- Hanger Hook -->
    <T.Mesh position={[0, 1.2, 0]}>
        <T.TorusGeometry args={[0.09, 0.014, 16, 32, Math.PI * 1.3]} />
        <T.MeshStandardMaterial
            color={hookColor}
            metalness={0.85}
            roughness={0.25}
        />
    </T.Mesh>
    <!-- Hook Base Stem -->
    <T.Mesh position={[0, 1.08, 0]}>
        <T.CylinderGeometry args={[0.014, 0.014, 0.1, 16]} />
        <T.MeshStandardMaterial
            color={hookColor}
            metalness={0.85}
            roughness={0.25}
        />
    </T.Mesh>
    <!-- Left Shoulder Bar -->
    <T.Mesh
        position={[-0.43, 1.0, 0]}
        rotation={[0, 0, -0.15]}
    >
        <T.CylinderGeometry args={[0.024, 0.028, 0.72, 16]} />
        <T.MeshStandardMaterial
            color={hangerColor}
            roughness={0.5}
            metalness={0.15}
        />
    </T.Mesh>
    <!-- Right Shoulder Bar -->
    <T.Mesh
        position={[0.43, 1.0, 0]}
        rotation={[0, 0, 0.15]}
    >
        <T.CylinderGeometry args={[0.024, 0.028, 0.72, 16]} />
        <T.MeshStandardMaterial
            color={hangerColor}
            roughness={0.5}
            metalness={0.15}
        />
    </T.Mesh>
    <!-- Center Hanger Node -->
    <T.Mesh position={[0, 1.05, 0]}>
        <T.SphereGeometry args={[0.038, 16, 16]} />
        <T.MeshStandardMaterial
            color={hangerColor}
            roughness={0.5}
            metalness={0.15}
        />
    </T.Mesh>
</T.Group>

<!-- 3D Shirt Mesh -->
<T.Mesh
    bind:ref={clothMesh}
    geometry={clothGeometry}
    castShadow
    receiveShadow
>
    {#if shirtTexture}
        <T.MeshStandardMaterial
            map={shirtTexture}
            side={THREE.DoubleSide}
            roughness={0.85}
            metalness={0.08}
        />
    {:else}
        <T.MeshStandardMaterial
            color="#181a20"
            side={THREE.DoubleSide}
            roughness={0.85}
            metalness={0.08}
        />
    {/if}
</T.Mesh>
