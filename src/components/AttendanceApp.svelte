<!-- RosterOwl monthly attendance sheet tool -->
<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import type { NameOrder } from '../lib/pdfChecklist';
  import PasteModal from './PasteModal.svelte';
  import Toasts from './Toasts.svelte';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import EmptyState from './EmptyState.svelte';
  import PdfPreview from './PdfPreview.svelte';
  import Icon from './Icon.svelte';

  app.load();

  // The current month plus the next 11 — the value carries year + 0-based month.
  const now = new Date();
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return {
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    };
  });

  let pasteMode = $state<'new' | 'add' | null>(null);
  let monthKey = $state(monthOptions[0]!.key);
  let nameOrder = $state<NameOrder>('last');
  let orientation = $state<'portrait' | 'landscape'>('landscape');
  let paper = $state<'letter' | 'a4'>('letter');
  let inkSaver = $state(false);
  let showFooter = $state(true);

  let previewUrl = $state('');
  let generating = $state(true);
  let error = $state('');
  // 0 means "not measured yet": every real month has at least one school day,
  // so a zero here is either the first render or a render that failed.
  let days = $state(0);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const canPreview =
    typeof navigator === 'undefined' || (navigator as Navigator).pdfViewerEnabled !== false;

  const cls = $derived(app.activeClass);
  // An attendance register always lists everyone — deliberately no skip-absent option.
  const rowCount = $derived((cls?.students ?? []).length);
  let unrenderable = $state<string[]>([]);
  // Names only (privacy rule). Tracked by the preview effect so roster edits regenerate.
  const namesKey = $derived(
    (cls?.students ?? []).map((s) => `${s.first} ${s.last}`.trim()).join('\0')
  );
  // Never show a stale or placeholder day count — the register is only ever
  // one page, so the number is the one thing the note actually promises.
  const daysLabel = $derived(generating || days === 0 ? '…' : String(days));

  function selectedMonth(): { year: number; month: number } {
    const [year = now.getFullYear(), month = now.getMonth()] = monthKey.split('-').map(Number);
    return { year, month };
  }

  function opts() {
    const { year, month } = selectedMonth();
    return {
      paper,
      orientation,
      year,
      month,
      nameOrder,
      inkSaver,
      showFooter,
      subtitle: cls?.name ?? '',
    };
  }

  // Options are snapshotted synchronously (before any await) so the rendered
  // register, its filename, and its title can never disagree — the month
  // select stays live while a render is in flight.
  async function generate(o = opts()): Promise<Uint8Array | null> {
    const c = app.activeClass;
    if (!c || c.students.length === 0) {
      error = 'No class yet — paste your class list first';
      days = 0;
      generating = false;
      return null;
    }
    generating = true;
    error = '';
    try {
      const [{ renderAttendancePdf }, { loadPdfFonts }] = await Promise.all([
        import('../lib/pdfAttendance'),
        import('../lib/pdfFonts'),
      ]);
      const fonts = await loadPdfFonts();
      const result = await renderAttendancePdf(c.students, o, fonts);
      days = result.days;
      unrenderable = result.unrenderable;
      if (canPreview) {
        const url = URL.createObjectURL(
          new Blob([result.bytes.slice().buffer], { type: 'application/pdf' })
        );
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = url;
      }
      return result.bytes;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not build the PDF';
      days = 0;
      return null;
    } finally {
      generating = false;
    }
  }

  $effect(() => {
    void [monthKey, nameOrder, orientation, paper, inkSaver, showFooter, namesKey, cls?.name, app.activeClassId];
    generating = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => generate(), 350);
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
    if (rowCount === 0) return;
    const o = opts();
    const bytes = await generate(o);
    if (!bytes) return;
    const { attendancePdfFilename } = await import('../lib/pdfAttendance');
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = attendancePdfFilename(o.subtitle || 'Class', o.year, o.month);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    app.toast('Attendance sheet saved to your downloads', 'ok');
  }

</script>

<div class="tool-frame">
  <div class="tool-toolbar">
    <div class="tool-cluster">
      <ClassSwitcher onnew={() => (pasteMode = 'new')} />
    </div>
  </div>

  {#if app.isSample}
    <div data-sample-banner>
      <span><strong>Sample class.</strong> Preview the sheet, then replace it with your own roster.</span>
      <button class="btn primary small" onclick={() => (pasteMode = 'new')}>Use my class list</button>
    </div>
  {/if}

  {#if !cls || cls.students.length === 0}
    <EmptyState
      title={cls ? 'No students on this roster' : 'No class yet'}
      actionLabel={cls ? 'Add students' : 'Paste your class list'}
      onaction={() => (pasteMode = cls ? 'add' : 'new')}
    >
      Paste your class list once — every month's attendance sheet starts from it, and you can
      reprint any month without typing the names again.
    </EmptyState>
  {:else}
    <div class="print-grid">
      <div class="print-options">
        <label class="print-opt">
          Month
          <select bind:value={monthKey}>
            {#each monthOptions as m}
              <option value={m.key}>{m.label}</option>
            {/each}
          </select>
        </label>
        <label class="print-opt">
          Name order
          <select bind:value={nameOrder}>
            <option value="last">Last name A→Z (Last, First)</option>
            <option value="first">First name A→Z</option>
            <option value="roster">Roster order</option>
          </select>
        </label>
        <label class="print-opt">
          Layout
          <select bind:value={orientation}>
            <option value="landscape">Landscape (roomier day columns)</option>
            <option value="portrait">Portrait</option>
          </select>
        </label>
        <label class="print-opt">
          Paper
          <select bind:value={paper}>
            <option value="letter">Letter (US)</option>
            <option value="a4">A4</option>
          </select>
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={inkSaver} />
          Ink saver (B/W)
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={showFooter} />
          “Made with RosterOwl” footer
        </label>
        {#if unrenderable.length > 0}
          <p class="print-note warn" role="status">
            <Icon name="alert" size={14} />
            <span>
              This font can't print {unrenderable.length === 1 ? 'this name' : 'these names'}:
              {unrenderable.join(', ')} — {unrenderable.length === 1 ? 'it' : 'they'} would show as
              boxes. Consider a Latin-alphabet spelling for the printout.
            </span>
          </p>
        {/if}
        <p class="print-note">
          {rowCount} student{rowCount === 1 ? '' : 's'} × {daysLabel} school days — always one page.
        </p>
        <button class="btn primary" onclick={() => download()} disabled={generating || !!error || rowCount === 0}>
          <Icon name="download" size={16} />
          {generating ? 'Preparing preview…' : 'Download attendance sheet'}
        </button>
      </div>
      <PdfPreview
        label="attendance sheet"
        {previewUrl}
        {generating}
        {error}
        {canPreview}
        onretry={() => generate()}
        portrait={orientation === 'portrait'}
      />
    </div>
  {/if}
</div>

{#if pasteMode}
  <PasteModal mode={pasteMode} onclose={() => (pasteMode = null)} />
{/if}
<Toasts />

<style>
  /* The alert glyph is a flex item of the global .print-note.warn row: keep it
     from shrinking on a 320px screen and sit it on the first line of text. */
  .print-note.warn :global(svg) {
    flex: none;
    margin-top: 0.15em;
  }
</style>
