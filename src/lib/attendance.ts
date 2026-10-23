// Daily attendance: which days were taken, who was absent or late, and the
// month's totals. Pure functions over the class's AttendanceLog — no pdf-lib,
// so the attendance tool can import this without loading the PDF engine.
//
// Dates are the device's local calendar date ('YYYY-MM-DD'). Days are built
// with new Date(y, m, d) and stepped with setDate(), never by adding
// milliseconds, so a daylight-saving change can't skip or repeat a day.

import { isDateKey } from './backup';
import type { AttendanceLog, AttendanceMark, ClassData, Id, Student } from './types';

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

export function dayState(log: AttendanceLog, date: string, id: Id): DayState {
  const joined = log.joined[id];
  if (joined && date < joined) return 'not-enrolled';
  return log.days[date]?.[id] ?? 'present';
}

/** Counts for one day, over the students enrolled on it. */
export function tally(
  log: AttendanceLog,
  date: string,
  students: Student[],
): { taken: boolean; present: number; absent: number; late: number } {
  const out = { taken: date in log.days, present: 0, absent: 0, late: 0 };
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
    .filter((key) => key in log.days);
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
    const d = parseDateKey(key);
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
  return cls.students.filter((s) => s.absent && cls.attendance.days[date]?.[s.id] !== 'absent');
}

const NEXT: Record<'present' | AttendanceMark, 'present' | AttendanceMark> = {
  present: 'absent',
  absent: 'late',
  late: 'present',
};

/**
 * One tap on a student: present → absent → late → present. The first tap
 * records the day. On a day before the student joined, the tap instead moves
 * their join date back to it (the teacher added them late).
 *
 * When `date` is today, the tapped student's absent flag follows the mark, so
 * the picker, group maker and seating shuffle skip them; late counts as here.
 */
export function tapStudent(cls: ClassData, date: string, id: Id, todayKey: string): DayState {
  const log = cls.attendance;
  const state = dayState(log, date, id);
  const day = (log.days[date] ??= {});
  let next: 'present' | AttendanceMark;
  if (state === 'not-enrolled') {
    log.joined[id] = date;
    next = 'present';
  } else {
    next = NEXT[state];
    if (next === 'present') delete day[id];
    else day[id] = next;
  }
  if (date === todayKey) {
    const s = cls.students.find((x) => x.id === id);
    if (s) s.absent = next === 'absent';
  }
  return next;
}

/** Record the day with nobody absent or late. */
export function markAllPresent(cls: ClassData, date: string, todayKey: string): void {
  cls.attendance.days[date] = {};
  if (date === todayKey) for (const s of cls.students) s.absent = false;
}

/** Mark absent everyone the other tools already flag as absent. */
export function markFlaggedAbsent(cls: ClassData, date: string, todayKey: string): void {
  const flagged = flaggedNotMarked(cls, date);
  const day = (cls.attendance.days[date] ??= {});
  for (const s of flagged) {
    day[s.id] = 'absent';
    if (date === todayKey) s.absent = true;
  }
}

export function clearDay(cls: ClassData, date: string): void {
  delete cls.attendance.days[date];
}

/**
 * Students added once attendance has started count from today, so the
 * register doesn't show them present on days before they arrived.
 */
export function noteNewStudents(log: AttendanceLog, ids: Id[], todayKey: string): void {
  if (Object.keys(log.days).length === 0) return;
  for (const id of ids) log.joined[id] = todayKey;
}

export function forgetStudent(log: AttendanceLog, id: Id): void {
  for (const day of Object.values(log.days)) delete day[id];
  delete log.joined[id];
}
