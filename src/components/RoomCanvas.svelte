<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/appState.svelte';
  import { drag } from '../lib/dragState.svelte';
  import { roomBounds } from '../lib/geometry';
  import type { Desk, Id, Student, ZoneKind } from '../lib/types';
  import { GROUP_HUES } from '../lib/types';
  import Icon from './Icon.svelte';

  const CELL = 64;
  const DESK_W = CELL * 0.98;
  const DESK_H = CELL * 0.8;
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 2;

  let canvasEl: HTMLDivElement | undefined = $state();
  let scrollerEl: HTMLDivElement | undefined = $state();
  let zoom = $state(1);
  let compact = $state(false);
  let liveMessage = $state('');
  let didAutoFit = false;

  const room = $derived(app.activeRoom);
  const cls = $derived(app.activeClass);
  const bounds = $derived(room ? roomBounds(room) : { minX: 0, minY: 0, width: 10, height: 7 });
  const canvasW = $derived(Math.max(bounds.width * CELL, compact ? 320 : 560));
  const canvasH = $derived(Math.max(bounds.height * CELL, compact ? 280 : 420));

  const conflictStudents = $derived(new Set(app.conflicts.flatMap((c) => c.students)));

  const groupHulls = $derived.by(() => {
    if (!room) return [];
    const byGroup = new Map<Id, Desk[]>();
    for (const d of room.desks) {
      if (!d.groupId) continue;
      const list = byGroup.get(d.groupId) ?? [];
      list.push(d);
      byGroup.set(d.groupId, list);
    }
    let i = 0;
    const hulls: { x: number; y: number; w: number; h: number; color: string }[] = [];
    for (const desks of byGroup.values()) {
      const xs = desks.map((d) => d.x);
      const ys = desks.map((d) => d.y);
      hulls.push({
        x: gx(Math.min(...xs)) - 10,
        y: gy(Math.min(...ys)) - 10,
        w: (Math.max(...xs) - Math.min(...xs)) * CELL + DESK_W + 20,
        h: (Math.max(...ys) - Math.min(...ys)) * CELL + DESK_H + 20,
        color: GROUP_HUES[i++ % GROUP_HUES.length],
      });
    }
    return hulls;
  });

  function gx(unitX: number): number {
    return (unitX - bounds.minX) * CELL;
  }
  function gy(unitY: number): number {
    return (unitY - bounds.minY) * CELL;
  }

  // ---- view controls --------------------------------------------------------

  function clampZoom(z: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
  }

  function bumpZoom(delta: number) {
    zoom = clampZoom(Math.round((zoom + delta) * 20) / 20);
  }

  async function setZoom(z: number) {
    zoom = clampZoom(z);
    await tick();
  }

  /** Fit the whole room in view and center it — the "Reset view" action. */
  async function resetView() {
    if (!scrollerEl) return;
    const next = Math.min(
      1.25,
      (scrollerEl.clientWidth - 32) / canvasW,
      (scrollerEl.clientHeight - 32) / canvasH
    );
    zoom = clampZoom(Math.round(next * 20) / 20);
    await tick();
    scrollerEl.scrollLeft = Math.max(0, (canvasW * zoom - scrollerEl.clientWidth) / 2);
    scrollerEl.scrollTop = 0;
  }

  /** Pinch / ctrl+wheel zooms toward the pointer, like every pro canvas. */
  async function onScrollerWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || !scrollerEl) return;
    e.preventDefault();
    const rect = scrollerEl.getBoundingClientRect();
    const px = e.clientX - rect.left + scrollerEl.scrollLeft;
    const py = e.clientY - rect.top + scrollerEl.scrollTop;
    const prev = zoom;
    const next = clampZoom(prev * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
    if (next === prev) return;
    zoom = next;
    const scale = next / prev;
    await tick();
    scrollerEl.scrollLeft = px * scale - (e.clientX - rect.left);
    scrollerEl.scrollTop = py * scale - (e.clientY - rect.top);
  }

  function announce(message: string) {
    liveMessage = message;
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 760px)');
    const sync = () => (compact = mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });

  $effect(() => {
    void canvasW;
    if (didAutoFit || !scrollerEl || !compact) return;
    resetView();
    didAutoFit = true;
  });

  function occupantOf(deskId: Id): Id | null {
    return cls?.seating[deskId] ?? null;
  }

  function deskAt(e: PointerEvent): Id | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-desk-id]');
    return el ? (el as HTMLElement).dataset.deskId! : null;
  }

  function overTray(e: PointerEvent): boolean {
    return !!document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-tray]');
  }

  // ---- pointer handling -----------------------------------------------------

  /** Drag step in grid units — half-grid with snap on, fine steps with it off. */
  function dragStep(): number {
    return app.snap ? 0.5 : 0.1;
  }

  function onDeskPointerDown(e: PointerEvent, desk: Desk) {
    if (e.button !== 0) return;
    e.preventDefault();

    if (app.mode === 'arrange') {
      if (app.zoneBrush) {
        app.toggleDeskZone(desk.id, app.zoneBrush);
        return;
      }
      drag.current = {
        kind: 'desk',
        deskId: desk.id,
        groupId: desk.groupId,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
        moved: false,
      };
      app.selectedDeskId = desk.id;
      return;
    }

    // Seat mode
    const occupant = occupantOf(desk.id);
    if (app.pairPicking && occupant) {
      app.completePairPick(occupant);
      return;
    }
    if (app.selectedStudentId && app.selectedStudentId !== occupant) {
      // Click-a-student-then-click-a-desk seating (works on occupied desks too:
      // seatStudent swaps/displaces).
      app.seatStudent(desk.id, app.selectedStudentId);
      app.selectedStudentId = null;
      return;
    }
    if (occupant) {
      drag.current = {
        kind: 'student',
        studentId: occupant,
        fromDeskId: desk.id,
        fromCanvas: true,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        moved: false,
      };
      app.selectedDeskId = desk.id;
      app.selectedStudentId = null;
    } else {
      app.selectedDeskId = app.selectedDeskId === desk.id ? null : desk.id;
    }
  }

  function onMarkerPointerDown(e: PointerEvent, which: 'teacher' | 'door') {
    if (app.mode !== 'arrange' || e.button !== 0) return;
    e.preventDefault();
    drag.current = {
      kind: 'marker',
      which,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      moved: false,
    };
  }

  function onMarkerKeydown(e: KeyboardEvent, which: 'teacher' | 'door') {
    if (app.mode !== 'arrange' || !room) return;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-0.5, 0],
      ArrowRight: [0.5, 0],
      ArrowUp: [0, -0.5],
      ArrowDown: [0, 0.5],
    };
    const delta = deltas[e.key];
    if (!delta) return;
    e.preventDefault();
    const marker = which === 'teacher' ? room.teacherDesk : room.door;
    if (!marker) return;
    const next = { x: Math.max(0, marker.x + delta[0]), y: Math.max(0, marker.y + delta[1]) };
    if (which === 'teacher') room.teacherDesk = next;
    else room.door = next;
    app.scheduleSave();
  }

  function onWindowPointerMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || !canvasEl || !room) return;
    if (d.kind === 'student') {
      d.x = e.clientX;
      d.y = e.clientY;
      // Threshold so click jitter is never mistaken for a drag.
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) d.moved = true;
    } else if (d.kind === 'desk') {
      // Client-pixel deltas: canvas bounds shift as desks move, so grid-based
      // math mid-drag would make the desk run away from the pointer.
      const unit = dragStep();
      const dx = (e.clientX - d.lastClientX) / (CELL * zoom);
      const dy = (e.clientY - d.lastClientY) / (CELL * zoom);
      if (Math.abs(dx) >= unit || Math.abs(dy) >= unit) {
        const step = { x: Math.round(dx / unit) * unit, y: Math.round(dy / unit) * unit };
        if (d.groupId && groupDrag) {
          app.moveGroup(d.groupId, step.x, step.y);
        } else {
          const desk = room.desks.find((k) => k.id === d.deskId);
          if (desk) app.moveDesk(d.deskId, desk.x + step.x, desk.y + step.y);
        }
        d.lastClientX += step.x * CELL * zoom;
        d.lastClientY += step.y * CELL * zoom;
        d.moved = true;
      }
    } else if (d.kind === 'marker') {
      const unit = dragStep();
      const dx = (e.clientX - d.lastClientX) / (CELL * zoom);
      const dy = (e.clientY - d.lastClientY) / (CELL * zoom);
      if (Math.abs(dx) >= unit || Math.abs(dy) >= unit) {
        const step = { x: Math.round(dx / unit) * unit, y: Math.round(dy / unit) * unit };
        const m = d.which === 'teacher' ? room.teacherDesk : room.door;
        if (m) {
          const pos = { x: Math.max(0, m.x + step.x), y: Math.max(0, m.y + step.y) };
          if (d.which === 'teacher') room.teacherDesk = pos;
          else room.door = pos;
        }
        d.lastClientX += step.x * CELL * zoom;
        d.lastClientY += step.y * CELL * zoom;
        d.moved = true;
        app.scheduleSave();
      }
    }
  }

  function onWindowPointerUp(e: PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'student' && d.moved) {
      const target = deskAt(e);
      if (target) {
        app.seatStudent(target, d.studentId);
        app.selectedDeskId = target;
        announce(`Seated ${app.names.get(d.studentId)}`);
      } else if (d.fromCanvas && overTray(e)) {
        // Only canvas-origin drags unseat on tray drop — a small drag within
        // the roster panel must never silently unseat someone.
        app.unseat(d.studentId);
        app.selectedDeskId = null;
        announce(`Unseated ${app.names.get(d.studentId)}`);
      }
    }
  }

  function onkeydown(e: KeyboardEvent) {
    // A modal owns the keyboard while it's open.
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') app.clearSelection();
    if ((e.key === 'Delete' || e.key === 'Backspace') && app.mode === 'arrange' && app.selectedDeskId) {
      deleteDesk(app.selectedDeskId);
    }
    if (app.mode === 'arrange' && app.selectedDeskId && room) {
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-0.5, 0],
        ArrowRight: [0.5, 0],
        ArrowUp: [0, -0.5],
        ArrowDown: [0, 0.5],
      };
      const delta = deltas[e.key];
      if (delta) {
        e.preventDefault();
        const desk = room.desks.find((item) => item.id === app.selectedDeskId);
        if (desk) {
          app.moveDesk(desk.id, desk.x + delta[0], desk.y + delta[1]);
          announce('Desk moved');
        }
      }
    }
  }

  let groupDrag = $state(true);
  export function isGroupDrag() {
    return groupDrag;
  }

  const selectedDesk = $derived(room?.desks.find((d) => d.id === app.selectedDeskId) ?? null);
  const selectedOccupantId = $derived(selectedDesk ? occupantOf(selectedDesk.id) : null);
  const selectedOccupant = $derived(
    cls?.students.find((s) => s.id === selectedOccupantId) ?? null
  );

  function zoneTitle(z: ZoneKind): string {
    return z === 'near-teacher' ? 'Near-teacher zone' : 'Away-from-door zone';
  }

  function deskLabel(desk: Desk, student: Student | null, locked: boolean): string {
    const parts = [student ? `Desk with ${app.names.get(student.id)}` : 'Empty desk'];
    if (app.selectedDeskId === desk.id) parts.push('selected');
    if (locked) parts.push('locked');
    if (student?.absent) parts.push('student absent');
    if (student && conflictStudents.has(student.id)) parts.push('rule conflict');
    if (desk.zones.length) parts.push(...desk.zones.map(zoneTitle));
    parts.push(app.mode === 'arrange' ? 'Arrange mode' : 'Seat mode');
    return parts.join(', ');
  }

  function deleteDesk(deskId: Id) {
    if (!room) return;
    const desk = room.desks.find((item) => item.id === deskId);
    if (!desk) return;
    const savedDesk = { ...desk, zones: [...desk.zones] };
    const classState = app.classes
      .filter((item) => item.roomId === room.id)
      .map((item) => ({
        id: item.id,
        studentId: item.seating[deskId],
        locked: item.locked.includes(deskId),
      }));
    app.removeDesk(deskId);
    app.toast('Desk removed', 'info', {
      label: 'Undo',
      run: () => {
        room.desks = [...room.desks, savedDesk];
        for (const saved of classState) {
          const item = app.classes.find((candidate) => candidate.id === saved.id);
          if (!item) continue;
          if (saved.studentId) item.seating[deskId] = saved.studentId;
          if (saved.locked && !item.locked.includes(deskId)) item.locked.push(deskId);
        }
        app.refreshConflicts();
        app.scheduleSave();
      },
    });
  }
