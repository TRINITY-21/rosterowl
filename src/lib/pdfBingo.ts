// Classroom bingo cards: every card its own shuffle of the item pool, built
// from student names or the teacher's word list, plus a numbered caller's
// list. Split in two on purpose — buildBingoCards is pure and seedable (rand
// param) so tests are deterministic; renderBingoPdf only draws. The lib is
// roster-agnostic: items arrive as plain strings, and printed output carries
// names only (privacy rule — no absent flags, no zone prefs, no roster tags).

import fontkit from '@pdf-lib/fontkit';
import type { Color, PDFFont, PDFPage } from 'pdf-lib';
import { PDFDocument, rgb } from 'pdf-lib';
import type { CellRect, GridSpec } from './imposition';
import { cellRect, drawCutLines } from './imposition';
import type { CertFonts } from './pdfCerts';

export type BingoSize = 3 | 4 | 5;

export interface BingoCard {
  /** Names mode: the student this card belongs to. Custom mode: the title. */
  header: string;
  /** Row-major from the top-left; length = size². Free squares hold "FREE". */
  cells: string[];
}

export interface BingoBuildOptions {
  size: BingoSize;
  /** Odd sizes only: the middle square prints "FREE". Ignored for 4×4. */
  freeCenter: boolean;
  /** Cards to build. Ignored with excludeHeader (then it's one per item). */
  count: number;
  /**
   * Names mode: card i is headed by items[i], and that item is left out of
   * its own grid (students hunt classmates, not themselves).
   */
  excludeHeader?: boolean;
  /** Header for every card when excludeHeader is off, e.g. "Class Bingo". */
  title?: string;
}

export interface BingoRenderOptions {
  paper: 'letter' | 'a4';
  /** 1 = big and playable (default); 2 = stacked pair, paper saver. */
  perPage: 1 | 2;
  /** Append a final page listing every item in a numbered checkbox grid. */
  callerList: boolean;
  /** Every item in play (the grid pool), for the caller's list. */
  items: string[];
  inkSaver: boolean;
  showFooter: boolean;
}

export const FREE_CELL = 'FREE';

const PAGE_SIZES: Record<BingoRenderOptions['paper'], [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const MARGIN = 36;
/** Chalkboard green — the grid lines. */
const GREEN = rgb(0.18, 0.42, 0.31);
/** Soft marigold — the free-square fill. */
const MARIGOLD_SOFT = rgb(0.98, 0.92, 0.8);
const INK = rgb(0.14, 0.2, 0.19);
const GRAY = rgb(0.4, 0.46, 0.44);
const FAINT = rgb(0.62, 0.62, 0.62);
const BLACK = rgb(0, 0, 0);

// ---------------------------------------------------------------------------
// Item pool
// ---------------------------------------------------------------------------

/**
 * One item per line: trimmed, blank lines dropped, duplicates ignored
 * (case-insensitive; the first spelling wins).
 */
export function parseItems(text: string): string[] {
  return normalizeItems(text.split('\n'));
}

function normalizeItems(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Items one card's grid consumes: size² minus the free center on odd sizes. */
export function cellsNeeded(size: BingoSize, freeCenter: boolean): number {
  return size * size - (freeCenter && size % 2 === 1 ? 1 : 0);
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Card building — pure and seedable
// ---------------------------------------------------------------------------

export function buildBingoCards(
  items: string[],
  opts: BingoBuildOptions,
  rand: () => number = Math.random,
): BingoCard[] {
  const pool = normalizeItems(items);
  const free = opts.freeCenter && opts.size % 2 === 1;
  const needed = cellsNeeded(opts.size, opts.freeCenter);
  const centerIdx = Math.floor((opts.size * opts.size) / 2);

  // In names mode every card loses its own header from the pool, so each
  // card draws from one item fewer than the full list.
  const available = opts.excludeHeader ? Math.max(0, pool.length - 1) : pool.length;
  if (available < needed) {
    throw new Error(`${opts.size}×${opts.size} needs ${needed} items — you have ${available}`);
  }

  const count = opts.excludeHeader ? pool.length : Math.max(1, Math.floor(opts.count));
  const cards: BingoCard[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < count; i++) {
    const header = opts.excludeHeader ? pool[i]! : (opts.title ?? '').trim();
    const cardPool = opts.excludeHeader ? pool.filter((_, j) => j !== i) : pool;
    let cells: string[] = [];
    // Bounded retry so no two cards in the set come out identical (dedupe by
    // joined cells). After the bound we accept the collision rather than spin.
    for (let attempt = 0; attempt < 40; attempt++) {
      const picked = shuffled(cardPool, rand).slice(0, needed);
      cells = free
        ? [...picked.slice(0, centerIdx), FREE_CELL, ...picked.slice(centerIdx)]
        : picked;
      if (!seen.has(cells.join('\n'))) break;
    }
    seen.add(cells.join('\n'));
    cards.push({ header, cells });
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

interface EmbeddedFonts {
  body: PDFFont;
  bodyBold: PDFFont;
  display: PDFFont;
}

function fit(font: PDFFont, text: string, maxW: number, max: number): number {
  const unitW = font.widthOfTextAtSize(text, 1);
  if (unitW <= 0) return max;
  return Math.min(max, maxW / unitW);
}

function drawCenteredAt(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  cx: number,
  y: number,
  color: Color,
) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: cx - w / 2, y, size, font, color });
}

/** Space in `text` nearest its midpoint, or null when it's a single word. */
function splitNearMiddle(text: string): [string, string] | null {
  const mid = text.length / 2;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ' ') continue;
    const d = Math.abs(i - mid);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best < 0) return null;
  return [text.slice(0, best), text.slice(best + 1)];
}

