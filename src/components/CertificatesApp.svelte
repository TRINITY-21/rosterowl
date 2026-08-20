<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { createPdfPreview } from '../lib/pdfPreview.svelte';
  import PasteModal from './PasteModal.svelte';
  import Toasts from './Toasts.svelte';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import SyncMenu from './SyncMenu.svelte';
  import EmptyState from './EmptyState.svelte';
  import PdfPreview from './PdfPreview.svelte';
  import SampleBanner from './SampleBanner.svelte';
  import { rosterStamp } from '../lib/names';
  import { AWARD_PRESETS } from '../lib/presets';
  import ToolBoundary from './ToolBoundary.svelte';
  import ShareActions from './ShareActions.svelte';
  import { certsPdfFilename } from '../lib/filenames';

  app.load();

  const PRESETS = AWARD_PRESETS;

  let pasteMode = $state<'new' | 'add' | null>(null);
  let award = $state(PRESETS[0]);
  let customAward = $state('');
  let message = $state('for outstanding effort and achievement this year');
  let dateLine = $state(
    new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  );
  let signedBy = $state('');
  let paper = $state<'letter' | 'a4'>('letter');
  let skipAbsent = $state(false);
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
  const effectiveAward = $derived(award === '__custom__' ? customAward || 'Award' : award);
  const recipientCount = $derived(
    (cls?.students ?? []).filter((s) => !(skipAbsent && s.absent)).length
  );

  function opts() {
    return {
      paper,
      award: effectiveAward,
      message,
      dateLine,
      signedBy: signedBy || (cls?.name ?? ''),
      inkSaver,
      showFooter,
      skipAbsent,
    };
  }

  async function generate(previewOnly: boolean): Promise<Uint8Array | null> {
    const c = app.activeClass;
    if (!c || c.students.length === 0) {
      error = 'No class yet — paste your class list first';
      generating = false;
      return null;
    }
    if (recipientCount === 0) {
      preview.clear();
      error = '';
      generating = false;
      return null;
    }
    generating = true;
    error = '';
    try {
      const [{ renderCertificatesPdf }, { loadCertFonts }] = await Promise.all([
        import('../lib/pdfCerts'),
        import('../lib/pdfFonts'),
      ]);
      const fonts = await loadCertFonts();
      // The preview renders just the first certificate that will actually print;
      // downloads render all. Slicing the *filtered* list matters — otherwise a
      // skipped absent first student yields a zero-page preview PDF.
      const students = previewOnly
        ? c.students.filter((s) => !(skipAbsent && s.absent)).slice(0, 1)
        : c.students;
      const { bytes } = await renderCertificatesPdf(students, opts(), fonts);
      if (previewOnly) preview.show(bytes);
      return bytes;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not build the PDF';
      return null;
    } finally {
      generating = false;
    }
  }

  $effect(() => {
    void [effectiveAward, message, dateLine, signedBy, paper, skipAbsent, inkSaver, showFooter, app.activeClassId, rosterKey, cls?.name];
    generating = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => generate(true), 350);
    return () => {
      if (timer) clearTimeout(timer);
    };
  });


  // Rebuilt on demand rather than reusing the preview's bytes, so an option
  // changed while the preview was still rendering cannot ship a stale sheet.
  async function buildPdf(): Promise<Uint8Array> {
    const bytes = await generate(false);
    if (!bytes) throw new Error(error || 'Could not build the PDF');
    return bytes;
  }

  const filename = $derived(certsPdfFilename(cls?.name || 'Class', effectiveAward));

</script>
<ToolBoundary tool="certificate maker">


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
      Preview the certificate, then switch to your own roster.
    </SampleBanner>
  {/if}

  {#if !cls || cls.students.length === 0}
    <EmptyState
      title={cls ? 'No students on this roster' : 'No class yet'}
      actionLabel={cls ? 'Add students' : 'Paste your class list'}
      onaction={() => (pasteMode = cls ? 'add' : 'new')}
    >
      Certificates print one page per student, so RosterOwl needs the names first. Paste your class
      list once — every tool on the site reuses it.
    </EmptyState>
  {:else}
    <!-- The single "nothing to render" state for this tool. The next action lives
         here rather than in the options panel so there is only one such message. -->
    {#snippet noRecipients()}
      <div class="print-msg">
        <p><strong>No certificates to print.</strong></p>
        <p>
          Every student in {cls.name} is marked absent and “Skip students marked absent” is on.
          Uncheck it to include everyone, or update attendance first.
        </p>
        <a class="btn small" href="/seating-chart/">Update attendance</a>
      </div>
    {/snippet}

    <div class="print-grid">
      <div class="print-options">
        <label class="print-opt">
          Award
          <select bind:value={award}>
            {#each PRESETS as p}
              <option value={p}>{p}</option>
            {/each}
            <option value="__custom__">Custom…</option>
          </select>
        </label>
        {#if award === '__custom__'}
          <label class="print-opt">
            Custom award title
            <input bind:value={customAward} placeholder="e.g. Spelling Bee Champion" maxlength="60" />
          </label>
        {/if}
        <label class="print-opt">
          Message
          <textarea class="message-box" bind:value={message} rows="3" maxlength="220"></textarea>
        </label>
        <label class="print-opt">
          Date line
          <input bind:value={dateLine} maxlength="40" />
        </label>
        <label class="print-opt">
          Signed by
          <input bind:value={signedBy} placeholder={cls.name} maxlength="60" />
        </label>
        <label class="print-opt">
          Paper
          <select bind:value={paper}>
            <option value="letter">Letter (US), landscape</option>
            <option value="a4">A4, landscape</option>
          </select>
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={skipAbsent} />
          Skip students marked absent
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={inkSaver} />
          Ink saver (B/W)
        </label>
        <label class="print-check">
          <input type="checkbox" bind:checked={showFooter} />
          “Made with RosterOwl” footer
        </label>
        {#if recipientCount > 0}
          <p class="print-note">
            One landscape certificate per student — {recipientCount}
            {recipientCount === 1 ? 'page' : 'pages'} in a single PDF, full names as they appear in
            your roster.
          </p>
        {/if}
        <ShareActions
          getBytes={buildPdf}
          downloadLabel={`Download ${recipientCount} certificates`}
          {filename}
          label="certificates"
          disabled={generating || !!error || recipientCount === 0}
          onerror={(e) => (error = e instanceof Error ? e.message : 'Could not build the PDF')}
        />
      </div>
      <div class="preview-col">
        <PdfPreview
          label="certificate"
          previewUrl={preview.url}
          {generating}
          {error}
          canPreview={preview.canPreview}
          onretry={() => generate(true)}
          blocked={recipientCount === 0 ? noRecipients : undefined}
        />
        {#if recipientCount > 0 && !error && preview.canPreview}
          <p class="print-note">
            Preview shows the first certificate — the download has one per student.
          </p>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if pasteMode}
  <PasteModal mode={pasteMode} onclose={() => (pasteMode = null)} />
{/if}
<Toasts />
</ToolBoundary>

<style>
  /* The preview column stacks the PDF pane over its caption; min-width:0 keeps
     the grid track from being forced open on a 320px screen. */
  .preview-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  /* The one control teachers retype — let them drag it taller. */
  .message-box {
    width: 100%;
    resize: vertical;
  }
</style>
