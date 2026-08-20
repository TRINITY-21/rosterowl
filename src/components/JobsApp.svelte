<!-- RosterOwl classroom jobs chart tool -->
<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { JOB_PRESET } from '../lib/jobs';
  import PasteModal from './PasteModal.svelte';
  import Icon from './Icon.svelte';
  import Toasts from './Toasts.svelte';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import EmptyState from './EmptyState.svelte';
  import PdfPreview from './PdfPreview.svelte';

  app.load();

  let pasteMode = $state<'new' | 'add' | null>(null);
  let title = $state('Our Classroom Jobs');
  let weekLabel = $state('');
  let paper = $state<'letter' | 'a4'>('letter');
  let inkSaver = $state(false);
  let showFooter = $state(true);
  let newJob = $state('');

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
  const titles = $derived(cls?.jobs.titles ?? []);
  const assignments = $derived(app.jobAssignments);
  const jobCount = $derived(titles.length);
  const assignedCount = $derived(assignments.filter((s) => s !== null).length);
  const studentCount = $derived(cls?.students.length ?? 0);
  const unstaffed = $derived(Math.max(0, jobCount - studentCount));

  function displayName(id: string): string {
    return app.names.get(id) ?? '';
  }

  /** PRIVACY: names only — never absence flags or any other roster tag. */
  function entries() {
    return titles.map((t, i) => {
      const s = assignments[i] ?? null;
      return { title: t, name: s ? displayName(s.id) || `${s.first} ${s.last}`.trim() : null };
    });
  }

  function opts() {
    return { paper, title, weekLabel, inkSaver, showFooter };
  }

  async function generate(): Promise<Uint8Array | null> {
    const c = app.activeClass;
    if (!c || c.students.length === 0) {
      error = 'No class yet — paste your class list first';
      generating = false;
      return null;
    }
    if (jobCount === 0) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      error = '';
      generating = false;
      return null;
    }
    generating = true;
    error = '';
    try {
      const [{ renderJobsChartPdf }, { loadCertFonts }] = await Promise.all([
        import('../lib/pdfJobs'),
        import('../lib/pdfFonts'),
      ]);
      const fonts = await loadCertFonts();
      const { bytes } = await renderJobsChartPdf(entries(), opts(), fonts);
      if (canPreview) {
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
    void [
      title,
      weekLabel,
      paper,
      inkSaver,
      showFooter,
      app.activeClassId,
      JSON.stringify(titles),
      // Resolved names, not just ids: renaming a student leaves the ids
      // untouched, and the poster would keep printing the old spelling.
      assignments.map((s) => (s ? (app.names.get(s.id) ?? `${s.first} ${s.last}`) : '')).join(','),
      rosterKey,
      cls?.name,
    ];
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
    if (jobCount === 0) return;
    const bytes = await generate();
    if (!bytes) return;
    const { jobsPdfFilename } = await import('../lib/pdfJobs');
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = jobsPdfFilename(cls?.name ?? 'Class');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    app.toast('Jobs chart saved to your downloads', 'ok');
  }

  function commitRename(i: number, e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    app.renameJob(i, input.value);
    // renameJob ignores blank titles — snap the field back to the kept value.
    input.value = app.activeClass?.jobs.titles[i] ?? input.value;
  }

  function onAssign(i: number, e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    if (select.value) app.assignJob(i, select.value);
    // The value binding is one-way; snap back so the DOM can never show a
    // pick the model rejected (e.g. an overflow row).
    select.value = app.jobAssignments[i]?.id ?? '';
  }

  function addJob() {
    const t = newJob.trim();
    if (!t) return;
    app.addJob(t);
    newJob = '';
  }

  /**
   * The preset OVERWRITES the whole title list, so it always leaves an undo —
   * same contract as app.rotateJobs. The class is captured by reference so undo
   * restores this class's list even if another class is active when it's clicked.
   */
  function applyPreset() {
    const c = app.activeClass;
    if (!c) return;
    const prev = [...c.jobs.titles];
    app.applyJobPreset(JOB_PRESET);
    app.toast(
      prev.length
        ? `Replaced ${prev.length} job${prev.length === 1 ? '' : 's'} with the ${JOB_PRESET.length} classics`
        : `${JOB_PRESET.length} classic jobs added`,
      'ok',
      {
        label: 'Undo',
        run: () => {
          c.jobs.titles = [...prev];
          app.scheduleSave();
        },
      }
    );
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
      <span><strong>Sample class.</strong> Try a rotation, then replace it with your own roster.</span>
      <button class="btn primary small" onclick={() => (pasteMode = 'new')}>Use my class list</button>
    </div>
  {/if}

  {#if !cls || cls.students.length === 0}
    <EmptyState title="No class yet" actionLabel="Paste your class list" onaction={() => (pasteMode = 'new')}>
      Paste your class list once — every job chart starts from it.
    </EmptyState>
  {:else}
    <div class="print-grid">
      <div class="print-options">
        {#if jobCount > 0}
          <div class="job-rows" role="group" aria-label="Jobs and who does them">
            {#each titles as jobTitle, i}
              <div class="job-row">
                <input
                  class="job-title"
                  value={jobTitle}
                  maxlength="40"
                  aria-label={`Job ${i + 1} title`}
                  onchange={(e) => commitRename(i, e)}
                />
                <select
                  class="job-assign"
                  aria-label={`Who does ${jobTitle}`}
                  value={assignments[i]?.id ?? ''}
                  disabled={i >= studentCount}
                  onchange={(e) => onAssign(i, e)}
                >
                  {#if !assignments[i]}
                    <option value="">{i >= studentCount ? '— more jobs than students —' : '— unassigned —'}</option>
                  {/if}
                  {#each cls.students as s (s.id)}
                    <option value={s.id}>{displayName(s.id)}{s.absent ? ' (absent)' : ''}</option>
                  {/each}
                </select>
                <button
                  class="icon-btn danger"
                  aria-label={`Remove ${jobTitle}`}
                  title={`Remove ${jobTitle}`}
                  onclick={() => app.removeJob(i)}
                ><Icon name="close" size={14} /></button>
              </div>
            {/each}
          </div>
        {/if}

        <form
          class="job-add"
          onsubmit={(e) => {
            e.preventDefault();
            addJob();
          }}
        >
          <input
            bind:value={newJob}
            maxlength="40"
            placeholder="Add a job, e.g. Pet Feeder"
            aria-label="New job title"
          />
          <button class="btn small" type="submit" disabled={!newJob.trim()}>Add job</button>
        </form>

        {#if jobCount > 0}
          <div class="job-actions">
            <button class="btn primary" onclick={() => app.rotateJobs()}>Rotate jobs</button>
            <button class="btn small" onclick={() => app.shuffleJobCrew()}>Shuffle crew</button>
          </div>
          <p class="print-note">Every job changes hands each rotation — and everyone gets equal turns over the cycle.</p>
          <p class="print-note status">
            {assignedCount} of {studentCount} students have a job this week.
          </p>
          {#if unstaffed > 0}
            <p class="print-note warn" role="status">
              <Icon name="alert" size={14} />
              <span>
                {unstaffed} more job{unstaffed === 1 ? '' : 's'} than students — the last
                {unstaffed === 1 ? 'card prints' : `${unstaffed} cards print`} a dash instead of a
                name. Remove a job to fill the chart.
              </span>
            </p>
          {/if}
        {/if}

        <label class="print-opt">
          Poster title
          <input bind:value={title} maxlength="60" placeholder="Our Classroom Jobs" />
        </label>
        <label class="print-opt">
          Week label (optional)
          <input bind:value={weekLabel} maxlength="40" placeholder="e.g. Week of Sept 8" />
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
        <p class="print-note">
          {jobCount === 0
            ? 'Add a job to build the poster.'
            : `${jobCount} job${jobCount === 1 ? '' : 's'} on a poster — always one page.`}
        </p>
        <button class="btn primary" onclick={() => download()} disabled={generating || !!error || jobCount === 0}>
          <Icon name="download" size={16} />
          {generating && jobCount > 0 ? 'Preparing preview…' : 'Download jobs chart'}
        </button>
      </div>
      {#if jobCount === 0}
        <PdfPreview
          label="jobs chart"
          {previewUrl}
          {generating}
          {error}
          {canPreview}
          onretry={() => generate()}
          portrait
        >
          {#snippet blocked()}
            <EmptyState
              compact
              title="No jobs on the chart yet"
              actionLabel={`Add the ${JOB_PRESET.length} classic jobs`}
              onaction={applyPreset}
            >
              Add one on the left, or start from the classics — line leader, door holder, paper
              passer and friends. Rename or remove any of them afterwards; the poster preview
              appears here.
            </EmptyState>
          {/snippet}
        </PdfPreview>
      {:else}
        <PdfPreview
          label="jobs chart"
          {previewUrl}
          {generating}
          {error}
          {canPreview}
          onretry={() => generate()}
          portrait
        />
      {/if}
    </div>
  {/if}
</div>

{#if pasteMode}
  <PasteModal mode={pasteMode} onclose={() => (pasteMode = null)} />
{/if}
<Toasts />

<style>
  .job-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .job-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
  }

  .job-add {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  /* One compact control size for every field in the job editor. */
  .job-row input,
  .job-row select,
  .job-add input {
    min-width: 0;
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
  }

  .job-row input,
  .job-row select {
    width: 100%;
  }

  .job-add input {
    flex: 1;
  }

  @media (max-width: 640px) {
    /* Match the global 16px floor: anything smaller makes iOS Safari zoom in
       when the field is focused. */
    .job-row input,
    .job-row select,
    .job-add input {
      font-size: var(--text-base);
    }
  }

  .job-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  /* The live readout of the panel — full ink so it reads before the help text. */
  .status {
    font-weight: 700;
    color: var(--ink);
  }

  /* The alert glyph is a flex item of the global .print-note.warn row: keep it
     from shrinking on a 320px screen and sit it on the first line of text. */
  .print-note.warn :global(svg) {
    flex: none;
    margin-top: 0.15em;
  }
</style>
