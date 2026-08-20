// Seating solver: seeded greedy placement + min-conflicts hill climbing with
// random restarts. Pure and framework-free; all randomness flows from one PRNG
// so the same seed and input always produce the same arrangement.

import type {
  Conflict,
  Desk,
  Id,
  PairConstraint,
  SolveInput,
  SolveResult,
  Student,
  ZoneKind,
} from './types';
import { areAdjacent } from './geometry';
import { displayNames } from './names';

const ZONE_PHRASE: Record<ZoneKind, string> = {
  'near-teacher': 'near the teacher',
  'away-from-door': 'away from the door',
};

/** mulberry32 — tiny, fast, good-enough PRNG for shuffling seats. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Check a seating chart against every constraint and report violations as
 * human-readable conflicts. Also used by the UI after manual seat edits.
 */
export function findConflicts(
  desks: Desk[],
  students: Student[],
  apart: PairConstraint[],
  together: PairConstraint[],
  seating: Record<Id, Id>,
): Conflict[] {
  const deskById = new Map<Id, Desk>(desks.map((d) => [d.id, d]));
  const studentById = new Map<Id, Student>();
  for (const s of students) if (!studentById.has(s.id)) studentById.set(s.id, s);
  // Disambiguated names ("Maya L.") so conflict messages match the rest of the UI.
  const nameOf = displayNames(students);
  const nm = (s: Student) => nameOf.get(s.id) ?? s.first;

  // First seat wins if a student somehow appears on two desks.
  const deskOf = new Map<Id, Desk>();
  for (const [deskId, studentId] of Object.entries(seating)) {
    const desk = deskById.get(deskId);
    if (desk && studentById.has(studentId) && !deskOf.has(studentId)) deskOf.set(studentId, desk);
  }

  const conflicts: Conflict[] = [];

  for (const { a, b } of apart) {
    const sa = studentById.get(a);
    const sb = studentById.get(b);
    if (!sa || !sb || a === b) continue;
    const da = deskOf.get(a);
    const db = deskOf.get(b);
    if (da && db && areAdjacent(da, db)) {
      conflicts.push({
        kind: 'apart-violated',
        students: [a, b],
        message: `${nm(sa)} and ${nm(sb)} are seated next to each other`,
      });
    }
  }

  for (const { a, b } of together) {
    const sa = studentById.get(a);
    const sb = studentById.get(b);
    if (!sa || !sb || a === b) continue;
    const da = deskOf.get(a);
    const db = deskOf.get(b);
    if (!(da && db && areAdjacent(da, db))) {
      conflicts.push({
        kind: 'together-violated',
        students: [a, b],
        message: `${nm(sa)} and ${nm(sb)} are not seated next to each other`,
      });
    }
  }

  for (const s of students) {
    const desk = deskOf.get(s.id);
    if (desk && s.zonePref !== null && !desk.zones.includes(s.zonePref)) {
      conflicts.push({
        kind: 'zone-unmet',
        students: [s.id],
        message: `${nm(s)} needs a seat ${ZONE_PHRASE[s.zonePref]}`,
      });
    }
  }

  for (const s of students) {
    // Absent students are expected to be unseated — not a conflict.
    if (!deskOf.has(s.id) && !s.absent) {
      conflicts.push({
        kind: 'unseated',
        students: [s.id],
        message: `${nm(s)} could not be seated`,
      });
    }
  }

  return conflicts;
}

interface Cons {
  together: boolean;
  a: Id;
  b: Id;
}

const RESTARTS = 4;
const MAX_SWEEPS = 40;
const EVALS_PER_RESTART = 40_000;

