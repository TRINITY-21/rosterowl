// One-page groups PDF: numbered group boxes with member names.
// Same privacy rule as the chart: names only.

import { PDFDocument, rgb } from 'pdf-lib';
import { capOffset, uniformSize } from './pdfText';
import type { Color, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Id, PdfFonts, PdfOptions, Student } from './types';

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

  // Name size: one size for every group, set by the longest name and by the
  // fullest group. The caps here used to be 15pt of line and 12pt of type
  // regardless of box size, which left a four-name group sitting in the top
  // third of a half-page card with nothing beneath it. They now scale with the
  // box, so a short list prints large and a long one still fits.
  const headH = Math.min(26, boxH * 0.16);
  const bodyH = boxH - headH - 14;
  const lineH = Math.max(9, Math.min(36, bodyH / Math.max(1, maxMembers)));
  const allNames = groups.flatMap((g) => g.map((st) => displayNames.get(st.id) ?? st.first));
  const nameSize = uniformSize(regular, allNames, boxW - 20, {
    max: Math.min(28, lineH * 0.74) * opts.nameScale,
    min: 6,
  });

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
      y: top - headH + (headH - 11) / 2 - 2,
      size: 11,
      font: bold,
      color: ink ? BLACK : GREEN,
    });
    const members = groups[i]!;
    // Centre this group's own names in the card body: a group of three in a
    // grid sized for four should sit centred, not leave a gap at the bottom.
    const ownH = members.length * lineH;
    const bodyTop = top - headH - 4;
    const startY = bodyTop - (bodyH - ownH) / 2;
    for (let m = 0; m < members.length; m++) {
      const name = displayNames.get(members[m]!.id) ?? members[m]!.first;
      // Each name sits optically centred in its own line slot.
      const slotCentre = startY - m * lineH - lineH / 2;
      page.drawText(name, {
        x: x + 10,
        y: slotCentre - capOffset(nameSize),
        size: nameSize,
        font: regular,
        color: ink ? BLACK : TITLE_INK,
      });
    }
  }

  return doc.save();
}

/** "Period 2 — groups.pdf", matching the other generators' naming. */
// Lives in filenames.ts so components can name a download without pulling
// pdf-lib in; re-exported here because that is where callers expect it.
export { groupsPdfFilename } from "./filenames";
