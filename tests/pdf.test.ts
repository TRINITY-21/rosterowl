import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { chartPdfFilename, renderChartPdf } from '../src/lib/pdf';
import type { ClassData, Id, PdfFonts, PdfOptions, Room } from '../src/lib/types';

function fontBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`../public/fonts/${name}`, import.meta.url))));
}

const fonts: PdfFonts = {
  regular: fontBytes('AtkinsonHyperlegible-Regular.ttf'),
  bold: fontBytes('AtkinsonHyperlegible-Bold.ttf'),
};

// 6 desks: one 4-desk table group, two loose row desks; teacher desk + door.
function makeRoom(): Room {
  return {
    id: 'room1',
    name: 'Room 12',
    desks: [
      { id: 'd1', x: 1, y: 2, groupId: 'g1', zones: [] },
      { id: 'd2', x: 2.1, y: 2, groupId: 'g1', zones: [] },
      { id: 'd3', x: 1, y: 3.1, groupId: 'g1', zones: [] },
      { id: 'd4', x: 2.1, y: 3.1, groupId: 'g1', zones: [] },
      { id: 'd5', x: 5, y: 2, groupId: null, zones: [] },
      { id: 'd6', x: 5, y: 3.5, groupId: null, zones: ['near-teacher'] },
    ],
    teacherDesk: { x: 3, y: 0.5 },
    door: { x: 6, y: 0.5 },
  };
}

// 5 students seated on d1–d5; d6 stays empty.
function makeClass(): ClassData {
  return {
    id: 'c1',
    name: 'Period 3',
    roomId: 'room1',
    students: [
      { id: 's1', first: 'Ava', last: 'Nguyen', absent: false, zonePref: null },
      { id: 's2', first: 'Ben', last: 'Ortiz', absent: false, zonePref: 'near-teacher' },
      { id: 's3', first: 'Cleo', last: 'Park', absent: false, zonePref: null },
      { id: 's4', first: 'Dev', last: 'Shah', absent: false, zonePref: null },
      { id: 's5', first: 'Elle', last: 'Kim', absent: false, zonePref: null },
    ],
    apart: [],
    together: [],
    seating: { d1: 's1', d2: 's2', d3: 's3', d4: 's4', d5: 's5' },
    locked: [],
    pickerHistory: [],
    jobs: { titles: [], wheel: [], offset: 0 },
    wordLists: { bingo: '', flashcards: '' },
  };
}

function makeNames(): Map<Id, string> {
  return new Map<Id, string>([
    ['s1', 'Ava N.'],
    ['s2', 'Ben O.'],
    ['s3', 'Cleo P.'],
    ['s4', 'Dev S.'],
    ['s5', 'Elle K.'],
  ]);
}

function makeOpts(over: Partial<PdfOptions> = {}): PdfOptions {
  return {
    paper: 'letter',
    orientation: 'landscape',
    nameScale: 1,
    inkSaver: false,
    showFooter: true,
    title: 'Period 3',
    subtitle: 'Room 12 — Aug 19, 2026',
    ...over,
  };
}

function header(bytes: Uint8Array): string {
  return new TextDecoder('ascii').decode(bytes.slice(0, 5));
}

describe('renderChartPdf', () => {
  it('produces a valid one-page letter-landscape PDF', async () => {
    const bytes = await renderChartPdf(makeRoom(), makeClass(), makeNames(), makeOpts(), fonts);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(header(bytes)).toBe('%PDF-');

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(792, 1);
    expect(height).toBeCloseTo(612, 1);
  });

  it('respects a4 portrait page size', async () => {
    const bytes = await renderChartPdf(
      makeRoom(),
      makeClass(),
      makeNames(),
      makeOpts({ paper: 'a4', orientation: 'portrait' }),
      fonts,
    );
    const doc = await PDFDocument.load(bytes);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });

  it('renders diacritic names (Zoë, José) without throwing', async () => {
    const names = makeNames();
    names.set('s1', 'Zoë Müller');
    names.set('s2', 'José R.');
    const bytes = await renderChartPdf(makeRoom(), makeClass(), names, makeOpts(), fonts);
    expect(header(bytes)).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('renders in ink-saver mode with footer off', async () => {
    const bytes = await renderChartPdf(
      makeRoom(),
      makeClass(),
      makeNames(),
      makeOpts({ inkSaver: true, showFooter: false }),
      fonts,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('handles nameScale extremes and very long names', async () => {
    const names = makeNames();
    names.set('s3', 'Maximiliana Konstantinopolous-Featherstonehaugh');
    for (const nameScale of [0.75, 1.6]) {
      const bytes = await renderChartPdf(makeRoom(), makeClass(), names, makeOpts({ nameScale }), fonts);
      expect(header(bytes)).toBe('%PDF-');
    }
  });

  it('renders a room with no desks or markers', async () => {
    const room: Room = { id: 'r0', name: 'Empty', desks: [], teacherDesk: null, door: null };
    const cls: ClassData = { ...makeClass(), seating: {} };
    const bytes = await renderChartPdf(room, cls, new Map(), makeOpts(), fonts);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('skips desks whose occupant has no display name', async () => {
    const names = makeNames();
    names.delete('s5'); // seated on d5, but no display name -> drawn as empty desk
    const bytes = await renderChartPdf(makeRoom(), makeClass(), names, makeOpts(), fonts);
    expect(header(bytes)).toBe('%PDF-');
  });
});

describe('chartPdfFilename', () => {
  it('formats className, em dash, short month and year', () => {
    expect(chartPdfFilename('Ms Rivera', new Date(2026, 8, 15))).toBe('Ms Rivera — Sept 2026.pdf');
    expect(chartPdfFilename('Period 3', new Date(2026, 0, 2))).toBe('Period 3 — Jan 2026.pdf');
    expect(chartPdfFilename('Bio', new Date(2027, 5, 30))).toBe('Bio — June 2027.pdf');
  });

  it('strips filesystem-unsafe characters', () => {
    const name = chartPdfFilename('A/B\\C:D*E?F"G<H>I|J', new Date(2026, 0, 1));
    expect(name).toBe('ABCDEFGHIJ — Jan 2026.pdf');
    for (const ch of ['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
      expect(name.includes(ch)).toBe(false);
    }
  });

  it('collapses whitespace and falls back when nothing survives', () => {
    expect(chartPdfFilename('  Ms   Rivera  ', new Date(2026, 8, 1))).toBe('Ms Rivera — Sept 2026.pdf');
    expect(chartPdfFilename('///???', new Date(2026, 8, 1))).toBe('Seating chart — Sept 2026.pdf');
  });

  it('defaults to the current date', () => {
    const now = new Date();
    const name = chartPdfFilename('Math');
    expect(name.endsWith(`${now.getFullYear()}.pdf`)).toBe(true);
  });
});
