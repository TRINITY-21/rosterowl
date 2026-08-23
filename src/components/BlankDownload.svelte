<script lang="ts">
  // Builds one blank printable in the browser and hands it to the download
  // shelf. Same shape as TemplateDownload, but driven by the BLANKS catalogue
  // so the gallery stays a data list rather than a pile of components.
  import { ALL_BLANKS } from '../lib/blanks';
  import { safeFilename } from '../lib/filenames';
  import ShareActions from './ShareActions.svelte';

  let { blankKey }: { blankKey: string } = $props();

  let error = $state('');

  const spec = $derived(ALL_BLANKS.find((b) => b.key === blankKey));
  const filename = $derived(`${safeFilename(spec?.filename ?? '', 'Blank printable')}.pdf`);

  async function buildPdf(): Promise<Uint8Array> {
    if (!spec) throw new Error('That blank is no longer available');
    error = '';
    const { loadBlankFonts } = await import('../lib/blanks');
    return await spec.render(await loadBlankFonts());
  }
</script>

<span class="wrap">
  <ShareActions
    getBytes={buildPdf}
    downloadLabel="Download blank PDF"
    {filename}
    label="blank printable"
    compact
    onerror={(e) =>
      (error =
        e instanceof Error && e.message
          ? e.message
          : "Couldn't build the PDF — check your connection and try again.")}
  />
  {#if error}
    <span class="err" role="alert">
      {error}
      <button class="btn small" onclick={() => (error = '')}>Dismiss</button>
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
