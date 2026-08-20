<script lang="ts">
  // The preview pane every printable tool shares: error → can't-preview →
  // skeleton → the PDF itself. Centralised so all nine surfaces behave and
  // look identical, and so a fix lands everywhere at once.
  import type { Snippet } from 'svelte';

  let {
    /** Human-readable name of the document, e.g. "attendance sheet". */
    label,
    previewUrl,
    generating,
    error = '',
    onretry,
    /** False when the browser can't render PDFs inline (some WebKit setups). */
    canPreview = true,
    /** Skeleton page shape while the first render is in flight. */
    portrait = false,
    /** Optional tool-specific state shown instead of the PDF (e.g. "pool too small"). */
    blocked,
  }: {
    label: string;
    previewUrl: string;
    generating: boolean;
    error?: string;
    onretry?: () => void;
    canPreview?: boolean;
    portrait?: boolean;
    blocked?: Snippet;
  } = $props();
</script>

<div class="print-preview">
  {#if error}
    <div class="print-msg err" role="alert">
      <p>{error}</p>
      {#if onretry}
        <button class="btn small" onclick={onretry}>Try again</button>
      {/if}
    </div>
  {:else if blocked}
    {@render blocked()}
  {:else if !canPreview}
    <div class="print-msg">
      <p>Your browser can't show PDF previews inline.</p>
      <p>The download will match exactly — use the download button.</p>
    </div>
  {:else if generating && !previewUrl}
    <div class="print-skeleton">
      <p class="sr-only" role="status" aria-live="polite">Building {label} preview…</p>
      <div class="sheet" data-portrait={portrait ? '' : undefined} aria-hidden="true">
        <span class="skeleton-line title"></span>
        <span class="skeleton-line"></span>
        <span class="skeleton-line short"></span>
        <span class="skeleton-line grid"></span>
        <span class="skeleton-line short"></span>
      </div>
    </div>
  {:else}
    <object
      data={previewUrl}
      type="application/pdf"
      title="{label} preview"
      aria-label="{label} preview"
      class:stale={generating}
    ></object>
  {/if}
</div>

<style>
  /* A regenerating preview dims rather than disappearing — no flash of empty. */
  object.stale {
    opacity: 0.55;
    transition: opacity var(--motion-medium) ease;
  }
</style>
