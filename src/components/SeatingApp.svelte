<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { confirmDialog } from '../lib/dialog.svelte';
  import { TEMPLATES, desksMatchTemplate } from '../lib/geometry';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import PasteModal from './PasteModal.svelte';
  import PdfDialog from './PdfDialog.svelte';
  import RoomCanvas from './RoomCanvas.svelte';
  import RosterPanel from './RosterPanel.svelte';
  import Toasts from './Toasts.svelte';
  import VersionHistoryModal from './VersionHistoryModal.svelte';

  let { preset }: { preset?: string } = $props();

  // The templates gallery links here as /seating-chart/?preset=<key>, so a card
  // opens the layout it shows. An explicit prop (the SEO landing pages) wins.
  const activePreset = $derived.by(() => {
    if (preset) return preset;
    if (typeof location === 'undefined') return undefined;
    const key = new URLSearchParams(location.search).get('preset');
    return key && TEMPLATES.some((t) => t.key === key) ? key : undefined;
  });

  // First visit on a layout-specific landing page starts the sample room from
  // that layout. Saved state always wins over the preset.
  $effect(() => app.load(activePreset));

  let pasteMode = $state<'new' | 'add' | null>(null);
  let pdfOpen = $state(false);
  let versionsOpen = $state(false);
  let restoreInput: HTMLInputElement | undefined = $state();
  let rosterOpen = $state(true);
  let frameEl: HTMLDivElement | undefined = $state();

  /**
   * Close any open toolbar popover when clicking elsewhere or acting. Scoped to
   * this component's own <details> — a document-wide query would also slam the
   * header's tools panel shut on every pointerdown in here.
   */
  function closePopovers(e?: Event) {
    for (const d of frameEl?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? []) {
      if (!e || !d.contains(e.target as Node)) d.open = false;
    }
  }

  const cls = $derived(app.activeClass);

  // Layout-specific landing pages promise a specific arrangement. When saved
  // state won over the preset, offer a one-click switch instead of lying.
  const presetTemplate = $derived(
    activePreset ? (TEMPLATES.find((t) => t.key === activePreset) ?? null) : null
  );
  const presetPending = $derived(
    presetTemplate !== null &&
      app.loaded &&
      app.activeRoom !== null &&
      !desksMatchTemplate(app.activeRoom.desks, presetTemplate.key)
  );

  async function applyPreset() {
    const tpl = presetTemplate;
    if (!tpl) return;
    const ok = await confirmDialog({
      title: `Switch to ${tpl.label}?`,
      message: 'Desks are replaced with this layout, and seating is cleared for every class that uses this room.',
      detail: 'The current room is saved to version history first.',
      confirmLabel: 'Switch layout',
    });
    if (!ok) return;
    app.applyTemplate(tpl.key);
    app.toast(`Room switched to ${tpl.label}`, 'ok');
  }

  async function onTemplate(e: Event) {
    // Grab everything before awaiting — currentTarget is gone afterwards.
    const select = e.currentTarget as HTMLSelectElement;
    const key = select.value;
    select.value = '';
    if (!key) return;
    const label = TEMPLATES.find((t) => t.key === key)?.label ?? 'this template';
    const ok = await confirmDialog({
      title: 'Start over from a template?',
      message: `Desks are replaced with ${label}, and seating is cleared for every class that uses this room.`,
      detail: 'The current room is saved to version history first.',
      confirmLabel: 'Replace room',
    });
    if (ok) app.applyTemplate(key);
  }

  async function deleteActiveClass() {
    const target = cls;
    if (!target) return;
    const ok = await confirmDialog({
      title: `Delete “${target.name}”?`,
      message: 'The class list, seating, rules, and job assignments are removed from this browser.',
      detail: "This can't be undone — download a backup first if you're unsure.",
      confirmLabel: 'Delete class',
      tone: 'danger',
    });
    if (ok) app.deleteClass(target.id);
  }

  async function onRestoreFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) await app.restoreBackup(file);
    (e.currentTarget as HTMLInputElement).value = '';
  }
</script>

<svelte:window onpointerdown={(e) => closePopovers(e)} />

