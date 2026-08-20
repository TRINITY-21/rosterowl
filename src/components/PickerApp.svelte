<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { roundProgress } from '../lib/picker';
  import PasteModal from './PasteModal.svelte';
  import Toasts from './Toasts.svelte';
  import ClassSwitcher from './ClassSwitcher.svelte';
  import SyncMenu from './SyncMenu.svelte';
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import SampleBanner from './SampleBanner.svelte';
  import ToolBoundary from './ToolBoundary.svelte';

  app.load();

  let pasteMode = $state<'new' | 'add' | null>(null);
  let lastPickedId = $state<string | null>(null);
  let popKey = $state(0);

  const cls = $derived(app.activeClass);
  const progress = $derived(
    cls ? roundProgress(cls.students, cls.pickerHistory) : { done: 0, total: 0 }
  );
  const absentCount = $derived(cls?.students.filter((s) => s.absent).length ?? 0);
  const availableCount = $derived((cls?.students.length ?? 0) - absentCount);
  const lastPickedName = $derived(lastPickedId ? app.names.get(lastPickedId) : null);
  // The screen-reader announcement lives in one stable text node (see the .stage
  // markup). Keeping it out of the {#key} block means a pick is announced once,
  // not once per element the keyed block re-creates.
  const announcement = $derived(lastPickedName ? `${lastPickedName} — it’s your turn` : '');

  function pick() {
    const student = app.pickStudent();
    // Defensive only. Both entry points already refuse when nobody is available:
    // the button is not rendered, and the space bar bails out. No toast here —
    // the "Everyone is marked absent" empty state is on screen saying exactly this.
    if (!student) return;
    lastPickedId = student.id;
    popKey++;
  }

  function onkeydown(e: KeyboardEvent) {
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    if (e.repeat) return; // holding Space must not machine-gun picks
    // Never steal activation from a focused control or link.
    if ((e.target as HTMLElement)?.closest('a, button, summary, input, textarea, select, [contenteditable]')) return;
    if (!cls || cls.students.length === 0) return;
    if (availableCount === 0) return; // nobody to pick; the empty state already explains why
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      pick();
    }
  }
</script>

<svelte:window {onkeydown} />


