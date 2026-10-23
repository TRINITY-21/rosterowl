// Monthly attendance register: roster down the side, the month's school days
// (Mon–Fri) across the top. Days the teacher took in RosterOwl carry ✓ / A / L
// and per-student totals; every other cell stays blank for hand marks.
// Always one page — rows and day columns scale down, they never overflow.

import fontkit from '@pdf-lib/fontkit';
import type { PDFFont } from 'pdf-lib';
import { PDFDocument, rgb } from 'pdf-lib';
import type { AttendanceLog, PdfFonts, Student } from './types';
import type { NameOrder } from './pdfChecklist';
import { orderedNames } from './pdfChecklist';
import { dateKey, dayState, isTaken, monthTotals, schoolDays } from './attendance';

// Moved to attendance.ts (no pdf-lib there); re-exported for existing callers.
export { schoolDays } from './attendance';

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
const ABSENT = rgb(0.72, 0.25, 0.2);
const LATE = rgb(0.75, 0.52, 0.1);
/** Width of each totals column ("Abs", "Late"), present only on a marked month. */
const TOTALS_W = 26;

function fit(font: PDFFont, text: string, maxW: number, max: number): number {
  const unitW = font.widthOfTextAtSize(text, 1);
  if (unitW <= 0) return max;
  return Math.min(max, maxW / unitW);
}

/**
 * @param log the class's attendance. Omitted, or with no taken day in this
 * month, the sheet is exactly the blank register.
 */
