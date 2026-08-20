<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { createPdfPreview } from '../lib/pdfPreview.svelte';
  import type { TagStyle } from '../lib/pdfNameTags';
  import PasteModal from './PasteModal.svelte';
  import Toasts from './Toasts.svelte';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import SyncMenu from './SyncMenu.svelte';
  import EmptyState from './EmptyState.svelte';
  import PdfPreview from './PdfPreview.svelte';
  import SampleBanner from './SampleBanner.svelte';
  import { rosterStamp } from '../lib/names';
  import ToolBoundary from './ToolBoundary.svelte';
  import ShareActions from './ShareActions.svelte';
  import { nameTagsPdfFilename } from '../lib/filenames';

  app.load();

  let pasteMode = $state<'new' | 'add' | null>(null);
  let style = $state<TagStyle>('desk-plate');
  let showLastName = $state(true);
  let cornerLabel = $state('');
  let paper = $state<'letter' | 'a4'>('letter');
  let skipAbsent = $state(false);
  let inkSaver = $state(false);
  let showCutLines = $state(true);

  const preview = createPdfPreview();
  let generating = $state(true);
  let error = $state('');
  let pages = $state(0);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cls = $derived(app.activeClass);
  // Preview must follow roster edits (including from another tab), or the
  // on-screen PDF and the downloaded file disagree.
  const rosterKey = $derived(rosterStamp(cls?.students));
  const tagCount = $derived(
    (cls?.students ?? []).filter((s) => !(skipAbsent && s.absent)).length
  );

  // One word for both styles, so the button, the toast and the note never drift.
  const tagWord = $derived(style === 'desk-plate' ? 'desk plates' : 'name tags');
  // Desk plates print landscape (2 up); badge sheets print portrait (2 × 4).
  const isPortrait = $derived(style === 'badge-8up');
  const perSheet = $derived(isPortrait ? '8 per portrait sheet' : '2 per landscape page');
  const pageNote = $derived(
    generating
      ? 'Page count updates as soon as the preview is ready.'
      : `${pages} ${pages === 1 ? 'page' : 'pages'} in one PDF.`
  );

  function opts() {
    return { paper, style, showLastName, cornerLabel, inkSaver, skipAbsent, showCutLines };
  }

  async function generate(): Promise<Uint8Array | null> {
    const c = app.activeClass;
    if (!c || c.students.length === 0) {
      error = 'No class yet — paste your class list first';
      generating = false;
      return null;
    }
    if (tagCount === 0) {
      preview.clear();
      error = '';
      pages = 0;
      generating = false;
      return null;
    }
    generating = true;
    error = '';
    try {
      const [{ renderNameTagsPdf }, { loadCertFonts }] = await Promise.all([
        import('../lib/pdfNameTags'),
        import('../lib/pdfFonts'),
      ]);
      const fonts = await loadCertFonts();
      const result = await renderNameTagsPdf(c.students, opts(), fonts);
      pages = result.pages;
      preview.show(result.bytes);
      return result.bytes;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not build the PDF';
      return null;
    } finally {
      generating = false;
    }
  }

  $effect(() => {
    void [style, showLastName, cornerLabel, paper, skipAbsent, inkSaver, showCutLines, app.activeClassId, rosterKey, cls?.name];
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

  const filename = $derived(nameTagsPdfFilename(cls?.name || 'Class', style));

</script>
<ToolBoundary tool="name tag maker">


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
      Preview the sheet, then replace it with your own roster.
    </SampleBanner>
  {/if}

  {#if !cls || cls.students.length === 0}
    <EmptyState
      title={cls ? 'No students on this roster' : 'No class yet'}
      actionLabel={cls ? 'Add students' : 'Paste your class list'}
      onaction={() => (pasteMode = cls ? 'add' : 'new')}
    >
      Tags are printed straight from your roster, so RosterOwl needs the names first. Paste your
      class list once — a tag for everyone, no name typed twice, and every other tool reuses it.
    </EmptyState>
  {:else}
    <!-- The single "nothing to render" state for this tool. The next action lives
         here rather than in the options panel so there is only one such message. -->
    {#snippet noTags()}
      <div class="print-msg">
        <p><strong>No tags to print.</strong></p>
        <p>
          Every student in {cls.name} is marked absent and “Skip students marked absent” is on.
          Uncheck it to print a tag for the whole class, or update attendance first.
        </p>
        <a class="btn small" href="/seating-chart/">Update attendance</a>
      </div>
    {/snippet}

    <div class="print-grid">
      <div class="print-options">
        <label class="print-opt">
          Style
          <select bind:value={style}>
            <option value="desk-plate">Desk plates — 2 per page</option>
            <option value="badge-8up">Name tags — 8 per sheet (Avery 5395)</option>
          </select>
        </label>
        <label class="print-opt">
          Paper
          <select bind:value={paper}>
            <option value="letter">Letter (US)</option>
            <option value="a4">A4</option>
          </select>
        </label>
        <label class="print-opt">
          Corner label (optional)
          <input bind:value={cornerLabel} placeholder={cls.name} maxlength="40" />
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={showLastName} />
          Show last names
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={showCutLines} />
          Dashed cut guides
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={skipAbsent} />
          Skip students marked absent
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={inkSaver} />
          Ink saver (B/W)
        </label>
        {#if tagCount > 0}
          <p class="print-note">
            {tagCount} {tagWord}, {perSheet}. {pageNote}
          </p>
        {/if}
        <ShareActions
          getBytes={buildPdf}
          downloadLabel={`Download ${tagCount} ${tagWord}`}
          {filename}
          label="name tags"
          disabled={generating || !!error || tagCount === 0}
          onerror={(e) => (error = e instanceof Error ? e.message : 'Could not build the PDF')}
        />
      </div>
      <PdfPreview
        label={style === 'desk-plate' ? 'desk plate' : 'name tag'}
        previewUrl={preview.url}
        {generating}
        {error}
        canPreview={preview.canPreview}
        onretry={() => generate()}
        portrait={isPortrait}
        blocked={tagCount === 0 ? noTags : undefined}
      />
    </div>
  {/if}
</div>

{#if pasteMode}
  <PasteModal mode={pasteMode} onclose={() => (pasteMode = null)} />
{/if}
<Toasts />
</ToolBoundary>
