// One-page seating chart PDF. Deterministic layout: same inputs -> same page.
// PRIVACY: only display names appear on the page — never tags, zone prefs,
// absent flags, or constraint info.

import { PDFDocument, rgb } from 'pdf-lib';
import type { Color, PDFFont, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ClassData, Desk, Id, PdfFonts, PdfOptions, Room } from './types';
import { roomBounds } from './geometry';
import { capOffset, drawCenteredLines, uniformNameLayout } from './pdfText';

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
// The desk card. Deliberately flat, and no longer a copy of the canvas: the
// screen draws a real desktop with a gradient, a name plate and a chair, none
// of which survives a school laser printer. Print keeps the ink budget.
const DESK_FILL = rgb(1, 1, 1);
const DESK_BORDER = rgb(0.769, 0.733, 0.655); // #c4bba7
const EMPTY_BORDER = rgb(0.84, 0.82, 0.78);
/** Contact shadow under each card — the flat print equivalent of --shadow-1. */
const DESK_SHADOW = rgb(0.886, 0.867, 0.835);

const PAPER = { r: 0.98, g: 0.969, b: 0.941 }; // #faf7f0, what tints sit on

/** Table-group hues, in the same order as GROUP_HUES on the canvas. */
const GROUP_TINTS: ReadonlyArray<{ r: number; g: number; b: number }> = [
  { r: 0.357, g: 0.553, b: 0.788 }, // blue   #5b8dc9
  { r: 0.851, g: 0.482, b: 0.4 },   // coral  #d97b66
  { r: 0.435, g: 0.643, b: 0.435 }, // green  #6fa46f
  { r: 0.557, g: 0.486, b: 0.765 }, // violet #8e7cc3
  { r: 0.788, g: 0.635, b: 0.153 }, // gold   #c9a227
  { r: 0.306, g: 0.608, b: 0.580 }, // teal   #4e9b94
];

/** The canvas uses color-mix(hue N%, transparent) over paper; this is that. */
function tint(hue: { r: number; g: number; b: number }, amount: number): Color {
  return rgb(
    PAPER.r + (hue.r - PAPER.r) * amount,
    PAPER.g + (hue.g - PAPER.g) * amount,
    PAPER.b + (hue.b - PAPER.b) * amount,
  );
}