export function solve(input: SolveInput): SolveResult {
  const { desks, students, apart, together, fixed } = input;
  const rand = mulberry32((input.seed ?? Date.now()) >>> 0);

  const studentById = new Map<Id, Student>();
  for (const s of students) if (!studentById.has(s.id)) studentById.set(s.id, s);
  const deskIndex = new Map<Id, number>(desks.map((d, i) => [d.id, i]));
  const nd = desks.length;

  const adj = new Uint8Array(nd * nd);
  for (let i = 0; i < nd; i++) {
    for (let j = i + 1; j < nd; j++) {
      if (areAdjacent(desks[i], desks[j])) {
        adj[i * nd + j] = 1;
        adj[j * nd + i] = 1;
      }
    }
  }
  const deskZones: Set<ZoneKind>[] = desks.map((d) => new Set(d.zones));

  // Fixed seats: the desk is off-limits to everyone else, and the pinned
  // student (when present in the roster) never moves.
  const fixedDeskSet = new Set<number>();
  const fixedStudentDesk = new Map<Id, number>();
  for (const [deskId, studentId] of Object.entries(fixed)) {
    const di = deskIndex.get(deskId);
    if (di === undefined) continue;
    fixedDeskSet.add(di);
    if (studentById.has(studentId) && !fixedStudentDesk.has(studentId)) {
      fixedStudentDesk.set(studentId, di);
    }
  }

  const freeStudents = students.filter((s) => !fixedStudentDesk.has(s.id));
  const freeDesks: number[] = [];
  for (let i = 0; i < nd; i++) if (!fixedDeskSet.has(i)) freeDesks.push(i);

  // Slots: one per free desk, plus virtual "unseated" slots (-1) when students
  // outnumber desks — so who ends up unseated is itself optimized.
  const slotDesk: number[] = freeDesks.slice();
  while (slotDesk.length < freeStudents.length) slotDesk.push(-1);
  const nSlots = slotDesk.length;
  const nFree = freeStudents.length;

  const cons: Cons[] = [];
  const consOf = new Map<Id, number[]>();
  const addCons = (p: PairConstraint, isTogether: boolean): void => {
    if (p.a === p.b || !studentById.has(p.a) || !studentById.has(p.b)) return;
    const idx = cons.length;
    cons.push({ together: isTogether, a: p.a, b: p.b });
    for (const id of [p.a, p.b]) {
      const list = consOf.get(id);
      if (list) list.push(idx);
      else consOf.set(id, [idx]);
    }
  };
  for (const p of apart) addCons(p, false);
  for (const p of together) addCons(p, true);

  // Current desk index per student id (-1 = unseated). Fixed students never move.
  const deskNow = new Map<Id, number>();
  const assign = new Int32Array(nSlots).fill(-1); // slot -> freeStudents index
  const slotOf = new Int32Array(nFree).fill(-1); // freeStudents index -> slot

  const consViolated = (c: Cons): boolean => {
    const da = deskNow.get(c.a);
    const db = deskNow.get(c.b);
    const near =
      da !== undefined && db !== undefined && da >= 0 && db >= 0 && adj[da * nd + db] === 1;
    return c.together ? !near : near;
  };

  // A student's own cost term: 1 if unseated, else 1 if their zone pref is unmet.
  const seatTerm = (s: Student): number => {
    const d = deskNow.get(s.id);
    if (d === undefined || d < 0) return 1;
    return s.zonePref !== null && !deskZones[d].has(s.zonePref) ? 1 : 0;
  };

  const fullCost = (): number => {
    let c = 0;
    for (const con of cons) if (consViolated(con)) c++;
    for (const s of students) c += seatTerm(s);
    return c;
  };

  const place = (sIdx: number, slot: number): void => {
    assign[slot] = sIdx;
    slotOf[sIdx] = slot;
    deskNow.set(freeStudents[sIdx].id, slotDesk[slot]);
  };

  const doSwap = (i: number, j: number): void => {
    const si = assign[i];
    const sj = assign[j];
    assign[i] = sj;
    assign[j] = si;
    if (si >= 0) {
      slotOf[si] = j;
      deskNow.set(freeStudents[si].id, slotDesk[j]);
    }
    if (sj >= 0) {
      slotOf[sj] = i;
      deskNow.set(freeStudents[sj].id, slotDesk[i]);
    }
  };

  const touched: number[] = [];
  const swapDelta = (i: number, j: number): number => {
    const si = assign[i];
    const sj = assign[j];
    touched.length = 0;
    if (si >= 0) for (const ci of consOf.get(freeStudents[si].id) ?? []) touched.push(ci);
    if (sj >= 0) {
      for (const ci of consOf.get(freeStudents[sj].id) ?? []) {
        if (!touched.includes(ci)) touched.push(ci);
      }
    }
    let before = 0;
    for (const ci of touched) if (consViolated(cons[ci])) before++;
    if (si >= 0) before += seatTerm(freeStudents[si]);
    if (sj >= 0) before += seatTerm(freeStudents[sj]);

    if (si >= 0) deskNow.set(freeStudents[si].id, slotDesk[j]);
    if (sj >= 0) deskNow.set(freeStudents[sj].id, slotDesk[i]);
    let after = 0;
    for (const ci of touched) if (consViolated(cons[ci])) after++;
    if (si >= 0) after += seatTerm(freeStudents[si]);
    if (sj >= 0) after += seatTerm(freeStudents[sj]);

    if (si >= 0) deskNow.set(freeStudents[si].id, slotDesk[i]);
    if (sj >= 0) deskNow.set(freeStudents[sj].id, slotDesk[j]);
    return after - before;
  };

  const localViolations = (sIdx: number): number => {
    const s = freeStudents[sIdx];
    let v = seatTerm(s);
    for (const ci of consOf.get(s.id) ?? []) if (consViolated(cons[ci])) v++;
    return v;
  };

  const shuffleInPlace = <T>(arr: T[]): T[] => {
    for (let k = arr.length - 1; k > 0; k--) {
      const r = Math.floor(rand() * (k + 1));
      const tmp = arr[k];
      arr[k] = arr[r];
      arr[r] = tmp;
    }
    return arr;
  };

  const resetPlacement = (): void => {
    assign.fill(-1);
    slotOf.fill(-1);
    deskNow.clear();
    for (const [sid, di] of fixedStudentDesk) deskNow.set(sid, di);
  };

  // Cost of trying one student on one candidate desk during greedy seeding.
  const placementCost = (s: Student, dIdx: number): number => {
    let c = 0;
    if (dIdx < 0) c += 2; // leaving anyone unseated is the worst single choice
    else if (s.zonePref !== null && !deskZones[dIdx].has(s.zonePref)) c += 1;
    for (const ci of consOf.get(s.id) ?? []) {
      const con = cons[ci];
      const otherId = con.a === s.id ? con.b : con.a;
      const od = deskNow.get(otherId);
      if (od === undefined) continue; // partner not placed yet
      const near = dIdx >= 0 && od >= 0 && adj[dIdx * nd + od] === 1;
      if (con.together ? !near : near) c += 1;
    }
    return c;
  };

  // Seed placement: together-pair members first (so partners can chase each
  // other), then zone-pref students, then the rest — each bucket shuffled.
  const greedyInit = (): void => {
    resetPlacement();
    const inTogether = new Set<Id>();
    for (const c of cons) {
      if (c.together) {
        inTogether.add(c.a);
        inTogether.add(c.b);
      }
    }
    const first: number[] = [];
    const second: number[] = [];
    const rest: number[] = [];
    freeStudents.forEach((s, idx) => {
      if (inTogether.has(s.id)) first.push(idx);
      else if (s.zonePref !== null) second.push(idx);
      else rest.push(idx);
    });
    const order = [...shuffleInPlace(first), ...shuffleInPlace(second), ...shuffleInPlace(rest)];
    const slotOrder = shuffleInPlace(Array.from({ length: nSlots }, (_, k) => k));
    for (const sIdx of order) {
      const s = freeStudents[sIdx];
      let best = Infinity;
      let bestSlot = -1;
      for (const slot of slotOrder) {
        if (assign[slot] !== -1) continue;
        const cost = placementCost(s, slotDesk[slot]);
        if (cost < best) {
          best = cost;
          bestSlot = slot;
        }
        if (best === 0) break;
      }
      if (bestSlot >= 0) place(sIdx, bestSlot);
    }
  };

  const randomInit = (): void => {
    resetPlacement();
    const slots = shuffleInPlace(Array.from({ length: nSlots }, (_, k) => k));
    for (let s = 0; s < nFree; s++) place(s, slots[s]);
  };

  // Min-conflicts: each sweep visits conflicted students in random order and
  // takes their best strictly-improving swap. Hard caps bound the worst case.
  const climb = (): void => {
    let evals = EVALS_PER_RESTART;
    const slotIdxs = Array.from({ length: nSlots }, (_, k) => k);
    for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
      let improved = false;
      shuffleInPlace(slotIdxs);
      for (const i of slotIdxs) {
        const si = assign[i];
        if (si < 0 || localViolations(si) === 0) continue;
        let bestDelta = 0;
        let bestJ = -1;
        for (let j = 0; j < nSlots; j++) {
          if (j === i) continue;
          if (--evals < 0) return;
          const d = swapDelta(i, j);
          if (d < bestDelta) {
            bestDelta = d;
            bestJ = j;
          }
        }
        if (bestJ >= 0) {
          doSwap(i, bestJ);
          improved = true;
        }
      }
      if (!improved) return;
    }
  };

  // Violations no rearrangement of free students can remove.
  let floor = Math.max(0, nFree - freeDesks.length);
  for (const c of cons) {
    const da = fixedStudentDesk.get(c.a);
    const db = fixedStudentDesk.get(c.b);
    if (da !== undefined && db !== undefined) {
      const near = adj[da * nd + db] === 1;
      if (c.together ? !near : near) floor++;
    }
  }
  for (const s of students) {
    const d = fixedStudentDesk.get(s.id);
    if (d !== undefined && s.zonePref !== null && !deskZones[d].has(s.zonePref)) floor++;
  }

  let bestCost = Infinity;
  let bestAssign: Int32Array = assign.slice();
  for (let attempt = 0; attempt < RESTARTS; attempt++) {
    if (attempt < 2) greedyInit();
    else randomInit();
    climb();
    const cost = fullCost();
    if (cost < bestCost) {
      bestCost = cost;
      bestAssign = assign.slice();
    }
    if (bestCost <= floor) break;
  }

  const seating: Record<Id, Id> = { ...fixed };
  for (let slot = 0; slot < nSlots; slot++) {
    const sIdx = bestAssign[slot];
    const dIdx = slotDesk[slot];
    if (sIdx >= 0 && dIdx >= 0) seating[desks[dIdx].id] = freeStudents[sIdx].id;
  }

  const conflicts = findConflicts(desks, students, apart, together, seating);
  return { seating, conflicts, ok: conflicts.length === 0 };
}
