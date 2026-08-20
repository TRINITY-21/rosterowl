// Central app state (Svelte 5 runes class). Everything the UI mutates goes
// through actions here so persistence, conflict checking, and toasts stay
// consistent. Rendered client-only — but every browser API is still guarded.

import { backupFilename, parseBackup, serializeBackup } from './backup';
import { confirmDialog } from './dialog.svelte';
import { TEMPLATES, distance, makeCluster, makeGroups, newId } from './geometry';
import {
    assignJob as assignJobInWheel,
    jobAssignments as computeJobAssignments,
    removeJobAt,
    rotateJobs as rotateJobsWheel,
    shuffleWheel,
    syncWheel,
} from './jobs';
import { displayNames } from './names';
import { pickNext } from './picker';
import type { ParsedName } from './smartPaste';
import { findConflicts, solve } from './solver';
import type {
    ClassData,
    Conflict,
    Id,
    PersistedState,
    Room,
    Student,
    ZoneKind,
} from './types';
import { STORAGE_KEY, emptyJobs, emptyWordLists } from './types';
import {
    AUTO_SNAPSHOT_MS,
    fingerprint,
    loadVersions,
    persistVersions,
    pushVersion,
    summarize,
    type VersionEntry,
    type VersionKind,
} from './versions';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'ok' | 'warn';
  /** Optional action button (e.g. "Save backup"). */
  action?: { label: string; run: () => void };
}

const SAMPLE_CLASS_ID = 'sample-class';

function sampleData(
  presetTemplate?: string
): Pick<PersistedState, 'rooms' | 'classes' | 'activeClassId'> {
  const tpl = presetTemplate ? TEMPLATES.find((t) => t.key === presetTemplate) : undefined;
  const desks = tpl ? tpl.make() : makeGroups(6, 4);
  const teacherDesk = { x: 3.9, y: 0.2 };
  // The four desks nearest the teacher become the "near teacher" zone.
  [...desks]
    .sort((a, b) => distance(a, teacherDesk) - distance(b, teacherDesk))
    .slice(0, 4)
    .forEach((d) => d.zones.push('near-teacher'));
  const room: Room = {
    id: 'sample-room',
    name: 'Room 12',
    desks,
    teacherDesk,
    door: { x: 0.2, y: 0.2 },
  };

  const names: Array<[string, string]> = [
    ['Ava', 'Martinez'], ['Liam', "O'Brien"], ['Zoë', 'Chen'], ['Noah', 'Williams'],
    ['Maya', 'Larsen'], ['Maya', 'Patel'], ['Ethan', 'Kim'], ['Sofia', 'Rossi'],
    ['Jackson', 'Lee'], ['Amara', 'Okafor'], ['Lucas', 'Silva'], ['Mia', 'Johnson'],
    ['Oliver', 'Grant'], ['Isabella', 'Cruz'], ['Elijah', 'Brooks'], ['Harper', 'Nguyen'],
    ['Mateo', 'Alvarez'], ['Ruby', 'Thompson'], ['Kai', 'Nakamura'], ['Grace', 'Adeyemi'],
    ['Leo', 'Fischer'], ['Nora', 'Haddad'],
  ];
  const students: Student[] = names.map(([first, last]) => ({
    id: newId(),
    first,
    last,
    absent: false,
    zonePref: null,
  }));
  const nora = students.find((s) => s.first === 'Nora');
  if (nora) nora.zonePref = 'near-teacher';
  const jackson = students.find((s) => s.first === 'Jackson');
  const ethan = students.find((s) => s.first === 'Ethan');

  const cls: ClassData = {
    id: SAMPLE_CLASS_ID,
    name: 'Sample class — 4th grade',
    roomId: room.id,
    students,
    apart: jackson && ethan ? [{ a: jackson.id, b: ethan.id }] : [],
    together: [],
    seating: {},
    locked: [],
    pickerHistory: [],
    // The sample class arrives with a filled jobs chart so /jobs-chart/
    // demonstrates itself on first visit.
    jobs: {
      titles: [
        'Line Leader', 'Door Holder', 'Paper Passer', 'Materials Manager',
        'Board Eraser', 'Light Monitor', 'Class Librarian', 'Messenger',
      ],
      wheel: students.map((s) => s.id),
      offset: 0,
    },
    wordLists: emptyWordLists(),
  };
  const result = solve({
    desks: room.desks,
    students,
    apart: cls.apart,
    together: cls.together,
    fixed: {},
    seed: 42,
  });
  cls.seating = result.seating;

  return { rooms: [room], classes: [cls], activeClassId: cls.id };
}