/**
 * Auto-fit cell text: shrink to fit on one line; when that gets very small
 * and the text has a space, wrap to two lines instead — whichever reads
 * larger. Sizes are capped by the cell, so text never overflows.
 */
function drawCellLabel(page: PDFPage, r: CellRect, text: string, font: PDFFont, color: Color) {
  const padX = 5;
  const maxW = r.w - 2 * padX;
  const cap = Math.min(16, r.h * 0.4);
  const oneSize = fit(font, text, maxW, cap);
  const cx = r.x + r.w / 2;

  const parts = oneSize < cap * 0.7 ? splitNearMiddle(text) : null;
  if (parts) {
    const [a, b] = parts;
    const twoSize = Math.min(cap, fit(font, a, maxW, cap), fit(font, b, maxW, cap), (r.h * 0.72) / 2.3);
    if (twoSize > oneSize) {
      const lineH = twoSize * 1.15;
      const yTop = r.y + r.h / 2 + lineH / 2 - twoSize * 0.36;
      drawCenteredAt(page, a, font, twoSize, cx, yTop, color);
      drawCenteredAt(page, b, font, twoSize, cx, yTop - lineH, color);
      return;
    }
  }
  drawCenteredAt(page, text, font, oneSize, cx, r.y + r.h / 2 - oneSize * 0.36, color);
}

/** One card (header + square grid) inside `region`. */
function drawCard(page: PDFPage, region: CellRect, card: BingoCard, ink: boolean, f: EmbeddedFonts) {
  const size = Math.round(Math.sqrt(card.cells.length));
  const header = card.header.trim();
  const headerH = header ? Math.min(52, region.h * 0.14) : 8;

  if (header) {
    const hSize = fit(f.display, header, region.w - 16, headerH * 0.62);
    drawCenteredAt(
      page,
      header,
      f.display,
      hSize,
      region.x + region.w / 2,
      region.y + region.h - headerH + (headerH - hSize * 0.72) / 2,
      ink ? BLACK : GREEN,
    );
  }

  // Square grid, centered in what's left under the header.
  const availH = region.h - headerH;
  const side = Math.min(region.w, availH);
  const gx = region.x + (region.w - side) / 2;
  const gy = region.y + (availH - side) / 2;
  const cs = side / size;
  const cellAt = (i: number): CellRect => ({
    x: gx + (i % size) * cs,
    y: gy + side - (Math.floor(i / size) + 1) * cs,
    w: cs,
    h: cs,
  });

  // Free-square fill first, so grid lines sit on top (plain in ink-saver).
  if (!ink) {
    card.cells.forEach((text, i) => {
      if (text !== FREE_CELL) return;
      const r = cellAt(i);
      page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: MARIGOLD_SOFT });
    });
  }

  const gridColor = ink ? BLACK : GREEN;
  for (let k = 0; k <= size; k++) {
    const thickness = k === 0 || k === size ? 1.5 : 0.8;
    page.drawLine({
      start: { x: gx + k * cs, y: gy },
      end: { x: gx + k * cs, y: gy + side },
      thickness,
      color: gridColor,
    });
    page.drawLine({
      start: { x: gx, y: gy + k * cs },
      end: { x: gx + side, y: gy + k * cs },
      thickness,
      color: gridColor,
    });
  }

  card.cells.forEach((text, i) => {
    const r = cellAt(i);
    if (text === FREE_CELL) {
      const s = fit(f.display, FREE_CELL, r.w - 12, r.h * 0.4);
      drawCenteredAt(page, FREE_CELL, f.display, s, r.x + r.w / 2, r.y + r.h / 2 - s * 0.36, ink ? BLACK : GREEN);
    } else {
      drawCellLabel(page, r, text, f.bodyBold, ink ? BLACK : INK);
    }
  });
}

function drawFooter(page: PDFPage, opts: BingoRenderOptions, font: PDFFont) {
  if (!opts.showFooter) return;
  page.drawText('Made with RosterOwl — rosterowl.com', {
    x: MARGIN,
    y: 14,
    size: 7,
    font,
    color: FAINT,
  });
}

