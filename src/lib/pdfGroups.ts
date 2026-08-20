// One-page groups PDF: numbered group boxes with member names.
// Same privacy rule as the chart: names only.

import { PDFDocument, rgb } from 'pdf-lib';
import type { Color, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Id, PdfFonts, PdfOptions, Student } from './types';
import { safeFilename } from './filenames';

const PAGE_SIZES: Record<PdfOptions['paper'], [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};
const MARGIN = 36;
const GREEN = rgb(0.18, 0.42, 0.31);
const TITLE_INK = rgb(0.13, 0.16, 0.14);
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.45, 0.45, 0.45);
const FAINT_GRAY = rgb(0.62, 0.62, 0.62);
const BOX_FILL = rgb(0.98, 0.97, 0.94);
const BOX_BORDER = rgb(0.72, 0.69, 0.62);

function fit(font: PDFFont, text: string, maxW: number, max: number): number {
  const unitW = font.widthOfTextAtSize(text, 1);
  if (unitW <= 0) return max;
  return Math.min(max, maxW / unitW);
}

export async function renderGroupsPdf(
  groups: Student[][],
  displayNames: Map<Id, string>,
  opts: PdfOptions,
  fonts: PdfFonts,
): Promise<Uint8Array> {
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
  const contentW = pageW - 2 * MARGIN;

  // Header
  let y = pageH - MARGIN;
  const titleSize = Math.max(12, fit(bold, opts.title, contentW, 20));
  y -= titleSize;
  if (opts.title) {
    page.drawText(opts.title, { x: MARGIN, y, size: titleSize, font: bold, color: ink ? BLACK : TITLE_INK });
  }
  if (opts.subtitle) {
    y -= 16;
    page.drawText(opts.subtitle, { x: MARGIN, y, size: 11, font: regular, color: GRAY });
  }
  y -= 12;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: pageW - MARGIN, y },
    thickness: 1.5,
    color: ink ? BLACK : GREEN,
  });

  if (opts.showFooter) {
    page.drawText('Made with RosterOwl — rosterowl.com', {
      x: MARGIN,
      y: 14,
      size: 7.5,
      font: regular,
      color: FAINT_GRAY,
    });
  }

  const G = groups.length;
  if (G === 0) return doc.save();

  // Grid of boxes sized to fit one page.
  const areaTop = y - 14;
  const areaBottom = MARGIN + 10;
  const areaH = areaTop - areaBottom;
  const maxMembers = Math.max(...groups.map((g) => g.length));
  const cols = Math.max(1, Math.min(G, Math.round(Math.sqrt((G * contentW) / areaH / 1.4)) || 1));
  const rows = Math.ceil(G / cols);
  const gap = 12;
  const boxW = (contentW - gap * (cols - 1)) / cols;
  const boxH = (areaH - gap * (rows - 1)) / rows;

  // Name size: fit the tallest member list and the widest name.
  const headH = 20;
  const lineH = Math.max(9, Math.min(15, (boxH - headH - 12) / Math.max(1, maxMembers)));
  let nameSize = Math.min(12, lineH * 0.78) * opts.nameScale;
  for (const g of groups) {
    for (const s of g) {
      nameSize = Math.min(nameSize, fit(regular, displayNames.get(s.id) ?? s.first, boxW - 20, nameSize));
    }
  }
  nameSize = Math.max(6, nameSize);

  const boxColor: Color | undefined = ink ? undefined : BOX_FILL;
  for (let i = 0; i < G; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (boxW + gap);
    const top = areaTop - row * (boxH + gap);
    page.drawRectangle({
      x,
      y: top - boxH,
      width: boxW,
      height: boxH,
      color: boxColor,
      borderColor: ink ? BLACK : BOX_BORDER,
      borderWidth: 1,
    });
    const label = `Group ${i + 1}`;
    page.drawText(label, {
      x: x + 10,
      y: top - 16,
      size: 11,
      font: bold,
      color: ink ? BLACK : GREEN,
    });
    const members = groups[i]!;
    for (let m = 0; m < members.length; m++) {
      const name = displayNames.get(members[m]!.id) ?? members[m]!.first;
      page.drawText(name, {
        x: x + 10,
        y: top - headH - 8 - m * lineH - nameSize,
        size: nameSize,
        font: regular,
        color: ink ? BLACK : TITLE_INK,
      });
    }
  }

  return doc.save();
}

/** "Period 2 — groups.pdf", matching the other generators' naming. */
export function groupsPdfFilename(className: string): string {
  return `${safeFilename(className)} — groups.pdf`;
}
