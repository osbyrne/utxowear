<script>
    import { Canvas } from "@threlte/core";
    import Shirt from "../components/Shirt.svelte";
</script>

<div
    class="relative h-[clamp(22rem,58vh,42rem)] w-full cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-base-200/50 shadow-inner active:cursor-grabbing sm:h-[clamp(28rem,64vh,46rem)] lg:h-[clamp(34rem,66vh,50rem)]"
>
    <Canvas>
        <Shirt />
    </Canvas>
</div>
