import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import {
  renderChecklistPdf,
  checklistPdfFilename,
  orderedNames,
} from '../src/lib/pdfChecklist';
import type { ChecklistOptions } from '../src/lib/pdfChecklist';
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
};

const baseOpts: ChecklistOptions = {
  paper: 'letter',
  orientation: 'portrait',
  title: 'Homework — Week of Sept 8',
  subtitle: 'Period 3 · fall term',
  columns: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  nameOrder: 'last',
  includeAbsent: true,
  inkSaver: false,
  showFooter: true,
};

const roster = [
  stu('a', 'Zoë', 'Chen'),
  stu('b', 'Liam', "O'Brien", true),
  stu('c', 'Ava', 'Martinez'),
  stu('d', 'Solo', ''),
];

describe('orderedNames', () => {
  it('keeps roster order by default', () => {
    expect(orderedNames(roster, 'roster').map((r) => r.label)).toEqual([
      'Zoë Chen',
      "Liam O'Brien",
      'Ava Martinez',
      'Solo',
    ]);
  });
  it('sorts by last name with Last, First labels', () => {
    const labels = orderedNames(roster, 'last').map((r) => r.label);
    expect(labels[0]).toBe('Chen, Zoë');
    expect(labels).toContain('Solo'); // missing last name keeps plain label
  });
  it('sorts by first name', () => {
    expect(orderedNames(roster, 'first')[0]!.label).toBe('Ava Martinez');
  });
});

describe('renderChecklistPdf', () => {
  it('renders a single-page loadable PDF with all students', async () => {
    const { bytes, rows } = await renderChecklistPdf(roster, baseOpts, fonts);
    expect(rows).toBe(4);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('can exclude absent students', async () => {
    const { rows } = await renderChecklistPdf(roster, { ...baseOpts, includeAbsent: false }, fonts);
    expect(rows).toBe(3);
  });

  it('stays on one page even with a huge roster and many columns', async () => {
    const big = Array.from({ length: 40 }, (_, i) => stu(`s${i}`, `Kid${i}`, `Lastname${i}`));
    const { bytes, rows } = await renderChecklistPdf(
      big,
      { ...baseOpts, columns: Array.from({ length: 10 }, (_, i) => `W${i + 1}`), orientation: 'landscape' },
      fonts
    );
    expect(rows).toBe(40);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('handles zero columns and empty roster without throwing', async () => {
    const a = await renderChecklistPdf(roster, { ...baseOpts, columns: [] }, fonts);
    expect(a.rows).toBe(4);
    const b = await renderChecklistPdf([], baseOpts, fonts);
    expect(b.rows).toBe(0);
  });
});

describe('checklistPdfFilename', () => {
  it('builds a safe, readable filename', () => {
    expect(checklistPdfFilename('Period 3', 'Permission slips')).toBe(
      'Period 3 — Permission slips.pdf'
    );
  });
});

// Regression (review finding): the 11pt row-height floor let big rosters slide
// off the page. Rows must always fit — geometry is exact when rowH = bodyH/n.
describe('renderChecklistPdf one-page guarantee', () => {
  it('fits 60 students portrait and 48 landscape without a second page', async () => {
    for (const [n, orientation] of [[60, 'portrait'], [48, 'landscape']] as const) {
      const big = Array.from({ length: n }, (_, i) => stu(`s${i}`, `Kid${i}`, `Lastname${i}`));
      const { bytes, rows } = await renderChecklistPdf(big, { ...baseOpts, orientation }, fonts);
      expect(rows).toBe(n);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
    }
  });
});
