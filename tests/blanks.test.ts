import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { ALL_BLANKS, ATTENDANCE_BLANKS, BLANKS } from '../src/lib/blanks';
import type { CertFonts } from '../src/lib/pdfCerts';

// Same bytes the browser fetches. Baloo 2 must be the locally-instanced static
// build — the variable font breaks fontkit.
const fonts: CertFonts = {
  regular: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Regular.ttf')),
  bold: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Bold.ttf')),
  display: new Uint8Array(readFileSync('public/fonts/Baloo2-Display.ttf')),
};

describe('blank printables', () => {
  it('describes each blank with unique, complete metadata', () => {
    expect(new Set(BLANKS.map((b) => b.key)).size).toBe(BLANKS.length);
    expect(new Set(BLANKS.map((b) => b.filename)).size).toBe(BLANKS.length);
    for (const b of BLANKS) {
      expect(b.key).toMatch(/^[a-z0-9-]+$/);
      expect(b.label.trim()).not.toBe('');
      expect(b.hint.trim()).not.toBe('');
      expect(b.toolHref).toMatch(/^\/[a-z-]+\/$/);
      expect(b.toolLabel.trim()).not.toBe('');
    }
  });

  // The whole point of a blank is that the real renderer tolerates an empty
  // roster. Render every one for real rather than trusting that it does.
  for (const blank of BLANKS) {
    it(`renders ${blank.key} as a valid PDF with at least one page`, async () => {
      const bytes = await blank.render(fonts);
      expect(bytes.byteLength).toBeGreaterThan(1000);
      // %PDF- magic.
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    }, 30000);
  }

  it('leaves no student names on any blank sheet', async () => {
    // A blank must never leak the sample roster through a default somewhere.
    const forbidden = ['Ava', 'Liam', 'Zoë', 'Maya', 'Sample class'];
    for (const blank of BLANKS) {
      const bytes = await blank.render(fonts);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
      const text = new TextDecoder('latin1').decode(bytes);
      for (const name of forbidden) expect(text).not.toContain(name);
    }
  }, 60000);
});

describe('blank attendance roster variants', () => {
  it('offers distinct sizes, each with its own file name', () => {
    expect(new Set(ATTENDANCE_BLANKS.map((b) => b.key)).size).toBe(ATTENDANCE_BLANKS.length);
    // Two variants sharing a download name would silently overwrite each other
    // in the teacher's downloads folder.
    expect(new Set(ATTENDANCE_BLANKS.map((b) => b.filename)).size).toBe(ATTENDANCE_BLANKS.length);
    for (const b of ATTENDANCE_BLANKS) expect(b.toolHref).toBe('/attendance/');
  });

  it('is reachable by key from the download component', () => {
    // BlankDownload looks up ALL_BLANKS; a variant missing from it renders a
    // button that throws only when a visitor presses it.
    for (const b of ATTENDANCE_BLANKS) {
      expect(ALL_BLANKS.find((x) => x.key === b.key)).toBeTruthy();
    }
    expect(new Set(ALL_BLANKS.map((b) => b.key)).size).toBe(ALL_BLANKS.length);
    for (const b of BLANKS) expect(ALL_BLANKS).toContain(b);
  });

  // The selling point of every one of these is "one page". A row count that
  // silently spills onto a second sheet would break that promise in the only
  // place it matters — after the teacher has printed it.
  for (const blank of ATTENDANCE_BLANKS) {
    it(`renders ${blank.key} on exactly one page`, async () => {
      const bytes = await blank.render(fonts);
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
    }, 30000);
  }

  it('actually differs in paper size and orientation', async () => {
    const size = async (key: string) => {
      const spec = ATTENDANCE_BLANKS.find((b) => b.key === key)!;
      const doc = await PDFDocument.load(await spec.render(fonts));
      const { width, height } = doc.getPage(0).getSize();
      return { width: Math.round(width), height: Math.round(height) };
    };
    const letter = await size('attendance');
    const portrait = await size('attendance-portrait');
    const a4 = await size('attendance-a4');

    expect(letter.width).toBeGreaterThan(letter.height);
    expect(portrait.height).toBeGreaterThan(portrait.width);
    expect(a4).not.toEqual(letter);
  }, 60000);
});
