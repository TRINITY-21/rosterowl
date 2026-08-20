<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { buildGroups, type Grouping } from '../lib/groups';
  import { GROUP_HUES } from '../lib/types';
  import PasteModal from './PasteModal.svelte';
  import Toasts from './Toasts.svelte';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import SyncMenu from './SyncMenu.svelte';
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import SampleBanner from './SampleBanner.svelte';
  import ToolBoundary from './ToolBoundary.svelte';
  import ShareActions from './ShareActions.svelte';
  import { groupsPdfFilename } from '../lib/filenames';

  app.load();

  let pasteMode = $state<'new' | 'add' | null>(null);
  let groupSize = $state(4);
  let honorRules = $state(true);
  let includeAbsent = $state(false);
  let seed = $state(Math.floor(Math.random() * 1e9));
  let inkSaver = $state(false);
  let downloading = $state(false);
  let pdfError = $state('');

  const cls = $derived(app.activeClass);
  const pool = $derived(
    (cls?.students ?? []).filter((s) => includeAbsent || !s.absent)
  );
  const grouping: Grouping = $derived(
    buildGroups({
      students: pool,
      groupSize,
      apart: honorRules ? (cls?.apart ?? []) : [],
      together: honorRules ? (cls?.together ?? []) : [],
      seed,
    })
  );
  const absentCount = $derived((cls?.students ?? []).filter((s) => s.absent).length);
  const ruleCount = $derived((cls?.apart.length ?? 0) + (cls?.together.length ?? 0));

  function reshuffle() {
    seed = Math.floor(Math.random() * 1e9);
  }

  async function buildPdf(): Promise<Uint8Array> {
    if (!cls || pool.length === 0) throw new Error('No students to group yet');
    downloading = true;
    pdfError = '';
    try {
      const [{ renderGroupsPdf }, { loadPdfFonts }] = await Promise.all([
        import('../lib/pdfGroups'),
        import('../lib/pdfFonts'),
      ]);
      const fonts = await loadPdfFonts();
      const date = new Date().toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      return await renderGroupsPdf(grouping.groups, app.names, {
        paper: 'letter',
        orientation: grouping.groups.length > 6 ? 'landscape' : 'portrait',
        nameScale: 1,
        inkSaver,
        showFooter: true,
        title: cls.name,
        subtitle: `Groups of ${groupSize} · ${date}`,
      }, fonts);
    } finally {
      downloading = false;
    }
  }

  const filename = $derived(groupsPdfFilename(cls?.name || 'Class'));
</script>
<ToolBoundary tool="group maker">


