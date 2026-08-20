<script lang="ts">
  import Modal from './Modal.svelte';
  import { app } from '../lib/appState.svelte';
  import type { PdfOptions } from '../lib/types';

  let { onclose }: { onclose: () => void } = $props();

  let paper = $state<'letter' | 'a4'>('letter');
  let orientation = $state<'portrait' | 'landscape'>('landscape');
  let nameScale = $state(1);
  let inkSaver = $state(false);
  let showFooter = $state(true);

  let previewUrl = $state('');
  let generating = $state(true);
  let error = $state('');
  // navigator.pdfViewerEnabled === false means the browser can't show PDFs
  // inline (some Safari/WebKit setups) — show a friendly note instead of a
  // blank box. Undefined (older browsers) is treated as "probably can".
  const canPreview =
    typeof navigator === 'undefined' || (navigator as Navigator).pdfViewerEnabled !== false;
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

  async function generate() {
    const cls = app.activeClass;
    const room = app.activeRoom;
    if (!cls || !room) {
      error = 'No room is set up for this class yet';
      generating = false;
      return;
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
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = url;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not build the PDF';
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

  $effect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  });

  async function download() {
    if (!previewUrl) return;
    const { chartPdfFilename } = await import('../lib/pdf');
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = chartPdfFilename(app.activeClass?.name ?? 'Seating chart');
    a.click();
    app.toast('Chart PDF saved to your downloads', 'ok');
  }
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
        Always one page, always fits. Student rules and absences are never printed — names only.
      </p>
      <button class="btn primary dl" onclick={download} disabled={generating || !!error}>
        {generating ? 'Preparing preview…' : 'Download PDF'}
      </button>
    </div>
    <div class="print-preview">
      {#if error}
        <div class="print-msg err" role="alert">
          <p>{error}</p>
          <button class="btn small" onclick={generate}>Try again</button>
        </div>
      {:else if !canPreview}
        <div class="print-msg">
          <p>Your browser can't show PDF previews inline.</p>
          <p>
            The downloaded chart will match what's on your screen — hit
            <strong>Download PDF</strong>.
          </p>
        </div>
      {:else if generating && !previewUrl}
        <div class="print-msg" role="status" aria-live="polite">Building preview…</div>
      {:else}
        <object data={previewUrl} type="application/pdf" title="PDF preview" aria-label="PDF preview"></object>
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
  .dl {
    justify-content: center;
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