<div class="frame" bind:this={frameEl}>
  <div class="toolbar">
    <div class="cluster">
      <ClassSwitcher onnew={() => (pasteMode = 'new')} />
    </div>

    <div class="segmented" role="group" aria-label="Mode">
      <button
        aria-pressed={app.mode === 'seat'}
        onclick={() => {
          app.mode = 'seat';
          app.clearSelection();
        }}>Seat students</button
      >
      <button
        aria-pressed={app.mode === 'arrange'}
        onclick={() => {
          app.mode = 'arrange';
          app.clearSelection();
        }}>Arrange room</button
      >
    </div>

    <div class="cluster right">
      {#if app.conflicts.length > 0}
        <details class="conflicts">
          <summary>{app.conflicts.length} conflict{app.conflicts.length === 1 ? '' : 's'}</summary>
          <div class="pop">
            {#each app.conflicts as c}
              <p>{c.message}</p>
            {/each}
          </div>
        </details>
      {/if}
      <button
        class="btn"
        onclick={() => (versionsOpen = true)}
        title="Version history — restore an earlier snapshot"
      >
        <Icon name="history" size={16} />
        History
      </button>
      <button class="btn" onclick={() => app.shuffle()} title="Re-seat everyone, honoring rules and locks">
        <Icon name="shuffle" size={16} />
        Shuffle
      </button>
      <button class="btn primary" onclick={() => (pdfOpen = true)} disabled={!cls}>
        <Icon name="download" size={16} />
        Download PDF
      </button>
      <details class="menu">
        <summary class="btn quiet" aria-label="More options">
          <Icon name="dots" size={18} stroke={2.6} />
        </summary>
        <div class="pop">
          <button
            class="item"
            onclick={() => {
              app.downloadBackup();
              closePopovers(undefined);
            }}><Icon name="download" size={15} /> Save backup file</button
          >
          <button
            class="item"
            onclick={() => {
              restoreInput?.click();
              closePopovers(undefined);
            }}><Icon name="upload" size={15} /> Restore backup…</button
          >
          <hr />
          <label class="theme">
            Theme
            <select
              value={app.settings.theme === 'dark' ? 'dark' : 'light'}
              onchange={(e) => app.setTheme(e.currentTarget.value as 'light' | 'dark')}
            >
              <option value="light">Light paper</option>
              <option value="dark">Chalkboard</option>
            </select>
          </label>
          <hr />
          <button
            class="item danger"
            onclick={() => {
              closePopovers(undefined);
              deleteActiveClass();
            }}><Icon name="trash" size={15} /> Delete this class</button
          >
        </div>
      </details>
      <input type="file" accept=".json" hidden bind:this={restoreInput} onchange={onRestoreFile} />
    </div>
  </div>

  {#if app.isSample}
    <div class="sample-banner" data-sample-banner>
      <span><strong>Sample class.</strong> Move a desk, set a rule, or shuffle. Your changes stay on this device.</span>
      <button class="btn primary small" onclick={() => (pasteMode = 'new')}>Use my class list</button>
    </div>
  {/if}

  {#if presetPending && presetTemplate}
    <div class="sample-banner" role="status" data-preset-banner>
      <span>This page features the <strong>{presetTemplate.label}</strong> layout — your saved room is shown instead.</span>
      <button class="btn primary small" onclick={applyPreset}>Switch to this layout</button>
    </div>
  {/if}

  {#if app.mode === 'arrange'}
    <div class="subbar">
      <div class="sub-group" role="group" aria-label="Room">
        <input
          class="room-name"
          aria-label="Room name"
          value={app.activeRoom?.name ?? ''}
          onchange={(e) => app.renameRoom(e.currentTarget.value)}
        />
        <select aria-label="Start from a template" onchange={onTemplate}>
          <option value="">Start over from template…</option>
          {#each TEMPLATES as t}
            <option value={t.key}>{t.label}</option>
          {/each}
        </select>
      </div>

      <div class="sub-group" role="group" aria-label="Add desks">
        <span class="lbl">Add</span>
        <button class="btn small" onclick={() => app.addCluster(1)}>desk</button>
        <button class="btn small" onclick={() => app.addCluster(2)}>pair</button>
        <button class="btn small" onclick={() => app.addCluster(4)}>table of 4</button>
        <button class="btn small" onclick={() => app.addCluster(6)}>table of 6</button>
      </div>

      <div class="sub-group" role="group" aria-label="Zone brush">
        <span class="lbl">Zones</span>
        <button
          class="btn small brush"
          class:on={app.zoneBrush === 'near-teacher'}
          aria-pressed={app.zoneBrush === 'near-teacher'}
          onclick={() => (app.zoneBrush = app.zoneBrush === 'near-teacher' ? null : 'near-teacher')}
        >
          <span class="brush-dot near-teacher" aria-hidden="true"></span>
          Near teacher
        </button>
        <button
          class="btn small brush"
          class:on={app.zoneBrush === 'away-from-door'}
          aria-pressed={app.zoneBrush === 'away-from-door'}
          onclick={() =>
            (app.zoneBrush = app.zoneBrush === 'away-from-door' ? null : 'away-from-door')}
        >
          <span class="brush-dot away-from-door" aria-hidden="true"></span>
          Away from door
        </button>
      </div>

      <div class="sub-group" role="group" aria-label="Room fixtures">
        <span class="lbl">Fixtures</span>
        <button
          class="btn small"
          onclick={() => {
            const r = app.activeRoom;
            if (!r) return;
            r.teacherDesk = r.teacherDesk ? null : { x: 3.5, y: 0.2 };
            app.scheduleSave();
          }}>{app.activeRoom?.teacherDesk ? 'Remove teacher desk' : 'Add teacher desk'}</button
        >
        <button
          class="btn small"
          onclick={() => {
            const r = app.activeRoom;
            if (!r) return;
            r.door = r.door ? null : { x: 0.2, y: 0.2 };
            app.scheduleSave();
          }}>{app.activeRoom?.door ? 'Remove door' : 'Add door'}</button
        >
      </div>
    </div>
  {/if}

  {#if !cls}
    <EmptyState title="No class yet" actionLabel="Paste your class list" onaction={() => (pasteMode = 'new')}>
      Paste a class list to start seating students. Your names stay in this browser.
    </EmptyState>
  {:else}
  <button
    class="roster-toggle"
    type="button"
    aria-expanded={rosterOpen}
    aria-controls="roster-panel"
    title={rosterOpen ? 'Hide the roster and use the full canvas' : 'Show the roster'}
    onclick={() => (rosterOpen = !rosterOpen)}
  >
    <Icon name={rosterOpen ? 'minus' : 'plus'} size={15} />
    {rosterOpen ? 'Hide roster' : `Show roster · ${cls.students.length} students`}
  </button>
  <div class="workspace" class:roster-collapsed={!rosterOpen}>
    <RosterPanel onAddStudents={() => (pasteMode = cls ? 'add' : 'new')} />
    <RoomCanvas />
  </div>
  {/if}
</div>

{#if pasteMode}
  <PasteModal mode={pasteMode} onclose={() => (pasteMode = null)} />
{/if}
{#if pdfOpen}
  <PdfDialog onclose={() => (pdfOpen = false)} />
{/if}
{#if versionsOpen}
  <VersionHistoryModal onclose={() => (versionsOpen = false)} />
{/if}
<Toasts />
<ConfirmDialog />

<style>
  .frame {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    height: min(88vh, 940px);
    min-height: 560px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
  }
  .cluster {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }
  .conflicts,
  .menu {
    position: relative;
  }
  .conflicts summary {
    list-style: none;
    cursor: pointer;
    background: var(--warn-soft);
    color: var(--warn);
    border: 1px solid color-mix(in srgb, var(--warn) 55%, transparent);
    border-radius: var(--radius-pill);
    font-weight: 700;
    font-size: var(--text-sm);
    padding: 0.35rem 0.8rem;
  }
  .conflicts summary:hover {
    background: color-mix(in srgb, var(--warn) 18%, var(--warn-soft));
  }
  .menu summary {
    list-style: none;
  }
  .conflicts summary::-webkit-details-marker,
  .menu summary::-webkit-details-marker {
    display: none;
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 60;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-2);
    padding: var(--space-2);
    min-width: 15rem;
    font-size: var(--text-sm);
  }
  .pop p {
    margin: 0.25rem 0.3rem;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-radius: var(--radius-s);
    padding: 0.5rem 0.6rem;
    font-weight: 700;
    color: var(--ink);
  }
  .item :global(svg) {
    flex: none;
    color: var(--muted);
  }
  .item.danger :global(svg) {
    color: var(--danger);
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item.danger {
    color: var(--danger);
  }
  .menu hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 0.3rem 0;
  }
  .theme {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    color: var(--muted);
    font-weight: 700;
  }
  /* Labelled clusters that wrap as whole units. Bare 1px dividers used to wrap
     too, leaving a stray rule orphaned at the head of the second line. */
  .subbar {
    display: flex;
    align-items: center;
    gap: var(--space-2) var(--space-5);
    flex-wrap: wrap;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-m);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
  }

  .sub-group {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }
  .room-name {
    width: 9rem;
    min-height: var(--control-h-sm);
    font-weight: 700;
  }
  .lbl {
    color: var(--muted);
    font-weight: 700;
    white-space: nowrap;
  }
  .brush.on {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .brush-dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    flex: none;
  }
  .brush-dot.near-teacher {
    background: var(--accent);
  }
  .brush-dot.away-from-door {
    background: var(--g-violet);
  }
  .workspace {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 0.8rem;
  }
  /* Collapsing the roster hands the whole width to the canvas — useful at every
     size, not just on a phone, when you are arranging a wide room. */
  .roster-toggle {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: var(--control-h-sm);
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-s);
    background: var(--surface);
    color: var(--muted);
    font-weight: 700;
    transition: color var(--motion-fast) ease, border-color var(--motion-fast) ease;
  }

  .roster-toggle:hover {
    color: var(--ink);
    border-color: var(--line-strong);
  }

  .workspace.roster-collapsed :global(.panel) {
    display: none;
  }
  @media (max-width: 760px) {
    .toolbar {
      align-items: stretch;
      gap: var(--space-2);
    }
    .cluster {
      flex-wrap: wrap;
    }
    .cluster.right {
      width: 100%;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: var(--space-1);
      scrollbar-width: thin;
    }
    .workspace {
      flex-direction: column;
      gap: var(--space-3);
    }
    .frame {
      height: auto;
      min-height: 0;
    }
    :global(.panel) {
      flex: 1 1 auto;
      width: 100%;
      max-height: min(42vh, 24rem);
    }
    :global(.canvas-wrap) {
      min-height: 32rem;
    }
    .subbar {
      flex-wrap: nowrap;
      overflow-x: auto;
      padding: var(--space-2);
      scrollbar-width: thin;
    }
    .roster-toggle {
      align-self: stretch;
      justify-content: center;
      min-height: var(--touch-target);
      border-radius: var(--radius-m);
      color: var(--ink);
    }
  }
</style>
