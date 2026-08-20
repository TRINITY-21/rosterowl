import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { renderNameTagsPdf, nameTagsPdfFilename } from '../src/lib/pdfNameTags';
import type { NameTagOptions } from '../src/lib/pdfNameTags';
import type { Student } from '../src/lib/types';

const stu = (id: string, first: string, last: string, absent = false): Student => ({
  id,
  first,
  last,
  absent,
  zonePref: null,
});

const fonts = {
  regular: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Regular.ttf')),
  bold: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Bold.ttf')),
  display: new Uint8Array(readFileSync('public/fonts/Baloo2-Display.ttf')),
};

const baseOpts: NameTagOptions = {
  paper: 'letter',
  style: 'desk-plate',
  showLastName: true,
  cornerLabel: 'Period 3',
  inkSaver: false,
  skipAbsent: false,
  showCutLines: true,
};

const roster = (n: number): Student[] =>
  Array.from({ length: n }, (_, i) => stu(`s${i}`, `First${i}`, `Last${i}`));

describe('renderNameTagsPdf', () => {
  it('imposes 2 desk plates per landscape page', async () => {
    const { bytes, count, pages } = await renderNameTagsPdf(roster(5), baseOpts, fonts);
    expect(count).toBe(5);
    expect(pages).toBe(3);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight()); // landscape
  });

  it('imposes 8 badges per portrait page', async () => {
    const opts: NameTagOptions = { ...baseOpts, style: 'badge-8up' };
    const { bytes, count, pages } = await renderNameTagsPdf(roster(9), opts, fonts);
    expect(count).toBe(9);
    expect(pages).toBe(2);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getHeight()).toBeGreaterThan(doc.getPage(0).getWidth()); // portrait
  });

  it('skips absent students when asked', async () => {
    const students = [stu('a', 'Ava', 'M'), stu('b', 'Ben', 'K', true), stu('c', 'Cal', 'D')];
    const withAbsent = await renderNameTagsPdf(students, baseOpts, fonts);
    const without = await renderNameTagsPdf(students, { ...baseOpts, skipAbsent: true }, fonts);
    expect(withAbsent.count).toBe(3);
    expect(without.count).toBe(2);
    expect(without.pages).toBe(1);
  });

  it('handles diacritics without throwing', async () => {
    const students = [stu('a', 'Zoë', 'Muñoz-García'), stu('b', 'José', 'Ibáñez')];
    for (const style of ['desk-plate', 'badge-8up'] as const) {
      const { count } = await renderNameTagsPdf(students, { ...baseOpts, style }, fonts);
      expect(count).toBe(2);
    }
  });

  it('renders an empty roster as an empty document without throwing', async () => {
    const { count, pages } = await renderNameTagsPdf([], baseOpts, fonts);
    expect(count).toBe(0);
    expect(pages).toBe(0);
  });

  it('supports a4, ink saver, no last names, no cut lines, no label', async () => {
    const opts: NameTagOptions = {
      ...baseOpts,
      paper: 'a4',
      style: 'badge-8up',
      showLastName: false,
      cornerLabel: '',
      inkSaver: true,
      showCutLines: false,
    };
    const { bytes, pages } = await renderNameTagsPdf(roster(8), opts, fonts);
    expect(pages).toBe(1);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1); // a4 portrait
  });
});

describe('nameTagsPdfFilename', () => {
  it('labels each style', () => {
    expect(nameTagsPdfFilename('Period 3', 'desk-plate')).toBe('Period 3 — Desk plates.pdf');
    expect(nameTagsPdfFilename('Period 3', 'badge-8up')).toBe('Period 3 — Name tags.pdf');
  });

  it('keeps spaces and hyphens, strips illegal chars and leading dots', () => {
    expect(nameTagsPdfFilename('Period 3 — English', 'desk-plate')).toBe(
      'Period 3 — English — Desk plates.pdf'
    );
    expect(nameTagsPdfFilename('.we/ird:na*me', 'badge-8up')).toBe('weirdname — Name tags.pdf');
    expect(nameTagsPdfFilename('', 'desk-plate')).toBe('Class — Desk plates.pdf');
  });
});