function defaultSettings(): PersistedState['settings'] {
  return { theme: 'system', backupPromptShown: false };
}

class AppState {
  rooms = $state<Room[]>([]);
  classes = $state<ClassData[]>([]);
  activeClassId = $state<Id | null>(null);
  settings = $state<PersistedState['settings']>(defaultSettings());

  // UI-only state (not persisted)
  mode = $state<'seat' | 'arrange'>('seat');
  conflicts = $state<Conflict[]>([]);
  selectedDeskId = $state<Id | null>(null);
  selectedStudentId = $state<Id | null>(null);
  /** When set, the next student clicked completes a pair constraint. */
  pairPicking = $state<{ kind: 'apart' | 'together'; a: Id } | null>(null);
  zoneBrush = $state<ZoneKind | null>(null);
  /** Snap desk dragging to the half-grid. Off = fine free placement. */
  snap = $state(true);
  toasts = $state<Toast[]>([]);
  loaded = $state(false);
  /** Version history snapshots, newest first. */
  versions = $state<VersionEntry[]>([]);

  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #toastSeq = 0;

  // ---- derived ------------------------------------------------------------

  get activeClass(): ClassData | null {
    return this.classes.find((c) => c.id === this.activeClassId) ?? null;
  }

  get activeRoom(): Room | null {
    const cls = this.activeClass;
    if (!cls) return null;
    return this.rooms.find((r) => r.id === cls.roomId) ?? null;
  }

  get isSample(): boolean {
    return this.activeClassId === SAMPLE_CLASS_ID;
  }

  get names(): Map<Id, string> {
    return displayNames(this.activeClass?.students ?? []);
  }

  /** studentId -> deskId (inverse of seating). */
  get seatOf(): Map<Id, Id> {
    const m = new Map<Id, Id>();
    const cls = this.activeClass;
    if (cls) for (const [deskId, sid] of Object.entries(cls.seating)) m.set(sid, deskId);
    return m;
  }

  get unseated(): Student[] {
    const cls = this.activeClass;
    if (!cls) return [];
    const seated = new Set(Object.values(cls.seating));
    return cls.students.filter((s) => !seated.has(s.id));
  }

  // ---- lifecycle ----------------------------------------------------------

