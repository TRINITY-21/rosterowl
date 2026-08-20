// Multi-up name tags: desk plates (2-up landscape) and badge sheets (8-up
// portrait). The grid/imposition math is shared with the other multi-up
// generators (bingo, flashcards) via imposition.ts — keep it style-agnostic.
// Names come straight from student.first/student.last; zone prefs, absence,
// and every other roster tag must never appear on output (privacy rule).

import { PDFDocument, rgb } from 'pdf-lib';
import type { Color, PDFFont, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { cellRect, drawCutLines } from './imposition';
import type { CellRect, GridSpec } from './imposition';
import type { Student } from './types';
import type { CertFonts } from './pdfCerts';
import { safeFilename } from './filenames';

export type TagStyle = 'desk-plate' | 'badge-8up';

export interface NameTagOptions {
  paper: 'letter' | 'a4';
  style: TagStyle;
  /** show the last name in smaller type under the first name */
  showLastName: boolean;
  /** tiny label in a corner of each tag, e.g. the class name; '' = none */
  cornerLabel: string;
  inkSaver: boolean;
  skipAbsent: boolean;
  /** dashed cut guides between tags */
  showCutLines: boolean;
}

const PAGE_SIZES: Record<NameTagOptions['paper'], [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const GREEN = rgb(0.18, 0.42, 0.31);
const MARIGOLD = rgb(0.91, 0.63, 0.24);
const INK = rgb(0.14, 0.2, 0.19);
const GRAY = rgb(0.4, 0.46, 0.44);
const BLACK = rgb(0, 0, 0);

function fit(font: PDFFont, text: string, maxW: number, max: number): number {
  const unitW = font.widthOfTextAtSize(text, 1);
  if (unitW <= 0) return max;
  return Math.min(max, maxW / unitW);
}

// ---------------------------------------------------------------------------
// Tag chrome — per-style measurements
// ---------------------------------------------------------------------------

interface TagChrome {
  outerWidth: number;
  innerWidth: number;
  innerInset: number;
  /** side padding inside the tag when fitting the name */
  namePad: number;
  nameCap: number;
  nameMin: number;
  lastCap: number;
  labelSize: number;
  labelPad: number;
}

const CHROME: Record<TagStyle, TagChrome> = {
  'desk-plate': {
    outerWidth: 1.5, innerWidth: 0.75, innerInset: 6,
    // nameMin must stay 0: any floor lets a very long name overflow the tag.
    namePad: 24, nameCap: 64, nameMin: 0, lastCap: 20,
    labelSize: 7, labelPad: 12,
  },
  // 8-up approximates Avery 5395 badge sheets (2⅓" × 3⅜" insert cards).
  'badge-8up': {
    outerWidth: 1, innerWidth: 0.5, innerInset: 4,
    namePad: 12, nameCap: 30, nameMin: 0, lastCap: 12,
    labelSize: 6, labelPad: 8,
  },
};

function gridFor(style: TagStyle, pageW: number, pageH: number): GridSpec {
  if (style === 'desk-plate') {
    // Landscape, 2 plates stacked vertically, full printable width each.
    const margin = 36;
    const gutterY = 12;
    return {
      cols: 1, rows: 2,
      cellW: pageW - 2 * margin,
      cellH: (pageH - 2 * margin - gutterY) / 2,
      originX: margin,
      topY: pageH - margin,
      gutterX: 0, gutterY,
    };
  }
  // Portrait, 2 × 4 badge grid centered on the page.
  // Real Avery 5395 letter template: 3⅜″ × 2⅓″ badges (243 × 168pt),
  // contiguous rows (no vertical gap), 0.375″ between columns — centering
  // lands on Avery's 0.6875″ side and ~0.83″ top margins exactly.
  const cellW = 243;
  const cellH = 168;
  const gutterX = 27;
  const gutterY = 0;
  const gridW = 2 * cellW + gutterX;
  const gridH = 4 * cellH + 3 * gutterY;
  return {
    cols: 2, rows: 4,
    cellW, cellH,
    originX: (pageW - gridW) / 2,
    topY: pageH - (pageH - gridH) / 2,
    gutterX, gutterY,
  };
}

// ---------------------------------------------------------------------------
// One tag
// ---------------------------------------------------------------------------

function drawCenteredIn(page: PDFPage, rect: CellRect, text: string, font: PDFFont, size: number, baselineY: number, color: Color) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rect.x + (rect.w - w) / 2, y: baselineY, size, font, color });
}

