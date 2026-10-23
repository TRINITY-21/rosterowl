import { describe, expect, it } from 'vitest';
import {
  clearDay,
  dateKey,
  dayState,
  defaultMarkingDay,
  flaggedNotMarked,
  forgetStudent,
  markAllPresent,
  markFlaggedAbsent,
  monthTotals,
  noteNewStudents,
  parseDateKey,
  printMonths,
  stepSchoolDay,
  tally,
  tapStudent,
} from '../src/lib/attendance';
import type { AttendanceLog, ClassData, Student } from '../src/lib/types';
import { emptyAttendance, emptyJobs, emptyWordLists } from '../src/lib/types';

const TODAY = '2026-10-21'; // a Wednesday

const stu = (id: string): Student => ({ id, first: id.toUpperCase(), last: '', absent: false, zonePref: null });

function cls(): ClassData {
  return {
    id: 'c1',
    name: 'Period 3',
    roomId: 'r1',
    students: [stu('a'), stu('b'), stu('c')],
    apart: [],
    together: [],
    seating: {},
    locked: [],
    pickerHistory: [],
    jobs: emptyJobs(),
    wordLists: emptyWordLists(),
    attendance: emptyAttendance(),
  };
}

const student = (c: ClassData, id: string) => c.students.find((s) => s.id === id)!;

describe('dates', () => {
  it('keys by the local calendar date', () => {
    expect(dateKey(new Date(2026, 9, 21, 23, 59))).toBe('2026-10-21');
  });

  it('rejects impossible dates', () => {
    expect(parseDateKey('2026-02-30')).toBeNull();
    expect(parseDateKey('Oct 21')).toBeNull();
    expect(parseDateKey('2026-10-21')!.getDate()).toBe(21);
  });

  it('opens on today on a weekday and on Friday at the weekend', () => {
    expect(dateKey(defaultMarkingDay(new Date(2026, 9, 21)))).toBe('2026-10-21');
    expect(dateKey(defaultMarkingDay(new Date(2026, 9, 24)))).toBe('2026-10-23');
    expect(dateKey(defaultMarkingDay(new Date(2026, 9, 25, 8)))).toBe('2026-10-23');
  });

  it('steps over weekends, across months and the November DST change', () => {
    expect(dateKey(stepSchoolDay(new Date(2026, 10, 2), -1, new Date(2026, 10, 6))!)).toBe('2026-10-30');
    expect(dateKey(stepSchoolDay(new Date(2026, 9, 30), 1, new Date(2026, 10, 6))!)).toBe('2026-11-02');
    expect(dateKey(stepSchoolDay(new Date(2027, 0, 1), -1, new Date(2027, 0, 4))!)).toBe('2026-12-31');
  });

  it('never steps past today', () => {
    expect(stepSchoolDay(new Date(2026, 9, 21), 1, new Date(2026, 9, 21, 15))).toBeNull();
    expect(stepSchoolDay(new Date(2026, 9, 23), 1, new Date(2026, 9, 24))).toBeNull();
  });
});

describe('tapStudent', () => {
  it('cycles present → absent → late → present and records the day on first tap', () => {
    const c = cls();
    expect(c.attendance.days[TODAY]).toBeUndefined();
    expect(tapStudent(c, TODAY, 'a', TODAY)).toBe('absent');
    expect(c.attendance.days[TODAY]).toEqual({ a: 'absent' });
    expect(tapStudent(c, TODAY, 'a', TODAY)).toBe('late');
    expect(tapStudent(c, TODAY, 'a', TODAY)).toBe('present');
    expect(c.attendance.days[TODAY]).toEqual({});
    expect(dayState(c.attendance, TODAY, 'b')).toBe('present');
  });

  it('links the absent-today flag only when the day is today, and only for the tapped student', () => {
    const c = cls();
    student(c, 'b').absent = true; // flagged earlier in another tool
    tapStudent(c, TODAY, 'a', TODAY);
    expect(student(c, 'a').absent).toBe(true);
    tapStudent(c, TODAY, 'a', TODAY); // late counts as present
    expect(student(c, 'a').absent).toBe(false);
    tapStudent(c, TODAY, 'c', TODAY);
    expect(student(c, 'b').absent).toBe(true);
    student(c, 'a').absent = false;
    tapStudent(c, '2026-10-20', 'a', TODAY);
    expect(c.attendance.days['2026-10-20']).toEqual({ a: 'absent' });
    expect(student(c, 'a').absent).toBe(false);
  });

  it('enrolls a not-yet-joined student from that day instead of marking them', () => {
    const c = cls();
    c.attendance.joined.c = '2026-10-21';
    expect(dayState(c.attendance, '2026-10-19', 'c')).toBe('not-enrolled');
    expect(tapStudent(c, '2026-10-19', 'c', TODAY)).toBe('present');
    expect(c.attendance.joined.c).toBe('2026-10-19');
    expect(c.attendance.days['2026-10-19']).toEqual({});
  });
});

