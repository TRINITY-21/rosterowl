<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { drag } from '../lib/dragState.svelte';
  import { looksLastFirst, splitFullName, swapLastFirst } from '../lib/smartPaste';
  import type { Student } from '../lib/types';
  import { GROUP_HUES } from '../lib/types';
  import Icon from './Icon.svelte';

  let { onAddStudents }: { onAddStudents: () => void } = $props();

  const cls = $derived(app.activeClass);
  const conflictStudents = $derived(new Set(app.conflicts.flatMap((c) => c.students)));
  const unseatedIds = $derived(new Set(app.unseated.map((s) => s.id)));

  const isSafari = $derived.by(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    return /safari/i.test(ua) && !/chrome|chromium|crios|android|edg/i.test(ua);
  });

  function hue(student: Student): string {
    const i = cls?.students.indexOf(student) ?? 0;
    return GROUP_HUES[i % GROUP_HUES.length];
  }

  function initials(s: Student): string {
    return (s.first[0] ?? '?') + (s.last[0] ?? '');
  }

  function onRowPointerDown(e: PointerEvent, s: Student) {
    if (e.button !== 0) return;
    // Skip inner controls (absent/remove buttons) — but not the chip itself,
    // which is a <button>.
    const ctl = (e.target as HTMLElement).closest('button, select, input');
    if (ctl && ctl !== e.currentTarget) return;
    if (app.pairPicking) {
      app.completePairPick(s.id);
      return;
    }
    e.preventDefault();
    drag.current = {
      kind: 'student',
      studentId: s.id,
      fromDeskId: app.seatOf.get(s.id) ?? null,
      fromCanvas: false,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
  }

  function onRowClickIntent(s: Student) {
    // pointerup without movement = click: arm click-to-seat.
    if (drag.current?.kind === 'student' && !drag.current.moved) {
      armStudent(s);
    }
  }

  function armStudent(s: Student) {
    app.selectedStudentId = app.selectedStudentId === s.id ? null : s.id;
    app.selectedDeskId = null;
  }

  function onRowKeydown(e: KeyboardEvent, s: Student) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (app.pairPicking) app.completePairPick(s.id);
      else armStudent(s);
    }
  }

  /**
   * Inline rename. Smart paste is good but not perfect — before this, the only
   * way to fix "Martinez Ava" was to delete the student and re-paste the class.
   */
  let editingId = $state<string | null>(null);
  let draft = $state('');

  function startEdit(student: Student) {
    editingId = student.id;
    draft = `${student.first}${student.last ? ` ${student.last}` : ''}`.trim();
  }

  function commitEdit(student: Student) {
    const text = draft.trim();
    editingId = null;
    if (!text) return;
    // Only the name-shape helpers, never parseRoster: its junk filter would
    // silently drop digits, so renaming to "Ava Martinez 2" would do nothing.
    const next = looksLastFirst(text) ? swapLastFirst(text) : splitFullName(text);
    if (!next.first && !next.last) return;
    if (next.first === student.first && next.last === student.last) return;
    app.updateStudent(student.id, next);
  }

  function removeStudentWithUndo(student: Student) {
    const target = app.activeClass;
    if (!target) return;
    // Everything the undo needs is captured by VALUE now, and the class is
    // re-found by id at click time: `cls` is a $derived, so reading it inside
    // the closure would resolve to whatever class is active when Undo is hit.
    const classId = target.id;
    const index = target.students.findIndex((item) => item.id === student.id);
    const seating = Object.entries(target.seating).find(([, id]) => id === student.id);
    const apart = target.apart.filter((pair) => pair.a === student.id || pair.b === student.id);
    const together = target.together.filter((pair) => pair.a === student.id || pair.b === student.id);
    const history = [...target.pickerHistory];
    // removeStudent's syncWheel strips the id — keep the rotation to restore
    // the student's exact place in the jobs cycle on undo.
    const wheel = [...target.jobs.wheel];
    const wheelOffset = target.jobs.offset;
    const name = app.names.get(student.id) ?? `${student.first} ${student.last}`.trim();
    app.removeStudent(student.id);
    app.toast(`${name} removed`, 'info', {
      label: 'Undo',
      run: () => {
        const owner = app.classes.find((c) => c.id === classId);
        if (!owner || owner.students.some((item) => item.id === student.id)) return;
        owner.students.splice(Math.max(0, Math.min(index, owner.students.length)), 0, student);
        if (seating && !(seating[0] in owner.seating)) owner.seating[seating[0]] = student.id;
        owner.apart.push(...apart);
        owner.together.push(...together);
        owner.pickerHistory = history;
        owner.jobs.wheel = wheel;
        owner.jobs.offset = wheelOffset;
        app.refreshConflicts();
        app.scheduleSave();
      },
    });
  }

  function removeRule(kind: 'apart' | 'together', index: number) {
    const target = app.activeClass;
    if (!target) return;
    const pair = target[kind][index];
    if (!pair) return;
    const classId = target.id;
    app.removePair(kind, index);
    app.toast('Seating rule removed', 'info', {
      label: 'Undo',
      run: () => {
        const owner = app.classes.find((c) => c.id === classId);
        if (!owner) return;
        const list = owner[kind];
        // The list may have changed since — never duplicate, never overshoot.
        const exists = list.some(
          (p) => (p.a === pair.a && p.b === pair.b) || (p.a === pair.b && p.b === pair.a)
        );
        if (!exists) list.splice(Math.min(index, list.length), 0, pair);
        app.refreshConflicts();
        app.scheduleSave();
      },
    });
  }
