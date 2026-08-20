<!-- RosterOwl class checklist tool -->
<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { createPdfPreview } from '../lib/pdfPreview.svelte';
  import type { NameOrder } from '../lib/pdfChecklist';
  import PasteModal from './PasteModal.svelte';
  import Toasts from './Toasts.svelte';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import SyncMenu from './SyncMenu.svelte';
  import EmptyState from './EmptyState.svelte';
  import PdfPreview from './PdfPreview.svelte';
  import SampleBanner from './SampleBanner.svelte';
  import { rosterStamp } from '../lib/names';
  import PresetPicker from './PresetPicker.svelte';
  import { CHECKLIST_PRESETS } from '../lib/presets';
  import Icon from './Icon.svelte';
  import ToolBoundary from './ToolBoundary.svelte';
  import ShareActions from './ShareActions.svelte';
  import { checklistPdfFilename } from '../lib/filenames';

  app.load();

  let pasteMode = $state<'new' | 'add' | null>(null);
  let title = $state('Checklist');
  let columns = $state<string[]>(['', '', '', '', '']);
  let nameOrder = $state<NameOrder>('last');
  let orientation = $state<'portrait' | 'landscape'>('portrait');
  let paper = $state<'letter' | 'a4'>('letter');
  let includeAbsent = $state(true);
  let inkSaver = $state(false);
  let showFooter = $state(true);

  const preview = createPdfPreview();
  let generating = $state(true);
  let error = $state('');
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cls = $derived(app.activeClass);
  // Preview must follow roster edits (including from another tab), or the
  // on-screen PDF and the downloaded file disagree.
  const rosterKey = $derived(rosterStamp(cls?.students));
  const rowCount = $derived(
    (cls?.students ?? []).filter((s) => includeAbsent || !s.absent).length
  );

  function setColumnCount(n: number) {
    const next = columns.slice(0, n);
    while (next.length < n) next.push('');
    columns = next;
  }

  function applyColumnPreset(value: string[]) {
    // Assigning a new array changes the count select too — it reads length.
    columns = [...value];
  }

  function opts() {
    const date = new Date().toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return {
      paper,
      orientation,
      title,
      subtitle: `${cls?.name ?? ''} · ${date}`,
      columns: columns.map((c) => c.trim()),
      nameOrder,
      includeAbsent,
      inkSaver,
      showFooter,
    };
  }

  async function generate(): Promise<Uint8Array | null> {
    const c = app.activeClass;
    if (!c || c.students.length === 0) {
      error = 'No class yet — paste your class list first';
      generating = false;
      return null;
    }
    if (rowCount === 0) {
      preview.clear();
      error = '';
      generating = false;
      return null;
    }
    generating = true;
    error = '';
    try {
      const [{ renderChecklistPdf }, { loadPdfFonts }] = await Promise.all([
        import('../lib/pdfChecklist'),
        import('../lib/pdfFonts'),
      ]);
      const fonts = await loadPdfFonts();
      const { bytes } = await renderChecklistPdf(c.students, opts(), fonts);
      preview.show(bytes);
      return bytes;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not build the PDF';
      return null;
    } finally {
      generating = false;
    }
  }

  $effect(() => {
    void [title, columns.join('\0'), nameOrder, orientation, paper, includeAbsent, inkSaver, showFooter, app.activeClassId, rosterKey, cls?.name];
    generating = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => generate(), 350);
    return () => {
      if (timer) clearTimeout(timer);
    };
  });


  // Rebuilt on demand rather than reusing the preview's bytes, so an option
  // changed while the preview was still rendering cannot ship a stale sheet.
  async function buildPdf(): Promise<Uint8Array> {
    const bytes = await generate();
    if (!bytes) throw new Error(error || 'Could not build the PDF');
    return bytes;
  }

  const filename = $derived(checklistPdfFilename(cls?.name || 'Class', title));

</script>
<ToolBoundary tool="checklist maker">


