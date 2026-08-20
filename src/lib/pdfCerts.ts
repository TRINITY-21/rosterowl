// Whole-class award certificates: one page per student, one PDF.
// Formal full names (never the disambiguated short forms), names only — the
// same privacy rule as every other export.

import { PDFDocument, rgb } from 'pdf-lib';
import type { Color, PDFFont, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PdfFonts, Student } from './types';

export interface CertOptions {
  paper: 'letter' | 'a4';
  /** e.g. "Star Reader Award", "Certificate of Achievement" */
  award: string;
  /** e.g. "for outstanding effort and achievement in 4th grade" */
  message: string;
  /** Freeform date line, e.g. "June 5, 2027" */
  dateLine: string;
  /** Name printed under the signature line, e.g. "Ms Rivera" */
  signedBy: string;
  inkSaver: boolean;
  showFooter: boolean;
  skipAbsent: boolean;
}

export interface CertFonts extends PdfFonts {
  /** Display face for the award title and student name (Baloo 2). */
  display: Uint8Array;
}

const PAGE_SIZES: Record<CertOptions['paper'], [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const GREEN = rgb(0.18, 0.42, 0.31);
const MARIGOLD = rgb(0.91, 0.63, 0.24);
const INK = rgb(0.14, 0.2, 0.19);
const GRAY = rgb(0.4, 0.46, 0.44);
const FAINT = rgb(0.62, 0.62, 0.62);
const BLACK = rgb(0, 0, 0);

function fit(font: PDFFont, text: string, maxW: number, max: number): number {
  const unitW = font.widthOfTextAtSize(text, 1);
  if (unitW <= 0) return max;
  return Math.min(max, maxW / unitW);
}

function centered(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color: Color) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (page.getWidth() - w) / 2, y, size, font, color });
}

/** Greedy word-wrap into at most `maxLines` centered lines. */
function wrapCentered(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  topY: number,
  maxW: number,
  color: Color,
  maxLines = 3,
): number {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const attempt = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(attempt, size) <= maxW || !cur) cur = attempt;
    else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (cur) lines.push(cur);
  let y = topY;
  for (const line of lines.slice(0, maxLines)) {
    centered(page, line, font, size, y, color);
    y -= size * 1.45;
  }
  return y;
}

export async function renderCertificatesPdf(
  students: Student[],
  opts: CertOptions,
  fonts: CertFonts,
): Promise<{ bytes: Uint8Array; count: number }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const body = await doc.embedFont(fonts.regular, { subset: true });
  const bodyBold = await doc.embedFont(fonts.bold, { subset: true });
  // Baloo 2 must be a locally-instanced static TTF (fonttools instancer):
  // both the gstatic build and the raw variable font break fontkit.
  const display = await doc.embedFont(fonts.display, { subset: false });

  const [shortSide, longSide] = PAGE_SIZES[opts.paper];
  // Certificates are always landscape.
  const pageW = longSide;
  const pageH = shortSide;
  const ink = opts.inkSaver;

  const recipients = students.filter((s) => !(opts.skipAbsent && s.absent));

  for (const student of recipients) {
    const page = doc.addPage([pageW, pageH]);
    const fullName = `${student.first} ${student.last}`.trim();

    // Double border
    page.drawRectangle({
      x: 24, y: 24, width: pageW - 48, height: pageH - 48,
      borderColor: ink ? BLACK : MARIGOLD, borderWidth: ink ? 1.5 : 3,
    });
    page.drawRectangle({
      x: 34, y: 34, width: pageW - 68, height: pageH - 68,
      borderColor: ink ? BLACK : GREEN, borderWidth: 1,
    });
    if (!ink) {
      // Corner dots, a quiet nod to the desk grid.
      for (const [cx, cy] of [[46, 46], [pageW - 46, 46], [46, pageH - 46], [pageW - 46, pageH - 46]] as const) {
        page.drawCircle({ x: cx, y: cy, size: 4, color: MARIGOLD });
      }
    }

    const contentW = pageW - 160;

    // Award title
    const awardSize = Math.max(20, fit(display, opts.award, contentW, 34));
    centered(page, opts.award, display, awardSize, pageH - 130, ink ? BLACK : GREEN);

    centered(page, 'proudly presented to', body, 12, pageH - 165, ink ? BLACK : GRAY);

    // Student name — the star of the page
    const nameSize = Math.max(24, fit(display, fullName, contentW, 52));
    centered(page, fullName, display, nameSize, pageH - 165 - nameSize - 28, ink ? BLACK : INK);

    // Accent rule under the name
    const ruleY = pageH - 165 - nameSize - 46;
    page.drawLine({
      start: { x: pageW / 2 - 110, y: ruleY },
      end: { x: pageW / 2 + 110, y: ruleY },
      thickness: 1.5,
      color: ink ? BLACK : MARIGOLD,
    });

    // Message
    if (opts.message.trim()) {
      wrapCentered(page, opts.message.trim(), body, 13, ruleY - 30, contentW, ink ? BLACK : GRAY);
    }

    // Bottom row: date (left) and signature (right)
    const lineY = 92;
    const lineW = 180;
    const leftX = 110;
    const rightX = pageW - 110 - lineW;
    for (const x of [leftX, rightX]) {
      page.drawLine({
        start: { x, y: lineY }, end: { x: x + lineW, y: lineY },
        thickness: 0.8, color: ink ? BLACK : GRAY,
      });
    }
    if (opts.dateLine.trim()) {
      const t = opts.dateLine.trim();
      const s = fit(body, t, lineW - 10, 12);
      page.drawText(t, { x: leftX + (lineW - body.widthOfTextAtSize(t, s)) / 2, y: lineY + 6, size: s, font: bodyBold, color: ink ? BLACK : INK });
    }
    if (opts.signedBy.trim()) {
      const t = opts.signedBy.trim();
      const s = fit(body, t, lineW - 10, 12);
      page.drawText(t, { x: rightX + (lineW - body.widthOfTextAtSize(t, s)) / 2, y: lineY + 6, size: s, font: bodyBold, color: ink ? BLACK : INK });
    }
    const dateLabel = 'date';
    const sigLabel = 'signature';
    page.drawText(dateLabel, { x: leftX + (lineW - body.widthOfTextAtSize(dateLabel, 9)) / 2, y: lineY - 14, size: 9, font: body, color: ink ? BLACK : GRAY });
    page.drawText(sigLabel, { x: rightX + (lineW - body.widthOfTextAtSize(sigLabel, 9)) / 2, y: lineY - 14, size: 9, font: body, color: ink ? BLACK : GRAY });

    if (opts.showFooter) {
      // Centred along the bottom, inside the frame. At (40, 40) it landed on
      // top of both border rules and the bottom-left corner dot — the one place
      // on the page guaranteed to have something already drawn on it.
      const mark = 'Made with RosterOwl — rosterowl.com';
      page.drawText(mark, {
        x: (pageW - body.widthOfTextAtSize(mark, 7)) / 2,
        y: 44,
        size: 7,
        font: body,
        color: FAINT,
      });
    }
  }

  return { bytes: await doc.save(), count: recipients.length };
}

// Lives in filenames.ts so components can name a download without pulling
// pdf-lib in; re-exported here because that is where callers expect it.
export { certsPdfFilename } from "./filenames";