<ToolBoundary tool="student picker">
<div class="tool-frame">
  <div class="tool-toolbar">
    <div class="tool-cluster">
      <ClassSwitcher onnew={() => (pasteMode = 'new')} onswitch={() => (lastPickedId = null)} />
    </div>
    <div class="tool-cluster">
      <SyncMenu />
    </div>
  </div>

  {#if app.isSample}
    <SampleBanner onreplace={() => (pasteMode = 'new')}>
      Try a fair round, then add your own students.
    </SampleBanner>
  {/if}

  {#if !cls || cls.students.length === 0}
    <EmptyState
      icon="shuffle"
      title={cls ? 'No students on this roster' : 'No class yet'}
      actionLabel={cls ? 'Add students' : 'Paste your class list'}
      onaction={() => (pasteMode = cls ? 'add' : 'new')}
    >
      Paste your class list once — it powers this and every other RosterOwl tool.
    </EmptyState>
  {:else if availableCount === 0}
    <EmptyState compact icon="alert" title="Everyone is marked absent" href="/seating-chart/" actionLabel="Mark students present">
      Every student on this roster is marked absent, so the picker has nobody to call on. Mark
      someone present in the seating chart — your round continues where it left off.
    </EmptyState>
  {:else}
    <div class="stage">
      {#if lastPickedName}
        {#key popKey}
          <div class="picked-name" aria-hidden="true">{lastPickedName}</div>
        {/key}
        <div class="picked-label" aria-hidden="true">it’s your turn</div>
      {:else}
        <div class="ready">Ready when you are.</div>
        <div class="picked-label">Space bar works too.</div>
      {/if}
      <p class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>

    <div class="controls">
      <button class="btn primary big-pick" onclick={() => pick()}>
        <Icon name="sparkle" size={18} />
        Pick a student
      </button>
      <button
        class="btn"
        onclick={() => {
          if (!cls || cls.pickerHistory.length === 0) return;
          const previous = [...cls.pickerHistory];
          app.resetPickerRound();
          lastPickedId = null;
          app.toast('Picker round reset', 'info', {
            label: 'Undo',
            run: () => {
              cls.pickerHistory = previous;
              app.scheduleSave();
            },
          });
        }}
        disabled={cls.pickerHistory.length === 0}
      >
        <Icon name="restore" size={16} />
        Reset round
      </button>
    </div>

    <div class="progress">
      <div
        class="bar"
        role="progressbar"
        aria-valuenow={progress.done}
        aria-valuemax={progress.total}
        aria-label="Round progress"
        aria-valuetext={`${progress.done} of ${progress.total} students picked${absentCount ? `; ${absentCount} absent skipped` : ''}`}
      >
        <div class="fill" style="width:{progress.total ? (progress.done / progress.total) * 100 : 0}%"></div>
      </div>
      <span class="lbl">
        {progress.done} of {progress.total} this round
        {#if absentCount > 0}· {absentCount} absent skipped{/if}
      </span>
    </div>

    {#if cls.pickerHistory.length > 0}
      <div class="history">
        <h2 class="sr-only">Picked so far this round, most recent last</h2>
        {#each cls.pickerHistory.slice(-12) as id, i (id + i)}
          <span class="hchip"><em>{Math.max(0, cls.pickerHistory.length - 12) + i + 1}</em>{app.names.get(id) ?? '?'}</span>
        {/each}
      </div>
    {/if}
  {/if}
</div>

{#if pasteMode}
  <PasteModal mode={pasteMode} onclose={() => (pasteMode = null)} />
{/if}
<Toasts />
</ToolBoundary>

<style>
  .stage {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-l);
    box-shadow: var(--shadow-1);
    min-height: 15rem;
    display: grid;
    place-content: center;
    text-align: center;
    padding: var(--space-6) var(--space-4);
  }
  .picked-name {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(2.6rem, 9vw, 5.5rem);
    line-height: 1.05;
    letter-spacing: -0.01em;
    color: var(--brand-strong);
    animation: pop 320ms cubic-bezier(0.2, 1.4, 0.4, 1);
    overflow-wrap: anywhere;
  }
  @keyframes pop {
    0% {
      transform: scale(0.6);
      opacity: 0;
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .picked-name {
      animation: none;
    }
  }
  .ready {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(1.6rem, 4vw, 2.4rem);
    color: var(--muted);
  }
  .picked-label {
    margin-top: var(--space-3);
    color: var(--muted);
    font-size: var(--text-sm);
  }
  .controls {
    display: flex;
    justify-content: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .big-pick {
    font-size: var(--text-lg);
    min-height: 3.4rem;
    padding: 0.8rem 1.8rem;
    border-radius: var(--radius-l);
  }
  .progress {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    justify-content: center;
    flex-wrap: wrap;
  }
  .bar {
    width: min(60vw, 21rem);
    height: 0.5rem;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--brand);
    border-radius: var(--radius-pill);
    transition: width var(--motion-medium) var(--ease-standard);
  }
  .lbl {
    font-size: var(--text-sm);
    color: var(--muted);
    font-weight: 700;
  }
  .history {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    justify-content: center;
  }
  .hchip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-pill);
    padding: 0.15rem 0.6rem 0.15rem 0.3rem;
    font-size: var(--text-xs);
    font-weight: 700;
  }
  .hchip em {
    font-style: normal;
    width: 1.15rem;
    height: 1.15rem;
    display: grid;
    place-items: center;
    background: var(--brand-soft);
    color: var(--brand);
    border-radius: 50%;
    font-size: 0.66rem;
  }
</style>