</script>

<svelte:window
  onpointermove={onWindowPointerMove}
  onpointerup={onWindowPointerUp}
  onpointercancel={() => (drag.current = null)}
  {onkeydown}
/>

<div class="canvas-wrap" class:arrange={app.mode === 'arrange'}>
  <p class="sr-only" aria-live="polite">{liveMessage}</p>
  {#if app.pairPicking}
    <div class="pick-banner">
      Now click the other student ({app.pairPicking.kind === 'apart' ? 'keep apart' : 'keep together'})
      <button class="btn small quiet" onclick={() => (app.pairPicking = null)}>Cancel</button>
    </div>
  {/if}

  {#if app.mode === 'arrange'}
    <div class="arrange-hint">
      Drag desks to match your real room · click desks with a zone brush active to paint zones
      <label class="gd"><input type="checkbox" bind:checked={groupDrag} /> Move whole tables</label>
    </div>
  {/if}

  <div class="scroller" bind:this={scrollerEl} onwheel={onScrollerWheel}>
    <div class="canvas-size" style="width:{canvasW * zoom}px;height:{canvasH * zoom}px">
      <div
        class="canvas"
        bind:this={canvasEl}
        style="width:{canvasW}px;height:{canvasH}px;transform:scale({zoom})"
      >
      {#each groupHulls as hull}
        <div
          class="hull"
          style="left:{hull.x}px;top:{hull.y}px;width:{hull.w}px;height:{hull.h}px;background:color-mix(in srgb, var({hull.color}) 11%, transparent);border-color:color-mix(in srgb, var({hull.color}) 32%, transparent)"
        ></div>
      {/each}

      {#if room?.teacherDesk}
        <button
          type="button"
          class="marker teacher"
          style="left:{gx(room.teacherDesk.x)}px;top:{gy(room.teacherDesk.y)}px"
          onpointerdown={(e) => onMarkerPointerDown(e, 'teacher')}
          onkeydown={(e) => onMarkerKeydown(e, 'teacher')}
          aria-label="Teacher desk marker. Use arrow keys to move in arrange mode."
        >
          Teacher
        </button>
      {/if}
      {#if room?.door}
        <button
          type="button"
          class="marker door"
          style="left:{gx(room.door.x)}px;top:{gy(room.door.y)}px"
          onpointerdown={(e) => onMarkerPointerDown(e, 'door')}
          onkeydown={(e) => onMarkerKeydown(e, 'door')}
          aria-label="Door marker. Use arrow keys to move in arrange mode."
        >
          Door
        </button>
      {/if}

      {#each room?.desks ?? [] as desk (desk.id)}
        {@const sid = occupantOf(desk.id)}
        {@const student = sid ? cls?.students.find((s) => s.id === sid) : null}
        {@const locked = cls?.locked.includes(desk.id)}
        <div
          class="desk"
          class:empty={!sid}
          class:selected={app.selectedDeskId === desk.id}
          class:conflict={sid ? conflictStudents.has(sid) : false}
          class:absent={student?.absent}
          data-desk-id={desk.id}
          style="left:{gx(desk.x)}px;top:{gy(desk.y)}px;width:{DESK_W}px;height:{DESK_H}px"
          role="button"
          tabindex="0"
          aria-label={deskLabel(desk, student ?? null, !!locked)}
          aria-pressed={app.selectedDeskId === desk.id}
          onpointerdown={(e) => onDeskPointerDown(e, desk)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (app.mode !== 'seat') {
                app.selectedDeskId = app.selectedDeskId === desk.id ? null : desk.id;
                return;
              }
              if (app.pairPicking && sid) {
                app.completePairPick(sid);
              } else if (app.selectedStudentId && app.selectedStudentId !== sid) {
                app.seatStudent(desk.id, app.selectedStudentId);
                app.selectedStudentId = null;
              } else {
                app.selectedDeskId = app.selectedDeskId === desk.id ? null : desk.id;
              }
            }
          }}
        >
          {#if student}
            <span class="name">{app.names.get(student.id)}</span>
          {:else}
            <span class="plus" aria-hidden="true">+</span>
          {/if}
          {#if locked}
            <span class="lock" title="Locked — shuffle won't move this seat">
              <Icon name="lock" size={10} stroke={2.6} /><span class="sr-only">Locked</span>
            </span>
          {/if}
          <span class="zones">
            {#each desk.zones as z}
              <i class="zone {z}" title={zoneTitle(z)}></i>
            {/each}
          </span>
        </div>
      {/each}
      </div>
    </div>
  </div>

  <div class="canvas-pill" role="group" aria-label="Canvas view controls">
    <button class="pill-btn" onclick={() => bumpZoom(-0.1)} aria-label="Zoom out" title="Zoom out">
      <Icon name="minus" size={16} />
    </button>
    <button
      class="pill-zoom"
      onclick={() => setZoom(1)}
      title="Reset zoom to 100%"
      aria-label={`Zoom ${Math.round(zoom * 100)} percent. Activate to reset to 100 percent.`}
    >
      {Math.round(zoom * 100)}%
    </button>
    <button class="pill-btn" onclick={() => bumpZoom(0.1)} aria-label="Zoom in" title="Zoom in">
      <Icon name="plus" size={16} />
    </button>
    <span class="pill-divider" aria-hidden="true"></span>
    <button class="pill-btn reset" onclick={resetView} aria-label="Reset view" title="Fit the whole room in view">
      <Icon name="home" size={16} />
      <span class="reset-label">Reset view</span>
    </button>
    <span class="pill-divider" aria-hidden="true"></span>
    <button
      class="pill-snap"
      class:on={app.snap}
      aria-pressed={app.snap}
      aria-label="Snap desks to the grid"
      title={app.snap ? 'Snap to grid: on' : 'Snap to grid: off — free placement'}
      onclick={() => (app.snap = !app.snap)}
    >
      <Icon name="magnet" size={17} />
    </button>
  </div>

  {#if selectedDesk && app.mode === 'seat' && !drag.current}
    <div class="action-bar" role="group" aria-label="Seat actions">
      <strong>{selectedOccupant ? app.names.get(selectedOccupant.id) : 'Empty desk'}</strong>
      <button class="btn small" onclick={() => app.toggleLock(selectedDesk.id)}>
        {cls?.locked.includes(selectedDesk.id) ? 'Locked' : 'Lock seat'}
      </button>
      {#if selectedOccupant}
        <button class="btn small" onclick={() => app.unseat(selectedOccupant.id)}>Unseat</button>
        <button class="btn small" onclick={() => app.toggleAbsent(selectedOccupant.id)}>
          {selectedOccupant.absent ? 'Mark present' : 'Mark absent'}
        </button>
        <button
          class="btn small"
          onclick={() => app.startPairPick('apart', selectedOccupant.id)}
          title="Pick another student this one must not sit next to"
        >
          Keep apart with…
        </button>
        <button
          class="btn small"
          onclick={() => app.startPairPick('together', selectedOccupant.id)}
          title="Pick another student this one must sit next to"
        >
          Keep together with…
        </button>
        <label class="zone-pref">
          Priority seating
          <select
            value={selectedOccupant.zonePref ?? ''}
            onchange={(e) =>
              app.setZonePref(
                selectedOccupant.id,
                (e.currentTarget.value || null) as ZoneKind | null
              )}
          >
            <option value="">None</option>
            <option value="near-teacher">Near teacher</option>
            <option value="away-from-door">Away from door</option>
          </select>
        </label>
      {/if}
      <button class="btn small quiet" onclick={() => (app.selectedDeskId = null)}>Done</button>
    </div>
  {/if}

  {#if selectedDesk && app.mode === 'arrange' && !drag.current}
    <div class="action-bar" role="group" aria-label="Desk actions">
      <strong>Desk</strong>
      <button
        class="btn small zone-btn"
        class:on={selectedDesk.zones.includes('near-teacher')}
        aria-pressed={selectedDesk.zones.includes('near-teacher')}
        onclick={() => app.toggleDeskZone(selectedDesk.id, 'near-teacher')}
      >
        <span class="zone-swatch near-teacher" aria-hidden="true"></span>
        Near teacher
      </button>
      <button
        class="btn small zone-btn"
        class:on={selectedDesk.zones.includes('away-from-door')}
        aria-pressed={selectedDesk.zones.includes('away-from-door')}
        onclick={() => app.toggleDeskZone(selectedDesk.id, 'away-from-door')}
      >
        <span class="zone-swatch away-from-door" aria-hidden="true"></span>
        Away from door
      </button>
      <button class="btn small danger" onclick={() => deleteDesk(selectedDesk.id)}>
        Delete desk
      </button>
      <button class="btn small quiet" onclick={() => (app.selectedDeskId = null)}>Done</button>
    </div>
  {/if}

  {#if drag.current?.kind === 'student' && drag.current.moved}
    <div class="ghost" style="left:{drag.current.x}px;top:{drag.current.y}px">
      {app.names.get(drag.current.studentId)}
    </div>
  {/if}
</div>

<style>
  .canvas-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .scroller {
    flex: 1;
    display: grid;
    overflow: auto;
    background: var(--canvas-bg);
    background-image: radial-gradient(var(--canvas-dot) 1.2px, transparent 1.2px);
    background-size: 24px 24px;
    border-radius: var(--radius-l);
    border: 1px solid var(--line);
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .canvas-size {
    position: relative;
    margin: auto;
  }
  .canvas {
    position: relative;
    transform-origin: top left;
  }

  /* --- floating view controls (bottom right) --- */
  .canvas-pill {
    position: absolute;
    right: var(--space-3);
    bottom: calc(var(--space-3) + env(safe-area-inset-bottom));
    z-index: 25;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-2);
  }
  .pill-btn,
  .pill-zoom,
  .pill-snap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-width: 2.1rem;
    min-height: 2.1rem;
    padding: 0 0.45rem;
    border: none;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--ink);
    font-weight: 700;
    transition: background var(--motion-fast) ease, color var(--motion-fast) ease;
  }
  .pill-btn:hover,
  .pill-zoom:hover {
    background: var(--surface-2);
  }
  .pill-zoom {
    min-width: 3rem;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .reset-label {
    font-size: var(--text-sm);
  }
  .pill-divider {
    width: 1px;
    height: 1.4rem;
    background: var(--line);
    margin: 0 3px;
  }
  .pill-snap {
    min-width: 2.35rem;
    min-height: 2.35rem;
    color: var(--muted);
  }
  .pill-snap:hover {
    background: var(--surface-2);
  }
  .pill-snap.on {
    background: var(--accent);
    color: var(--on-accent);
  }
  .pill-snap.on:hover {
    background: color-mix(in srgb, var(--accent) 88%, black);
  }

  .hull {
    position: absolute;
    border-radius: 16px;
    border: 1px solid transparent;
    pointer-events: none;
  }
  .desk {
    position: absolute;
    display: grid;
    place-items: center;
    background: var(--desk-fill);
    border: 1.5px solid var(--desk-line);
    border-radius: 10px;
    box-shadow: var(--shadow-1);
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
    cursor: grab;
    transition: border-color 100ms ease, box-shadow 100ms ease;
  }
  .desk.empty {
    background: transparent;
    border-style: dashed;
    border-color: var(--desk-empty-line);
    box-shadow: none;
    cursor: pointer;
    touch-action: auto; /* empty desks let touch users pan the canvas */
  }
  .desk:hover {
    border-color: var(--brand);
    box-shadow: var(--shadow-2);
  }
  .desk.empty:hover {
    box-shadow: none;
  }
  .desk.selected {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 25%, transparent);
  }
  .desk.conflict {
    border-color: var(--warn);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 25%, transparent);
  }
  .desk.absent .name {
    color: var(--muted);
    text-decoration: line-through;
  }
  .name {
    font-size: 0.82rem;
    font-weight: 700;
    text-align: center;
    line-height: 1.1;
    padding: 0 4px;
    overflow-wrap: anywhere;
  }
  .plus {
    color: var(--muted);
    opacity: 0.6;
    font-size: 1.1rem;
  }
  .lock {
    position: absolute;
    top: -8px;
    left: -8px;
    width: 1.2rem;
    height: 1.2rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--brand);
    color: var(--on-brand);
    box-shadow: 0 0 0 2px var(--canvas-bg);
  }
  .zones {
    position: absolute;
    top: 3px;
    right: 4px;
    display: flex;
    gap: 3px;
  }
  .zone {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px var(--desk-fill);
  }
  .zone.near-teacher {
    background: var(--accent);
  }
  .zone.away-from-door {
    background: var(--g-violet);
  }
  .marker {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--surface);
    color: var(--muted);
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-pill);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 12px;
    min-height: auto;
    user-select: none;
    touch-action: none;
  }
  .marker.teacher {
    background: var(--brand-soft);
    border-color: color-mix(in srgb, var(--brand) 45%, transparent);
    color: var(--brand-strong);
  }
  .marker.door {
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    color: var(--warn);
  }
  .arrange .marker {
    cursor: grab;
  }
  .pick-banner {
    position: absolute;
    top: 0.6rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    color: var(--ink);
    border-radius: var(--radius-pill);
    padding: 0.35rem 0.9rem;
    font-size: 0.9rem;
    font-weight: 700;
    box-shadow: var(--shadow-1);
  }
  .arrange-hint {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    font-size: 0.85rem;
    color: var(--muted);
    padding: 0.15rem 0.25rem 0.5rem;
  }
  .gd {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: 700;
    color: var(--ink);
  }
  .action-bar {
    position: absolute;
    bottom: calc(0.8rem + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    justify-content: center;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-l);
    box-shadow: var(--shadow-2);
    padding: 0.5rem 0.8rem;
    max-width: min(94%, 46rem);
    font-size: 0.9rem;
  }
  @media (max-width: 760px) {
    .action-bar {
      left: var(--space-2);
      right: var(--space-2);
      bottom: calc(var(--space-2) + env(safe-area-inset-bottom));
      max-width: none;
      transform: none;
      justify-content: flex-start;
      max-height: 45%;
      overflow: auto;
    }
    .arrange-hint {
      align-items: flex-start;
      gap: var(--space-2);
    }
    /* Keep the view pill clear of the full-width mobile action bar. */
    .canvas-pill {
      right: var(--space-2);
      bottom: calc(var(--space-2) + env(safe-area-inset-bottom));
    }
    .canvas-wrap:has(.action-bar) .canvas-pill {
      display: none;
    }
    .reset-label {
      display: none;
    }
    /* Fingers need the full target; the pill still reads as one control. */
    .pill-btn,
    .pill-zoom,
    .pill-snap {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
  }
  .action-bar .danger {
    color: var(--danger);
    border-color: var(--danger);
  }
  .zone-btn.on {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .zone-swatch {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    flex: none;
  }
  .zone-swatch.near-teacher {
    background: var(--accent);
  }
  .zone-swatch.away-from-door {
    background: var(--g-violet);
  }
  .zone-pref {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .ghost {
    position: fixed;
    z-index: 100;
    transform: translate(-50%, -120%);
    background: var(--brand);
    color: var(--on-brand);
    font-weight: 700;
    font-size: 0.85rem;
    border-radius: var(--radius-pill);
    padding: 0.3rem 0.8rem;
    box-shadow: var(--shadow-2);
    pointer-events: none;
  }
</style>
