import { describe, expect, it } from 'vitest';
import { findConflicts, solve } from '../src/lib/solver';
import { areAdjacent } from '../src/lib/geometry';
import type { Desk, Id, SolveInput, Student, ZoneKind } from '../src/lib/types';

// --- fixture helpers (deterministic ids, no crypto) ---

function desk(
  id: string,
  x: number,
  y: number,
  groupId: string | null = null,
  zones: ZoneKind[] = [],
): Desk {
  return { id, x, y, groupId, zones };
}

function student(id: string, first: string, zonePref: ZoneKind | null = null): Student {
  return { id, first, last: 'Test', absent: false, zonePref };
}

/** n desks in one row, 1.5 apart: consecutive desks are adjacent, others not. */
function rowDesks(n: number): Desk[] {
  return Array.from({ length: n }, (_, i) => desk(`d${i}`, i * 1.5, 0));
}

/** cols x rows grid matching the rows template spacing. */
function gridDesks(cols: number, rows: number): Desk[] {
  const out: Desk[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(desk(`d${r * cols + c}`, 1 + c * 1.5, 2 + r * 1.8));
    }
  }
  return out;
}

function roster(n: number): Student[] {
  return Array.from({ length: n }, (_, i) => student(`s${i}`, `Kid${i}`));
}

function baseInput(overrides: Partial<SolveInput>): SolveInput {
  return { desks: [], students: [], apart: [], together: [], fixed: {}, seed: 1, ...overrides };
}

function deskOfStudent(seating: Record<Id, Id>, desks: Desk[], studentId: Id): Desk {
  const entry = Object.entries(seating).find(([, sid]) => sid === studentId);
  expect(entry, `student ${studentId} should be seated`).toBeDefined();
  const found = desks.find((d) => d.id === entry![0]);
  expect(found, `desk ${entry![0]} should exist`).toBeDefined();
  return found!;
}

describe('solve — determinism', () => {
  it('same seed and input produce identical output', () => {
    const make = (): SolveInput =>
      baseInput({
        desks: gridDesks(4, 3),
        students: roster(10),
        apart: [{ a: 's0', b: 's1' }, { a: 's2', b: 's3' }],
        together: [{ a: 's4', b: 's5' }],
        seed: 12345,
      });
    const r1 = solve(make());
    const r2 = solve(make());
    expect(r2.seating).toEqual(r1.seating);
    expect(r2.conflicts).toEqual(r1.conflicts);
    expect(r2.ok).toBe(r1.ok);
  });

  it('works when seed is omitted', () => {
    const input = baseInput({ desks: rowDesks(5), students: roster(4) });
    delete input.seed;
    const res = solve(input);
    expect(Object.keys(res.seating)).toHaveLength(4);
    expect(res.ok).toBe(true);
  });
});

describe('solve — fixed seats', () => {
  it('never moves or reassigns fixed seats, even under constraint pressure', () => {
    const desks = rowDesks(6);
    const students = roster(6);
    // Pin s0 and s1 next to each other, then demand they sit apart: the solver
    // must report the conflict rather than touch the fixed desks.
    const fixed = { d2: 's0', d3: 's1' };
    for (const seed of [1, 2, 99, 4096]) {
      const res = solve(baseInput({ desks, students, apart: [{ a: 's0', b: 's1' }], fixed, seed }));
      expect(res.seating['d2']).toBe('s0');
      expect(res.seating['d3']).toBe('s1');
      expect(res.ok).toBe(false);
      expect(res.conflicts.some((c) => c.kind === 'apart-violated')).toBe(true);
    }
  });

  it('seats a together partner adjacent to a fixed student', () => {
    const desks = rowDesks(4);
    const students = roster(4);
    const res = solve(
      baseInput({ desks, students, together: [{ a: 's0', b: 's1' }], fixed: { d0: 's0' }, seed: 7 }),
    );
    expect(res.seating['d0']).toBe('s0');
    // d1 is the only desk adjacent to d0.
    expect(res.seating['d1']).toBe('s1');
    expect(res.ok).toBe(true);
  });
});

