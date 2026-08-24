<script>
    import { Canvas } from "@threlte/core";
    import Shirt from "../components/Shirt.svelte";
</script>

<div
    class="relative w-full overflow-hidden rounded-2xl bg-base-200/50 cursor-grab active:cursor-grabbing touch-none select-none shadow-inner"
    style="height: 70vh; min-height: 500px;"
>
    <Canvas>
        <Shirt />
    </Canvas>
</div>
