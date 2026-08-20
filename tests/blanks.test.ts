import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { BLANKS } from '../src/lib/blanks';
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