function drawTag(
  page: PDFPage,
  rect: CellRect,
  student: Student,
  opts: NameTagOptions,
  chrome: TagChrome,
  fonts: { body: PDFFont; bodyBold: PDFFont; display: PDFFont },
) {
  const ink = opts.inkSaver;

  // Double border (single black outer in ink-saver mode).
  page.drawRectangle({
    x: rect.x, y: rect.y, width: rect.w, height: rect.h,
    borderColor: ink ? BLACK : MARIGOLD, borderWidth: chrome.outerWidth,
  });
  if (!ink) {
    page.drawRectangle({
      x: rect.x + chrome.innerInset, y: rect.y + chrome.innerInset,
      width: rect.w - 2 * chrome.innerInset, height: rect.h - 2 * chrome.innerInset,
      borderColor: GREEN, borderWidth: chrome.innerWidth,
    });
  }

  // Name block, vertically centered within the tag.
  const first = student.first.trim();
  const last = student.last.trim();
  const hasLast = opts.showLastName && last.length > 0;
  const maxW = rect.w - 2 * chrome.namePad;

  const firstSize = Math.max(chrome.nameMin, fit(fonts.display, first, maxW, chrome.nameCap));
  const lastSize = hasLast ? fit(fonts.bodyBold, last, maxW, chrome.lastCap) : 0;

  const capH = 0.72; // approximate cap-height ratio for both faces
  const gap = hasLast ? firstSize * 0.28 : 0;
  const blockH = firstSize * capH + gap + lastSize * capH;
  const blockTop = rect.y + rect.h / 2 + blockH / 2;
  const firstBaseline = blockTop - firstSize * capH;

  drawCenteredIn(page, rect, first, fonts.display, firstSize, firstBaseline, ink ? BLACK : INK);
  if (hasLast) {
    drawCenteredIn(page, rect, last, fonts.bodyBold, lastSize, firstBaseline - gap - lastSize * capH, ink ? BLACK : GRAY);
  }

  // Corner label, bottom-right inside the tag.
  const label = opts.cornerLabel.trim();
  if (label) {
    const size = fit(fonts.body, label, rect.w - 2 * chrome.labelPad, chrome.labelSize);
    const w = fonts.body.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: rect.x + rect.w - chrome.labelPad - w,
      y: rect.y + chrome.labelPad,
      size, font: fonts.body, color: ink ? BLACK : GRAY,
    });
  }
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export async function renderNameTagsPdf(
  students: Student[],
  opts: NameTagOptions,
  fonts: CertFonts,
): Promise<{ bytes: Uint8Array; count: number; pages: number }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const body = await doc.embedFont(fonts.regular, { subset: true });
  const bodyBold = await doc.embedFont(fonts.bold, { subset: true });
  // Baloo 2 must be a locally-instanced static TTF (fonttools instancer):
  // both the gstatic build and the raw variable font break fontkit.
  const display = await doc.embedFont(fonts.display, { subset: false });
  const embedded = { body, bodyBold, display };

  const [shortSide, longSide] = PAGE_SIZES[opts.paper];
  // Desk plates print landscape; badge sheets print portrait.
  const landscape = opts.style === 'desk-plate';
  const pageW = landscape ? longSide : shortSide;
  const pageH = landscape ? shortSide : longSide;

  const grid = gridFor(opts.style, pageW, pageH);
  const chrome = CHROME[opts.style];
  const perPage = grid.cols * grid.rows;

  const roster = students.filter((s) => !(opts.skipAbsent && s.absent));

  for (let i = 0; i < roster.length; i += perPage) {
    const page = doc.addPage([pageW, pageH]);
    // Cut guides go down first so tag content sits on top of them.
    if (opts.showCutLines) drawCutLines(page, grid, pageW, pageH);
    const batch = roster.slice(i, i + perPage);
    batch.forEach((student, slot) => {
      drawTag(page, cellRect(grid, slot), student, opts, chrome, embedded);
    });
  }

  // Count before save(): pdf-lib pads an empty document with one blank page.
  const pages = doc.getPageCount();
  return { bytes: await doc.save(), count: roster.length, pages };
}

export function nameTagsPdfFilename(className: string, style: TagStyle): string {
  const cls = safeFilename(className);
  const label = style === 'desk-plate' ? 'Desk plates' : 'Name tags';
  return `${cls} — ${label}.pdf`;
}
