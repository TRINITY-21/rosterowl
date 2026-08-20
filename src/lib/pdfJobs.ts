// Classroom jobs chart poster: big display-font header, optional week label,
// then one card per job in a grid — the job title small and bold, the student
// name large in the display face. Always exactly one page: card height is
// computed from the available space and every text size scales down from it.
// Names only on output — no absence marks or any other roster tag (privacy rule).

import fontkit from '@pdf-lib/fontkit';
import type { Color, PDFFont, PDFPage } from 'pdf-lib';
import { PDFDocument, rgb } from 'pdf-lib';
import { cellRect } from './imposition';
import type { CellRect, GridSpec } from './imposition';
import type { CertFonts } from './pdfCerts';
import { safeFilename } from './filenames';

/** One job slot on the chart. `name: null` = unassigned (em-dash slot). */
export interface JobEntry {
  title: string;
  name: string | null;
}

export interface JobsChartOptions {
  paper: 'letter' | 'a4';
  /** e.g. "Our Classroom Jobs" */
  title: string;
  /** Optional subtitle, e.g. "Week of Sept 8"; '' = none */
  weekLabel: string;
  inkSaver: boolean;
  showFooter: boolean;
}

// Portrait only — a poster for the classroom door.
const PAGE_SIZES: Record<JobsChartOptions['paper'], [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const MARGIN = 36;
const GREEN = rgb(0.18, 0.42, 0.31);
const MARIGOLD = rgb(0.91, 0.63, 0.24);
const INK = rgb(0.14, 0.2, 0.19);
const GRAY = rgb(0.4, 0.46, 0.44);
const FAINT = rgb(0.62, 0.62, 0.62);
const CREAM = rgb(0.972, 0.962, 0.937);
const BLACK = rgb(0, 0, 0);

function fit(font: PDFFont, text: string, maxW: number, max: number): number {
  const unitW = font.widthOfTextAtSize(text, 1);
  if (unitW <= 0) return max;
  return Math.min(max, maxW / unitW);
}

function drawCenteredIn(
  page: PDFPage,
  rect: CellRect,
  text: string,
  font: PDFFont,
  size: number,
  baselineY: number,
  color: Color,
) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rect.x + (rect.w - w) / 2, y: baselineY, size, font, color });
}

function drawCard(
  page: PDFPage,
  rect: CellRect,
  entry: JobEntry,
  ink: boolean,
  fonts: { body: PDFFont; bodyBold: PDFFont; display: PDFFont },
) {
  // Card chrome: soft cream fill with a marigold border; black outline only
  // in ink-saver mode.
  if (!ink) {
    page.drawRectangle({ x: rect.x, y: rect.y, width: rect.w, height: rect.h, color: CREAM });
  }
  page.drawRectangle({
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    borderColor: ink ? BLACK : MARIGOLD,
    borderWidth: ink ? 1 : 1.5,
  });

  const pad = Math.min(10, rect.h * 0.12);
  const maxW = rect.w - 2 * pad;

  // Job title: small bold uppercase label along the top of the card.
  const label = entry.title.trim().toUpperCase();
  const labelSize = label
    ? Math.min(Math.min(11, rect.h * 0.17), fit(fonts.bodyBold, label, maxW, 11))
    : 0;
  const labelBaseline = rect.y + rect.h - pad - labelSize;
  if (label && labelSize > 0.5) {
    drawCenteredIn(page, rect, label, fonts.bodyBold, labelSize, labelBaseline, ink ? BLACK : GREEN);
  }

  // Student name — the star of the card — centered in the remaining space.
  // Every size derives from the card height, so a crowded chart shrinks its
  // type instead of ever spilling off the page.
  const zoneH = labelBaseline - labelSize * 0.5 - (rect.y + pad);
  const capH = 0.72; // approximate cap-height ratio
  if (entry.name) {
    const cap = Math.min(40, zoneH * 0.6);
    const size = fit(fonts.display, entry.name, maxW, cap);
    if (size > 0.5) {
      const baseline = rect.y + pad + (zoneH - size * capH) / 2;
      drawCenteredIn(page, rect, entry.name, fonts.display, size, baseline, ink ? BLACK : INK);
    }
  } else {
    // Em-dash slot for an unassigned job (body face — glyph guaranteed there).
    const size = Math.min(20, zoneH * 0.5);
    if (size > 0.5) {
      const baseline = rect.y + pad + (zoneH - size * capH) / 2;
      drawCenteredIn(page, rect, '—', fonts.bodyBold, size, baseline, ink ? BLACK : FAINT);
    }
  }
}

