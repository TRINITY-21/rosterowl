// Daily attendance: which days were taken, who was absent or late, and the
// month's totals. Pure functions over the class's AttendanceLog — no pdf-lib,
// so the attendance tool can import this without loading the PDF engine.
//
// Dates are the device's local calendar date ('YYYY-MM-DD'). Days are built
// with new Date(y, m, d) and stepped with setDate(), never by adding
// milliseconds, so a daylight-saving change can't skip or repeat a day.

import type { AttendanceDay, AttendanceLog, AttendanceMark, ClassData, Id, Student } from './types';

export type DayState = 'present' | AttendanceMark | 'not-enrolled';

// getDay() index -> letter. Single letters on purpose: the day number printed
// beside each letter disambiguates Tuesday/Thursday.
const WEEKDAY_LETTERS = ['', 'M', 'T', 'W', 'T', 'F', ''] as const;

/** Every Mon–Fri of the month. `month` is 0-based like JS Date. */
export function schoolDays(year: number, month: number): { day: number; weekday: string }[] {
  const out: { day: number; weekday: string }[] = [];
  const lastDay = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= lastDay; day++) {
    const dow = new Date(year, month, day).getDay();
    if (dow >= 1 && dow <= 5) out.push({ day, weekday: WEEKDAY_LETTERS[dow]! });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A real calendar date written 'YYYY-MM-DD' — not merely that shape. */
export function isDateKey(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of a 'YYYY-MM-DD' key, or null if it is not a real date. */
export function parseDateKey(key: string): Date | null {
  if (!isDateKey(key)) return null;
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSchoolDay(d: Date): boolean {
  const dow = d.getDay();
  return dow >= 1 && dow <= 5;
}

/** Today when it is a school day, otherwise the most recent Friday. */
export function defaultMarkingDay(today: Date): Date {
  const d = midnight(today);
  while (!isSchoolDay(d)) d.setDate(d.getDate() - 1);
  return d;
}

/** The previous or next Mon–Fri, or null rather than step past today. */
export function stepSchoolDay(from: Date, dir: -1 | 1, today: Date): Date | null {
  const d = midnight(from);
  do d.setDate(d.getDate() + dir);
  while (!isSchoolDay(d));
  return dir === 1 && d > midnight(today) ? null : d;
}

/** Attendance was taken that day (and not cleared since). */
export function isTaken(log: AttendanceLog, date: string): boolean {
  const day = log.days[date];
  return !!day && !day.cleared;
}

export function dayState(log: AttendanceLog, date: string, id: Id): DayState {
  const joined = log.joined[id];
  if (joined && date < joined) return 'not-enrolled';
  const day = log.days[date];
  return (day && !day.cleared ? day.marks[id] : undefined) ?? 'present';
}

/** Counts for one day, over the students enrolled on it. */
export function tally(
  log: AttendanceLog,
  date: string,
  students: Student[],
): { taken: boolean; present: number; absent: number; late: number } {
  const out = { taken: isTaken(log, date), present: 0, absent: 0, late: 0 };
  for (const s of students) {
    const state = dayState(log, date, s.id);
    if (state !== 'not-enrolled') out[state] += 1;
  }
  return out;
}

/**
 * The month's taken school days and each student's absent/late counts on
 * them. Days before a student joined, and marks for anyone no longer on the
 * roster, count for nothing.
 */
export function monthTotals(
  log: AttendanceLog,
  students: Student[],
  year: number,
  month0: number,
): { daysTaken: number; schoolDayCount: number; perStudent: Map<Id, { absent: number; late: number }> } {
  const taken = schoolDays(year, month0)
    .map(({ day }) => dateKey(new Date(year, month0, day)))
    .filter((key) => isTaken(log, key));
  const perStudent = new Map<Id, { absent: number; late: number }>();
  for (const s of students) {
    const counts = { absent: 0, late: 0 };
    for (const key of taken) {
      const state = dayState(log, key, s.id);
      if (state === 'absent' || state === 'late') counts[state] += 1;
    }
    perStudent.set(s.id, counts);
  }
  return { daysTaken: taken.length, schoolDayCount: schoolDays(year, month0).length, perStudent };
}

/**
 * Months the register can be printed for: every month with a taken day,
 * `include` (the month being marked), and this month plus the next 11.
 */
export function printMonths(
  now: Date,
  log: AttendanceLog,
  include?: Date,
): { year: number; month: number }[] {
  const seen = new Map<number, { year: number; month: number }>();
  const add = (year: number, month: number) => seen.set(year * 12 + month, { year, month });
  for (const key of Object.keys(log.days)) {
    const d = isTaken(log, key) ? parseDateKey(key) : null;
    if (d) add(d.getFullYear(), d.getMonth());
  }
  if (include) add(include.getFullYear(), include.getMonth());
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    add(d.getFullYear(), d.getMonth());
  }
  return [...seen.entries()].sort(([a], [b]) => a - b).map(([, m]) => m);
}

/** Students flagged absent in the other tools but not marked absent on `date`. */
export function flaggedNotMarked(cls: ClassData, date: string): Student[] {
  return cls.students.filter((s) => s.absent && dayState(cls.attendance, date, s.id) !== 'absent');
}

const NEXT: Record<'present' | AttendanceMark, 'present' | AttendanceMark> = {
  present: 'absent',
  absent: 'late',
  late: 'present',
};

/** The day to write marks into: a fresh one if it was never taken or was cleared. */
function openDay(log: AttendanceLog, date: string, now: number): AttendanceDay {
  const existing = log.days[date];
  if (existing && !existing.cleared) {
    existing.at = now;
    return existing;
  }
  log.days[date] = { at: now, marks: {} };
  return log.days[date]!;
}

/**
 * One tap on a student: present → absent → late → present. The first tap
 * records the day. On a day before the student joined, the tap instead moves
 * their join date back to it (the teacher added them late) — without taking
 * attendance for anyone else.
 *
 * When `date` is today, the tapped student's absent flag follows the mark, so
 * the picker, group maker and seating shuffle skip them; late counts as here.
 */
export function tapStudent(cls: ClassData, date: string, id: Id, todayKey: string, now: number): DayState {
  const log = cls.attendance;
  const state = dayState(log, date, id);
  let next: 'present' | AttendanceMark;
  if (state === 'not-enrolled') {
    log.joined[id] = date;
    next = 'present';
  } else {
    next = NEXT[state];
    const day = openDay(log, date, now);
    if (next === 'present') delete day.marks[id];
    else day.marks[id] = next;
  }
  if (date === todayKey) {
    const s = cls.students.find((x) => x.id === id);
    if (s) s.absent = next === 'absent';
  }
  return next;
}

/** Record the day with nobody absent or late. */
export function markAllPresent(cls: ClassData, date: string, todayKey: string, now: number): void {
  cls.attendance.days[date] = { at: now, marks: {} };
  if (date === todayKey) for (const s of cls.students) s.absent = false;
}

/** Mark absent everyone the other tools already flag as absent. */
export function markFlaggedAbsent(cls: ClassData, date: string, todayKey: string, now: number): void {
  const flagged = flaggedNotMarked(cls, date);
  if (flagged.length === 0) return;
  const day = openDay(cls.attendance, date, now);
  for (const s of flagged) {
    day.marks[s.id] = 'absent';
    if (date === todayKey) s.absent = true;
  }
}

/** Un-take a day. A dated tombstone, not a deletion, so the clear syncs. */
export function clearDay(cls: ClassData, date: string, now: number): void {
  if (!isTaken(cls.attendance, date)) return;
  cls.attendance.days[date] = { at: now, marks: {}, cleared: true };
}

/**
 * Students added once attendance has started count from today, so the
 * register doesn't show them present on days before they arrived.
 */
export function noteNewStudents(log: AttendanceLog, ids: Id[], todayKey: string): void {
  if (!Object.keys(log.days).some((date) => isTaken(log, date))) return;
  for (const id of ids) log.joined[id] = todayKey;
}

/**
 * Combine two copies of a class's log: every day either has, the newer
 * version of a day where both do (`incoming` on a tie), and each student's
 * earliest join date. Always builds fresh objects.
 */
export function mergeAttendance(existing: AttendanceLog, incoming: AttendanceLog): AttendanceLog {
  const days: AttendanceLog['days'] = {};
  for (const date of new Set([...Object.keys(existing.days), ...Object.keys(incoming.days)])) {
    const a = existing.days[date];
    const b = incoming.days[date];
    const winner = !a ? b! : !b ? a : b.at >= a.at ? b : a;
    days[date] = winner.cleared
      ? { at: winner.at, marks: {}, cleared: true }
      : { at: winner.at, marks: { ...winner.marks } };
  }
  const joined: AttendanceLog['joined'] = { ...existing.joined };
  for (const [id, date] of Object.entries(incoming.joined)) {
    const mine = joined[id];
    if (!mine || date < mine) joined[id] = date;
  }
  return { days, joined };
}