// Marker pills, matching .marker.door / .marker.teacher on the canvas.
const DOOR_FILL = rgb(0.976, 0.929, 0.847); // --accent-soft #f9edd8
const DOOR_BORDER = rgb(0.906, 0.784, 0.55);
const DOOR_INK = rgb(0.541, 0.373, 0.059); // --warn #8a5f0f
const TEACHER_FILL = rgb(0.891, 0.929, 0.906); // --brand-soft #e3ede7
const TEACHER_BORDER = rgb(0.639, 0.749, 0.694);
const TEACHER_INK = rgb(0.141, 0.341, 0.255); // --brand-strong #245741

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
    // Each table group takes its own hue, in the same order the canvas assigns
    // them (insertion order of the desks), so the printed chart is recognisably
    // the chart on screen rather than six identical green blobs.
    let g = 0;
    for (const members of groups.values()) {
      const hue = GROUP_TINTS[g++ % GROUP_TINTS.length]!;
      if (members.length < 2) continue;
      const xs = members.map((d) => d.x);
      const ys = members.map((d) => d.y);
      const pad = scale * 0.16;
      const left = toX(Math.min(...xs)) - pad;
      const right = toX(Math.max(...xs) + 1) + pad;
      const top = toY(Math.min(...ys)) + pad;
      const bottom = toY(Math.max(...ys) + 1) - pad;
      drawRoundedRect(page, left, bottom, right - left, top - bottom, cornerR + pad * 0.5, {
        fill: tint(hue, 0.11),
        border: tint(hue, 0.32),
        borderWidth: 1,
      });
    }
  }

  // ----- Desks + names -----
  // Every desk is the same size, so every name is set at the same size: the one
  // the longest name can take. Fitting each name to its own desk independently
  // is what printed "Mia" at twice the size of "Isabella" on the same chart.
  const seated = room.desks
    .map((d) => {
      const id = cls.seating[d.id];
      return (id !== undefined ? displayNames.get(id) ?? '' : '').trim();
    })
    .filter((n) => n.length > 0);
  const maxTextW = deskW - Math.max(4, deskW * 0.14);
  const { size: nameSize, lines: nameLines } = uniformNameLayout(bold, seated, maxTextW, {
    max: NAME_MAX_PT * opts.nameScale,
    min: NAME_MIN_PT,
    twoLineBelow: TWO_LINE_THRESHOLD_PT,
  });

  for (const desk of room.desks) {
    const left = toX(desk.x) + inset;
    const bottom = toY(desk.y + 1) + inset;
    const studentId = cls.seating[desk.id];
    const name = (studentId !== undefined ? displayNames.get(studentId) ?? '' : '').trim();
    const occupied = name.length > 0;

    // A soft contact shadow lifts the card off its group tint, the way
    // --shadow-1 does on screen. Skipped in ink-saver, where every drop of
    // toner has to earn its place.
    if (occupied && !ink) {
      drawRoundedRect(page, left, bottom - scale * 0.03, deskW, deskW, cornerR, {
        fill: DESK_SHADOW,
      });
    }

    const style: RectStyle = occupied
      ? ink
        ? { border: BLACK, borderWidth: 1 }
        : { fill: DESK_FILL, border: DESK_BORDER, borderWidth: 1.2 }
      : ink
        ? { border: rgb(0.55, 0.55, 0.55), borderWidth: 1, dash: [3, 2] }
        : { border: EMPTY_BORDER, borderWidth: 1, dash: [3, 2] };
    drawRoundedRect(page, left, bottom, deskW, deskW, cornerR, style);

    if (occupied) {
      drawCenteredLines(page, nameLines.get(name) ?? [name], {
        font: bold,
        size: nameSize,
        cx: left + deskW / 2,
        cy: bottom + deskW / 2,
        color: ink ? BLACK : NAME_INK,
      });
    }
  }

  // ----- Teacher desk + door markers -----
  // Dashed pills, matching .marker on the canvas: uppercase, letter-spaced,
  // tinted. Previously the door was the bare word "Door" floating in white
  // space and the teacher was a grey box, neither of which read as a feature of
  // the room on paper.
  const drawMarker = (
    label: string,
    at: { x: number; y: number },
    fill: Color,
    border: Color,
    inkColor: Color,
  ): void => {
    const size = clamp(scale * 0.17, 5, 8.5);
    const textW = bold.widthOfTextAtSize(label, size);
    const padX = size * 1.1;
    const w = textW + 2 * padX;
    const h = size * 2.1;
    const cx = toX(at.x + 0.5);
    const cy = toY(at.y + 0.5);
    drawRoundedRect(page, cx - w / 2, cy - h / 2, w, h, h / 2, {
      fill: ink ? undefined : fill,
      border: ink ? BLACK : border,
      borderWidth: 1,
      dash: [2.5, 2],
    });
    // Letter-spaced by hand: pdf-lib has no tracking, and the canvas pills are
    // set at 0.06em, which is most of what makes them read as labels.
    const track = size * 0.06;
    const chars = [...label];
    const spacedW = chars.reduce((acc, ch) => acc + bold.widthOfTextAtSize(ch, size) + track, -track);
    let x = cx - spacedW / 2;
    for (const ch of chars) {
      page.drawText(ch, { x, y: cy - capOffset(size), size, font: bold, color: ink ? BLACK : inkColor });
      x += bold.widthOfTextAtSize(ch, size) + track;
    }
  };

  if (room.teacherDesk) {
    drawMarker('TEACHER', room.teacherDesk, TEACHER_FILL, TEACHER_BORDER, TEACHER_INK);
  }
  if (room.door) {
    drawMarker('DOOR', room.door, DOOR_FILL, DOOR_BORDER, DOOR_INK);
  }

  return doc.save();
}

// AP-style short months; matches the "Sept 2026" naming convention.

/** "Ms Rivera — Sept 2026.pdf", safe for every mainstream filesystem. */
// Lives in filenames.ts so components can name a download without pulling
// pdf-lib in; re-exported here because that is where callers expect it.
export { chartPdfFilename } from "./filenames";
