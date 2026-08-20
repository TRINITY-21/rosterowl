// Multi-up flashcards: big centered words on cut-apart card sheets — name-wall
// cards, draw-a-stick name jar, sight words, vocab, math facts. Roster-agnostic
// on purpose: the component builds the string[] labels (names or a custom word
// list) and this module just lays them out. Grid/imposition math is shared with
// the other multi-up generators (name tags, bingo) via imposition.ts.
// PRIVACY: cards carry the given text only — the component must pass names and
// nothing else from the roster (never absent flags, zone prefs, or tags).

import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { cellRect, drawCutLines } from './imposition';
import type { CellRect, GridSpec } from './imposition';
import type { CertFonts } from './pdfCerts';
import { safeFilename } from './filenames';

/** jumbo = 2/page landscape halves · large = 4/page quarters · small = 8/page eighths. */
export type CardSize = 'jumbo' | 'large' | 'small';

/** Where the card text came from — only affects the filename label. */
export type ItemMode = 'names' | 'custom';

export interface FlashcardOptions {
  paper: 'letter' | 'a4';
  size: CardSize;
  /** Light card borders + dashed cut guides down the gutters. */
  showCutLines: boolean;
  /** Tiny label bottom-right of each card, e.g. the class name; '' = none. */
  cornerLabel: string;
  inkSaver: boolean;
}

