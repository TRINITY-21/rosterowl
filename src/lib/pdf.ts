// One-page seating chart PDF. Deterministic layout: same inputs -> same page.
// PRIVACY: only display names appear on the page — never tags, zone prefs,
// absent flags, or constraint info.

import { PDFDocument, rgb } from 'pdf-lib';
import type { Color, PDFFont, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ClassData, Desk, Id, PdfFonts, PdfOptions, Room } from './types';
import { roomBounds } from './geometry';
import { safeFilename } from './filenames';

const PAGE_SIZES: Record<PdfOptions['paper'], [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const MARGIN = 36;

// Palette
const GREEN = rgb(0.18, 0.42, 0.31);
const TITLE_INK = rgb(0.13, 0.16, 0.14);
const NAME_INK = rgb(0.15, 0.15, 0.15);
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.45, 0.45, 0.45);
const FAINT_GRAY = rgb(0.62, 0.62, 0.62);
const DESK_FILL = rgb(0.98, 0.97, 0.94);
const DESK_BORDER = rgb(0.55, 0.52, 0.45);
const EMPTY_BORDER = rgb(0.78, 0.76, 0.71);
const GROUP_FILL = rgb(0.936, 0.955, 0.938);
const MARKER_FILL = rgb(0.94, 0.94, 0.94);

const NAME_MAX_PT = 16;
const NAME_MIN_PT = 6;
const TWO_LINE_THRESHOLD_PT = 7;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Largest size (capped at `max`) at which `text` fits in `maxW` points. */
function fitSize(font: PDFFont, text: string, maxW: number, max: number): number {
  // Glyph advance widths scale linearly with size, so one measurement suffices.
  const unitW = font.widthOfTextAtSize(text, 1);
  if (unitW <= 0) return max;
  return Math.min(max, maxW / unitW);
}

function roundedRectPath(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return (
    `M ${rr} 0 L ${w - rr} 0 Q ${w} 0 ${w} ${rr} L ${w} ${h - rr} ` +
    `Q ${w} ${h} ${w - rr} ${h} L ${rr} ${h} Q 0 ${h} 0 ${h - rr} ` +
    `L 0 ${rr} Q 0 0 ${rr} 0 Z`
  );
}

interface RectStyle {
  fill?: Color;
  border?: Color;
  borderWidth?: number;
  dash?: number[];
}

function drawRoundedRect(
  page: PDFPage,
  x: number,
  yBottom: number,
  w: number,
  h: number,
  r: number,
  style: RectStyle,
): void {
  // drawSvgPath places the path's top-left origin at (x, y), y-down.
  page.drawSvgPath(roundedRectPath(w, h, r), {
    x,
    y: yBottom + h,
    color: style.fill,
    borderColor: style.border,
    borderWidth: style.borderWidth,
    borderDashArray: style.dash,
  });
}

/** Fit a name into `maxW`: shrink, split into two lines if too small, scale, clamp. */
function layoutName(
  name: string,
  font: PDFFont,
  maxW: number,
  nameScale: number,
): { lines: string[]; size: number } {
  // The slider scales the size CAP, never the fitted size — text must always
  // still fit inside the desk.
  const maxPt = NAME_MAX_PT * nameScale;
  let lines = [name];
  let fitted = fitSize(font, name, maxW, maxPt);
  if (fitted < TWO_LINE_THRESHOLD_PT && name.includes(' ')) {
    // Split at the space nearest the middle of the string.
    let best = -1;
    const mid = name.length / 2;
    for (let i = name.indexOf(' '); i !== -1; i = name.indexOf(' ', i + 1)) {
      if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
    }
    const two = [name.slice(0, best).trim(), name.slice(best + 1).trim()].filter((s) => s.length > 0);
    if (two.length === 2) {
      lines = two;
      fitted = Math.min(
        fitSize(font, two[0]!, maxW, maxPt),
        fitSize(font, two[1]!, maxW, maxPt),
      );
    }
  }
  return { lines, size: Math.max(fitted, NAME_MIN_PT) };
}

function drawCenteredLines(
  page: PDFPage,
  lines: string[],
  font: PDFFont,
  size: number,
  cx: number,
  cy: number,
  color: Color,
): void {
  const lineGap = size * 1.18;
  const n = lines.length;
  for (let i = 0; i < n; i++) {
    const text = lines[i]!;
    const w = font.widthOfTextAtSize(text, size);
    // Baseline offset ~0.36em below the optical center of a line.
    const y = cy + ((n - 1) / 2 - i) * lineGap - size * 0.36;
    page.drawText(text, { x: cx - w / 2, y, size, font, color });
  }
}

