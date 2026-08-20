// Shared spatial logic: desk adjacency, room templates, bounds.
// Used by the canvas renderer, the solver, and the PDF engine so all three
// agree on what "next to each other" means.

import type { Desk, Id, Room } from './types';

/** Desks closer than this (in grid units, center to center) are neighbors. */
export const ADJACENT_DISTANCE = 1.6;

/** Fresh, collision-safe id. */
export function newId(): Id {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Same table group, or physically neighboring desks. */
export function areAdjacent(a: Desk, b: Desk): boolean {
  if (a.id === b.id) return false;
  if (a.groupId !== null && a.groupId === b.groupId) return true;
  return distance(a, b) <= ADJACENT_DISTANCE;
}

/** Bounding box of a desk set in grid units (with a little breathing room). */
export function roomBounds(room: Room): { minX: number; minY: number; width: number; height: number } {
  const pts: { x: number; y: number }[] = [...room.desks];
  if (room.teacherDesk) pts.push(room.teacherDesk);
  if (room.door) pts.push(room.door);
  if (pts.length === 0) return { minX: 0, minY: 0, width: 8, height: 6 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - 0.7;
  const minY = Math.min(...ys) - 0.7;
  const width = Math.max(...xs) + 0.7 - minX + 1;
  const height = Math.max(...ys) + 0.7 - minY + 1;
  return { minX, minY, width, height };
}

// ---------------------------------------------------------------------------
// Templates — starting points, never straitjackets. Every generated desk is a
// plain Desk the teacher can drag, delete, or add to afterwards.
// ---------------------------------------------------------------------------

const ROW_GAP_X = 1.5;
const ROW_GAP_Y = 1.8;

/** Classic rows facing the teacher. */
export function makeRows(cols: number, rows: number): Desk[] {
  const desks: Desk[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      desks.push({ id: newId(), x: 1 + c * ROW_GAP_X, y: 2 + r * ROW_GAP_Y, groupId: null, zones: [] });
    }
  }
  return desks;
}

/** Relative desk offsets for one table cluster of a given size. */
function clusterShape(size: number): { x: number; y: number }[] {
  switch (size) {
    case 2: return [{ x: 0, y: 0 }, { x: 1.1, y: 0 }];
    case 3: return [{ x: 0, y: 0 }, { x: 1.1, y: 0 }, { x: 0.55, y: 1.1 }];
    case 5: return [{ x: 0, y: 0 }, { x: 1.1, y: 0 }, { x: 0, y: 1.1 }, { x: 1.1, y: 1.1 }, { x: 0.55, y: 2.2 }];
    case 6: return [{ x: 0, y: 0 }, { x: 1.1, y: 0 }, { x: 0, y: 1.1 }, { x: 1.1, y: 1.1 }, { x: 0, y: 2.2 }, { x: 1.1, y: 2.2 }];
    case 4:
    default:
      return [{ x: 0, y: 0 }, { x: 1.1, y: 0 }, { x: 0, y: 1.1 }, { x: 1.1, y: 1.1 }];
  }
}

/** Table clusters laid out in a flowing grid. */
export function makeGroups(groupCount: number, groupSize: number): Desk[] {
  const desks: Desk[] = [];
  const shape = clusterShape(groupSize);
  const clusterW = 2.1 + 1.3; // cluster footprint + aisle
  const clusterH = (groupSize > 4 ? 3.2 : groupSize > 2 ? 2.1 : 1) + 1.5;
  const perRow = Math.max(1, Math.ceil(Math.sqrt(groupCount * 1.4)));
  for (let g = 0; g < groupCount; g++) {
    const gid = newId();
    const gx = 1 + (g % perRow) * clusterW;
    const gy = 2 + Math.floor(g / perRow) * clusterH;
    for (const off of shape) {
      desks.push({ id: newId(), x: gx + off.x, y: gy + off.y, groupId: gid, zones: [] });
    }
  }
  return desks;
}

/** One new cluster positioned below/right of existing desks. */
export function makeCluster(size: number, at: { x: number; y: number }): Desk[] {
  const gid = size > 1 ? newId() : null;
  return clusterShape(size === 1 ? 2 : size)
    .slice(0, size)
    .map((off) => ({ id: newId(), x: at.x + off.x, y: at.y + off.y, groupId: gid, zones: [] }));
}

/**
 * Horseshoe/U-shape: a bottom row plus two side columns, opening toward the
 * teacher at the top. Total desks = width + 2 * depth.
 */
export function makeUShape(width: number, depth: number): Desk[] {
  const desks: Desk[] = [];
  const gx = 1.4;
  const gy = 1.5;
  const rightX = 1 + (width - 1) * gx;
  const bottomY = 2 + depth * gy;
  for (let i = 0; i < depth; i++) {
    desks.push({ id: newId(), x: 1, y: 2 + i * gy, groupId: null, zones: [] });
    desks.push({ id: newId(), x: rightX, y: 2 + i * gy, groupId: null, zones: [] });
  }
  for (let c = 0; c < width; c++) {
    desks.push({ id: newId(), x: 1 + c * gx, y: bottomY, groupId: null, zones: [] });
  }
  return desks;
}

export interface TemplateDef {
  key: string;
  label: string;
  make: () => Desk[];
}

/**
 * True when `desks` already has a template's layout. Ids differ on every
 * make() call, so compare the positional shape only.
 */
export function desksMatchTemplate(desks: Desk[], key: string): boolean {
  const tpl = TEMPLATES.find((t) => t.key === key);
  if (!tpl) return false;
  const want = tpl.make();
  if (want.length !== desks.length) return false;
  // Quantize to the drag grid (0.5): template coordinates sit off that grid,
  // so a desk nudged away and snapped back must still count as matching.
  const q = (v: number) => (Math.round(v * 2) / 2).toFixed(1);
  const shape = (list: Desk[]) => list.map((d) => `${q(d.x)},${q(d.y)}`).sort().join('|');
  return shape(want) === shape(desks);
}

export const TEMPLATES: TemplateDef[] = [
  { key: 'rows-5x6', label: 'Rows — 5 × 6 (30 desks)', make: () => makeRows(5, 6) },
  { key: 'rows-6x5', label: 'Rows — 6 × 5 (30 desks)', make: () => makeRows(6, 5) },
  { key: 'groups4-6', label: 'Table groups of 4 — 6 tables (24)', make: () => makeGroups(6, 4) },
  { key: 'groups4-8', label: 'Table groups of 4 — 8 tables (32)', make: () => makeGroups(8, 4) },
  { key: 'groups6-5', label: 'Table groups of 6 — 5 tables (30)', make: () => makeGroups(5, 6) },
  { key: 'pairs-12', label: 'Pairs — 12 pairs (24)', make: () => makeGroups(12, 2) },
  { key: 'u-20', label: 'U-shape — 20 desks', make: () => makeUShape(8, 6) },
  { key: 'u-26', label: 'U-shape — 26 desks', make: () => makeUShape(10, 8) },
];
