<script lang="ts">
  import { safeFilename } from '../lib/filenames';
  import { TEMPLATES } from '../lib/geometry';
  import type { ClassData, Room } from '../lib/types';
  import { emptyJobs, emptyWordLists } from '../lib/types';
  import Icon from './Icon.svelte';

  let { templateKey, label }: { templateKey: string; label: string } = $props();

  let busy = $state(false);
  let error = $state('');

  async function download() {
    const tpl = TEMPLATES.find((t) => t.key === templateKey);
    if (!tpl || busy) return;
    busy = true;
    error = '';
    try {
      const [{ renderChartPdf }, { loadPdfFonts }] = await Promise.all([
        import('../lib/pdf'),
        import('../lib/pdfFonts'),
      ]);
      const desks = tpl.make();
      const minX = Math.min(...desks.map((d) => d.x));
      const maxX = Math.max(...desks.map((d) => d.x));
      const room: Room = {
        id: 'tpl',
        name: '',
        desks,
        teacherDesk: { x: (minX + maxX) / 2, y: 0.2 },
        door: null,
      };
      const cls: ClassData = {
        id: 'tpl-class',
        name: '',
        roomId: 'tpl',
        students: [],
        apart: [],
        together: [],
        seating: {},
        locked: [],
        pickerHistory: [],
        jobs: emptyJobs(),
        wordLists: emptyWordLists(),
      };
      const fonts = await loadPdfFonts();
      const wide = maxX - minX > 8;
      const bytes = await renderChartPdf(
        room,
        cls,
        new Map(),
        {
          paper: 'letter',
          orientation: wide ? 'landscape' : 'portrait',
          nameScale: 1,
          inkSaver: false,
          showFooter: true,
          title: `Seating chart — ${label}`,
          subtitle: 'Class: ____________________ Date: ______________',
        },
        fonts
      );
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFilename(`Blank seating chart — ${label}`, 'Blank seating chart')}.pdf`;
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
    align-items: flex-end;
  }
  .err {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--line));
    border-radius: var(--radius-s);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: var(--text-xs);
    font-weight: 700;
    max-width: 16rem;
    text-align: right;
  }
</style>