describe('solve — pair constraints', () => {
  it('separates an apart pair when the room allows it', () => {
    const desks = rowDesks(6);
    const students = roster(6);
    const res = solve(baseInput({ desks, students, apart: [{ a: 's0', b: 's1' }], seed: 3 }));
    expect(res.ok).toBe(true);
    const d0 = deskOfStudent(res.seating, desks, 's0');
    const d1 = deskOfStudent(res.seating, desks, 's1');
    expect(areAdjacent(d0, d1)).toBe(false);
  });

  it('seats a together pair adjacent', () => {
    const desks = gridDesks(4, 3);
    const students = roster(12);
    const res = solve(baseInput({ desks, students, together: [{ a: 's3', b: 's7' }], seed: 11 }));
    expect(res.ok).toBe(true);
    const d3 = deskOfStudent(res.seating, desks, 's3');
    const d7 = deskOfStudent(res.seating, desks, 's7');
    expect(areAdjacent(d3, d7)).toBe(true);
  });

  it('treats same-group desks as adjacent for constraints', () => {
    // Two clusters far apart: same groupId means adjacent regardless of distance.
    const desks = [
      desk('a1', 0, 0, 'g1'),
      desk('a2', 1.1, 0, 'g1'),
      desk('b1', 20, 0, 'g2'),
      desk('b2', 21.1, 0, 'g2'),
    ];
    const students = roster(4);
    const res = solve(baseInput({ desks, students, apart: [{ a: 's0', b: 's1' }], seed: 5 }));
    expect(res.ok).toBe(true);
    const d0 = deskOfStudent(res.seating, desks, 's0');
    const d1 = deskOfStudent(res.seating, desks, 's1');
    expect(d0.groupId).not.toBe(d1.groupId);
  });
});

describe('solve — zone preferences', () => {
  it('seats a zone-pref student on a desk with that zone', () => {
    const desks = rowDesks(6);
    desks[5] = { ...desks[5], zones: ['near-teacher'] };
    const students = [student('s0', 'Maya', 'near-teacher'), ...roster(4).slice(1)];
    const res = solve(baseInput({ desks, students, seed: 21 }));
    expect(res.ok).toBe(true);
    const d = deskOfStudent(res.seating, desks, 's0');
    expect(d.zones).toContain('near-teacher');
  });

  it('reports zone-unmet when no zone desk exists', () => {
    const desks = rowDesks(3);
    const students = [student('s0', 'Maya', 'away-from-door'), student('s1', 'Jo')];
    const res = solve(baseInput({ desks, students, seed: 2 }));
    expect(res.ok).toBe(false);
    const zc = res.conflicts.find((c) => c.kind === 'zone-unmet');
    expect(zc).toBeDefined();
    expect(zc!.students).toEqual(['s0']);
    expect(zc!.message).toBe('Maya needs a seat away from the door');
  });
});

describe('solve — capacity', () => {
  it('reports overflow students as unseated and seats the rest', () => {
    const desks = rowDesks(3);
    const students = roster(5);
    const res = solve(baseInput({ desks, students, seed: 9 }));
    expect(res.ok).toBe(false);
    const seated = Object.values(res.seating);
    expect(seated).toHaveLength(3);
    expect(new Set(seated).size).toBe(3);
    const unseated = res.conflicts.filter((c) => c.kind === 'unseated');
    expect(unseated).toHaveLength(2);
    for (const c of unseated) expect(seated).not.toContain(c.students[0]);
    expect(res.conflicts).toHaveLength(2); // no other conflict kinds
  });

  it('leaves desks empty when students are few', () => {
    const desks = rowDesks(8);
    const students = roster(3);
    const res = solve(baseInput({ desks, students, seed: 4 }));
    expect(res.ok).toBe(true);
    expect(Object.keys(res.seating)).toHaveLength(3);
  });
});

describe('solve — impossible constraints', () => {
  it('returns ok:false with the right conflict instead of looping', () => {
    const desks = [desk('d0', 0, 0), desk('d1', 1.1, 0)]; // side by side
    const students = [student('sa', 'Maya'), student('sb', 'Jordan')];
    const res = solve(baseInput({ desks, students, apart: [{ a: 'sa', b: 'sb' }], seed: 8 }));
    expect(res.ok).toBe(false);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].kind).toBe('apart-violated');
    expect(res.conflicts[0].students).toEqual(['sa', 'sb']);
    expect(res.conflicts[0].message).toBe('Maya and Jordan are seated next to each other');
    // Both students still got desks.
    expect(new Set(Object.values(res.seating)).size).toBe(2);
  });
});

describe('solve — performance', () => {
  it('30 desks, 28 students, 5 constraints solves in under 200ms', () => {
    const desks = gridDesks(5, 6);
    desks[0] = { ...desks[0], zones: ['near-teacher'] };
    desks[1] = { ...desks[1], zones: ['near-teacher'] };
    const students = roster(28);
    students[6] = { ...students[6], zonePref: 'near-teacher' };
    const input = baseInput({
      desks,
      students,
      apart: [{ a: 's0', b: 's1' }, { a: 's2', b: 's3' }],
      together: [{ a: 's4', b: 's5' }, { a: 's10', b: 's11' }],
      seed: 42,
    });
    const t0 = performance.now();
    const res = solve(input);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(200);
    expect(res.ok).toBe(true);
  });
});