<div class="tool-frame">
  <div class="tool-toolbar">
    <div class="tool-cluster">
      <ClassSwitcher onnew={() => (pasteMode = 'new')} />
    </div>
    <div class="tool-cluster">
      <SyncMenu />
    </div>
  </div>

  {#if app.isSample}
    <SampleBanner onreplace={() => (pasteMode = 'new')}>
      Build a checklist, then replace it with your own roster.
    </SampleBanner>
  {/if}

  {#if !cls || cls.students.length === 0}
    <EmptyState
      title={cls ? 'No students on this roster' : 'No class yet'}
      actionLabel={cls ? 'Add students' : 'Paste your class list'}
      onaction={() => (pasteMode = cls ? 'add' : 'new')}
    >
      Paste your class list once — every checklist starts from it.
    </EmptyState>
  {:else}
    <div class="print-grid">
      <div class="print-options">
        <label class="print-opt">
          Title
          <input bind:value={title} maxlength="80" placeholder="e.g. Permission slips" />
        </label>
        <PresetPicker
          label="Ready-made checklists"
          presets={CHECKLIST_PRESETS}
          onpick={(p) => applyColumnPreset(p.value)}
        />

        <label class="print-opt">
          Columns
          <select value={String(columns.length)} onchange={(e) => setColumnCount(Number(e.currentTarget.value))}>
            {#each [1, 2, 3, 4, 5, 6, 7, 8, 10, 12] as n}
              <option value={String(n)}>{n}</option>
            {/each}
          </select>
        </label>

        <div class="col-group" role="group" aria-labelledby="checklist-col-heading">
          <div class="col-head">
            <span class="col-heading" id="checklist-col-heading">Column headers</span>
            <button
              type="button"
              class="btn small quiet"
              aria-label="Fill the columns with Mon–Fri"
              onclick={() => applyColumnPreset(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])}
            >
              Mon–Fri
            </button>
          </div>
          <div class="col-labels">
            {#each columns as _, i}
              <input
                class="col-label"
                bind:value={columns[i]}
                maxlength="14"
                placeholder={`Col ${i + 1}`}
                aria-label={`Column ${i + 1} header`}
              />
            {/each}
          </div>
          <p class="print-note">Leave a header blank to print an empty cell.</p>
        </div>

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
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape (more columns)</option>
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
          <input type="checkbox" bind:checked={includeAbsent} />
          Include students marked absent
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={inkSaver} />
          Ink saver (B/W)
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={showFooter} />
          “Made with RosterOwl” footer
        </label>
        {#if rowCount === 0}
          <p class="print-note warn" role="status">
            <Icon name="alert" size={14} />
            <span>No rows to print — every student is marked absent.</span>
          </p>
        {:else}
          <p class="print-note">
            {rowCount} students × {columns.length}
            {columns.length === 1 ? 'column' : 'columns'} — numbered, always one page.
          </p>
        {/if}
        <ShareActions
          getBytes={buildPdf}
          downloadLabel="Download checklist"
          {filename}
          label="checklist"
          disabled={generating || !!error || rowCount === 0}
          onerror={(e) => (error = e instanceof Error ? e.message : 'Could not build the PDF')}
        />
      </div>

      <!-- One instance, handed the blocked snippet only when there is nothing
           to print. The two branches this replaced were identical but for that
           snippet, which is six props each waiting to be changed in one copy. -->
      <PdfPreview
        label="checklist"
        previewUrl={preview.url}
        {generating}
        {error}
        canPreview={preview.canPreview}
        onretry={() => generate()}
        portrait={orientation === 'portrait'}
        blocked={rowCount === 0 ? allAbsent : undefined}
      />

      {#snippet allAbsent()}
        <EmptyState compact icon="alert" title="Nothing to print yet" href="/seating-chart/" actionLabel="Review attendance">
          Every student in {cls?.name ?? 'this class'} is marked absent, so the checklist has no rows. Check
          “Include students marked absent” above to print the whole class, or fix attendance first.
        </EmptyState>
      {/snippet}
    </div>
  {/if}
</div>

{#if pasteMode}
  <PasteModal mode={pasteMode} onclose={() => (pasteMode = null)} />
{/if}
<Toasts />
</ToolBoundary>

<style>
  /* Column headers read as one labelled group, not a loose row of inputs. */
  .col-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* The Mon–Fri preset gets its own row so it never reflows with the inputs. */
  .col-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .col-heading {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--muted);
  }

  /* auto-fill keeps 1–12 inputs on a tidy grid and never overflows 320px. */
  .col-labels {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
    gap: var(--space-2);
  }

  .col-label {
    min-width: 0;
    width: 100%;
    min-height: var(--control-h-sm);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
  }

  @media (max-width: 640px) {
    .col-label {
      min-height: var(--touch-target);
    }
  }
</style>
