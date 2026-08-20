// Fair cold-calling: random pick with no repeats until everyone present has
// had a turn. Pure; randomness injected for testability.

import type { Id, Student } from './types';

export interface PickResult {
  student: Student | null;
  /** True when the previous round just completed and a fresh one began. */
  newRound: boolean;
}

export function pickNext(
  students: Student[],
  history: Id[],
  rand: () => number = Math.random,
): PickResult {
  const present = students.filter((s) => !s.absent);
  if (present.length === 0) return { student: null, newRound: false };
  const picked = new Set(history);
  let eligible = present.filter((s) => !picked.has(s.id));
  let newRound = false;
  if (eligible.length === 0) {
    // Everyone present has had a turn — start over. Exclude whoever was picked
    // last so a round boundary can never call the same student twice in a row.
    newRound = true;
    const lastId = history[history.length - 1];
    eligible = present.length > 1 ? present.filter((s) => s.id !== lastId) : present;
    if (eligible.length === 0) eligible = present;
  }
  const student = eligible[Math.floor(rand() * eligible.length)] ?? null;
  return { student, newRound };
}

/** How many of the present students have been picked this round. */
export function roundProgress(students: Student[], history: Id[]): { done: number; total: number } {
  const present = students.filter((s) => !s.absent);
  const picked = new Set(history);
  return { done: present.filter((s) => picked.has(s.id)).length, total: present.length };
}
