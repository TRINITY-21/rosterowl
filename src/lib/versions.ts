// Version history for the seating workspace. Snapshots of the whole persisted
// document are kept under their own localStorage key so restoring (or a bug in
// one version) can never corrupt the live document.

import type { PersistedState } from './types';

export const VERSIONS_KEY = 'rosterowl:versions:v1';
export const MAX_VERSIONS = 30;
/** Minimum gap between automatic snapshots while the teacher keeps editing. */
export const AUTO_SNAPSHOT_MS = 8 * 60 * 1000;

export type VersionKind = 'auto' | 'manual' | 'safety';

export interface VersionEntry {
  id: string;
  /** Epoch ms when the snapshot was taken. */
  ts: number;
  kind: VersionKind;
  /** Optional teacher-given name (manual saves). */
  label: string | null;
  /** Human summary computed at capture time, e.g. "2 classes · 24 desks". */
  summary: string;
  state: PersistedState;
}

/** Content fingerprint — settings excluded so a theme flip never makes a version. */
export function fingerprint(state: PersistedState): string {
  return JSON.stringify({ rooms: state.rooms, classes: state.classes });
}

export function summarize(state: PersistedState): string {
  const classes = state.classes.length;
  const desks = state.rooms.reduce((n, r) => n + r.desks.length, 0);
  const active = state.classes.find((c) => c.id === state.activeClassId) ?? state.classes[0];
  const parts = [
    `${classes} class${classes === 1 ? '' : 'es'}`,
    `${desks} desk${desks === 1 ? '' : 's'}`,
  ];
  if (active) {
    const seated = Object.keys(active.seating).length;
    parts.push(`${seated}/${active.students.length} seated in ${active.name}`);
  }
  return parts.join(' · ');
}

export function loadVersions(): VersionEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(VERSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is VersionEntry =>
        v && typeof v.id === 'string' && typeof v.ts === 'number' && v.state?.version === 1
    );
  } catch {
    return [];
  }
}

/**
 * Persist, dropping the oldest automatic snapshots first if the browser's
 * storage quota pushes back. Returns the list that actually got stored.
 */
export function persistVersions(versions: VersionEntry[]): VersionEntry[] {
  if (typeof localStorage === 'undefined') return versions;
  let list = [...versions];
  for (;;) {
    try {
      localStorage.setItem(VERSIONS_KEY, JSON.stringify(list));
      return list;
    } catch {
      if (list.length === 0) return list;
      list = dropOne(list);
    }
  }
}

/** Newest-first insert + cap. Auto snapshots are evicted before named ones. */
export function pushVersion(versions: VersionEntry[], entry: VersionEntry): VersionEntry[] {
  let list = [entry, ...versions];
  while (list.length > MAX_VERSIONS) list = dropOne(list);
  return list;
}

function dropOne(list: VersionEntry[]): VersionEntry[] {
  // Search from the oldest end for the first auto/safety entry; only when the
  // history is nothing but manual saves does the oldest manual go.
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].kind !== 'manual') return [...list.slice(0, i), ...list.slice(i + 1)];
  }
  return list.slice(0, -1);
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function versionTitle(entry: VersionEntry): string {
  if (entry.label) return entry.label;
  if (entry.kind === 'manual') return 'Saved version';
  if (entry.kind === 'safety') return 'Before restore';
  return 'Auto-save';
}
