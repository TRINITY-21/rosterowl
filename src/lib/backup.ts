// Backup export/import. Parsing is defensive: it rebuilds a clean
// PersistedState field by field so a restored file can never smuggle in
// missing or malformed data that would crash the UI later.

import { isDateKey, mergeAttendance } from './attendance';
import type {
    AppSettings,
    AttendanceDay,
    AttendanceLog,
    AttendanceMark,
    ClassData,
    Desk,
    Id,
    JobsState,
    Marker,
    PairConstraint,
    PersistedState,
    Room,
    Student,
    WordLists,
    ZoneKind,
} from './types';
import { emptyJobs } from './types';

const APP_TAG = 'rosterowl';
const PARSE_ERROR = "This file doesn't look like a RosterOwl backup";

export function serializeBackup(state: PersistedState): string {
  return JSON.stringify(
    { app: APP_TAG, exportedAt: new Date().toISOString(), state },
    null,
    2,
  );
}

export function backupFilename(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `rosterowl-backup-${y}-${m}-${d}.json`;
}

/**
 * @param mergeWith the classes already in memory, when this document is about
 * to replace them. Attendance is the one part that is merged rather than
 * replaced: each class's log is combined with the same class's log here, day
 * by day, newer day winning (see mergeAttendance). A copy that lacks days —
 * from a device that hasn't seen them, or from a build that predates
 * attendance and drops the field — therefore never erases them.
 */
export function parseBackup(json: string, mergeWith?: readonly ClassData[]): PersistedState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail();
  }

  let candidate: unknown = parsed;
  if (isRecord(parsed) && ('state' in parsed || 'app' in parsed)) {
    // Wrapped form. Reject other apps' export files outright.
    if (parsed.app !== APP_TAG) fail();
    candidate = parsed.state;
  }

  if (!isRecord(candidate)) fail();
  if (candidate.version !== 1) fail();
  if (!Array.isArray(candidate.rooms) || !Array.isArray(candidate.classes)) fail();

  const rooms = candidate.rooms.map(cleanRoom);
  const classes = candidate.classes
    .map((v) => cleanClass(v, mergeWith))
    .map((cls) => sanitizeClass(cls, rooms));
  const classIds = new Set(classes.map((cls) => cls.id));
  const requested = typeof candidate.activeClassId === 'string' ? candidate.activeClassId : null;

  return {
    version: 1,
    rooms,
    classes,
    activeClassId: requested && classIds.has(requested) ? requested : (classes[0]?.id ?? null),
    settings: cleanSettings(candidate.settings),
  };
}

// ---------------------------------------------------------------------------

function fail(): never {
  throw new Error(PARSE_ERROR);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(v: unknown): string {
  if (typeof v !== 'string') fail();
  return v;
}

function optionalString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

const ZONE_KINDS: readonly ZoneKind[] = ['near-teacher', 'away-from-door'];

function cleanZones(v: unknown): ZoneKind[] {
  if (!Array.isArray(v)) return [];
  return v.filter((z): z is ZoneKind => ZONE_KINDS.includes(z as ZoneKind));
}

function cleanZonePref(v: unknown): ZoneKind | null {
  return ZONE_KINDS.includes(v as ZoneKind) ? (v as ZoneKind) : null;
}

function cleanMarker(v: unknown): Marker | null {
  if (!isRecord(v) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  return { x: v.x as number, y: v.y as number };
}

function cleanDesk(v: unknown): Desk {
  if (!isRecord(v)) fail();
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) fail();
  return {
    id: requireString(v.id),
    x: v.x as number,
    y: v.y as number,
    groupId: typeof v.groupId === 'string' ? v.groupId : null,
    zones: cleanZones(v.zones),
  };
}

function cleanRoom(v: unknown): Room {
  if (!isRecord(v)) fail();
  if (!Array.isArray(v.desks)) fail();
  return {
    id: requireString(v.id),
    name: optionalString(v.name, ''),
    desks: v.desks.map(cleanDesk),
    teacherDesk: cleanMarker(v.teacherDesk),
    door: cleanMarker(v.door),
  };
}

function cleanStudent(v: unknown): Student {
  if (!isRecord(v)) fail();
  return {
    id: requireString(v.id),
    first: optionalString(v.first, ''),
    last: optionalString(v.last, ''),
    absent: v.absent === true,
    zonePref: cleanZonePref(v.zonePref),
  };
}

function cleanPairs(v: unknown): PairConstraint[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is Record<string, unknown> => isRecord(p))
    .filter((p) => typeof p.a === 'string' && typeof p.b === 'string')
    .map((p) => ({ a: p.a as Id, b: p.b as Id }));
}

function cleanSeating(v: unknown): Record<Id, Id> {
  if (!isRecord(v)) fail();
  const out: Record<Id, Id> = {};
  for (const [deskId, studentId] of Object.entries(v)) {
    if (typeof studentId === 'string') out[deskId] = studentId;
  }
  return out;
}

function cleanJobs(v: unknown): JobsState {
  if (!isRecord(v)) return emptyJobs();
  return {
    titles: Array.isArray(v.titles)
      ? v.titles.filter((t): t is string => typeof t === 'string')
      : [],
    wheel: Array.isArray(v.wheel) ? v.wheel.filter((w): w is Id => typeof w === 'string') : [],
    offset: Number.isInteger(v.offset) && (v.offset as number) >= 0 ? (v.offset as number) : 0,
  };
}

