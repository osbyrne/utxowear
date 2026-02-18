<script>
  let count = 0;
</script>

<section class="space-y-4 rounded-box bg-base-200 p-6">
  <h2 class="text-xl font-bold">Svelte Demo Component</h2>
  <p class="text-base-content/80">Button clicked: <span class="badge badge-primary badge-lg">{count}</span></p>
  <div class="flex flex-wrap gap-3">
    <button type="button" class="btn btn-primary" on:click={() => (count += 1)}>Increment</button>
    <button type="button" class="btn btn-outline" on:click={() => (count = 0)}>Reset</button>
  </div>
</section>