export async function renderJobsChartPdf(
  entries: JobEntry[],
  opts: JobsChartOptions,
  fonts: CertFonts,
): Promise<{ bytes: Uint8Array; pages: number }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const body = await doc.embedFont(fonts.regular, { subset: true });
  const bodyBold = await doc.embedFont(fonts.bold, { subset: true });
  // Baloo 2 must be a locally-instanced static TTF (fonttools instancer) and
  // must be embedded whole: subset:true corrupts its glyphs.
  const display = await doc.embedFont(fonts.display, { subset: false });
  const embedded = { body, bodyBold, display };

  const [pageW, pageH] = PAGE_SIZES[opts.paper];
  const page = doc.addPage([pageW, pageH]);
  const ink = opts.inkSaver;
  const contentW = pageW - 2 * MARGIN;

  // ----- Header -----
  let y = pageH - MARGIN;
  const title = opts.title.trim() || 'Our Classroom Jobs';
  // No lower bound on the title size: a very long title shrinks to fit the
  // width rather than running off the sheet.
  const titleSize = fit(display, title, contentW, 40);
  y -= titleSize;
  {
    const w = display.widthOfTextAtSize(title, titleSize);
    page.drawText(title, {
      x: (pageW - w) / 2,
      y,
      size: titleSize,
      font: display,
      color: ink ? BLACK : GREEN,
    });
  }
  const week = opts.weekLabel.trim();
  if (week) {
    const weekSize = fit(body, week, contentW, 13);
    y -= weekSize + 8;
    const w = body.widthOfTextAtSize(week, weekSize);
    page.drawText(week, { x: (pageW - w) / 2, y, size: weekSize, font: body, color: ink ? BLACK : GRAY });
  }
  y -= 12;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: pageW - MARGIN, y },
    thickness: 1.5,
    color: ink ? BLACK : MARIGOLD,
  });
  const gridTop = y - 12;

  if (opts.showFooter) {
    page.drawText('Made with RosterOwl — rosterowl.com', {
      x: MARGIN,
      y: 14,
      size: 7,
      font: body,
      color: FAINT,
    });
  }

  const n = entries.length;
  if (n === 0) return { bytes: await doc.save(), pages: doc.getPageCount() };

  // ----- Card grid: always one page -----
  const cols = n > 12 ? 3 : 2;
  const rows = Math.ceil(n / cols);
  const gutter = 10;
  const gridBottom = 28; // clears the footer line at y=14
  // No minimum card height: the one-page guarantee wins, and every text size
  // inside a card scales with cellH so content shrinks instead of overflowing.
  const cellH = (gridTop - gridBottom - (rows - 1) * gutter) / rows;
  const cellW = (contentW - (cols - 1) * gutter) / cols;
  const grid: GridSpec = {
    cols,
    rows,
    cellW,
    cellH,
    originX: MARGIN,
    topY: gridTop,
    gutterX: gutter,
    gutterY: gutter,
  };

  if (cellH > 2) {
    entries.forEach((entry, i) => drawCard(page, cellRect(grid, i), entry, ink, embedded));
  }

  return { bytes: await doc.save(), pages: doc.getPageCount() };
}

export function jobsPdfFilename(className: string): string {
  const cls = safeFilename(className);
  return `${cls} — Jobs chart.pdf`;
}
