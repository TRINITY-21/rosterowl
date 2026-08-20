<!-- RosterOwl classroom jobs chart tool -->
<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { createPdfPreview } from '../lib/pdfPreview.svelte';
  import { JOB_PRESETS, type Preset } from '../lib/presets';
  import PresetPicker from './PresetPicker.svelte';
  import PasteModal from './PasteModal.svelte';
  import Icon from './Icon.svelte';
  import Toasts from './Toasts.svelte';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import SyncMenu from './SyncMenu.svelte';
  import EmptyState from './EmptyState.svelte';
  import PdfPreview from './PdfPreview.svelte';
  import SampleBanner from './SampleBanner.svelte';
  import { rosterStamp } from '../lib/names';
  import ToolBoundary from './ToolBoundary.svelte';
  import ShareActions from './ShareActions.svelte';
  import { jobsPdfFilename } from '../lib/filenames';

  app.load();

  let pasteMode = $state<'new' | 'add' | null>(null);
  let title = $state('Our Classroom Jobs');
  let weekLabel = $state('');
  let paper = $state<'letter' | 'a4'>('letter');
  let inkSaver = $state(false);
  let showFooter = $state(true);
  let newJob = $state('');

  const preview = createPdfPreview();
  let generating = $state(true);
  let error = $state('');
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cls = $derived(app.activeClass);
  // Preview must follow roster edits (including from another tab), or the
  // on-screen PDF and the downloaded file disagree.
  const rosterKey = $derived(rosterStamp(cls?.students));
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
      preview.clear();
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


  // Rebuilt on demand rather than reusing the preview's bytes, so an option
  // changed while the preview was still rendering cannot ship a stale sheet.
  async function buildPdf(): Promise<Uint8Array> {
    const bytes = await generate();
    if (!bytes) throw new Error(error || 'Could not build the PDF');
    return bytes;
  }

  const filename = $derived(jobsPdfFilename(cls?.name || 'Class'));

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
  function applyPreset(preset: Preset<string[]> = JOB_PRESETS[0]) {
    const c = app.activeClass;
    if (!c) return;
    const prev = [...c.jobs.titles];
    const titles = preset.value;
    app.applyJobPreset(titles);
    app.toast(
      prev.length
        ? `Replaced ${prev.length} job${prev.length === 1 ? '' : 's'} with ${preset.label} (${titles.length})`
        : `${titles.length} jobs added — ${preset.label}`,
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
<ToolBoundary tool="jobs chart">


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
      Try a rotation, then replace it with your own roster.
    </SampleBanner>
  {/if}

  {#if !cls || cls.students.length === 0}
    <EmptyState
      title={cls ? 'No students on this roster' : 'No class yet'}
      actionLabel={cls ? 'Add students' : 'Paste your class list'}
      onaction={() => (pasteMode = cls ? 'add' : 'new')}
    >
      Paste your class list once — every jobs chart starts from it.
    </EmptyState>
  {:else}
    <div class="print-grid jobs-grid">
      <div class="print-options">
        <PresetPicker
          label="Ready-made job sets"
          presets={JOB_PRESETS}
          onpick={(p) => applyPreset(p)}
        />

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
        <ShareActions
          getBytes={buildPdf}
          downloadLabel="Download jobs chart"
          {filename}
          label="jobs chart"
          disabled={generating || !!error || jobCount === 0}
          onerror={(e) => (error = e instanceof Error ? e.message : 'Could not build the PDF')}
        />
      </div>
      <!-- One instance; see ChecklistApp for why the two branches collapsed. -->
      <PdfPreview
        label="jobs chart"
        previewUrl={preview.url}
        {generating}
        {error}
        canPreview={preview.canPreview}
        onretry={() => generate()}
        portrait
        blocked={jobCount === 0 ? noJobs : undefined}
      />

      {#snippet noJobs()}
        <EmptyState
          compact
          title="No jobs on the chart yet"
          actionLabel={`Add the ${JOB_PRESETS[0].value.length} classic jobs`}
          onaction={() => applyPreset()}
        >
          Add one on the left, or start from the classics — line leader, door holder, paper
          passer and friends. Rename or remove any of them afterwards; the poster preview
          appears here.
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
  /* This panel holds a two-field-per-row editor, not a stack of single
     controls, so it runs wider than the standard options column — at 19rem
     "Materials Manager" and "Class Librarian" were both cut off. */
  .jobs-grid {
    grid-template-columns: minmax(20rem, 25rem) minmax(0, 1fr);
  }

  .job-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .job-row {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) auto;
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
    /* This rule outranks the global .print-grid collapse, so it has to collapse
       itself — a 20rem minimum would push a phone into horizontal scrolling. */
    .jobs-grid {
      grid-template-columns: minmax(0, 1fr);
    }

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
