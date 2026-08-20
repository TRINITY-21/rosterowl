// Multi-up imposition math shared by the printable generators (name tags,
// bingo cards, flashcards, label sheets). Style-agnostic: a GridSpec describes
// the cell layout, cellRect resolves a slot to PDF coordinates, drawCutLines
// draws scissor guides down the gutters. PDF coordinates, origin bottom-left.

import { rgb } from 'pdf-lib';
import type { Color, PDFPage } from 'pdf-lib';

/** One rectangular cell, PDF coordinates (origin bottom-left). */
export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridSpec {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** Left edge of the grid. */
  originX: number;
  /** Top edge of the grid, measured up from the page bottom. */
  topY: number;
  gutterX: number;
  gutterY: number;
}

export const CUT_GRAY: Color = rgb(0.75, 0.75, 0.75);

/** Cell for slot `index`, filling left-to-right then top-to-bottom. */
export function cellRect(g: GridSpec, index: number): CellRect {
  const col = index % g.cols;
  const row = Math.floor(index / g.cols);
  return {
    x: g.originX + col * (g.cellW + g.gutterX),
    y: g.topY - row * (g.cellH + g.gutterY) - g.cellH,
    w: g.cellW,
    h: g.cellH,
  };
}

/** Dashed guides on the midline of every internal gutter, spanning the page. */
export function drawCutLines(
  page: PDFPage,
  g: GridSpec,
  pageW: number,
  pageH: number,
  color: Color = CUT_GRAY,
) {
  const style = { thickness: 0.6, color, dashArray: [4, 4] };
  for (let c = 1; c < g.cols; c++) {
    const x = g.originX + c * g.cellW + (c - 1) * g.gutterX + g.gutterX / 2;
    page.drawLine({ start: { x, y: 0 }, end: { x, y: pageH }, ...style });
  }
  for (let r = 1; r < g.rows; r++) {
    const y = g.topY - r * g.cellH - (r - 1) * g.gutterY - g.gutterY / 2;
    page.drawLine({ start: { x: 0, y }, end: { x: pageW, y }, ...style });
  }
}
