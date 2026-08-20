// Shared type-setting for every printed sheet.
//
// Two rules live here, because getting them wrong in nine separate renderers is
// what made the output look homemade:
//
// 1. ONE SIZE PER SET. Fitting each name to its own box independently means
//    "Mia" prints at 16pt next to "Isabella" at 7pt, and a chart of mixed type
//    sizes reads as broken rather than as designed. Every grid of like things
//    measures the whole set and uses the size the *longest* member can take.
//
// 2. CENTRE ON THE CAP HEIGHT, not the baseline or the em box. Text centred by
//    its em box sits visibly high, because the descender space below the
//    baseline is usually empty. Names sitting a few points high in every cell is
//    the difference between "printed" and "typeset".

import type { Color, PDFFont, PDFPage } from 'pdf-lib';

/**
 * Cap height as a fraction of font size, for Atkinson Hyperlegible and Baloo 2.
 * Both sit near 0.72em; the half of that is the offset from optical centre down
 * to the baseline.
 */
const CAP_HEIGHT_EM = 0.72;

/** Baseline offset below an optical centre line, for a single line of text. */
export const capOffset = (size: number): number => (size * CAP_HEIGHT_EM) / 2;

/** Largest size at which `text` fits `maxW`, ignoring any cap. */
export function widthLimitedSize(font: PDFFont, text: string, maxW: number): number {
  const unit = font.widthOfTextAtSize(text, 1);
  return unit > 0 ? maxW / unit : Number.POSITIVE_INFINITY;
}

export interface FitOptions {
  /** Never exceed this, however short the text. */
  max: number;
  /** Never go below this, however long the text — clipping is better than dust. */
  min?: number;
  /** Also fit within this height (single line). */
  maxH?: number;
}

/**
 * One size that fits every string in `texts` — the heart of rule 1.
 *
 * Returns `max` for an empty set so a grid with nothing in it still reserves
 * sensible space.
 */
export function uniformSize(
  font: PDFFont,
  texts: readonly string[],
  maxW: number,
  { max, min = 5, maxH }: FitOptions,
): number {
  let size = max;
  for (const text of texts) {
    if (!text) continue;
    size = Math.min(size, widthLimitedSize(font, text, maxW));
  }
  if (maxH !== undefined) size = Math.min(size, maxH / CAP_HEIGHT_EM);
  return Math.max(min, size);
}

/** Draws one line centred horizontally on `cx` and optically on `cy`. */
export function drawCentered(
  page: PDFPage,
  text: string,
  opts: { font: PDFFont; size: number; cx: number; cy: number; color: Color },
): void {
  const { font, size, cx, cy, color } = opts;
  page.drawText(text, {
    x: cx - font.widthOfTextAtSize(text, size) / 2,
    y: cy - capOffset(size),
    size,
    font,
    color,
  });
}

/** Draws a stack of lines, the block as a whole centred optically on `cy`. */
export function drawCenteredLines(
  page: PDFPage,
  lines: readonly string[],
  opts: { font: PDFFont; size: number; cx: number; cy: number; color: Color; lineHeight?: number },
): void {
  const { font, size, cx, cy, color, lineHeight = 1.18 } = opts;
  const gap = size * lineHeight;
  const top = cy + ((lines.length - 1) / 2) * gap;
  for (let i = 0; i < lines.length; i++) {
    drawCentered(page, lines[i]!, { font, size, cx, cy: top - i * gap, color });
  }
}

/**
 * Splits a name at the space nearest its middle, for cells too narrow to take it
 * on one line. Returns a single line when there is nowhere sensible to break.
 */
export function splitNearMiddle(text: string): string[] {
  if (!text.includes(' ')) return [text];
  const mid = text.length / 2;
  let best = -1;
  for (let i = text.indexOf(' '); i !== -1; i = text.indexOf(' ', i + 1)) {
    if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  }
  const parts = [text.slice(0, best).trim(), text.slice(best + 1).trim()].filter(Boolean);
  return parts.length === 2 ? parts : [text];
}

/**
 * One size for a set of names in fixed-size cells, allowing two lines where a
 * name is too long to look right on one.
 *
 * Names are laid out as a set: if any name needs two lines, the size is the one
 * that suits the whole grid, so every cell still matches.
 */
export function uniformNameLayout(
  font: PDFFont,
  names: readonly string[],
  maxW: number,
  { max, min = 6, twoLineBelow = 0 }: { max: number; min?: number; twoLineBelow?: number },
): { size: number; lines: Map<string, string[]> } {
  const lines = new Map<string, string[]>();
  for (const name of names) lines.set(name, [name]);

  let size = uniformSize(font, names, maxW, { max, min: 0 });

  // Too tight for one line: break the long ones and re-fit on the new set.
  if (size < twoLineBelow) {
    for (const name of names) lines.set(name, splitNearMiddle(name));
    const parts = [...lines.values()].flat();
    size = uniformSize(font, parts, maxW, { max, min: 0 });
  }

  return { size: Math.max(min, size), lines };
}
