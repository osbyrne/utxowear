<script>
    import { Canvas } from "@threlte/core";
    import Shirt from "../components/Shirt.svelte";
</script>

<div class="relative w-full overflow-hidden rounded-2xl bg-base-200/50 cursor-grab active:cursor-grabbing touch-none select-none shadow-inner" style="height: 70vh; min-height: 500px;">
    <Canvas>
        <Shirt />
    </Canvas>
    <div class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-base-100/70 px-3 py-1 text-xs font-medium text-base-content/70 backdrop-blur-sm shadow-sm ring-1 ring-base-300/50">
        ✨ Click & drag fabric to interact
    </div>
</div>