  /**
   * @param presetTemplate first-visit-only: the sample room starts from this
   * layout template (used by the SEO landing pages). Saved state always wins.
   */
  load(presetTemplate?: string) {
    if (this.loaded) return;
    let restored = false;
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const state = parseBackup(raw);
        this.rooms = state.rooms;
        this.classes = state.classes;
        this.activeClassId =
          state.classes.find((c) => c.id === state.activeClassId)?.id ??
          state.classes[0]?.id ??
          null;
        this.settings = { ...defaultSettings(), ...state.settings };
        restored = true;
      }
    } catch {
      // Corrupt store: fall through to sample rather than crash.
    }
    if (!restored) {
      const s = sampleData(presetTemplate);
      this.rooms = s.rooms;
      this.classes = s.classes;
      this.activeClassId = s.activeClassId;
    }
    // The header toggle can run on a page with no Svelte island, where it only
    // writes the standalone key. Adopt that choice instead of overwriting it.
    if (this.settings.theme === 'system') {
      try {
        const standalone = localStorage.getItem('rosterowl:theme');
        if (standalone === 'dark' || standalone === 'light') this.settings.theme = standalone;
      } catch {
        /* private mode — fall through to the default */
      }
    }
    this.applyTheme();
    this.refreshConflicts();
    this.versions = loadVersions();
    this.loaded = true;

    // Cross-tab safety: this browser's storage is the only copy of the
    // teacher's data, so a stale tab must adopt newer state before it can
    // save over it.
    if (typeof window !== 'undefined') {
      // Flush the debounced save when the tab is being hidden or closed, so
      // an action taken just before closing is never lost.
      window.addEventListener('pagehide', () => {
        if (this.#saveTimer) {
          clearTimeout(this.#saveTimer);
          this.#saveTimer = null;
          this.saveNow();
        }
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && this.#saveTimer) {
          clearTimeout(this.#saveTimer);
          this.#saveTimer = null;
          this.saveNow();
        }
      });

      window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY || !e.newValue) return;
        try {
          const state = parseBackup(e.newValue);
          this.rooms = state.rooms;
          this.classes = state.classes;
          this.activeClassId =
            state.classes.find((c) => c.id === this.activeClassId)?.id ??
            state.activeClassId ??
            state.classes[0]?.id ??
            null;
          this.settings = { ...defaultSettings(), ...state.settings };
          this.applyTheme();
          this.clearSelection();
          this.refreshConflicts();
        } catch {
          /* ignore malformed writes from other tabs */
        }
      });

      window.addEventListener('rosterowl-theme-change', (event) => {
        const theme = (event as CustomEvent<PersistedState['settings']['theme']>).detail;
        if (theme === 'system' || theme === 'light' || theme === 'dark') {
          this.settings.theme = theme;
          this.scheduleSave();
        }
      });
    }
  }

  snapshot(): PersistedState {
    return {
      version: 1,
      rooms: $state.snapshot(this.rooms),
      classes: $state.snapshot(this.classes),
      activeClassId: this.activeClassId,
      settings: $state.snapshot(this.settings),
    };
  }

  scheduleSave() {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot()));
      }
    } catch {
      this.toast('Could not save to this browser — download a backup to be safe.', 'warn');
    }
    const newest = this.versions[0];
    if (!newest || Date.now() - newest.ts >= AUTO_SNAPSHOT_MS) this.captureVersion('auto');
  }

  // ---- version history ----------------------------------------------------

  captureVersion(kind: VersionKind, label: string | null = null) {
    const state = this.snapshot();
    // Auto/safety snapshots skip when nothing about rooms/classes changed;
    // an explicit manual save is always honored.
    if (kind !== 'manual') {
      const newest = this.versions[0];
      if (newest && fingerprint(newest.state) === fingerprint(state)) return;
    }
    const entry: VersionEntry = {
      id: newId(),
      ts: Date.now(),
      kind,
      label,
      summary: summarize(state),
      state,
    };
    this.versions = persistVersions(pushVersion(this.versions, entry));
  }

  saveVersion(label: string | null = null) {
    this.captureVersion('manual', label);
    this.toast(label ? `Version “${label}” saved` : 'Version saved', 'ok');
  }

  restoreVersion(id: Id) {
    const entry = this.versions.find((v) => v.id === id);
    if (!entry) return;
    // The teacher can always get back to where they were before restoring.
    this.captureVersion('safety');
    const state: PersistedState = JSON.parse(JSON.stringify(entry.state));
    this.rooms = state.rooms;
    this.classes = state.classes;
    this.activeClassId =
      state.classes.find((c) => c.id === state.activeClassId)?.id ?? state.classes[0]?.id ?? null;
    this.clearSelection();
    this.refreshConflicts();
    this.saveNow();
    this.toast('Version restored', 'ok');
  }

  deleteVersion(id: Id) {
    this.versions = persistVersions(this.versions.filter((v) => v.id !== id));
  }

  async requestPersist() {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
        await navigator.storage.persist();
      }
    } catch {
      /* best effort */
    }
  }

  // ---- toasts -------------------------------------------------------------

  toast(message: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
    const id = ++this.#toastSeq;
    this.toasts.push({ id, message, kind, action });
    // Never stack more than four — the oldest actionless toast gives way first.
    // The search excludes the toast just pushed, which would otherwise evict
    // itself whenever every older toast carried an Undo action.
    if (this.toasts.length > 4) {
      const older = this.toasts.slice(0, -1);
      const victim = older.find((t) => !t.action) ?? older[0];
      if (victim) this.dismissToast(victim.id);
    }
    setTimeout(() => this.dismissToast(id), action ? 9000 : 3800);
  }

  dismissToast(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  // ---- theme --------------------------------------------------------------

  setTheme(theme: PersistedState['settings']['theme']) {
    this.settings.theme = theme;
    this.applyTheme();
    this.scheduleSave();
  }

  applyTheme() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    // Light paper is the default; only an explicit dark choice flips the page.
    if (this.settings.theme === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    try {
      // Mirror to the standalone key the pre-paint script reads first-visit.
      // Clearing it on 'system' keeps the mirror from going stale after a
      // backup restore, which would silently re-apply the old theme.
      if (this.settings.theme === 'system') localStorage.removeItem('rosterowl:theme');
      else localStorage.setItem('rosterowl:theme', this.settings.theme);
    } catch {
      /* best effort */
    }
  }

  // ---- roster / classes ---------------------------------------------------

  createClass(name: string, parsed: ParsedName[]) {
    const room =
      this.activeRoom ??
      this.rooms[0] ??
      ((): Room => {
        const r: Room = {
          id: newId(),
          name: 'My room',
          desks: makeGroups(6, 4),
          teacherDesk: { x: 3.9, y: 0.2 },
          door: null,
        };
        this.rooms.push(r);
        return r;
      })();
    const cls: ClassData = {
      id: newId(),
      name: name.trim() || 'My class',
      roomId: room.id,
      students: parsed.map((p) => ({
        id: newId(),
        first: p.first,
        last: p.last,
        absent: false,
        zonePref: null,
      })),
      apart: [],
      together: [],
      seating: {},
      locked: [],
      pickerHistory: [],
      jobs: emptyJobs(),
      wordLists: emptyWordLists(),
    };
    cls.jobs.wheel = cls.students.map((s) => s.id);
    this.classes.push(cls);
    this.activeClassId = cls.id;
    this.refreshConflicts();
    this.scheduleSave();
    this.offerFirstBackup();
    return cls;
  }

  addStudents(parsed: ParsedName[]) {
    const cls = this.activeClass;
    if (!cls) return;
    for (const p of parsed) {
      cls.students.push({ id: newId(), first: p.first, last: p.last, absent: false, zonePref: null });
    }
    syncWheel(cls.jobs, cls.students);
    this.refreshConflicts();
    this.scheduleSave();
  }

  updateStudent(id: Id, patch: Partial<Pick<Student, 'first' | 'last'>>) {
    const s = this.activeClass?.students.find((x) => x.id === id);
    if (!s) return;
    if (patch.first !== undefined) s.first = patch.first;
    if (patch.last !== undefined) s.last = patch.last;
    this.scheduleSave();
  }

  removeStudent(id: Id) {
    const cls = this.activeClass;
    if (!cls) return;
    cls.students = cls.students.filter((s) => s.id !== id);
    for (const [deskId, sid] of Object.entries(cls.seating)) {
      if (sid === id) delete cls.seating[deskId];
    }
    cls.apart = cls.apart.filter((p) => p.a !== id && p.b !== id);
    cls.together = cls.together.filter((p) => p.a !== id && p.b !== id);
    cls.pickerHistory = cls.pickerHistory.filter((h) => h !== id);
    syncWheel(cls.jobs, cls.students);
    if (this.selectedStudentId === id) this.selectedStudentId = null;
    this.refreshConflicts();
    this.scheduleSave();
  }

  toggleAbsent(id: Id) {
    const s = this.activeClass?.students.find((x) => x.id === id);
    if (!s) return;
    s.absent = !s.absent;
    this.refreshConflicts();
    this.scheduleSave();
  }

  setZonePref(id: Id, pref: ZoneKind | null) {
    const s = this.activeClass?.students.find((x) => x.id === id);
    if (!s) return;
    s.zonePref = pref;
    this.refreshConflicts();
    this.scheduleSave();
  }

  switchClass(id: Id) {
    this.activeClassId = id;
    this.clearSelection();
    this.refreshConflicts();
    this.scheduleSave();
  }

  renameClass(name: string) {
    const cls = this.activeClass;
    if (!cls) return;
    cls.name = name.trim() || cls.name;
    this.scheduleSave();
  }

  deleteClass(id: Id) {
    this.classes = this.classes.filter((c) => c.id !== id);
    if (this.activeClassId === id) this.activeClassId = this.classes[0]?.id ?? null;
    this.clearSelection();
    this.refreshConflicts();
    this.scheduleSave();
  }

  // ---- constraints --------------------------------------------------------

  startPairPick(kind: 'apart' | 'together', a: Id) {
    this.pairPicking = { kind, a };
  }

  completePairPick(b: Id) {
    const pick = this.pairPicking;
    const cls = this.activeClass;
    this.pairPicking = null;
    if (!pick || !cls || pick.a === b) return;
    const list = pick.kind === 'apart' ? cls.apart : cls.together;
    const exists = list.some((p) => (p.a === pick.a && p.b === b) || (p.a === b && p.b === pick.a));
    if (!exists) list.push({ a: pick.a, b });
    this.refreshConflicts();
    this.scheduleSave();
    const nm = this.names;
    this.toast(
      pick.kind === 'apart'
        ? `${nm.get(pick.a)} and ${nm.get(b)} will be kept apart`
        : `${nm.get(pick.a)} and ${nm.get(b)} will be kept together`,
      'ok'
    );
  }

  removePair(kind: 'apart' | 'together', index: number) {
    const cls = this.activeClass;
    if (!cls) return;
    (kind === 'apart' ? cls.apart : cls.together).splice(index, 1);
    this.refreshConflicts();
    this.scheduleSave();
  }

  // ---- seating ------------------------------------------------------------

  seatStudent(deskId: Id, studentId: Id) {
    const cls = this.activeClass;
    if (!cls) return;
    const currentDeskOfStudent = this.seatOf.get(studentId) ?? null;
    const occupant = cls.seating[deskId] ?? null;
    if (currentDeskOfStudent) delete cls.seating[currentDeskOfStudent];
    if (occupant && occupant !== studentId) {
      // Swap when the dragged student had a seat, otherwise displace to tray.
      if (currentDeskOfStudent) cls.seating[currentDeskOfStudent] = occupant;
    }
    cls.seating[deskId] = studentId;
    this.refreshConflicts();
    this.scheduleSave();
  }

  unseat(studentId: Id) {
    const cls = this.activeClass;
    if (!cls) return;
    const deskId = this.seatOf.get(studentId);
    if (deskId) delete cls.seating[deskId];
    this.refreshConflicts();
    this.scheduleSave();
  }

  toggleLock(deskId: Id) {
    const cls = this.activeClass;
    if (!cls) return;
    cls.locked = cls.locked.includes(deskId)
      ? cls.locked.filter((d) => d !== deskId)
      : [...cls.locked, deskId];
    this.scheduleSave();
  }

  shuffle() {
    const cls = this.activeClass;
    const room = this.activeRoom;
    if (!cls || !room) return;
    // Locked desks and absent students' current seats stay exactly put.
    const fixed: Record<Id, Id> = {};
    const absentIds = new Set(cls.students.filter((s) => s.absent).map((s) => s.id));
    for (const [deskId, sid] of Object.entries(cls.seating)) {
      if (cls.locked.includes(deskId) || absentIds.has(sid)) fixed[deskId] = sid;
    }
    const fixedStudentIds = new Set(Object.values(fixed));
    // Fixed students must be VISIBLE to the solver (their rules still apply);
    // absent unseated students are the only ones excluded entirely.
    const solveStudents = cls.students.filter(
      (s) => !absentIds.has(s.id) || fixedStudentIds.has(s.id)
    );
    // A desk locked while empty stays empty (broken chair, reserved seat).
    const desks = room.desks.filter(
      (d) => !(cls.locked.includes(d.id) && !(d.id in cls.seating))
    );
    const result = solve({
      desks,
      students: solveStudents,
      apart: cls.apart,
      together: cls.together,
      fixed,
    });
    cls.seating = result.seating;
    this.refreshConflicts();
    this.scheduleSave();
    const n = this.conflicts.length;
    if (n === 0) this.toast('Shuffled — all rules satisfied', 'ok');
    else this.toast(`Shuffled — ${n} rule${n === 1 ? '' : 's'} couldn't be satisfied`, 'warn');
  }

  refreshConflicts() {
    const cls = this.activeClass;
    const room = this.activeRoom;
    if (!cls || !room) {
      this.conflicts = [];
      return;
    }
    this.conflicts = findConflicts(room.desks, cls.students, cls.apart, cls.together, cls.seating);
  }

  clearSelection() {
    this.selectedDeskId = null;
    this.selectedStudentId = null;
    this.pairPicking = null;
    this.zoneBrush = null;
  }

  // ---- room editing -------------------------------------------------------

  applyTemplate(key: string) {
    const room = this.activeRoom;
    const cls = this.activeClass;
    if (!room || !cls) return;
    const tpl = TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    // Replacing every desk clears seating for all classes in this room —
    // keep an escape hatch in version history.
    this.captureVersion('safety');
    room.desks = tpl.make();
    cls.seating = {};
    cls.locked = [];
    for (const c of this.classes) {
      if (c.id !== cls.id && c.roomId === room.id) {
        c.seating = {};
        c.locked = [];
      }
    }
    this.refreshConflicts();
    this.scheduleSave();
  }

  addCluster(size: number) {
    const room = this.activeRoom;
    if (!room) return;
    const maxY = room.desks.length ? Math.max(...room.desks.map((d) => d.y)) : 1;
    const desks = makeCluster(size, { x: 1, y: maxY + 1.8 });
    room.desks.push(...desks);
    this.scheduleSave();
  }

  removeDesk(deskId: Id) {
    const room = this.activeRoom;
    if (!room) return;
    room.desks = room.desks.filter((d) => d.id !== deskId);
    for (const c of this.classes) {
      if (c.roomId === room.id) {
        delete c.seating[deskId];
        c.locked = c.locked.filter((d) => d !== deskId);
      }
    }
    if (this.selectedDeskId === deskId) this.selectedDeskId = null;
    this.refreshConflicts();
    this.scheduleSave();
  }

  /** Grid rounding honoring the snap toggle (half-grid vs fine placement). */
  snapRound(v: number): number {
    return this.snap ? Math.round(v * 2) / 2 : Math.round(v * 10) / 10;
  }

  moveDesk(deskId: Id, x: number, y: number) {
    const room = this.activeRoom;
    const d = room?.desks.find((k) => k.id === deskId);
    if (!d) return;
    d.x = Math.max(0, this.snapRound(x));
    d.y = Math.max(0, this.snapRound(y));
    this.refreshConflicts();
    this.scheduleSave();
  }

  moveGroup(groupId: Id, dx: number, dy: number) {
    const room = this.activeRoom;
    if (!room) return;
    const members = room.desks.filter((d) => d.groupId === groupId);
    if (members.length === 0) return;
    // Clamp the delta once for the whole group so hitting a wall never
    // squashes the cluster's shape.
    dx = Math.max(dx, -Math.min(...members.map((d) => d.x)));
    dy = Math.max(dy, -Math.min(...members.map((d) => d.y)));
    for (const d of members) {
      d.x = this.snapRound(d.x + dx);
      d.y = this.snapRound(d.y + dy);
    }
    this.refreshConflicts();
    this.scheduleSave();
  }

  toggleDeskZone(deskId: Id, kind: ZoneKind) {
    const room = this.activeRoom;
    const d = room?.desks.find((k) => k.id === deskId);
    if (!d) return;
    d.zones = d.zones.includes(kind) ? d.zones.filter((z) => z !== kind) : [...d.zones, kind];
    this.refreshConflicts();
    this.scheduleSave();
  }

  renameRoom(name: string) {
    const room = this.activeRoom;
    if (!room) return;
    room.name = name.trim() || room.name;
    this.scheduleSave();
  }

  // ---- picker ---------------------------------------------------------------

  /** Fair cold-call pick; returns the student or null (all absent / no class). */
  pickStudent(rand: () => number = Math.random): Student | null {
    const cls = this.activeClass;
    if (!cls) return null;
    const { student, newRound } = pickNext(cls.students, cls.pickerHistory, rand);
    if (!student) return null;
    if (newRound) {
      cls.pickerHistory = [];
      this.toast("Everyone's had a turn — starting a new round", 'ok');
    }
    cls.pickerHistory = [...cls.pickerHistory, student.id];
    this.scheduleSave();
    return student;
  }

  resetPickerRound() {
    const cls = this.activeClass;
    if (!cls) return;
    cls.pickerHistory = [];
    this.scheduleSave();
  }

  // ---- jobs chart -----------------------------------------------------------

  /** Student for each job title (null = more jobs than students). */
  get jobAssignments(): (Student | null)[] {
    const cls = this.activeClass;
    return cls ? computeJobAssignments(cls.jobs, cls.students) : [];
  }

  applyJobPreset(titles: string[]) {
    const cls = this.activeClass;
    if (!cls) return;
    syncWheel(cls.jobs, cls.students);
    cls.jobs.titles = [...titles];
    this.scheduleSave();
  }

  addJob(title: string) {
    const cls = this.activeClass;
    const t = title.trim();
    if (!cls || !t) return;
    syncWheel(cls.jobs, cls.students);
    cls.jobs.titles.push(t);
    this.scheduleSave();
  }

  renameJob(index: number, title: string) {
    const cls = this.activeClass;
    const t = title.trim();
    if (!cls || !t || index < 0 || index >= cls.jobs.titles.length) return;
    cls.jobs.titles[index] = t;
    this.scheduleSave();
  }

  removeJob(index: number) {
    const cls = this.activeClass;
    if (!cls || index < 0 || index >= cls.jobs.titles.length) return;
    syncWheel(cls.jobs, cls.students);
    removeJobAt(cls.jobs, index);
    this.scheduleSave();
  }

  rotateJobs() {
    const cls = this.activeClass;
    if (!cls) return;
    syncWheel(cls.jobs, cls.students);
    if (cls.jobs.titles.length === 0 || cls.jobs.wheel.length === 0) return;
    // Undo must restore THIS class's exact pre-rotate state, no matter which
    // class is active (or how the job list changed) when it's clicked.
    const prevOffset = cls.jobs.offset;
    rotateJobsWheel(cls.jobs);
    this.scheduleSave();
    this.toast('Jobs rotated — every job has a new owner', 'ok', {
      label: 'Undo',
      run: () => {
        cls.jobs.offset = prevOffset;
        this.scheduleSave();
      },
    });
  }

  /** Hand a job to a specific student (trades jobs if they already hold one). */
  assignJob(index: number, studentId: Id) {
    const cls = this.activeClass;
    if (!cls) return;
    syncWheel(cls.jobs, cls.students);
    assignJobInWheel(cls.jobs, index, studentId);
    this.scheduleSave();
  }

  shuffleJobCrew(rand: () => number = Math.random) {
    const cls = this.activeClass;
    if (!cls) return;
    syncWheel(cls.jobs, cls.students);
    shuffleWheel(cls.jobs, rand);
    this.scheduleSave();
    this.toast('Crew shuffled — a new rotation order', 'ok');
  }

  // ---- saved word lists -----------------------------------------------------

  setWordList(kind: 'bingo' | 'flashcards', text: string) {
    const cls = this.activeClass;
    if (!cls) return;
    cls.wordLists[kind] = text;
    this.scheduleSave();
  }

  // ---- backup -------------------------------------------------------------

  offerFirstBackup() {
    if (this.settings.backupPromptShown) return;
    this.settings.backupPromptShown = true;
    this.requestPersist();
    this.toast('Class saved in this browser. Download a backup file so it can never be lost.', 'info', {
      label: 'Save backup',
      run: () => this.downloadBackup(),
    });
    this.scheduleSave();
  }

  downloadBackup() {
    if (typeof document === 'undefined') return;
    const blob = new Blob([serializeBackup(this.snapshot())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFilename();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    this.toast('Backup saved to your downloads', 'ok');
  }

  async restoreBackup(file: File) {
    try {
      const text = await file.text();
      const state = parseBackup(text);
      if (this.classes.length > 0) {
        const ok = await confirmDialog({
          title: 'Restore this backup?',
          message: 'Everything currently in RosterOwl is replaced with the backup file.',
          detail: 'The current state is saved to version history first, so you can undo this.',
          confirmLabel: 'Restore backup',
        });
        if (!ok) return;
      }
      this.captureVersion('safety');
      this.rooms = state.rooms;
      this.classes = state.classes;
      this.activeClassId =
        state.classes.find((c) => c.id === state.activeClassId)?.id ??
        state.classes[0]?.id ??
        null;
      this.settings = { ...defaultSettings(), ...state.settings, backupPromptShown: true };
      this.applyTheme();
      this.clearSelection();
      this.refreshConflicts();
      this.saveNow();
      this.toast('Backup restored', 'ok');
    } catch (e) {
      this.toast(e instanceof Error ? e.message : 'That file could not be read', 'warn');
    }
  }
}

export const app = new AppState();
