// Classroom-jobs rotation logic. The model is a "wheel": every student sits
// in a fixed rotation order and job i belongs to wheel[(offset + i) % n].
// Rotating advances offset by (titles mod n, min 1), so every job changes
// hands each rotation, and because gcd(step, n) always divides the job count,
// a full cycle gives every student exactly equal turns.

import type { Id, JobsState, Student } from './types';

/** Starter set — the jobs that show up in almost every elementary classroom. */
export const JOB_PRESET: string[] = [
  'Line Leader',
  'Door Holder',
  'Paper Passer',
  'Materials Manager',
  'Board Eraser',
  'Light Monitor',
  'Class Librarian',
  'Messenger',
  'Plant Waterer',
  'Caboose',
];

/**
 * Heal the wheel after roster edits: every current student exactly once,
 * rotation order preserved, offset compensated so the CURRENT crew keeps its
 * jobs. New students join at the back of the rotation (just before the crew),
 * never displacing a current holder. Mutates `jobs` in place.
 */
export function syncWheel(jobs: JobsState, students: Student[]): void {
  const ids = new Set(students.map((s) => s.id));
  const seen = new Set<Id>();
  let offset = jobs.wheel.length ? mod(jobs.offset, jobs.wheel.length) : 0;
  const wheel: Id[] = [];
  jobs.wheel.forEach((id, i) => {
    if (ids.has(id) && !seen.has(id)) {
      wheel.push(id);
      seen.add(id);
    } else if (i < offset) {
      // A dropped entry before the crew start shifts every later position
      // down one; pull the offset with it so assignments don't re-deal.
      offset--;
    }
  });
  const fresh: Id[] = [];
  for (const s of students) {
    if (!seen.has(s.id)) {
      fresh.push(s.id);
      seen.add(s.id);
    }
  }
  wheel.splice(offset, 0, ...fresh);
  offset += fresh.length;
  jobs.wheel = wheel;
  jobs.offset = wheel.length ? mod(offset, wheel.length) : 0;
}

/**
 * Student for each job title, or null when there are more jobs than students.
 * Pure — tolerates a stale wheel (ids missing/extra) without mutating it.
 */
export function jobAssignments(jobs: JobsState, students: Student[]): (Student | null)[] {
  const byId = new Map(students.map((s) => [s.id, s]));
  const wheel = jobs.wheel.filter((id) => byId.has(id));
  const n = wheel.length;
  if (n === 0) return jobs.titles.map(() => null);
  const offset = mod(jobs.offset, n);
  return jobs.titles.map((_, i) => (i < n ? (byId.get(wheel[(offset + i) % n]!) ?? null) : null));
}

/**
 * Rotation step. titles mod n would be a no-op whenever the job count is a
 * multiple of the class size (e.g. the classic-10 preset with 5 or 10
 * students) — fall back to 1 so the chart always changes hands.
 */
function rotationStep(jobs: JobsState): number {
  return mod(jobs.titles.length, jobs.wheel.length) || 1;
}

/** Advance the rotation: every assigned job changes hands. */
export function rotateJobs(jobs: JobsState): void {
  const n = jobs.wheel.length;
  if (n === 0 || jobs.titles.length === 0) return;
  jobs.offset = mod(jobs.offset + rotationStep(jobs), n);
}

/** Inverse of rotateJobs (the "Undo" on the rotate toast). */
export function rotateJobsBack(jobs: JobsState): void {
  const n = jobs.wheel.length;
  if (n === 0 || jobs.titles.length === 0) return;
  jobs.offset = mod(jobs.offset - rotationStep(jobs), n);
}

/**
 * Remove the job at `index`, keeping every other job's current holder.
 * The removed job's holder leaves the crew block and becomes first in line
 * for the next opening. Call syncWheel first so positions are trustworthy.
 */
export function removeJobAt(jobs: JobsState, index: number): void {
  if (index < 0 || index >= jobs.titles.length) return;
  const n = jobs.wheel.length;
  const assigned = Math.min(jobs.titles.length, n);
  if (n > 0 && index < assigned) {
    const offset = mod(jobs.offset, n);
    const seq = jobs.wheel.map((_, i) => jobs.wheel[(offset + i) % n]!);
    const [holder] = seq.splice(index, 1);
    seq.splice(assigned - 1, 0, holder!);
    jobs.wheel = seq;
    jobs.offset = 0;
  }
  jobs.titles.splice(index, 1);
}

/**
 * Hand job `index` to `studentId` by swapping wheel slots — a straight trade
 * when that student already holds another job, otherwise the previous holder
 * goes jobless. Call syncWheel first so positions are trustworthy.
 */
export function assignJob(jobs: JobsState, index: number, studentId: Id): void {
  const n = jobs.wheel.length;
  if (n === 0 || index < 0 || index >= Math.min(jobs.titles.length, n)) return;
  const pos = mod(jobs.offset + index, n);
  const cur = jobs.wheel.indexOf(studentId);
  if (cur === -1 || cur === pos) return;
  const prev = jobs.wheel[pos]!;
  jobs.wheel[pos] = studentId;
  jobs.wheel[cur] = prev;
}

/** New random rotation order; offset resets so the chart matches immediately. */
export function shuffleWheel(jobs: JobsState, rand: () => number = Math.random): void {
  const wheel = [...jobs.wheel];
  for (let i = wheel.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [wheel[i], wheel[j]] = [wheel[j]!, wheel[i]!];
  }
  jobs.wheel = wheel;
  jobs.offset = 0;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
