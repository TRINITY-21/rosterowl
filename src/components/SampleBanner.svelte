<script lang="ts">
  // The "you're looking at the demo class" strip every tool shows on a first
  // visit. One component so the wording can vary per tool without the chrome
  // (or the "Use my class list" button) drifting apart.
  import type { Snippet } from 'svelte';

  let { onreplace, children }: { onreplace: () => void; children: Snippet } = $props();
</script>

<div data-sample-banner>
  <span><strong>Sample class.</strong> {@render children()}</span>
  <button class="btn primary small" type="button" onclick={onreplace}>Use my class list</button>
</div>
