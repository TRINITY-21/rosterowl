<script lang="ts" generics="T">
  // One control for every "start from a ready-made setup" list, so the
  // checklist, jobs and bingo tools all present their presets the same way.
  import type { Preset } from '../lib/presets';

  let {
    label = 'Start from',
    placeholder = 'Choose a starting point…',
    presets,
    onpick,
  }: {
    label?: string;
    placeholder?: string;
    presets: Preset<T>[];
    onpick: (preset: Preset<T>) => void;
  } = $props();

  function onchange(e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    const picked = presets.find((p) => p.key === select.value);
    // Snap back so the field always reads as an action, not a current value —
    // the teacher edits the fields afterwards and the preset stops being true.
    select.value = '';
    if (picked) onpick(picked);
  }
</script>

<label class="print-opt">
  {label}
  <select {onchange} value="">
    <option value="">{placeholder}</option>
    {#each presets as preset (preset.key)}
      <option value={preset.key} title={preset.hint}>{preset.label} — {preset.hint}</option>
    {/each}
  </select>
</label>
