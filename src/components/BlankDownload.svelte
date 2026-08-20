<script lang="ts">
  // Builds one blank printable in the browser and hands it to the download
  // shelf. Same shape as TemplateDownload, but driven by the BLANKS catalogue
  // so the gallery stays a data list rather than a pile of components.
  import { BLANKS } from '../lib/blanks';
  import { safeFilename } from '../lib/filenames';
  import Icon from './Icon.svelte';

  let { blankKey }: { blankKey: string } = $props();

  let busy = $state(false);
  let error = $state('');

  async function download() {
    const spec = BLANKS.find((b) => b.key === blankKey);
    if (!spec || busy) return;
    busy = true;
    error = '';
    try {
      const { loadBlankFonts } = await import('../lib/blanks');
      const fonts = await loadBlankFonts();
      const bytes = await spec.render(fonts);
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFilename(spec.filename, 'Blank printable')}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      error =
        e instanceof Error && e.message
          ? e.message
          : "Couldn't build the PDF — check your connection and try again.";
    } finally {
      busy = false;
    }
  }
</script>

<span class="wrap">
  <button class="btn primary small" onclick={download} disabled={busy}>
    <Icon name="download" size={15} />
    {busy ? 'Building…' : 'Download blank PDF'}
  </button>
  {#if error}
    <span class="err" role="alert">
      {error}
      <button class="btn small" onclick={download}>Try again</button>
    </span>
  {/if}
</span>

<style>
  .wrap {
    display: inline-flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .err {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--line));
    border-radius: var(--radius-s);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: var(--text-xs);
    font-weight: 700;
    max-width: 16rem;
  }
</style>
