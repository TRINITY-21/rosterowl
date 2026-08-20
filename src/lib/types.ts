// Core data model for RosterOwl.
// Rooms and classes are separate top-level entities: one physical room is
// reused by many class periods, so a desk arrangement is never rebuilt per class.

export type Id = string;

/** Zones a desk can be tagged with, and a student can prefer. */
export type ZoneKind = 'near-teacher' | 'away-from-door';

export interface Student {
  id: Id;
  first: string;
  /** May be empty — smart paste keeps whatever it could find. */
  last: string;
  absent: boolean;
  /**
   * Priority-seating preference ("near the teacher", "away from the door").
   * PRIVACY RULE: this must never appear on any printed or exported output.
   */
  zonePref: ZoneKind | null;
}

export interface Desk {
  id: Id;
  /** Position in grid units. One desk occupies roughly 1×1 grid unit. */
  x: number;
  y: number;
  /** Desks sharing a groupId form one table cluster. */
  groupId: Id | null;
  /** Zone tags painted onto this desk in arrange mode. */
  zones: ZoneKind[];
}

export interface Marker {
  x: number;
  y: number;
}

export interface Room {
  id: Id;
  name: string;
  desks: Desk[];
  /** Optional orientation markers, drawn on screen and print. */
  teacherDesk: Marker | null;
  door: Marker | null;
}

/** Unordered pair of student ids. */
export interface PairConstraint {
  a: Id;
  b: Id;
}

/**
 * Classroom-jobs rotation. Job i belongs to the student at
 * wheel[(offset + i) % wheel.length]; rotating advances offset so a fresh
 * crew takes over and everyone serves before anyone repeats.
 */
export interface JobsState {
  /** Job titles in display order. */
  titles: string[];
  /** Student rotation order. Roster edits re-heal this (new ids appended). */
  wheel: Id[];
  offset: number;
}

/** Saved custom item lists (raw textarea text) for the printable generators. */
export interface WordLists {
  bingo: string;
  flashcards: string;
}

export function emptyJobs(): JobsState {
  return { titles: [], wheel: [], offset: 0 };
}

export function emptyWordLists(): WordLists {
  return { bingo: '', flashcards: '' };
}

export interface ClassData {
  id: Id;
  name: string;
  roomId: Id;
  students: Student[];
  /** Students who must not sit adjacent (same table group or neighboring desks). */
  apart: PairConstraint[];
  /** Students who must sit adjacent. */
  together: PairConstraint[];
  /** deskId -> studentId. Keyed by ids so roster edits never invalidate seats. */
  seating: Record<Id, Id>;
  /** Desk ids whose current occupant must not be moved by the solver. */
  locked: Id[];
  /** Student ids already picked this round (fair cold-calling: no repeats). */
  pickerHistory: Id[];
  jobs: JobsState;
  wordLists: WordLists;
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  /** Set once the user has been offered a backup after first roster creation. */
  backupPromptShown: boolean;
}

/** The whole persisted document. Bump `version` on breaking changes and migrate. */
export interface PersistedState {
  version: 1;
  rooms: Room[];
  classes: ClassData[];
  activeClassId: Id | null;
  settings: AppSettings;
}

export const STORAGE_KEY = 'rosterowl:v1';

/**
 * Rotating colour tokens for table groups, roster avatars and group cards.
 * Shared so the canvas, the roster and the group maker always agree.
 */
export const GROUP_HUES = [
  '--g-blue',
  '--g-coral',
  '--g-green',
  '--g-violet',
  '--g-gold',
  '--g-teal',
] as const;

// ---------------------------------------------------------------------------
// Solver contract (implemented in solver.ts)
// ---------------------------------------------------------------------------

export interface SolveInput {
  desks: Desk[];
  /** Students to seat. Caller excludes absent students it wants left out. */
  students: Student[];
  apart: PairConstraint[];
  together: PairConstraint[];
  /** deskId -> studentId assignments the solver must keep exactly as-is. */
  fixed: Record<Id, Id>;
  /** Same seed -> same arrangement. Omit for a random shuffle. */
  seed?: number;
}

export type ConflictKind =
  | 'apart-violated'
  | 'together-violated'
  | 'zone-unmet'
  | 'unseated';

export interface Conflict {
  kind: ConflictKind;
  /** Student ids involved (one for zone-unmet/unseated, two for pairs). */
  students: Id[];
  message: string;
}

export interface SolveResult {
  /** deskId -> studentId, including the fixed seats. */
  seating: Record<Id, Id>;
  /** Constraints the best-found arrangement still violates. Empty = clean. */
  conflicts: Conflict[];
  /** True when every constraint was satisfied. */
  ok: boolean;
}

// ---------------------------------------------------------------------------
// PDF contract (implemented in pdf.ts)
// ---------------------------------------------------------------------------

export interface PdfOptions {
  paper: 'letter' | 'a4';
  orientation: 'portrait' | 'landscape';
  /** 1 = default name size; 0.75–1.6 via slider. */
  nameScale: number;
  /** B/W outline-only rendering for school laser printers. */
  inkSaver: boolean;
  /** "Made with RosterOwl — rosterowl.com" footer. Teacher can toggle off. */
  showFooter: boolean;
  /** e.g. class name. */
  title: string;
  /** e.g. room name + date. */
  subtitle: string;
}

export interface PdfFonts {
  regular: Uint8Array;
  bold: Uint8Array;
}
