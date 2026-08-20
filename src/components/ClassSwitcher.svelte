<script lang="ts">
  import { app } from '../lib/appState.svelte';

  let { onnew, onswitch }: { onnew: () => void; onswitch?: () => void } = $props();

  function onChange(e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    if (select.value === '__new__') {
      onnew();
      select.value = app.activeClassId ?? '';
      return;
    }
    app.switchClass(select.value);
    onswitch?.();
  }
</script>

<label class="switcher">
  <span class="sr-only">Current class</span>
  <select aria-label="Switch class" value={app.activeClassId ?? ''} onchange={onChange}>
    {#each app.classes as cls (cls.id)}
      <option value={cls.id}>{cls.name}</option>
    {/each}
    {#if app.classes.length === 0}
      <option value="" disabled>No class yet</option>
    {/if}
    <option value="__new__">+ New class…</option>
  </select>
</label>

<style>
  .switcher {
    display: inline-flex;
    min-width: 0;
  }

  select {
    width: min(15rem, 100%);
    font-weight: 700;
  }

  @media (max-width: 640px) {
    .switcher,
    select {
      width: 100%;
    }
  }
</style>
