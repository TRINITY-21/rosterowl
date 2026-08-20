import { describe, expect, it } from 'vitest';
import {
  JOB_PRESET,
  assignJob,
  jobAssignments,
  removeJobAt,
  rotateJobs,
  rotateJobsBack,
  shuffleWheel,
  syncWheel,
} from '../src/lib/jobs';
import type { JobsState, Student } from '../src/lib/types';

const stu = (id: string): Student => ({ id, first: id.toUpperCase(), last: 'X', absent: false, zonePref: null });

const students = ['a', 'b', 'c', 'd', 'e'].map(stu);

function jobs(titles: string[], wheel: string[], offset = 0): JobsState {
  return { titles, wheel, offset };
}

// Deterministic PRNG (mulberry32) so shuffle tests are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('JOB_PRESET', () => {
  it('is a non-empty starter set', () => {
    expect(JOB_PRESET.length).toBeGreaterThanOrEqual(8);
  });
});

/** Rotation order starting from the crew: who serves now, then who's next. */
function rotationOrder(j: JobsState): string[] {
  return j.wheel.map((_, i) => j.wheel[(j.offset + i) % j.wheel.length]!);
}

describe('syncWheel', () => {
  it('keeps departed/duplicate ids out and puts new students at the back of the rotation', () => {
    const j = jobs(['Job'], ['c', 'ghost', 'a', 'c']);
    syncWheel(j, students);
    expect([...j.wheel].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(rotationOrder(j)).toEqual(['c', 'a', 'b', 'd', 'e']);
  });

  it('normalizes offset into range and zeroes it for empty rosters', () => {
    const j = jobs(['Job'], ['a', 'b', 'c'], 7);
    syncWheel(j, students.slice(0, 3));
    expect(j.offset).toBe(1);
    const empty = jobs(['Job'], ['a'], 3);
    syncWheel(empty, []);
    expect(empty.wheel).toEqual([]);
    expect(empty.offset).toBe(0);
  });

  // Regression (review): a mid-week roster edit must never re-deal the
  // current crew's jobs.
  it('a new student joins behind everyone without displacing the current crew', () => {
    const three = students.slice(0, 3);
    const j = jobs(['J1', 'J2'], ['a', 'b', 'c'], 2); // crew: c, a (wraps)
    syncWheel(j, [...three, stu('d')]);
    expect(jobAssignments(j, [...three, stu('d')]).map((s) => s?.id)).toEqual(['c', 'a']);
    expect(rotationOrder(j)).toEqual(['c', 'a', 'b', 'd']); // d serves last
  });

  it('removing a jobless student before the crew start keeps the crew intact', () => {
    const j = jobs(['J1', 'J2'], ['a', 'b', 'c', 'd', 'e'], 3); // crew: d, e
    const without = students.filter((s) => s.id !== 'b');
    syncWheel(j, without);
    expect(jobAssignments(j, without).map((s) => s?.id)).toEqual(['d', 'e']);
  });
});

describe('jobAssignments', () => {
  it('maps job i to wheel[(offset + i) % n]', () => {
    const j = jobs(['J1', 'J2', 'J3'], ['a', 'b', 'c', 'd', 'e'], 3);
    expect(jobAssignments(j, students).map((s) => s?.id)).toEqual(['d', 'e', 'a']);
  });

  it('leaves extra jobs unassigned instead of double-booking students', () => {
    const two = students.slice(0, 2);
    const j = jobs(['J1', 'J2', 'J3', 'J4'], ['a', 'b']);
    expect(jobAssignments(j, two).map((s) => s?.id ?? null)).toEqual(['a', 'b', null, null]);
  });

  it('tolerates stale wheels (unknown ids skipped, empty roster all-null)', () => {
    const j = jobs(['J1', 'J2'], ['ghost', 'b', 'a']);
    expect(jobAssignments(j, students).map((s) => s?.id)).toEqual(['b', 'a']);
    expect(jobAssignments(jobs(['J1'], []), [])).toEqual([null]);
  });
});

describe('rotateJobs', () => {
  it('hands every job to a fresh crew and covers everyone before repeating', () => {
    const wheel = ['a', 'b', 'c', 'd', 'e'];
    const j = jobs(['J1', 'J2'], wheel);
    const served = new Set<string>();
    const firstHolders: string[] = [];
    for (let week = 0; week < 5; week++) {
      const crew = jobAssignments(j, students).map((s) => s!.id);
      firstHolders.push(crew[0]!);
      crew.forEach((id) => served.add(id));
      rotateJobs(j);
    }
    expect(served.size).toBe(5); // everyone served within one cycle
    expect(new Set(firstHolders).size).toBe(5); // no repeat J1 holder in the cycle
  });

  it('is undone exactly by rotateJobsBack', () => {
    const j = jobs(['J1', 'J2', 'J3'], ['a', 'b', 'c', 'd', 'e'], 2);
    rotateJobs(j);
    rotateJobsBack(j);
    expect(j.offset).toBe(2);
  });

  it('no-ops with no jobs or no students', () => {
    const j = jobs([], ['a'], 0);
    rotateJobs(j);
    expect(j.offset).toBe(0);
    const k = jobs(['J1'], [], 0);
    rotateJobs(k);
    expect(k.offset).toBe(0);
  });
});

describe('assignJob', () => {
  it('gives the job to the chosen student and trades when both hold jobs', () => {
    const j = jobs(['J1', 'J2'], ['a', 'b', 'c'], 0);
    assignJob(j, 0, 'b'); // b takes J1; a (previous holder) gets b's J2 slot
    expect(jobAssignments(j, students).map((s) => s?.id)).toEqual(['b', 'a']);
  });

  it('pulls a jobless student in; previous holder goes jobless', () => {
    const j = jobs(['J1'], ['a', 'b', 'c'], 0);
    assignJob(j, 0, 'c');
    expect(jobAssignments(j, students)[0]?.id).toBe('c');
    expect(j.wheel).toContain('a');
  });

  it('ignores out-of-range jobs and unknown students', () => {
    const j = jobs(['J1'], ['a', 'b'], 0);
    const before = [...j.wheel];
    assignJob(j, 5, 'b');
    assignJob(j, 0, 'ghost');
    expect(j.wheel).toEqual(before);
  });
});

// Regression (review): titles % students === 0 made rotation the identity —
// the classic-10 preset froze every 1/2/5/10-student class forever.
describe('rotateJobs when job count is a multiple of class size', () => {
  it('still changes every assigned job (10 jobs, 5 students)', () => {
    const five = students.slice(0, 5);
    const j = jobs([...JOB_PRESET], ['a', 'b', 'c', 'd', 'e'], 0);
    const before = jobAssignments(j, five).map((s) => s?.id ?? null);
    rotateJobs(j);
    const after = jobAssignments(j, five).map((s) => s?.id ?? null);
    expect(after).not.toEqual(before);
    for (let i = 0; i < 5; i++) expect(after[i]).not.toBe(before[i]);
  });

  it('still changes hands at 10 jobs × 10 students, and undo is exact', () => {
    const ten = Array.from({ length: 10 }, (_, i) => stu(`t${i}`));
    const j = jobs([...JOB_PRESET], ten.map((s) => s.id), 3);
    const before = jobAssignments(j, ten).map((s) => s?.id);
    rotateJobs(j);
    expect(jobAssignments(j, ten).map((s) => s?.id)).not.toEqual(before);
    rotateJobsBack(j);
    expect(j.offset).toBe(3);
    expect(jobAssignments(j, ten).map((s) => s?.id)).toEqual(before);
  });
});

// Regression (review): removing a job used to shift every later job onto a
// different student.
describe('removeJobAt', () => {
  it('keeps every other job\'s holder; the freed student is next in line', () => {
    const j = jobs(['A', 'B', 'C'], ['a', 'b', 'c', 'd', 'e'], 0);
    removeJobAt(j, 1);
    expect(j.titles).toEqual(['A', 'C']);
    expect(jobAssignments(j, students).map((s) => s?.id)).toEqual(['a', 'c']);
    expect(rotationOrder(j)).toEqual(['a', 'c', 'b', 'd', 'e']); // b next in line
  });

  it('works when the crew wraps past the array end', () => {
    const three = students.slice(0, 3);
    const j = jobs(['A', 'B'], ['a', 'b', 'c'], 2); // crew: c→A, a→B
    removeJobAt(j, 0);
    expect(j.titles).toEqual(['B']);
    expect(jobAssignments(j, three)[0]?.id).toBe('a'); // B keeps a
  });

  it('removing an unassigned overflow job leaves the crew untouched', () => {
    const two = students.slice(0, 2);
    const j = jobs(['A', 'B', 'C', 'D'], ['a', 'b'], 0);
    removeJobAt(j, 3);
    expect(j.titles).toEqual(['A', 'B', 'C']);
    expect(jobAssignments(j, two).map((s) => s?.id ?? null)).toEqual(['a', 'b', null]);
  });

  it('ignores out-of-range indexes', () => {
    const j = jobs(['A'], ['a'], 0);
    removeJobAt(j, 5);
    removeJobAt(j, -1);
    expect(j.titles).toEqual(['A']);
  });
});

describe('shuffleWheel', () => {
  it('keeps exactly the same members and resets offset', () => {
    const j = jobs(['J1'], ['a', 'b', 'c', 'd', 'e'], 3);
    shuffleWheel(j, mulberry32(7));
    expect([...j.wheel].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(j.offset).toBe(0);
  });

  it('actually reorders for a seed known to permute', () => {
    const j = jobs(['J1'], ['a', 'b', 'c', 'd', 'e'], 0);
    shuffleWheel(j, mulberry32(7));
    expect(j.wheel.join('')).not.toBe('abcde');
  });
});