export async function renderChartPdf(
  room: Room,
  cls: ClassData,
  displayNames: Map<Id, string>,
  opts: PdfOptions,
  fonts: PdfFonts,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Embedded fonts only — standard fonts cannot encode diacritics (Zoë, José).
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });

  const [shortSide, longSide] = PAGE_SIZES[opts.paper];
  const landscape = opts.orientation === 'landscape';
  const pageW = landscape ? longSide : shortSide;
  const pageH = landscape ? shortSide : longSide;
  const page = doc.addPage([pageW, pageH]);

  const ink = opts.inkSaver;
  const contentW = pageW - 2 * MARGIN;

  // ----- Header -----
  const title = opts.title.trim();
  const subtitle = opts.subtitle.trim();
  let y = pageH - MARGIN;
  const titleSize = Math.max(12, fitSize(bold, title, contentW, 20));
  y -= titleSize;
  if (title) {
    page.drawText(title, { x: MARGIN, y, size: titleSize, font: bold, color: ink ? BLACK : TITLE_INK });
  }
  if (subtitle) {
    y -= 11 + 5;
    page.drawText(subtitle, { x: MARGIN, y, size: 11, font: regular, color: GRAY });
  }
  y -= 12;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: pageW - MARGIN, y },
    thickness: 1.5,
    color: ink ? BLACK : GREEN,
  });

  // ----- Footer -----
  if (opts.showFooter) {
    page.drawText('Made with RosterOwl — rosterowl.com', {
      x: MARGIN,
      y: 14,
      size: 7.5,
      font: regular,
      color: FAINT_GRAY,
    });
  }

  // ----- Chart area: uniform scale, centered -----
  const chartTop = y - 14;
  const chartBottom = MARGIN;
  const bounds = roomBounds(room);
  const areaW = contentW;
  const areaH = chartTop - chartBottom;
  const scale = Math.min(areaW / bounds.width, areaH / bounds.height);
  const originX = MARGIN + (areaW - bounds.width * scale) / 2;
  // Grid y grows downward; PDF y grows upward. gridTopY maps bounds.minY.
  const gridTopY = chartBottom + (areaH - bounds.height * scale) / 2 + bounds.height * scale;
  const toX = (gx: number): number => originX + (gx - bounds.minX) * scale;
  const toY = (gy: number): number => gridTopY - (gy - bounds.minY) * scale;

  // A desk occupies the grid cell [x, x+1] x [y, y+1]; draw it slightly inset.
  const inset = scale * 0.06;
  const deskW = scale - 2 * inset;
  const cornerR = Math.min(3, deskW * 0.12);

  // ----- Table-group backgrounds (behind desks; skipped in ink-saver) -----
  if (!ink) {
    const groups = new Map<Id, Desk[]>();
    for (const d of room.desks) {
      if (d.groupId === null) continue;
      const list = groups.get(d.groupId);
      if (list) list.push(d);
      else groups.set(d.groupId, [d]);
    }
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const xs = members.map((d) => d.x);
      const ys = members.map((d) => d.y);
      const pad = scale * 0.16;
      const left = toX(Math.min(...xs)) - pad;
      const right = toX(Math.max(...xs) + 1) + pad;
      const top = toY(Math.min(...ys)) + pad;
      const bottom = toY(Math.max(...ys) + 1) - pad;
      drawRoundedRect(page, left, bottom, right - left, top - bottom, cornerR + pad * 0.5, {
        fill: GROUP_FILL,
      });
    }
  }

  // ----- Desks + names -----
  for (const desk of room.desks) {
    const left = toX(desk.x) + inset;
    const bottom = toY(desk.y + 1) + inset;
    const studentId = cls.seating[desk.id];
    const name = (studentId !== undefined ? displayNames.get(studentId) ?? '' : '').trim();
    const occupied = name.length > 0;

    const style: RectStyle = occupied
      ? ink
        ? { border: BLACK, borderWidth: 1 }
        : { fill: DESK_FILL, border: DESK_BORDER, borderWidth: 1 }
      : ink
        ? { border: rgb(0.55, 0.55, 0.55), borderWidth: 1, dash: [3, 2] }
        : { fill: DESK_FILL, border: EMPTY_BORDER, borderWidth: 1, dash: [3, 2] };
    drawRoundedRect(page, left, bottom, deskW, deskW, cornerR, style);

    if (occupied) {
      const maxTextW = deskW - Math.max(4, deskW * 0.14);
      const { lines, size } = layoutName(name, bold, maxTextW, opts.nameScale);
      drawCenteredLines(page, lines, bold, size, left + deskW / 2, bottom + deskW / 2, ink ? BLACK : NAME_INK);
    }
  }

  // ----- Teacher desk + door markers -----
  if (room.teacherDesk) {
    const m = room.teacherDesk;
    const w = deskW;
    const h = deskW * 0.62;
    const left = toX(m.x) + inset;
    const bottom = toY(m.y + 1) + (scale - h) / 2;
    drawRoundedRect(page, left, bottom, w, h, cornerR, {
      fill: ink ? undefined : MARKER_FILL,
      border: GRAY,
      borderWidth: 1,
    });
    const size = clamp(fitSize(regular, 'Teacher', w - 6, 8.5), 5, 8.5);
    drawCenteredLines(page, ['Teacher'], regular, size, left + w / 2, bottom + h / 2, GRAY);
  }
  if (room.door) {
    const m = room.door;
    const size = clamp(fitSize(regular, 'Door', deskW - 6, 8.5), 5, 8.5);
    drawCenteredLines(page, ['Door'], regular, size, toX(m.x + 0.5), toY(m.y + 0.5), GRAY);
  }

  return doc.save();
}

// AP-style short months; matches the "Sept 2026" naming convention.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** "Ms Rivera — Sept 2026.pdf", safe for every mainstream filesystem. */
export function chartPdfFilename(className: string, date: Date = new Date()): string {
  const base = safeFilename(className, 'Seating chart');
  return `${base} — ${MONTHS[date.getMonth()]} ${date.getFullYear()}.pdf`;
}