</script>

<aside class="panel" id="roster-panel" data-tray aria-label="Class roster">
  <header>
    {#if cls}
      <input
        class="class-name"
        value={cls.name}
        aria-label="Class name"
        onchange={(e) => app.renameClass(e.currentTarget.value)}
      />
      <div class="meta">
        {cls.students.length} students ·
        {cls.students.filter((s) => s.absent).length} absent
      </div>
    {/if}
    <button class="btn primary small add" onclick={onAddStudents}>
      <Icon name="plus" size={15} />
      Add students
    </button>
  </header>

  {#if app.selectedStudentId}
    <div class="hint armed">
      Now click a desk to seat {app.names.get(app.selectedStudentId)} —
      <button class="linkish" onclick={() => (app.selectedStudentId = null)}>cancel</button>
    </div>
  {:else}
    <div class="hint">Drag a name onto a desk — or click a name, then a desk.</div>
  {/if}

  {#if app.unseated.length > 0}
    <section class="tray">
      <h3>Not seated ({app.unseated.length})</h3>
      <div class="chips">
        {#each app.unseated as s (s.id)}
          <button
            class="chip"
            class:absent={s.absent}
            class:armed={app.selectedStudentId === s.id}
            aria-pressed={app.selectedStudentId === s.id}
            style="--hue:var({hue(s)})"
            onpointerdown={(e) => onRowPointerDown(e, s)}
            onpointerup={() => onRowClickIntent(s)}
            onkeydown={(e) => onRowKeydown(e, s)}
          >
            <span class="avatar">{initials(s)}</span>{app.names.get(s.id)}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <section class="list" aria-label="Students">
    {#if cls && cls.students.length === 0}
      <p class="none roster-empty">
        This class has no students yet.
        <button class="linkish" onclick={onAddStudents}>Paste your class list</button> to fill the room.
      </p>
    {/if}
    {#each cls?.students ?? [] as s (s.id)}
      <div
        class="row"
        class:absent={s.absent}
        class:armed={app.selectedStudentId === s.id}
        class:conflict={conflictStudents.has(s.id)}
      >
        {#if editingId === s.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="rename"
            bind:value={draft}
            autofocus
            aria-label="Name for {app.names.get(s.id)}"
            onblur={() => commitEdit(s)}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit(s);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                editingId = null;
              }
            }}
          />
        {:else}
          <button
            class="row-main"
            onpointerdown={(e) => onRowPointerDown(e, s)}
            onpointerup={() => onRowClickIntent(s)}
            aria-label="Select {app.names.get(s.id)}{s.absent ? ', absent' : ''}"
            aria-pressed={app.selectedStudentId === s.id}
            onkeydown={(e) => onRowKeydown(e, s)}
            ondblclick={() => startEdit(s)}
          >
            <span class="avatar" style="--hue:var({hue(s)})">{initials(s)}</span>
            <span class="rname">
              {app.names.get(s.id)}
              {#if unseatedIds.has(s.id)}<em class="tag">unseated</em>{/if}
              {#if s.zonePref}<i class="zonedot {s.zonePref}" title="Priority seating"></i><span class="sr-only"> priority seating</span>{/if}
            </span>
          </button>
          <button
            class="rename-btn"
            title="Rename"
            aria-label="Rename {app.names.get(s.id)}"
            onclick={(e) => {
              e.stopPropagation();
              startEdit(s);
            }}
          >
            <Icon name="file" size={14} />
          </button>
          <button
            class="absent-btn"
            title={s.absent ? 'Mark present' : 'Mark absent'}
            aria-label={s.absent ? `Mark ${app.names.get(s.id)} present` : `Mark ${app.names.get(s.id)} absent`}
            aria-pressed={s.absent}
            onclick={(e) => {
              e.stopPropagation();
              app.toggleAbsent(s.id);
            }}
          >
            <Icon name={s.absent ? 'close' : 'check'} size={15} />
          </button>
          <button
            class="remove-btn"
            title="Remove from class"
            aria-label="Remove {app.names.get(s.id)}"
            onclick={(e) => {
              e.stopPropagation();
              removeStudentWithUndo(s);
            }}
          >
            <Icon name="trash" size={15} />
          </button>
        {/if}
      </div>
    {/each}
  </section>

  {#if (cls?.apart.length ?? 0) > 0 || (cls?.together.length ?? 0) > 0}
    <section class="constraints">
      <h3>Seating rules</h3>
      {#each cls?.apart ?? [] as p, i}
        <div class="rule">
          <span class="rule-kind apart">apart</span>
          <span class="rule-pair">
            {app.names.get(p.a)}<span class="sr-only"> and </span><span class="pair-sep" aria-hidden="true">↔</span>{app.names.get(p.b)}
          </span>
          <button
            class="remove-btn"
            aria-label="Remove keep-apart rule for {app.names.get(p.a)} and {app.names.get(p.b)}"
            title="Remove rule"
            onclick={() => removeRule('apart', i)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      {/each}
      {#each cls?.together ?? [] as p, i}
        <div class="rule">
          <span class="rule-kind together">together</span>
          <span class="rule-pair">
            {app.names.get(p.a)}<span class="sr-only"> and </span><span class="pair-sep" aria-hidden="true">↔</span>{app.names.get(p.b)}
          </span>
          <button
            class="remove-btn"
            aria-label="Remove keep-together rule for {app.names.get(p.a)} and {app.names.get(p.b)}"
            title="Remove rule"
            onclick={() => removeRule('together', i)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      {/each}
    </section>
  {:else}
    <section class="constraints">
      <h3>Seating rules</h3>
      <p class="none">None yet. Click a seated student, then “Keep apart with…”.</p>
    </section>
  {/if}

  <footer>
    <p>
      Your class list lives <strong>on this device</strong> — it only reaches a server if you
      turn on sync. <a href="/privacy/">How that works</a>
    </p>
    {#if isSafari}
      <p class="safari">
        Safari can clear saved data after 7 days away.
        <button class="linkish" onclick={() => app.downloadBackup()}>Save a backup file</button> to be safe.
      </p>
    {/if}
  </footer>
</aside>

<style>
  .panel {
    flex: 0 0 clamp(16rem, 22vw, 19rem);
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-l);
    padding: var(--space-4);
    overflow-y: auto;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .class-name {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: var(--text-lg);
    min-height: 0;
    border: 1px solid transparent;
    background: transparent;
    padding: 0.25rem 0.35rem;
    border-radius: var(--radius-s);
  }
  .class-name:hover,
  .class-name:focus {
    border-color: var(--line-strong);
    background: var(--surface);
  }
  .meta {
    font-size: var(--text-xs);
    color: var(--muted);
    padding-left: 0.35rem;
  }
  .add {
    align-self: flex-start;
  }
  .hint {
    font-size: var(--text-xs);
    color: var(--muted);
    background: var(--surface-2);
    border-radius: var(--radius-s);
    padding: var(--space-2) var(--space-3);
  }
  .hint.armed {
    background: var(--accent-soft);
    color: var(--ink);
    font-weight: 700;
  }
  h3 {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    font-family: var(--font-body);
    margin: 0 0 var(--space-2);
  }
  .tray {
    background: var(--accent-soft);
    border: 1px dashed var(--accent);
    border-radius: var(--radius-m);
    padding: var(--space-3);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    padding: 0.2rem 0.6rem 0.2rem 0.25rem;
    font-size: var(--text-sm);
    font-weight: 700;
    touch-action: pan-y; /* vertical swipe scrolls; deliberate drags still work */
    cursor: grab;
  }
  .chip.armed,
  .row.armed {
    outline: 2px solid var(--accent);
  }
  .list {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.15rem;
    border-radius: var(--radius-s);
  }
  .row-main {
    flex: 1;
    min-width: 0;
    min-height: 2.25rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--ink);
    text-align: left;
    cursor: grab;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }
  .row:hover {
    background: var(--surface-2);
  }
  .row.conflict .rname {
    color: var(--warn);
  }
  .row.absent .rname {
    color: var(--muted);
    text-decoration: line-through;
  }
  .avatar {
    width: 1.55rem;
    height: 1.55rem;
    flex-shrink: 0;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 0.62rem;
    font-weight: 700;
    color: #fff;
    background: color-mix(in srgb, var(--hue, var(--g-blue)) 62%, #14201c);
  }
  .rname {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--text-sm);
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .tag {
    flex: none;
    font-style: normal;
    font-size: 0.66rem;
    font-weight: 700;
    color: var(--warn);
    background: var(--warn-soft);
    border-radius: var(--radius-pill);
    padding: 0.05rem 0.4rem;
  }
  .zonedot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    display: inline-block;
  }
  .zonedot.near-teacher {
    background: var(--accent);
  }
  .zonedot.away-from-door {
    background: var(--g-violet);
  }
  .rename {
    flex: 1;
    min-width: 0;
    min-height: 2.1rem;
    font-size: var(--text-sm);
    font-weight: 700;
    padding: 0.25rem 0.45rem;
  }
  .absent-btn,
  .remove-btn,
  .rename-btn {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 1.85rem;
    height: 1.85rem;
    min-height: 0;
    padding: 0;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    color: var(--muted);
    transition:
      background var(--motion-fast) ease,
      color var(--motion-fast) ease,
      border-color var(--motion-fast) ease,
      opacity var(--motion-fast) ease;
  }
  .rename-btn {
    opacity: 0;
    color: var(--muted);
  }
  .rename-btn:hover {
    background: var(--surface-2);
    color: var(--ink);
  }
  .absent-btn:hover {
    border-color: var(--line-strong);
    background: var(--surface-2);
    color: var(--ink);
  }
  .absent-btn[aria-pressed='true'] {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .remove-btn:hover {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .remove-btn {
    opacity: 0;
  }
  .row:hover .remove-btn,
  .row:hover .rename-btn,
  .rule:hover .remove-btn,
  .remove-btn:focus-visible,
  .rename-btn:focus-visible {
    opacity: 1;
  }
  @media (hover: none), (pointer: coarse) {
    .remove-btn,
    .rename-btn {
      opacity: 1;
    }
    .absent-btn,
    .remove-btn,
    .rename-btn {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
  }
  .constraints {
    border-top: 1px solid var(--line);
    padding-top: var(--space-3);
  }
  .rule {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: var(--text-sm);
    padding: 0.2rem 0;
  }
  .rule-pair {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .pair-sep {
    color: var(--muted);
    padding: 0 0.25rem;
  }
  .rule-kind {
    flex: none;
    font-size: 0.64rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: var(--radius-pill);
    padding: 0.1rem 0.45rem;
  }
  .rule-kind.apart {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .rule-kind.together {
    background: var(--brand-soft);
    color: var(--brand);
  }
  .roster-empty {
    padding: var(--space-3) var(--space-2);
  }
  .none {
    font-size: var(--text-xs);
    color: var(--muted);
    margin: 0;
  }
  footer {
    margin-top: auto;
    border-top: 1px solid var(--line);
    padding-top: var(--space-3);
    font-size: var(--text-xs);
    color: var(--muted);
  }
  footer p {
    margin: var(--space-2) 0;
  }
  .safari {
    background: var(--warn-soft);
    border-radius: var(--radius-s);
    padding: var(--space-2) var(--space-3);
    color: var(--ink);
  }
</style>
