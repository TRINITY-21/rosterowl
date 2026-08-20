<script lang="ts">
  import Modal from './Modal.svelte';
  import { app } from '../lib/appState.svelte';
  import { createPdfPreview } from '../lib/pdfPreview.svelte';
  import ShareActions from './ShareActions.svelte';
  import { chartPdfFilename } from '../lib/filenames';
  import type { PdfOptions } from '../lib/types';

  let { onclose }: { onclose: () => void } = $props();

  let paper = $state<'letter' | 'a4'>('letter');
  let orientation = $state<'portrait' | 'landscape'>('landscape');
  let nameScale = $state(1);
  let inkSaver = $state(false);
  let showFooter = $state(true);

  const preview = createPdfPreview();
  let generating = $state(true);
  let error = $state('');
  let timer: ReturnType<typeof setTimeout> | null = null;

  function opts(): PdfOptions {
    const cls = app.activeClass!;
    const room = app.activeRoom!;
    const date = new Date().toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return {
      paper,
      orientation,
      nameScale,
      inkSaver,
      showFooter,
      title: cls.name,
      subtitle: `${room.name} · ${date}`,
    };
  }

  async function generate(): Promise<Uint8Array | null> {
    const cls = app.activeClass;
    const room = app.activeRoom;
    if (!cls || !room) {
      error = 'No room is set up for this class yet';
      generating = false;
      return null;
    }
    generating = true;
    error = '';
    try {
      const [{ renderChartPdf }, { loadPdfFonts }] = await Promise.all([
        import('../lib/pdf'),
        import('../lib/pdfFonts'),
      ]);
      const fonts = await loadPdfFonts();
      const bytes = await renderChartPdf(room, cls, app.names, opts(), fonts);
      preview.show(bytes);
      return bytes;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not build the PDF';
      return null;
    } finally {
      generating = false;
    }
  }

  function regenerate() {
    generating = true; // disable Download while a stale PDF is on screen
    if (timer) clearTimeout(timer);
    timer = setTimeout(generate, 350);
  }

  $effect(() => {
    // Re-render preview whenever an option changes.
    void [paper, orientation, nameScale, inkSaver, showFooter];
    regenerate();
    return () => {
      if (timer) clearTimeout(timer);
    };
  });


  async function buildPdf(): Promise<Uint8Array> {
    const bytes = await generate();
    if (!bytes) throw new Error(error || 'Could not build the PDF');
    return bytes;
  }

  const filename = $derived(chartPdfFilename(app.activeClass?.name || 'Seating chart'));
</script>

<Modal title="Download seating chart PDF" {onclose} wide>
  <div class="print-grid">
    <div class="print-options in-modal">
      <label class="print-opt">
        Paper
        <select bind:value={paper}>
          <option value="letter">Letter (US)</option>
          <option value="a4">A4</option>
        </select>
      </label>
      <label class="print-opt">
        Orientation
        <select bind:value={orientation}>
          <option value="landscape">Landscape</option>
          <option value="portrait">Portrait</option>
        </select>
      </label>
      <label class="print-opt">
        <span class="range-row">Name size <span class="range-value">{Math.round(nameScale * 100)}%</span></span>
        <input type="range" min="0.75" max="1.6" step="0.05" bind:value={nameScale} />
      </label>
      <label class="print-check">
        <input type="checkbox" bind:checked={inkSaver} />
        Ink saver (B/W outlines — best for school printers)
      </label>
      <label class="print-check">
        <input type="checkbox" bind:checked={showFooter} />
        “Made with RosterOwl” footer
      </label>
      <p class="print-note">
        Always one page, always fits. Seating rules and absences are never printed — names only.
      </p>
      <ShareActions
        getBytes={buildPdf}
        {filename}
        label="seating chart"
        disabled={generating || !!error}
        onerror={(e) => (error = e instanceof Error ? e.message : 'Could not build the PDF')}
      />
    </div>
    <div class="print-preview">
      {#if error}
        <div class="print-msg err" role="alert">
          <p>{error}</p>
          <button class="btn small" onclick={() => generate()}>Try again</button>
        </div>
      {:else if !preview.canPreview}
        <div class="print-msg">
          <p>Your browser can't show PDF previews inline.</p>
          <p>
            The downloaded chart will match what's on your screen — hit
            <strong>Download PDF</strong>.
          </p>
        </div>
      {:else if generating && !preview.url}
        <div class="print-msg" role="status" aria-live="polite">Building preview…</div>
      {:else}
        <object data={preview.url} type="application/pdf" title="PDF preview" aria-label="PDF preview"></object>
      {/if}
    </div>
  </div>
</Modal>

<style>
  /* Inside a modal the options panel doesn't need its own card chrome. */
  .print-options.in-modal {
    position: static;
    border: none;
    padding: 0;
    background: transparent;
  }
  .range-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .range-value {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .print-preview,
  .print-preview object {
    min-height: 26rem;
  }
  @media (max-width: 640px) {
    .print-preview,
    .print-preview object {
      min-height: 19rem;
    }
  }
</style>