function cleanWordLists(v: unknown): WordLists {
  const rec = isRecord(v) ? v : {};
  return {
    bingo: typeof rec.bingo === 'string' ? rec.bingo : '',
    flashcards: typeof rec.flashcards === 'string' ? rec.flashcards : '',
  };
}

const MARKS: readonly AttendanceMark[] = ['absent', 'late'];

function cleanDay(v: Record<string, unknown>): AttendanceDay {
  const at = typeof v.at === 'number' && Number.isFinite(v.at) && v.at >= 0 ? v.at : 0;
  if (v.cleared === true) return { at, marks: {}, cleared: true };
  const marks: Record<Id, AttendanceMark> = {};
  if (isRecord(v.marks)) {
    for (const [id, mark] of Object.entries(v.marks)) {
      if (MARKS.includes(mark as AttendanceMark)) marks[id] = mark as AttendanceMark;
    }
  }
  return { at, marks };
}

// Always builds fresh objects, so a log merged in from live (reactive) state
// is never shared with it.
function cleanAttendance(v: unknown): AttendanceLog {
  const rec = isRecord(v) ? v : {};
  const days: AttendanceLog['days'] = {};
  if (isRecord(rec.days)) {
    for (const [date, day] of Object.entries(rec.days)) {
      if (isDateKey(date) && isRecord(day)) days[date] = cleanDay(day);
    }
  }
  const joined: AttendanceLog['joined'] = {};
  if (isRecord(rec.joined)) {
    for (const [id, date] of Object.entries(rec.joined)) {
      if (typeof date === 'string' && isDateKey(date)) joined[id] = date;
    }
  }
  return { days, joined };
}

function cleanClass(v: unknown, mergeWith?: readonly ClassData[]): ClassData {
  if (!isRecord(v)) fail();
  if (!Array.isArray(v.students)) fail();
  // A class with no field at all was written by a build that predates
  // attendance; it merges as an empty log rather than meaning "none".
  const incoming = cleanAttendance(v.attendance);
  const local = mergeWith?.find((c) => c.id === v.id);
  return {
    id: requireString(v.id),
    name: optionalString(v.name, ''),
    roomId: requireString(v.roomId),
    students: v.students.map(cleanStudent),
    apart: cleanPairs(v.apart),
    together: cleanPairs(v.together),
    seating: cleanSeating(v.seating),
    locked: Array.isArray(v.locked) ? v.locked.filter((l): l is Id => typeof l === 'string') : [],
    pickerHistory: Array.isArray(v.pickerHistory)
      ? v.pickerHistory.filter((l): l is Id => typeof l === 'string')
      : [],
    jobs: cleanJobs(v.jobs),
    wordLists: cleanWordLists(v.wordLists),
    attendance: local ? mergeAttendance(cleanAttendance(local.attendance), incoming) : incoming,
  };
}

function sanitizeClass(cls: ClassData, rooms: Room[]): ClassData {
  const room = rooms.find((item) => item.id === cls.roomId) ?? rooms[0];
  const deskIds = new Set(room?.desks.map((desk) => desk.id) ?? []);
  const studentIds = new Set(cls.students.map((student) => student.id));
  const seating: Record<Id, Id> = {};
  for (const [deskId, studentId] of Object.entries(cls.seating)) {
    if (deskIds.has(deskId) && studentIds.has(studentId)) seating[deskId] = studentId;
  }
  // Marks for students no longer on the roster are dropped here, at the next
  // parse, rather than when the student is removed — so Undo can bring a
  // removed student back with their marks. A day whose marks all belonged to
  // removed students stays a taken day.
  const days: AttendanceLog['days'] = {};
  for (const [date, day] of Object.entries(cls.attendance.days)) {
    const marks = Object.fromEntries(Object.entries(day.marks).filter(([id]) => studentIds.has(id)));
    days[date] = day.cleared ? { at: day.at, marks: {}, cleared: true } : { at: day.at, marks };
  }
  const joined = Object.fromEntries(
    Object.entries(cls.attendance.joined).filter(([id]) => studentIds.has(id)),
  );
  const seenWheel = new Set<Id>();
  const wheel = cls.jobs.wheel.filter(
    (id) => studentIds.has(id) && !seenWheel.has(id) && (seenWheel.add(id), true),
  );
  return {
    ...cls,
    roomId: room?.id ?? cls.roomId,
    seating,
    locked: cls.locked.filter((id) => deskIds.has(id)),
    pickerHistory: cls.pickerHistory.filter((id) => studentIds.has(id)),
    apart: cls.apart.filter((pair) => studentIds.has(pair.a) && studentIds.has(pair.b)),
    together: cls.together.filter((pair) => studentIds.has(pair.a) && studentIds.has(pair.b)),
    jobs: {
      titles: cls.jobs.titles,
      wheel,
      offset: wheel.length ? cls.jobs.offset % wheel.length : 0,
    },
    attendance: { days, joined },
  };
}

function cleanSettings(v: unknown): AppSettings {
  const themes: readonly AppSettings['theme'][] = ['system', 'light', 'dark'];
  const rec = isRecord(v) ? v : {};
  return {
    theme: themes.includes(rec.theme as AppSettings['theme'])
      ? (rec.theme as AppSettings['theme'])
      : 'system',
    backupPromptShown: rec.backupPromptShown === true,
  };
}