<div class="tool-frame">
  <div class="tool-toolbar">
    <div class="tool-cluster">
      <ClassSwitcher onnew={() => (pasteMode = 'new')} />
    </div>
    <div class="tool-cluster">
      <label class="ctl">
        Groups of
        <select bind:value={groupSize} aria-label="Groups of">
          {#each [2, 3, 4, 5, 6, 7, 8] as n}
            <option value={n}>{n}</option>
          {/each}
        </select>
      </label>
      <label class="ctl check">
        <input type="checkbox" bind:checked={honorRules} />
        Honor seating rules ({ruleCount})
      </label>
      <label class="ctl check">
        <input type="checkbox" bind:checked={includeAbsent} />
        Include absent
      </label>
    </div>
    <div class="tool-cluster">
      <button class="btn" onclick={() => reshuffle()}>
        <Icon name="shuffle" size={16} />
        Shuffle groups
      </button>
      <label class="ctl check"><input type="checkbox" bind:checked={inkSaver} /> Ink saver (B/W)</label>
      <ShareActions
        getBytes={buildPdf}
        {filename}
        label="groups"
        disabled={!cls || downloading || pool.length === 0}
        onerror={(e) => (pdfError = e instanceof Error && e.message ? e.message : 'Could not build the PDF')}
      />
    </div>
  </div>

  {#if app.isSample}
    <SampleBanner onreplace={() => (pasteMode = 'new')}>
      Explore freely, then replace it with your own roster.
    </SampleBanner>
  {/if}

  {#if pdfError}
    <div class="pdf-error" role="alert">
      <Icon name="alert" size={16} />
      <span class="banner-body">{pdfError}</span>
      <button class="btn small" onclick={() => (pdfError = '')}>Dismiss</button>
    </div>
  {/if}

  {#if !cls || cls.students.length === 0}
    <EmptyState
      title={cls ? 'No students on this roster' : 'No class yet'}
      actionLabel={cls ? 'Add students' : 'Paste your class list'}
      onaction={() => (pasteMode = cls ? 'add' : 'new')}
    >
      Random groups need names first. Paste your class list once — the group maker, the seating
      chart, and every other tool here reuse the same roster.
    </EmptyState>
  {:else if pool.length === 0}
    <EmptyState compact icon="alert" title="Everyone is marked absent" href="/seating-chart/" actionLabel="Update attendance">
      There is nobody left to group. Check “Include absent” in the toolbar to group the whole
      roster anyway, or update today’s attendance in the seating chart.
    </EmptyState>
  {:else}
    {#if grouping.conflicts.length > 0}
      <div class="warn-banner" role="status">
        <Icon name="alert" size={16} />
        <div class="banner-body">
          <strong>
            {grouping.conflicts.length === 1
              ? '1 seating rule could not be honored'
              : `${grouping.conflicts.length} seating rules could not be honored`}
          </strong>
          <ul class="conflict-list">
            {#each grouping.conflicts as c}
              <li>{c.message}</li>
            {/each}
          </ul>
        </div>
        <button class="btn small" onclick={() => reshuffle()}>Try another shuffle</button>
      </div>
    {/if}
    <div class="meta-line" aria-live="polite">
      <strong>{pool.length}</strong> students → <strong>{grouping.groups.length}</strong> groups
      {#if !includeAbsent && absentCount > 0}
        · {absentCount} absent excluded
      {/if}
    </div>
    <h2 class="sr-only">Your groups</h2>
    <div class="groups">
      {#each grouping.groups as g, i}
        <section
          class="gcard"
          style="--hue:var({GROUP_HUES[i % GROUP_HUES.length]})"
          aria-label="Group {i + 1}"
        >
          <header class="ghead">
            <h3>Group {i + 1}</h3>
            <span class="gcount">{g.length} {g.length === 1 ? 'student' : 'students'}</span>
          </header>
          <ul>
            {#each g as s (s.id)}
              <li class:absent={s.absent}>
                {app.names.get(s.id)}{#if s.absent}<span class="sr-only"> (marked absent)</span>{/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</div>

{#if pasteMode}
  <PasteModal mode={pasteMode} onclose={() => (pasteMode = null)} />
{/if}
<Toasts />
</ToolBoundary>

<style>
  /* Toolbar controls: label and control read as one chunk. */
  .ctl {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--muted);
  }

  .ctl.check {
    cursor: pointer;
  }

  /* --- banners -------------------------------------------------------------
     Both use the shared warn/danger token pairs so they read as the same
     family as .print-note.warn elsewhere in the app. */
  .warn-banner,
  .pdf-error {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    border-radius: var(--radius-m);
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .warn-banner {
    align-items: flex-start;
    background: var(--warn-soft);
    border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--line));
    color: var(--warn);
  }

  .pdf-error {
    align-items: center;
    background: var(--danger-soft);
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--line));
    color: var(--danger);
  }

  .warn-banner :global(svg) {
    flex: none;
    margin-top: var(--space-1);
  }

  .pdf-error :global(svg) {
    flex: none;
  }

  .banner-body {
    flex: 1 1 14rem;
    min-width: 0;
  }

  .warn-banner .btn,
  .pdf-error .btn {
    margin-left: auto;
  }

  .conflict-list {
    list-style: none;
    margin: var(--space-1) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-weight: 400;
  }

  /* Running summary of what the shuffle produced. */
  .meta-line {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .meta-line strong {
    color: var(--ink);
  }

  /* --- the group cards are the product ------------------------------------- */
  .groups {
    display: grid;
    /* min() keeps a single card from forcing a horizontal scroll at 320px. */
    grid-template-columns: repeat(auto-fill, minmax(min(13rem, 100%), 1fr));
    gap: var(--space-4);
  }

  .gcard {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-top: 4px solid var(--hue);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-1);
    padding: var(--space-3) var(--space-4) var(--space-4);
  }

  .ghead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .gcard h3 {
    font-size: var(--text-lg);
    color: var(--ink);
  }

  .gcount {
    flex: none;
    padding: var(--space-1) var(--space-2);
    border: 1px solid color-mix(in srgb, var(--hue) 34%, var(--line));
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--hue) 14%, var(--surface));
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }

  .gcard ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }

  .gcard li {
    padding: var(--space-2) 0;
    font-size: var(--text-base);
    font-weight: 700;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  /* Separators between rows only — no dangling rule under the last name. */
  .gcard li + li {
    border-top: 1px dashed var(--line);
  }

  .gcard li:first-child {
    padding-top: 0;
  }

  .gcard li:last-child {
    padding-bottom: 0;
  }

  .gcard li.absent {
    opacity: 0.55;
    text-decoration: line-through;
  }
</style>