export async function renderAttendancePdf(
  students: Student[],
  opts: AttendanceOptions,
  fonts: PdfFonts,
  log?: AttendanceLog,
): Promise<{ bytes: Uint8Array; rows: number; days: number; daysTaken: number; unrenderable: string[] }> {
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
  // Names and the marks the teacher took — never the live absent flag, zone
  // prefs, or any other roster tag.
  const rows = orderedNames(students, opts.nameOrder);
  const totals = log ? monthTotals(log, students, opts.year, opts.month) : null;
  const daysTaken = totals?.daysTaken ?? 0;
  const marked = daysTaken > 0;

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
  if (marked) {
    y -= 12;
    const taken = `Taken on ${daysTaken} of ${totals!.schoolDayCount} school days`;
    page.drawText(taken, { x: MARGIN, y, size: fit(regular, taken, contentW, 9), font: regular, color: ink ? BLACK : GRAY });
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

  if (rows.length === 0) {
    return { bytes: await doc.save(), rows: 0, days: dayList.length, daysTaken, unrenderable };
  }

  // ----- Table geometry: always one page -----
  const tableBottom = MARGIN - 6 + 18;
  const headerH = 26; // two stacked lines: day number over weekday letter
  const bodyH = tableTop - headerH - tableBottom;
  // No minimum row height: the one-page guarantee wins, and nameSize scales
  // with rowH so names shrink rather than rows sliding off the page.
  const rowH = Math.min(26, bodyH / rows.length);

  const indexW = 22;
  const nameW = contentW * 0.28;
  const totalsW = marked ? TOTALS_W * 2 : 0;
  // No minimum day-column width either: every school day always fits across.
  const dayW = dayList.length > 0 ? (contentW - indexW - nameW - totalsW) / dayList.length : 0;

  const nameSize = Math.min(10, rowH * 0.62);
  const gridColor = ink ? BLACK : LINE;
  const gridWidth = 0.6;
  const tableH = headerH + rowH * rows.length;
  const left = MARGIN;
  const daysRight = left + indexW + nameW + dayW * dayList.length;
  const right = daysRight + totalsW;

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

  if (marked) {
    for (const [k, label] of ['Abs', 'Late'].entries()) {
      const size = Math.min(7, fit(bold, label, TOTALS_W - 4, 7));
      page.drawText(label, {
        x: daysRight + TOTALS_W * k + (TOTALS_W - bold.widthOfTextAtSize(label, size)) / 2,
        y: tableTop - headerH / 2 - size / 2 + 1,
        size,
        font: bold,
        color: ink ? BLACK : GREEN,
      });
    }
  }

  const dayKeys = dayList.map(({ day }) => dateKey(new Date(opts.year, opts.month, day)));
  const markSize = Math.min(nameSize, dayW * 0.7);
  const drawRowMarks = (i: number, student: Student) => {
    const cellBottom = tableTop - headerH - rowH * (i + 1);
    for (let c = 0; c < dayKeys.length; c++) {
      const key = dayKeys[c]!;
      if (!isTaken(log!, key)) continue;
      const state = dayState(log!, key, student.id);
      const x0 = left + indexW + nameW + dayW * c;
      if (state === 'present') {
        // Drawn, not typed: neither Atkinson nor Baloo has a ✓ (U+2713) glyph.
        const side = Math.min(dayW, rowH) * 0.62;
        const sx = x0 + (dayW - side) / 2;
        const sy = cellBottom + (rowH - side) / 2;
        const pt = (fx: number, fy: number) => ({ x: sx + side * fx, y: sy + side * fy });
        const line = { thickness: Math.max(0.6, side * 0.09), color: ink ? BLACK : GREEN };
        page.drawLine({ start: pt(0.28, 0.52), end: pt(0.44, 0.34), ...line });
        page.drawLine({ start: pt(0.44, 0.34), end: pt(0.74, 0.72), ...line });
      } else if (state === 'absent' || state === 'late') {
        const letter = state === 'absent' ? 'A' : 'L';
        const font = ink && state === 'late' ? regular : bold;
        page.drawText(letter, {
          x: x0 + (dayW - font.widthOfTextAtSize(letter, markSize)) / 2,
          y: cellBottom + (rowH - markSize) / 2 + 1,
          size: markSize,
          font,
          color: ink ? BLACK : state === 'absent' ? ABSENT : LATE,
        });
      }
      // 'not-enrolled': before the student joined — left blank.
    }
    const counts = totals!.perStudent.get(student.id) ?? { absent: 0, late: 0 };
    for (const [k, n] of [counts.absent, counts.late].entries()) {
      const text = String(n);
      page.drawText(text, {
        x: daysRight + TOTALS_W * k + (TOTALS_W - regular.widthOfTextAtSize(text, nameSize)) / 2,
        y: cellBottom + (rowH - nameSize) / 2 + 1,
        size: nameSize,
        font: regular,
        // A zero is the common case; keep it quiet so the real counts stand out.
        color: n === 0 ? FAINT : ink ? BLACK : INK,
      });
    }
  };

  // Row index + names. Untaken day cells stay empty for the teacher's own marks.
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
    if (marked) drawRowMarks(i, rows[i]!.student);
  }

  // Grid lines
  for (let i = 0; i <= rows.length; i++) {
    const gy = tableTop - headerH - rowH * i;
    page.drawLine({ start: { x: left, y: gy }, end: { x: right, y: gy }, thickness: gridWidth, color: gridColor });
  }
  page.drawLine({ start: { x: left, y: tableTop }, end: { x: right, y: tableTop }, thickness: 1, color: gridColor });
  const vXs = [left, left + indexW, left + indexW + nameW];
  for (let c = 1; c <= dayList.length; c++) vXs.push(left + indexW + nameW + dayW * c);
  if (marked) vXs.push(daysRight + TOTALS_W, right);
  for (const vx of vXs) {
    page.drawLine({
      start: { x: vx, y: tableTop },
      end: { x: vx, y: tableTop - tableH },
      thickness: vx === left || vx === right ? 1 : gridWidth,
      color: gridColor,
    });
  }

  return { bytes: await doc.save(), rows: rows.length, days: dayList.length, daysTaken, unrenderable };
}

// Lives in filenames.ts so components can name a download without pulling
// pdf-lib in; re-exported here because that is where callers expect it.
export { attendancePdfFilename } from "./filenames";
