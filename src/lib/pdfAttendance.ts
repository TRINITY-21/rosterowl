// Monthly attendance register: roster down the side, the month's school days
// (Mon–Fri) across the top, blank cells for the teacher's own marks.
// Always one page — rows and day columns scale down, they never overflow.

import fontkit from '@pdf-lib/fontkit';
import type { PDFFont } from 'pdf-lib';
import { PDFDocument, rgb } from 'pdf-lib';
import type { PdfFonts, Student } from './types';
import type { NameOrder } from './pdfChecklist';
import { orderedNames } from './pdfChecklist';
import { safeFilename } from './filenames';

export interface AttendanceOptions {
  paper: 'letter' | 'a4';
  orientation: 'portrait' | 'landscape';
  year: number;
  /** 0-based like JS Date (0 = January). */
  month: number;
  nameOrder: NameOrder;
  inkSaver: boolean;
  showFooter: boolean;
  /** e.g. the class name. */
  subtitle: string;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

// getDay() index -> letter. Single letters on purpose: the day number printed
// beside each letter disambiguates Tuesday/Thursday.
const WEEKDAY_LETTERS = ['', 'M', 'T', 'W', 'T', 'F', ''] as const;

/** Every Mon–Fri of the month. `month` is 0-based like JS Date. */
export function schoolDays(year: number, month: number): { day: number; weekday: string }[] {
  const out: { day: number; weekday: string }[] = [];
  const lastDay = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= lastDay; day++) {
    const dow = new Date(year, month, day).getDay();
    if (dow >= 1 && dow <= 5) out.push({ day, weekday: WEEKDAY_LETTERS[dow]! });
  }
  return out;
}

const PAGE_SIZES: Record<AttendanceOptions['paper'], [number, number]> = {
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

export async function renderAttendancePdf(
  students: Student[],
  opts: AttendanceOptions,
  fonts: PdfFonts,
): Promise<{ bytes: Uint8Array; rows: number; days: number; unrenderable: string[] }> {
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

  const dayList = schoolDays(opts.year, opts.month);
  // Names only — never absent flags, zone prefs, or any other roster tag.
  const rows = orderedNames(students, opts.nameOrder);

  // Atkinson covers Latin only: names outside its cmap would print as .notdef
  // boxes with no error. Detect them so the UI can warn before printing.
  const face = fontkit.create(fonts.regular);
  const unrenderable = rows
    .map((r) => r.label)
    .filter((label) => [...label].some((ch) => !face.hasGlyphForCodePoint(ch.codePointAt(0)!)));

  // ----- Header -----
  const contentW = pageW - 2 * MARGIN;
  let y = pageH - MARGIN;
  const title = `Attendance — ${MONTH_NAMES[opts.month] ?? ''} ${opts.year}`;
  const titleSize = Math.max(12, fit(bold, title, contentW, 18));
  y -= titleSize;
  page.drawText(title, { x: MARGIN, y, size: titleSize, font: bold, color: ink ? BLACK : INK });
  if (opts.subtitle.trim()) {
    y -= 14;
    const sub = opts.subtitle.trim();
    page.drawText(sub, { x: MARGIN, y, size: fit(regular, sub, contentW, 10), font: regular, color: GRAY });
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

  if (rows.length === 0) return { bytes: await doc.save(), rows: 0, days: dayList.length, unrenderable };

  // ----- Table geometry: always one page -----
  const tableBottom = MARGIN - 6 + 18;
  const headerH = 26; // two stacked lines: day number over weekday letter
  const bodyH = tableTop - headerH - tableBottom;
  // No minimum row height: the one-page guarantee wins, and nameSize scales
  // with rowH so names shrink rather than rows sliding off the page.
  const rowH = Math.min(26, bodyH / rows.length);

  const indexW = 22;
  const nameW = contentW * 0.28;
  // No minimum day-column width either: every school day always fits across.
  const dayW = dayList.length > 0 ? (contentW - indexW - nameW) / dayList.length : 0;

  const nameSize = Math.min(10, rowH * 0.62);
  const gridColor = ink ? BLACK : LINE;
  const gridWidth = 0.6;
  const tableH = headerH + rowH * rows.length;
  const left = MARGIN;
  const right = left + indexW + nameW + dayW * dayList.length;

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

  // Day headers: day number (bold) stacked over its weekday letter.
  for (let c = 0; c < dayList.length; c++) {
    const { day, weekday } = dayList[c]!;
    const x0 = left + indexW + nameW + dayW * c;
    const num = String(day);
    const numSize = Math.min(8, fit(bold, num, dayW - 2, 8));
    page.drawText(num, {
      x: x0 + (dayW - bold.widthOfTextAtSize(num, numSize)) / 2,
      y: tableTop - 11,
      size: numSize,
      font: bold,
      color: ink ? BLACK : GREEN,
    });
    const letterSize = Math.min(6.5, fit(regular, weekday, dayW - 2, 6.5));
    page.drawText(weekday, {
      x: x0 + (dayW - regular.widthOfTextAtSize(weekday, letterSize)) / 2,
      y: tableTop - headerH + 4,
      size: letterSize,
      font: regular,
      color: ink ? BLACK : GRAY,
    });
  }

  // Row index + names. Day cells stay empty — teachers write their own marks.
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
  for (let c = 1; c <= dayList.length; c++) vXs.push(left + indexW + nameW + dayW * c);
  for (const vx of vXs) {
    page.drawLine({
      start: { x: vx, y: tableTop },
      end: { x: vx, y: tableTop - tableH },
      thickness: vx === left || vx === right ? 1 : gridWidth,
      color: gridColor,
    });
  }

  return { bytes: await doc.save(), rows: rows.length, days: dayList.length, unrenderable };
}

export function attendancePdfFilename(className: string, year: number, month: number): string {
  const cls = safeFilename(className);
  return `${cls} — Attendance ${MONTH_NAMES[month] ?? ''} ${year}.pdf`;
}
