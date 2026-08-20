// Shared pointer-drag state so a student chip picked up in the roster panel
// can be dropped on the canvas (and vice versa).
import type { Id } from './types';

export interface StudentDrag {
  kind: 'student';
  studentId: Id;
  fromDeskId: Id | null;
  /** True when the drag began on a canvas desk (drop-on-tray unseats only then). */
  fromCanvas: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

export interface DeskDrag {
  kind: 'desk';
  deskId: Id;
  groupId: Id | null;
  /** Client-pixel anchors — drag math must not depend on canvas bounds, which shift mid-drag. */
  lastClientX: number;
  lastClientY: number;
  moved: boolean;
}

export interface MarkerDrag {
  kind: 'marker';
  which: 'teacher' | 'door';
  lastClientX: number;
  lastClientY: number;
  moved: boolean;
}

export type Drag = StudentDrag | DeskDrag | MarkerDrag;

export const drag: { current: Drag | null } = $state({ current: null });
