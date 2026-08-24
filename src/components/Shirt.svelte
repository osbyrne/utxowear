<script lang="ts">
    import { T, useTask, useThrelte } from "@threlte/core";
    import * as THREE from "three";
    import { onMount } from "svelte";

    // Heavyweight 280+ GSM streetwear cotton physics (realistic drape, zero wind)
    const mass = 0.45;
    const damping = 0.085;

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

    let clothMesh: THREE.Mesh | undefined = $state();
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

    // 1. Generate one unified seamless 3D garment mesh (torso, shoulders, and sleeves are ONE single continuous fabric)
    function createShirtGeometry() {
        const parts: Particle[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        const constrs: Constraint[] = [];

        function addParticle(
            pos: THREE.Vector3,
            isFixed: boolean,
            isCollar = false,
        ): number {
            const idx = parts.length;
            parts.push({
                position: pos.clone(),
                previous: pos.clone(),
                original: pos.clone(),
                acceleration: new THREE.Vector3(),
                mass,
                invMass: isFixed ? 0 : 1 / mass,
                fixed: isFixed,
                isCollar,
            });
            return idx;
        }

        function addConstraint(p1: number, p2: number, stiffness = 1.0) {
            if (
                p1 >= 0 &&
                p2 >= 0 &&
                p1 < parts.length &&
                p2 < parts.length &&
                p1 !== p2
            ) {
                const dist = parts[p1].position.distanceTo(parts[p2].position);
                constrs.push({ a: p1, b: p2, restDistance: dist, stiffness });
            }
        }

        // Unified Garment Grid Dimensions
        const Nu = 36; // Columns horizontally from Left Cuff (0) -> Torso (8..28) -> Right Cuff (36)
        const Nv = 26; // Rows vertically from Bottom/Underarm (0) -> Shoulder/Top (26)

        const frontGrid: number[][] = [];
        const backGrid: number[][] = [];

        function computeVertex(
            i: number,
            j: number,
            isBack: boolean,
        ): {
            pos: THREE.Vector3;
            uv: THREE.Vector2;
            isFixed: boolean;
            isCollar: boolean;
        } {
            const u = i / Nu;
            const v = j / Nv;

            let x: number;
            let y: number;
            let z: number;
            let isFixed = false;
            let isCollar = false;

            if (i < 8) {
                // --- Left Sleeve (columns 0..7) ---
                // Continuous extension from left shoulder & underarm out to left cuff
                const t = i / 7; // 0 at cuff, 1 at torso/armhole boundary
                x = -1.28 + t * (-0.60 - -1.28);

                // Sleeve bottom seam and top seam
                const yBot = 0.32 + t * (0.35 - 0.32);
                const yTop = 0.68 + t * (0.92 - 0.68);
                y = yBot + v * (yTop - yBot);

                // 3D cylindrical sleeve depth (open circular hole at cuff i=0)
                const radius = (yTop - yBot) * 0.46;
                const depth = radius * Math.sin(v * Math.PI);
                z = isBack ? -depth : depth;

                // Welded at top and bottom sleeve seams
                if (v === 0 || v === 1) z = 0;
            } else if (i > 28) {
                // --- Right Sleeve (columns 29..36) ---
                // Continuous extension from right shoulder & underarm out to right cuff
                const t = (i - 28) / 8; // 0 at torso/armhole boundary, 1 at cuff
                x = 0.60 + t * (1.28 - 0.60);

                const yBot = 0.35 + t * (0.32 - 0.35);
                const yTop = 0.92 + t * (0.68 - 0.92);
                y = yBot + v * (yTop - yBot);

                const radius = (yTop - yBot) * 0.46;
                const depth = radius * Math.sin(v * Math.PI);
                z = isBack ? -depth : depth;

                if (v === 0 || v === 1) z = 0;
            } else {
                // --- Torso, Chest, Shoulders & Collar (columns 8..28) ---
                const tTorso = (i - 8) / 20; // 0 at left side seam, 1 at right side seam

                // Bottom hem curve
                const yBot =
                    -1.25 - 0.02 * Math.cos((tTorso - 0.5) * Math.PI);
                let yTop: number;

                if (i <= 13) {
                    // Left Shoulder (columns 8..13)
                    const tSh = (i - 8) / 5;
                    x = -0.60 + tSh * (-0.28 - -0.60);
                    yTop = 0.92 + tSh * (1.05 - 0.92);
                    // Fixed on left wooden hanger bar
                    if (j === Nv) isFixed = true;
                } else if (i >= 23) {
                    // Right Shoulder (columns 23..28)
                    const tSh = (i - 23) / 5;
                    x = 0.28 + tSh * (0.60 - 0.28);
                    yTop = 1.05 - tSh * (1.05 - 0.92);
                    // Fixed on right wooden hanger bar
                    if (j === Nv) isFixed = true;
                } else {
                    // Neck Collar Scoop (columns 14..22)
                    const s = (i - 18) / 4.5; // in [-1, 1]
                    x = 0.28 * s;
                    // Front crewneck dips down cleanly; back stays high
                    const scoopFront =
                        1.05 - 0.27 * Math.pow(Math.max(0, 1 - s * s), 0.65);
                    const scoopBack =
                        1.05 - 0.07 * Math.pow(Math.max(0, 1 - s * s), 0.65);
                    yTop = isBack ? scoopBack : scoopFront;
                    if (j >= Nv - 2) isCollar = true;
                }

                // Smooth contoured torso width from hem to underarm
                if (v < 0.62) {
                    const yMid = yBot + (v * (0.35 - yBot)) / 0.62;
                    const w =
                        0.58 + 0.035 * Math.pow((yMid + 0.45) / 0.8, 2);
                    x = -w + 2 * w * tTorso;
                    y = yBot + v * (yTop - yBot);
                } else {
                    y = yBot + v * (yTop - yBot);
                }

                // 3D Chest & Torso Volume Depth
                const depthFactor = Math.sin(
                    Math.min(1, v * 1.4) * Math.PI * 0.5,
                );
                const bodyDepth =
                    0.085 * depthFactor * Math.cos((tTorso - 0.5) * Math.PI);
                z = isBack ? -bodyDepth : bodyDepth;

                // Welded at side seams
                if (i === 8 || i === 28) {
                    z = 0;
                }
            }

            // Normalized UV mapping across unified garment
            const uvX = 0.5 + (x / 1.5) * 0.45;
            const uvY = (y - -1.30) / (1.15 - -1.30);

            return {
                pos: new THREE.Vector3(x, y, z),
                uv: new THREE.Vector2(
                    Math.max(0, Math.min(1, uvX)),
                    Math.max(0, Math.min(1, uvY)),
                ),
                isFixed,
                isCollar,
            };
        }

        // Generate Front and Back Particle Grids
        for (let j = 0; j <= Nv; j++) {
            const frontRow: number[] = [];
            const backRow: number[] = [];

            for (let i = 0; i <= Nu; i++) {
                // Front vertex
                const vF = computeVertex(i, j, false);
                const fIdx = addParticle(vF.pos, vF.isFixed, vF.isCollar);
                uvs.push(vF.uv.x, vF.uv.y);
                frontRow.push(fIdx);

                // Back vertex
                const vB = computeVertex(i, j, true);
                const bIdx = addParticle(vB.pos, vB.isFixed, vB.isCollar);
                uvs.push(vB.uv.x, vB.uv.y);
                backRow.push(bIdx);
            }

            frontGrid.push(frontRow);
            backGrid.push(backRow);
        }

        // Generate Triangles for Unified Front & Back Panels
        for (let j = 0; j < Nv; j++) {
            for (let i = 0; i < Nu; i++) {
                // Front surface (outward facing CCW)
                const f00 = frontGrid[j][i];
                const f10 = frontGrid[j][i + 1];
                const f01 = frontGrid[j + 1][i];
                const f11 = frontGrid[j + 1][i + 1];

                indices.push(f00, f10, f01);
                indices.push(f10, f11, f01);

                // Back surface (outward facing CCW)
                const b00 = backGrid[j][i];
                const b10 = backGrid[j][i + 1];
                const b01 = backGrid[j + 1][i];
                const b11 = backGrid[j + 1][i + 1];

                indices.push(b00, b01, b10);
                indices.push(b10, b01, b11);
            }
        }

        // --- Garment Seam Welding & Constraints ---
        // 1. Top Seams (Left sleeve top + left shoulder, Right shoulder + right sleeve top)
        for (let i = 0; i <= Nu; i++) {
            // Weld everywhere across the top EXCEPT the neck collar opening (columns 14..22)
            if (i <= 13 || i >= 23) {
                addConstraint(frontGrid[Nv][i], backGrid[Nv][i], 1.0);
            }
        }

        // 2. Sleeve Under-Seams (Bottom of sleeves)
        for (let i = 0; i <= 7; i++) {
            addConstraint(frontGrid[0][i], backGrid[0][i], 1.0);
        }
        for (let i = 29; i <= Nu; i++) {
            addConstraint(frontGrid[0][i], backGrid[0][i], 1.0);
        }

        // 3. Torso Side Seams (Bottom hem up to underarms at columns 8 and 28)
        const nUnderarmRow = Math.floor(Nv * 0.62);
        for (let j = 0; j <= nUnderarmRow; j++) {
            // Left side seam
            addConstraint(frontGrid[j][8], backGrid[j][8], 1.0);
            // Right side seam
            addConstraint(frontGrid[j][28], backGrid[j][28], 1.0);
        }

        // 4. Panel Internal Structural, Shear & Bending Springs
        function addSurfaceSprings(grid: number[][]) {
            for (let j = 0; j <= Nv; j++) {
                for (let i = 0; i <= Nu; i++) {
                    const p = grid[j][i];
                    // Structural warp & weft
                    if (i + 1 <= Nu) addConstraint(p, grid[j][i + 1], 1.0);
                    if (j + 1 <= Nv) addConstraint(p, grid[j + 1][i], 1.0);
                    // Shear diagonals
                    if (i + 1 <= Nu && j + 1 <= Nv)
                        addConstraint(p, grid[j + 1][i + 1], 0.88);
                    if (i - 1 >= 0 && j + 1 <= Nv)
                        addConstraint(p, grid[j + 1][i - 1], 0.88);
                    // Bending stiffness across heavy cotton
                    if (i + 2 <= Nu) addConstraint(p, grid[j][i + 2], 0.75);
                    if (j + 2 <= Nv) addConstraint(p, grid[j + 2][i], 0.75);
                }
            }
        }

        addSurfaceSprings(frontGrid);
        addSurfaceSprings(backGrid);

        // 5. Cross-panel Volume Springs (maintains natural 3D chest & torso garment separation)
        for (let j = 2; j <= Nv - 2; j += 2) {
            for (let i = 10; i <= 26; i += 2) {
                addConstraint(frontGrid[j][i], backGrid[j][i], 0.35);
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

    const {
        geom: clothGeometry,
        parts: particles,
        constrs: constraints,
    } = createShirtGeometry();

    // 2. High-resolution cotton streetwear texture
    function createFabricTexture(): THREE.CanvasTexture | null {
        if (typeof document === "undefined") return null;
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        // Dark charcoal obsidian fabric base
        ctx.fillStyle = "#16181e";
        ctx.fillRect(0, 0, 1024, 1024);

        // Dense heavyweight cotton micro-weave texture
        const imgData = ctx.getImageData(0, 0, 1024, 1024);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const noise = (Math.random() - 0.5) * 14;
            data[i] = Math.min(255, Math.max(0, data[i] + noise));
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
        }
        ctx.putImageData(imgData, 0, 0);

        // Collar ribbing arc
        ctx.strokeStyle = "#232630";
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.arc(512, 900, 125, 0, Math.PI);
        ctx.stroke();

        // Bottom hem stitching
        ctx.strokeStyle = "#2a2e3b";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(140, 36);
        ctx.lineTo(884, 36);
        ctx.moveTo(140, 45);
        ctx.lineTo(884, 45);
        ctx.stroke();

        // Sleeve cuff stitching lines
        ctx.beginPath();
        ctx.moveTo(30, 680);
        ctx.lineTo(90, 580);
        ctx.moveTo(994, 680);
        ctx.lineTo(934, 580);
        ctx.stroke();
        ctx.setLineDash([]);

        // Front chest graphic typography: UTXO WEAR
        const chestX = 512;
        const chestY = 660;

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = "#f8fafc";
        ctx.font = "900 48px system-ui, -apple-system, sans-serif";
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

    // 3. Realistic cloth physics simulation (Gravity + Heavy Cotton Drag Response)
    useTask((delta) => {
        const deltaTime = Math.min(delta, 0.016);
        const gravity = new THREE.Vector3(0, -9.8, 0);

        particles.forEach((particle) => {
            if (particle.fixed) return;
            particle.acceleration.set(0, 0, 0);
            particle.acceleration.add(gravity);
        });

        // Verlet integration
        particles.forEach((particle) => {
            if (particle.fixed) return;

            const vel = particle.position.clone().sub(particle.previous);
            particle.previous.copy(particle.position);

            // Heavy fabric damping
            vel.multiplyScalar(1 - damping);

            const acc = particle.acceleration
                .clone()
                .multiplyScalar(deltaTime * deltaTime);
            particle.position.add(vel).add(acc);
        });

        // Interactive mouse drag pull
        if (isDragging && draggedIndex !== -1) {
            const p = particles[draggedIndex];
            p.position.lerp(dragTarget, 0.45);
            p.previous.copy(p.position);

            const radius = 0.50;
            particles.forEach((other, idx) => {
                if (idx === draggedIndex || other.fixed) return;
                const d = other.original.distanceTo(p.original);
                if (d < radius) {
                    const factor = Math.pow(1 - d / radius, 2) * 0.22;
                    other.position.add(
                        dragTarget
                            .clone()
                            .sub(p.original)
                            .multiplyScalar(factor),
                    );
                }
            });
        }

        // Spring relaxation iterations (8 iterations for rigid, non-rubbery garment structure)
        for (let iter = 0; iter < 8; iter++) {
            constraints.forEach((constraint) => {
                const pa = particles[constraint.a];
                const pb = particles[constraint.b];

                const diff = pb.position.clone().sub(pa.position);
                const dist = diff.length();
                if (dist === 0) return;

                const diffNormalized = diff.clone().divideScalar(dist);
                const deltaDist =
                    (dist - constraint.restDistance) * constraint.stiffness;

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

        // Update geometry positions and compute surface normals
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

<!-- Fixed front-facing camera -->
<T.PerspectiveCamera makeDefault position={[0, -0.05, 3.75]} fov={45} />

<!-- Studio Lighting with ambient interior fill -->
<T.DirectionalLight position={[2.5, 4, 3.5]} intensity={1.8} castShadow />
<T.DirectionalLight position={[-2.5, -0.5, 2.5]} intensity={0.8} />
<T.DirectionalLight position={[0, 4, -2.5]} intensity={0.6} />
<T.AmbientLight intensity={0.7} />

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
    <T.Mesh position={[-0.43, 1.0, 0]} rotation={[0, 0, -0.15]}>
        <T.CylinderGeometry args={[0.024, 0.028, 0.72, 16]} />
        <T.MeshStandardMaterial
            color={hangerColor}
            roughness={0.5}
            metalness={0.15}
        />
    </T.Mesh>
    <!-- Right Shoulder Bar -->
    <T.Mesh position={[0.43, 1.0, 0]} rotation={[0, 0, 0.15]}>
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

<!-- 3D Hollow Garment Mesh with Open Sleeves, Collar & Waist -->
<T.Mesh bind:ref={clothMesh} geometry={clothGeometry} castShadow receiveShadow>
    {#if shirtTexture}
        <T.MeshStandardMaterial
            map={shirtTexture}
            side={THREE.DoubleSide}
            roughness={0.85}
            metalness={0.08}
        />
    {:else}
        <T.MeshStandardMaterial
            color="#16181e"
            side={THREE.DoubleSide}
            roughness={0.85}
            metalness={0.08}
        />
    {/if}
</T.Mesh>
