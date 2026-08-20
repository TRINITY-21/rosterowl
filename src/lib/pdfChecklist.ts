// Roster checklist grid: class list down the side, teacher-named columns
// across the top, one page. The highest-frequency printable in teaching —
// homework turn-in, permission slips, library books, signatures.

import fontkit from '@pdf-lib/fontkit';
import type { PDFFont } from 'pdf-lib';
import { PDFDocument, rgb } from 'pdf-lib';
import type { PdfFonts, Student } from './types';
import { safeFilename } from './filenames';

export type NameOrder = 'roster' | 'first' | 'last';

export interface ChecklistOptions {
  paper: 'letter' | 'a4';
  orientation: 'portrait' | 'landscape';
  /** e.g. "Homework — Week of Sept 8" */
  title: string;
  /** e.g. class name · date */
  subtitle: string;
  /** Column headers; empty strings render as blank headers. 1–12 columns. */
  columns: string[];
  nameOrder: NameOrder;
  includeAbsent: boolean;
  inkSaver: boolean;
  showFooter: boolean;
}

const PAGE_SIZES: Record<ChecklistOptions['paper'], [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const MARGIN = 36;
const GREEN = rgb(0.18, 0.42, 0.31);
const INK = rgb(0.14, 0.2, 0.19);
const GRAY = rgb(0.4, 0.46, 0.44);
const FAINT = rgb(0.62, 0.62, 0.62);
const LINE = rgb(0.78, 0.75, 0.68);
const ZEBRA = rgb(0.972, 0.962, 0.937);
const BLACK = rgb(0, 0, 0);

function fit(font: PDFFont, text: string, maxW: number, max: number): number {
  const unitW = font.widthOfTextAtSize(text, 1);
  if (unitW <= 0) return max;
  return Math.min(max, maxW / unitW);
}

/** Sorted copy; display name follows the sort ("Last, First" for last-name order). */
export function orderedNames(
  students: Student[],
  order: NameOrder,
): { student: Student; label: string }[] {
  const firstLast = (s: Student) => `${s.first} ${s.last}`.trim();
  const lastFirst = (s: Student) => (s.last ? `${s.last}, ${s.first}` : s.first);
  const rows = students.map((s) => ({ student: s, label: firstLast(s) }));
  if (order === 'first') {
    rows.sort((a, b) => firstLast(a.student).localeCompare(firstLast(b.student)));
  } else if (order === 'last') {
    for (const r of rows) r.label = lastFirst(r.student);
    rows.sort((a, b) => lastFirst(a.student).localeCompare(lastFirst(b.student)));
  }
  return rows;
}

export async function renderChecklistPdf(
  students: Student[],
  opts: ChecklistOptions,
  fonts: PdfFonts,
): Promise<{ bytes: Uint8Array; rows: number }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });

  const [shortSide, longSide] = PAGE_SIZES[opts.paper];
  const landscape = opts.orientation === 'landscape';
  const pageW = landscape ? longSide : shortSide;
  const pageH = landscape ? shortSide : longSide;
  const page = doc.addPage([pageW, pageH]);
  const ink = opts.inkSaver;

  const pool = opts.includeAbsent ? students : students.filter((s) => !s.absent);
  const rows = orderedNames(pool, opts.nameOrder);
  const columns = opts.columns.slice(0, 12);

  // ----- Header -----
  const contentW = pageW - 2 * MARGIN;
  let y = pageH - MARGIN;
  const title = opts.title.trim() || 'Checklist';
  const titleSize = Math.max(12, fit(bold, title, contentW, 18));
  y -= titleSize;
  page.drawText(title, { x: MARGIN, y, size: titleSize, font: bold, color: ink ? BLACK : INK });
  if (opts.subtitle.trim()) {
    y -= 14;
    page.drawText(opts.subtitle.trim(), { x: MARGIN, y, size: 10, font: regular, color: GRAY });
  }
  y -= 10;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: pageW - MARGIN, y },
    thickness: 1.2,
    color: ink ? BLACK : GREEN,
  });
  const tableTop = y - 8;

  if (opts.showFooter) {
    page.drawText('Made with RosterOwl — rosterowl.com', {
      x: MARGIN,
      y: 14,
      size: 7,
      font: regular,
      color: FAINT,
    });
  }

  if (rows.length === 0) return { bytes: await doc.save(), rows: 0 };

  // ----- Table geometry: always one page -----
  const tableBottom = MARGIN - 6 + 18;
  const headerH = 20;
  const bodyH = tableTop - headerH - tableBottom;
  // No minimum row height: the one-page guarantee wins, and nameSize scales
  // with rowH so names shrink rather than rows sliding off the page.
  const rowH = Math.min(26, bodyH / rows.length);

  const indexW = 22;
  const longestName = rows.reduce(
    (m, r) => Math.max(m, regular.widthOfTextAtSize(r.label, 10)),
    0
  );
  const nameW = Math.min(Math.max(longestName + 14, 110), contentW * 0.42);
  const colW = columns.length > 0 ? (contentW - indexW - nameW) / columns.length : 0;

  const nameSize = Math.min(10, rowH * 0.62);
  const gridColor = ink ? BLACK : LINE;
  const gridWidth = 0.6;
  const tableH = headerH + rowH * rows.length;
  const left = MARGIN;
  const right = MARGIN + indexW + nameW + colW * columns.length;

  // Zebra striping behind alternating rows (skip in ink-saver).
  if (!ink) {
    for (let i = 1; i < rows.length; i += 2) {
      page.drawRectangle({
        x: left,
        y: tableTop - headerH - rowH * (i + 1),
        width: right - left,
        height: rowH,
        color: ZEBRA,
      });
    }
  }

  // Column headers
  for (let c = 0; c < columns.length; c++) {
    const label = columns[c]!.trim();
    if (!label) continue;
    const x0 = left + indexW + nameW + colW * c;
    const size = Math.min(9, fit(bold, label, colW - 8, 9));
    const w = bold.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: x0 + (colW - w) / 2,
      y: tableTop - headerH + 6,
      size,
      font: bold,
      color: ink ? BLACK : GREEN,
    });
  }

  // Row index + names
  for (let i = 0; i < rows.length; i++) {
    const baseY = tableTop - headerH - rowH * (i + 1) + (rowH - nameSize) / 2 + 1;
    const idx = String(i + 1);
    page.drawText(idx, {
      x: left + indexW - 6 - regular.widthOfTextAtSize(idx, nameSize * 0.85),
      y: baseY,
      size: nameSize * 0.85,
      font: regular,
      color: GRAY,
    });
    const label = rows[i]!.label;
    const size = Math.min(nameSize, fit(regular, label, nameW - 10, nameSize));
    page.drawText(label, {
      x: left + indexW + 5,
      y: baseY,
      size,
      font: regular,
      color: ink ? BLACK : INK,
    });
  }

  // Grid lines
  for (let i = 0; i <= rows.length; i++) {
    const gy = tableTop - headerH - rowH * i;
    page.drawLine({ start: { x: left, y: gy }, end: { x: right, y: gy }, thickness: gridWidth, color: gridColor });
  }
  page.drawLine({ start: { x: left, y: tableTop }, end: { x: right, y: tableTop }, thickness: 1, color: gridColor });
  const vXs = [left, left + indexW, left + indexW + nameW];
  for (let c = 1; c <= columns.length; c++) vXs.push(left + indexW + nameW + colW * c);
  for (const vx of vXs) {
    page.drawLine({
      start: { x: vx, y: tableTop },
      end: { x: vx, y: tableTop - tableH },
      thickness: vx === left || vx === right ? 1 : gridWidth,
      color: gridColor,
    });
  }

  return { bytes: await doc.save(), rows: rows.length };
}

export function checklistPdfFilename(className: string, title: string): string {
  const cls = safeFilename(className);
  const t = safeFilename(title, 'Checklist');
  return `${cls} — ${t}.pdf`;
}
