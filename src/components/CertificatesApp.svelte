<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import PasteModal from './PasteModal.svelte';
  import Toasts from './Toasts.svelte';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import EmptyState from './EmptyState.svelte';
  import PdfPreview from './PdfPreview.svelte';
  import Icon from './Icon.svelte';

  app.load();

  const PRESETS = [
    'Certificate of Achievement',
    'Star Reader Award',
    'Kindness Award',
    'Perfect Attendance',
    'Most Improved',
    'Math Star',
    'Super Scientist',
    'Outstanding Effort',
  ];

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

  let previewUrl = $state('');
  let generating = $state(true);
  let error = $state('');
  let timer: ReturnType<typeof setTimeout> | null = null;
  const canPreview =
    typeof navigator === 'undefined' || (navigator as Navigator).pdfViewerEnabled !== false;

  const cls = $derived(app.activeClass);


  // Preview must follow roster edits (including from another tab), or the

  // on-screen PDF and the downloaded file disagree.

  const rosterKey = $derived(

    (cls?.students ?? []).map((s) => `${s.first} ${s.last}|${s.absent}`).join('\0')

  );
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
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
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
      if (previewOnly && canPreview) {
        const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }));
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = url;
      }
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

  $effect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  });

  async function download() {
    if (recipientCount === 0) return;
    const bytes = await generate(false);
    if (!bytes) return;
    const { certsPdfFilename } = await import('../lib/pdfCerts');
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = certsPdfFilename(cls?.name ?? 'Class', effectiveAward);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    app.toast(`${recipientCount} certificates saved as one PDF`, 'ok');
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
      <span><strong>Sample class.</strong> Preview the certificate, then switch to your own roster.</span>
      <button class="btn primary small" onclick={() => (pasteMode = 'new')}>Use my class list</button>
    </div>
  {/if}

  {#if !cls || cls.students.length === 0}
    <EmptyState title="No class yet" actionLabel="Paste your class list" onaction={() => (pasteMode = 'new')}>
      Certificates print one page per student, so RosterOwl needs the names first. Paste your class
      list once — every tool on the site reuses it.
    </EmptyState>
  {:else}
    <!-- The single "nothing to render" state for this tool. The next action lives
         here rather than in the options panel so there is only one such message. -->
    {#snippet noRecipients()}
      <div class="print-msg">
        <p><strong>No one left to certify.</strong></p>
        <p>
          Every student in {cls.name} is marked absent and “Skip students marked absent” is on.
          Untick it to include everyone, or update attendance first.
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
        <button class="btn primary" onclick={() => download()} disabled={generating || !!error || recipientCount === 0}>
          <Icon name="download" size={16} />
          {generating ? 'Preparing preview…' : `Download ${recipientCount} certificates`}
        </button>
      </div>
      <div class="preview-col">
        <PdfPreview
          label="certificate"
          {previewUrl}
          {generating}
          {error}
          {canPreview}
          onretry={() => generate(true)}
          blocked={recipientCount === 0 ? noRecipients : undefined}
        />
        {#if recipientCount > 0 && !error && canPreview}
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