/**
 * Caller's list: every item in a numbered checkbox grid — always one page
 * (columns and row height size down to fit, never spill to a second sheet).
 */
function drawCallerPage(
  doc: PDFDocument,
  items: string[],
  opts: BingoRenderOptions,
  f: EmbeddedFonts,
  pageW: number,
  pageH: number,
) {
  const page = doc.addPage([pageW, pageH]);
  const ink = opts.inkSaver;

  let y = pageH - MARGIN - 18;
  page.drawText("Caller's list", { x: MARGIN, y, size: 20, font: f.display, color: ink ? BLACK : GREEN });
  y -= 14;
  page.drawText(`${items.length} items — check each one off as you call it`, {
    x: MARGIN,
    y,
    size: 9.5,
    font: f.body,
    color: GRAY,
  });
  y -= 10;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: pageW - MARGIN, y },
    thickness: 1.2,
    color: ink ? BLACK : GREEN,
  });

  const top = y - 8;
  const bottom = MARGIN;
  const availH = top - bottom;
  const n = Math.max(1, items.length);
  const cols = n <= 14 ? 1 : n <= 40 ? 2 : n <= 78 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  // No minimum row height: the one-page promise wins, and text scales with
  // rowH so items shrink rather than sliding off the page.
  const rowH = Math.min(24, availH / rows);
  const colW = (pageW - 2 * MARGIN) / cols;
  const textSize = Math.min(10.5, rowH * 0.52);
  const boxSide = Math.min(10, rowH * 0.55);
  const numW = f.body.widthOfTextAtSize(`${items.length}.`, textSize);

  items.forEach((item, i) => {
    const x0 = MARGIN + Math.floor(i / rows) * colW;
    const yMid = top - (i % rows) * rowH - rowH / 2;
    const num = `${i + 1}.`;
    page.drawText(num, {
      x: x0 + numW - f.body.widthOfTextAtSize(num, textSize),
      y: yMid - textSize * 0.36,
      size: textSize,
      font: f.body,
      color: GRAY,
    });
    page.drawRectangle({
      x: x0 + numW + 6,
      y: yMid - boxSide / 2,
      width: boxSide,
      height: boxSide,
      borderColor: ink ? BLACK : GREEN,
      borderWidth: 0.8,
    });
    const tx = x0 + numW + 6 + boxSide + 6;
    const s = Math.min(textSize, fit(f.body, item, x0 + colW - 10 - tx, textSize));
    page.drawText(item, { x: tx, y: yMid - s * 0.36, size: s, font: f.body, color: ink ? BLACK : INK });
  });

  drawFooter(page, opts, f.body);
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export async function renderBingoPdf(
  cards: BingoCard[],
  opts: BingoRenderOptions,
  fonts: CertFonts,
): Promise<{ bytes: Uint8Array; pages: number; cards: number }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const body = await doc.embedFont(fonts.regular, { subset: true });
  const bodyBold = await doc.embedFont(fonts.bold, { subset: true });
  // Baloo 2 must be embedded unsubset — subset:true corrupts its glyphs.
  const display = await doc.embedFont(fonts.display, { subset: false });
  const f: EmbeddedFonts = { body, bodyBold, display };

  // Bingo cards are always portrait.
  const [pageW, pageH] = PAGE_SIZES[opts.paper];
  const ink = opts.inkSaver;

  const grid: GridSpec =
    opts.perPage === 2
      ? {
          cols: 1,
          rows: 2,
          cellW: pageW - 2 * MARGIN,
          cellH: (pageH - 2 * MARGIN - 28) / 2,
          originX: MARGIN,
          topY: pageH - MARGIN,
          gutterX: 0,
          gutterY: 28,
        }
      : {
          cols: 1,
          rows: 1,
          cellW: pageW - 2 * MARGIN,
          cellH: pageH - 2 * MARGIN - 10,
          originX: MARGIN,
          topY: pageH - MARGIN,
          gutterX: 0,
          gutterY: 0,
        };
  const perPage = grid.cols * grid.rows;

  for (let i = 0; i < cards.length; i += perPage) {
    const page = doc.addPage([pageW, pageH]);
    // Cut guides go down first so card content sits on top of them.
    if (opts.perPage === 2) drawCutLines(page, grid, pageW, pageH);
    cards.slice(i, i + perPage).forEach((card, slot) => {
      drawCard(page, cellRect(grid, slot), card, ink, f);
    });
    drawFooter(page, opts, body);
  }

  if (opts.callerList) {
    drawCallerPage(doc, normalizeItems(opts.items), opts, f, pageW, pageH);
  }

  // Count before save(): pdf-lib pads an empty document with one blank page.
  const pages = doc.getPageCount();
  return { bytes: await doc.save(), pages, cards: cards.length };
}

// Lives in filenames.ts so components can name a download without pulling
// pdf-lib in; re-exported here because that is where callers expect it.
export { bingoPdfFilename } from "./filenames";