describe('day actions', () => {
  it('markAllPresent records an empty day and clears today flags', () => {
    const c = cls();
    student(c, 'a').absent = true;
    markAllPresent(c, '2026-10-20', TODAY);
    expect(c.attendance.days['2026-10-20']).toEqual({});
    expect(student(c, 'a').absent).toBe(true); // a past day leaves flags alone
    markAllPresent(c, TODAY, TODAY);
    expect(c.attendance.days[TODAY]).toEqual({});
    expect(c.students.every((s) => !s.absent)).toBe(true);
  });

  it('flaggedNotMarked lists flagged students not marked absent; markFlaggedAbsent marks exactly them', () => {
    const c = cls();
    student(c, 'a').absent = true;
    student(c, 'b').absent = true;
    tapStudent(c, TODAY, 'b', TODAY); // b now marked absent
    expect(flaggedNotMarked(c, TODAY).map((s) => s.id)).toEqual(['a']);
    markFlaggedAbsent(c, TODAY, TODAY);
    expect(c.attendance.days[TODAY]).toEqual({ a: 'absent', b: 'absent' });
    expect(flaggedNotMarked(c, TODAY)).toEqual([]);
  });

  it('clearDay removes only that day', () => {
    const c = cls();
    tapStudent(c, '2026-10-20', 'a', TODAY);
    tapStudent(c, TODAY, 'b', TODAY);
    clearDay(c, TODAY);
    expect(c.attendance.days).toEqual({ '2026-10-20': { a: 'absent' } });
  });
});

describe('tally and totals', () => {
  it('tally counts enrolled students only', () => {
    const log: AttendanceLog = { days: { [TODAY]: { a: 'late' } }, joined: { c: '2026-10-22' } };
    const t = tally(log, TODAY, [stu('a'), stu('b'), stu('c')]);
    expect(t).toEqual({ taken: true, present: 1, absent: 0, late: 1 });
    expect(tally(log, '2026-10-20', [stu('a')]).taken).toBe(false);
  });

  it('monthTotals counts taken school days of that month only, skipping days before a student joined and ids not on the roster', () => {
    const log: AttendanceLog = {
      days: {
        '2026-09-30': { a: 'absent' },
        '2026-10-01': { a: 'absent', c: 'absent', ghost: 'late' },
        '2026-10-02': { a: 'late', c: 'late' },
        '2026-10-05': {},
      },
      joined: { c: '2026-10-02' },
    };
    const t = monthTotals(log, [stu('a'), stu('b'), stu('c')], 2026, 9);
    expect(t.schoolDayCount).toBe(22);
    expect(t.daysTaken).toBe(3);
    expect(t.perStudent.get('a')).toEqual({ absent: 1, late: 1 });
    expect(t.perStudent.get('b')).toEqual({ absent: 0, late: 0 });
    expect(t.perStudent.get('c')).toEqual({ absent: 0, late: 1 });
    expect(t.perStudent.has('ghost')).toBe(false);
  });
});

describe('roster changes', () => {
  it('noteNewStudents stamps joined only once a day has been taken', () => {
    const log = emptyAttendance();
    noteNewStudents(log, ['d'], TODAY);
    expect(log.joined).toEqual({});
    log.days['2026-10-20'] = {};
    noteNewStudents(log, ['e'], TODAY);
    expect(log.joined).toEqual({ e: TODAY });
  });

  it('forgetStudent removes marks and joined', () => {
    const log: AttendanceLog = {
      days: { '2026-10-20': { a: 'absent', b: 'late' }, [TODAY]: { a: 'late' } },
      joined: { a: '2026-10-19' },
    };
    forgetStudent(log, 'a');
    expect(log).toEqual({ days: { '2026-10-20': { b: 'late' }, [TODAY]: {} }, joined: {} });
  });
});

describe('printMonths', () => {
  it('lists months with marks, the included month, this month and the next 11, in order, once each', () => {
    const log = { days: { '2026-09-14': {}, '2026-10-01': { a: 'absent' } }, joined: {} } as AttendanceLog;
    const m = printMonths(new Date(2026, 9, 21), log, new Date(2026, 7, 20));
    expect(m.slice(0, 3)).toEqual([
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]);
    expect(m.at(-1)).toEqual({ year: 2027, month: 8 });
    expect(m).toHaveLength(14);
  });
});