const PAGE_SIZES: Record<FlashcardOptions['paper'], [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const MARGIN = 36;
const GUTTER = 12;

const INK = rgb(0.14, 0.2, 0.19);
const GRAY = rgb(0.4, 0.46, 0.44);
const LINE = rgb(0.78, 0.75, 0.68);
const BLACK = rgb(0, 0, 0);

/** Approximate cap-height ratio of the display face (same value as name tags). */
const CAP_H = 0.72;
/** Vertical gap between the two lines of a split card, as a ratio of size. */
const LINE_GAP = 0.4;

function fit(font: PDFFont, text: string, maxW: number, max: number): number {
  const unitW = font.widthOfTextAtSize(text, 1);
  if (unitW <= 0) return max;
  return Math.min(max, maxW / unitW);
}

/**
 * Textarea text → card items: one per line, trimmed, blank lines dropped.
 * Duplicates are KEPT on purpose — a sight-word list may legitimately repeat.
 */
export function parseItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Layout — per-size measurements
// ---------------------------------------------------------------------------

interface CardChrome {
  /** Inner padding when fitting the card text. */
  pad: number;
  /** Largest text size this card ever uses. */
  cap: number;
  /** Below this single-line size, try a two-line split before shrinking more. */
  readable: number;
  labelSize: number;
  labelPad: number;
}

const LAYOUT: Record<CardSize, { cols: number; rows: number; landscape: boolean }> = {
  jumbo: { cols: 1, rows: 2, landscape: true },
  large: { cols: 2, rows: 2, landscape: false },
  small: { cols: 2, rows: 4, landscape: false },
};

const CHROME: Record<CardSize, CardChrome> = {
  jumbo: { pad: 30, cap: 110, readable: 44, labelSize: 7, labelPad: 12 },
  large: { pad: 20, cap: 60, readable: 26, labelSize: 6, labelPad: 10 },
  small: { pad: 14, cap: 32, readable: 15, labelSize: 5.5, labelPad: 8 },
};

function gridFor(size: CardSize, pageW: number, pageH: number): GridSpec {
  const { cols, rows } = LAYOUT[size];
  return {
    cols,
    rows,
    cellW: (pageW - 2 * MARGIN - (cols - 1) * GUTTER) / cols,
    cellH: (pageH - 2 * MARGIN - (rows - 1) * GUTTER) / rows,
    originX: MARGIN,
    topY: pageH - MARGIN,
    gutterX: GUTTER,
    gutterY: GUTTER,
  };
}

/** Split at the space nearest the middle of the string, or null if impossible. */
function splitCentral(text: string): [string, string] | null {
  const mid = text.length / 2;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 1; i < text.length - 1; i++) {
    if (text[i] === ' ') {
      const d = Math.abs(i - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }
  if (best === -1) return null;
  const a = text.slice(0, best).trim();
  const b = text.slice(best + 1).trim();
  if (!a || !b) return null;
  return [a, b];
}

// ---------------------------------------------------------------------------
// One card
// ---------------------------------------------------------------------------

function drawCard(
  page: PDFPage,
  rect: CellRect,
  text: string,
  opts: FlashcardOptions,
  chrome: CardChrome,
  fonts: { body: PDFFont; display: PDFFont },
) {
  const ink = opts.inkSaver;

  if (opts.showCutLines) {
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      borderColor: ink ? BLACK : LINE,
      borderWidth: 0.75,
    });
  }

  const maxW = rect.w - 2 * chrome.pad;
  const maxH = rect.h - 2 * chrome.pad;

  // Single line first, auto-fit to the card width (and never taller than the
  // card — content always sizes DOWN to fit, no minimum that could overflow).
  const singleCap = Math.min(chrome.cap, maxH / 1.3);
  const single = fit(fonts.display, text, maxW, singleCap);

  let lines: string[] = [text];
  let size = single;
  if (single < chrome.readable) {
    // Long phrase: break at the most central space and re-fit both lines
    // before shrinking below readable. Keep the split only if it helps.
    const parts = splitCentral(text);
    if (parts) {
      const lineCap = Math.min(chrome.cap, maxH / (2 * CAP_H + LINE_GAP));
      const s = Math.min(
        fit(fonts.display, parts[0], maxW, lineCap),
        fit(fonts.display, parts[1], maxW, lineCap),
      );
      if (s > single) {
        lines = parts;
        size = s;
      }
    }
  }

  const color = ink ? BLACK : INK;
  if (lines.length === 1) {
    const w = fonts.display.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: rect.x + (rect.w - w) / 2,
      y: rect.y + rect.h / 2 - (size * CAP_H) / 2,
      size,
      font: fonts.display,
      color,
    });
  } else {
    const gap = size * LINE_GAP;
    const blockH = 2 * size * CAP_H + gap;
    let baseline = rect.y + rect.h / 2 + blockH / 2 - size * CAP_H;
    for (const line of lines) {
      const w = fonts.display.widthOfTextAtSize(line, size);
      page.drawText(line, {
        x: rect.x + (rect.w - w) / 2,
        y: baseline,
        size,
        font: fonts.display,
        color,
      });
      baseline -= gap + size * CAP_H;
    }
  }

  // Corner label, bottom-right inside the card.
  const label = opts.cornerLabel.trim();
  if (label) {
    const lsize = fit(fonts.body, label, rect.w - 2 * chrome.labelPad, chrome.labelSize);
    const lw = fonts.body.widthOfTextAtSize(label, lsize);
    page.drawText(label, {
      x: rect.x + rect.w - chrome.labelPad - lw,
      y: rect.y + chrome.labelPad,
      size: lsize,
      font: fonts.body,
      color: ink ? BLACK : GRAY,
    });
  }
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export async function renderFlashcardsPdf(
  items: string[],
  opts: FlashcardOptions,
  fonts: CertFonts,
): Promise<{ bytes: Uint8Array; count: number; pages: number }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const body = await doc.embedFont(fonts.regular, { subset: true });
  // Baloo 2 must embed with subset:false — subsetting corrupts its glyphs.
  const display = await doc.embedFont(fonts.display, { subset: false });
  const embedded = { body, display };

  const [shortSide, longSide] = PAGE_SIZES[opts.paper];
  const landscape = LAYOUT[opts.size].landscape;
  const pageW = landscape ? longSide : shortSide;
  const pageH = landscape ? shortSide : longSide;

  const grid = gridFor(opts.size, pageW, pageH);
  const chrome = CHROME[opts.size];
  const perPage = grid.cols * grid.rows;

  for (let i = 0; i < items.length; i += perPage) {
    const page = doc.addPage([pageW, pageH]);
    // Cut guides go down first so card content sits on top of them.
    if (opts.showCutLines) drawCutLines(page, grid, pageW, pageH);
    items.slice(i, i + perPage).forEach((item, slot) => {
      drawCard(page, cellRect(grid, slot), item, opts, chrome, embedded);
    });
    // Cards are cut apart, so no sheet ever carries the RosterOwl footer.
  }

  // Count before save(): pdf-lib pads an empty document with one blank page.
  const pages = doc.getPageCount();
  return { bytes: await doc.save(), count: items.length, pages };
}

export function flashcardsPdfFilename(className: string, mode: ItemMode): string {
  const cls = safeFilename(className);
  return `${cls} — ${mode === 'names' ? 'Name cards' : 'Flashcards'}.pdf`;
}