describe('findConflicts', () => {
  const desks = rowDesks(4);
  const students = [
    student('sa', 'Maya'),
    student('sb', 'Jordan'),
    student('sc', 'Priya', 'near-teacher'),
  ];

  it('flags an adjacent apart pair with a human sentence', () => {
    const conflicts = findConflicts(
      desks,
      students,
      [{ a: 'sa', b: 'sb' }],
      [],
      { d0: 'sa', d1: 'sb', d3: 'sc' },
    );
    const apart = conflicts.find((c) => c.kind === 'apart-violated');
    expect(apart).toBeDefined();
    expect(apart!.message).toBe('Maya and Jordan are seated next to each other');
    expect(apart!.students).toEqual(['sa', 'sb']);
  });

  it('flags a separated together pair', () => {
    const conflicts = findConflicts(
      desks,
      students,
      [],
      [{ a: 'sa', b: 'sb' }],
      { d0: 'sa', d3: 'sb', d2: 'sc' },
    );
    const tog = conflicts.find((c) => c.kind === 'together-violated');
    expect(tog).toBeDefined();
    expect(tog!.message).toBe('Maya and Jordan are not seated next to each other');
  });

  it('flags together as violated when one member is unseated', () => {
    const conflicts = findConflicts(desks, students, [], [{ a: 'sa', b: 'sb' }], { d0: 'sa' });
    expect(conflicts.some((c) => c.kind === 'together-violated')).toBe(true);
    expect(conflicts.some((c) => c.kind === 'unseated' && c.students[0] === 'sb')).toBe(true);
  });

  it('flags zone-unmet and unseated; clean seating yields no conflicts', () => {
    const withZone = desks.map((d) => (d.id === 'd0' ? { ...d, zones: ['near-teacher' as const] } : d));
    const bad = findConflicts(withZone, students, [], [], { d1: 'sc', d3: 'sa' });
    expect(bad.map((c) => c.kind).sort()).toEqual(['unseated', 'zone-unmet']);
    expect(bad.find((c) => c.kind === 'zone-unmet')!.message).toBe(
      'Priya needs a seat near the teacher',
    );

    const clean = findConflicts(withZone, students, [{ a: 'sa', b: 'sb' }], [], {
      d0: 'sc',
      d1: 'sa',
      d3: 'sb',
    });
    expect(clean).toEqual([]);
  });

  it('ignores constraints referencing unknown students', () => {
    const conflicts = findConflicts(desks, students, [{ a: 'sa', b: 'ghost' }], [{ a: 'ghost', b: 'sb' }], {
      d0: 'sa',
      d1: 'sb',
      d2: 'sc',
    });
    expect(conflicts.filter((c) => c.kind !== 'zone-unmet')).toEqual([]);
  });
});

// Regression: rules involving a FIXED (locked) student must still be honored —
// the app passes locked/absent-seated students in `students` alongside `fixed`.
import { describe as describe2, it as it2, expect as expect2 } from 'vitest';
import { solve as solveR } from '../src/lib/solver';
import type { Desk as DeskR, Student as StudentR } from '../src/lib/types';

const deskR = (id: string, x: number, y: number): DeskR => ({ id, x, y, groupId: null, zones: [] });
const stuR = (id: string, first: string): StudentR => ({ id, first, last: '', absent: false, zonePref: null });

describe2('solver + fixed students regression', () => {
  it2('keeps an apart rule away from a locked student', () => {
    // d0 and d1 are adjacent; d2 is far away.
    const desks = [deskR('d0', 0, 0), deskR('d1', 1.1, 0), deskR('d2', 8, 8)];
    const A = stuR('A', 'Ava');
    const B = stuR('B', 'Ben');
    for (let seed = 1; seed <= 10; seed++) {
      const r = solveR({
        desks,
        students: [A, B],
        apart: [{ a: 'A', b: 'B' }],
        together: [],
        fixed: { d0: 'A' },
        seed,
      });
      expect2(r.seating['d0']).toBe('A');
      expect2(r.seating['d2']).toBe('B');
      expect2(r.conflicts).toEqual([]);
      expect2(r.ok).toBe(true);
    }
  });
});
