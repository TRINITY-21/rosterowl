// Group builder: balanced random groups that honor keep-apart / keep-together
// rules. Pure and seeded, like the seating solver.

import type { Conflict, Id, PairConstraint, Student } from './types';
import { displayNames } from './names';

export interface GroupingInput {
  students: Student[];
  /** Target members per group (2–8). Count is derived: ceil(n / size). */
  groupSize: number;
  /** Students in an apart pair must land in different groups. */
  apart: PairConstraint[];
  /** Students in a together pair must land in the same group. */
  together: PairConstraint[];
  seed?: number;
}

export interface Grouping {
  groups: Student[][];
  conflicts: Conflict[];
  ok: boolean;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Union-find over student ids for together-pair closures. */
class UnionFind {
  parent = new Map<Id, Id>();
  find(x: Id): Id {
    let r = this.parent.get(x) ?? x;
    if (r !== x) {
      r = this.find(r);
      this.parent.set(x, r);
    }
    return r;
  }
  union(a: Id, b: Id): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function buildGroups(input: GroupingInput): Grouping {
  const { students, apart, together } = input;
  const size = Math.max(2, Math.min(8, Math.round(input.groupSize)));
  const rand = mulberry32(input.seed ?? Date.now());
  const byId = new Map(students.map((s) => [s.id, s]));
  const nameOf = displayNames(students);
  const nm = (id: Id) => nameOf.get(id) ?? byId.get(id)?.first ?? '?';

  const n = students.length;
  if (n === 0) return { groups: [], conflicts: [], ok: true };
  const groupCount = Math.max(1, Math.ceil(n / size));

  // 1. Together closures become atomic units.
  const uf = new UnionFind();
  for (const p of together) {
    if (byId.has(p.a) && byId.has(p.b)) uf.union(p.a, p.b);
  }
  const unitsByRoot = new Map<Id, Student[]>();
  for (const s of students) {
    const root = uf.find(s.id);
    const list = unitsByRoot.get(root);
    if (list) list.push(s);
    else unitsByRoot.set(root, [s]);
  }
  // Shuffle units (Fisher–Yates), biggest first so they pack.
  const units = [...unitsByRoot.values()];
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [units[i], units[j]] = [units[j]!, units[i]!];
  }
  units.sort((a, b) => b.length - a.length);

  // 2. Greedy placement into the emptiest group that adds no apart violation.
  const apartSet = new Set<string>();
  const key = (a: Id, b: Id) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const p of apart) {
    if (byId.has(p.a) && byId.has(p.b)) apartSet.add(key(p.a, p.b));
  }
  const groups: Student[][] = Array.from({ length: groupCount }, () => []);
  const violatesApart = (group: Student[], unit: Student[]): boolean => {
    for (const g of group) for (const u of unit) if (apartSet.has(key(g.id, u.id))) return true;
    return false;
  };
  for (const unit of units) {
    const order = [...groups].sort((a, b) => a.length - b.length);
    const target = order.find((g) => !violatesApart(g, unit)) ?? order[0]!;
    target.push(...unit);
  }

  // 3. Repair pass: swap members between groups to clear remaining violations.
  const together_ = together.filter((p) => byId.has(p.a) && byId.has(p.b));
  const violationCount = (): number => {
    let v = 0;
    for (const g of groups) {
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) {
          if (apartSet.has(key(g[i]!.id, g[j]!.id))) v++;
        }
      }
    }
    return v;
  };
  let best = violationCount();
  for (let iter = 0; iter < 400 && best > 0; iter++) {
    const gi = Math.floor(rand() * groups.length);
    const gj = Math.floor(rand() * groups.length);
    if (gi === gj || groups[gi]!.length === 0 || groups[gj]!.length === 0) continue;
    const ii = Math.floor(rand() * groups[gi]!.length);
    const jj = Math.floor(rand() * groups[gj]!.length);
    const a = groups[gi]![ii]!;
    const b = groups[gj]![jj]!;
    // Don't break together closures apart: a student may not be swapped away
    // from any group-mate in the same closure (root members included).
    if (groups[gi]!.some((s) => s !== a && uf.find(s.id) === uf.find(a.id))) continue;
    if (groups[gj]!.some((s) => s !== b && uf.find(s.id) === uf.find(b.id))) continue;
    groups[gi]![ii] = b;
    groups[gj]![jj] = a;
    const v = violationCount();
    if (v <= best) best = v;
    else {
      groups[gi]![ii] = a;
      groups[gj]![jj] = b;
    }
  }

  // 4. Report what still stands.
  const conflicts: Conflict[] = [];
  const groupOf = new Map<Id, number>();
  groups.forEach((g, i) => g.forEach((s) => groupOf.set(s.id, i)));
  for (const p of apart) {
    if (!byId.has(p.a) || !byId.has(p.b) || p.a === p.b) continue;
    if (groupOf.get(p.a) === groupOf.get(p.b)) {
      conflicts.push({
        kind: 'apart-violated',
        students: [p.a, p.b],
        message: `${nm(p.a)} and ${nm(p.b)} ended up in the same group`,
      });
    }
  }
  for (const p of together_) {
    if (p.a === p.b) continue;
    if (groupOf.get(p.a) !== groupOf.get(p.b)) {
      conflicts.push({
        kind: 'together-violated',
        students: [p.a, p.b],
        message: `${nm(p.a)} and ${nm(p.b)} are not in the same group`,
      });
    }
  }

  // Oversized together-closures can leave trailing groups empty — drop them.
  const nonEmpty = groups.filter((g) => g.length > 0);

  return { groups: nonEmpty, conflicts, ok: conflicts.length === 0 };
}
