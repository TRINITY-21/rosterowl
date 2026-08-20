import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import {
  renderAttendancePdf,
  attendancePdfFilename,
  schoolDays,
} from '../src/lib/pdfAttendance';
import type { AttendanceOptions } from '../src/lib/pdfAttendance';
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

const baseOpts: AttendanceOptions = {
  paper: 'letter',
  orientation: 'landscape',
  year: 2026,
  month: 8, // September 2026
  nameOrder: 'last',
  inkSaver: false,
  showFooter: true,
  subtitle: 'Period 3',
};

const roster = [
  stu('a', 'Zoë', 'Chen'),
  stu('b', 'Liam', "O'Brien", true),
  stu('c', 'Ava', 'Martinez'),
  stu('d', 'Solo', ''),
];

describe('schoolDays', () => {
  it('finds the 20 weekdays of February 2026, starting Mon Feb 2', () => {
    // Feb 1 2026 is a Sunday, so the first school day is Monday the 2nd.
    const days = schoolDays(2026, 1);
    expect(days).toHaveLength(20);
    expect(days[0]).toEqual({ day: 2, weekday: 'M' });
  });

  it('finds the 22 weekdays of September 2026', () => {
    expect(schoolDays(2026, 8)).toHaveLength(22);
  });

  it('never includes a Saturday or Sunday', () => {
    for (const [y, m] of [[2026, 0], [2026, 5], [2026, 11], [2027, 1], [2027, 7]] as const) {
      for (const { day } of schoolDays(y, m)) {
        const dow = new Date(y, m, day).getDay();
        expect(dow).toBeGreaterThanOrEqual(1);
        expect(dow).toBeLessThanOrEqual(5);
      }
    }
  });

  it('uses single weekday letters M/T/W/T/F', () => {
    const letters = new Set(schoolDays(2026, 8).map((d) => d.weekday));
    expect([...letters].sort()).toEqual(['F', 'M', 'T', 'W']);
    expect(schoolDays(2026, 8).every((d) => d.weekday.length === 1)).toBe(true);
  });
});

describe('renderAttendancePdf', () => {
  it('renders a single-page loadable PDF with every student and school day', async () => {
    const { bytes, rows, days } = await renderAttendancePdf(roster, baseOpts, fonts);
    expect(rows).toBe(4); // absent students are still on the register
    expect(days).toBe(22);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('renders in ink-saver portrait without throwing', async () => {
    const { bytes } = await renderAttendancePdf(
      roster,
      { ...baseOpts, inkSaver: true, orientation: 'portrait' },
      fonts
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('handles an empty roster: rows 0, still loadable', async () => {
    const { bytes, rows, days } = await renderAttendancePdf([], baseOpts, fonts);
    expect(rows).toBe(0);
    expect(days).toBe(22);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

// Regression pattern (from the checklist review finding): a row-height floor
// let big rosters slide off the page. Rows must always fit — geometry is exact
// when rowH = bodyH/n, and day columns divide the remaining width the same way.
describe('renderAttendancePdf one-page guarantee', () => {
  it('fits 60 students portrait and 48 landscape without a second page', async () => {
    for (const [n, orientation] of [[60, 'portrait'], [48, 'landscape']] as const) {
      const big = Array.from({ length: n }, (_, i) => stu(`s${i}`, `Kid${i}`, `Lastname${i}`));
      const { bytes, rows, days } = await renderAttendancePdf(big, { ...baseOpts, orientation }, fonts);
      expect(rows).toBe(n);
      expect(days).toBe(22);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
    }
  });
});

describe('attendancePdfFilename', () => {
  it('builds a safe, readable filename', () => {
    expect(attendancePdfFilename('Period 3', 2026, 8)).toBe(
      'Period 3 — Attendance September 2026.pdf'
    );
  });

  it('strips illegal filename characters', () => {
    expect(attendancePdfFilename('Rm 12: A/B "Block"?', 2026, 1)).toBe(
      'Rm 12 AB Block — Attendance February 2026.pdf'
    );
    expect(attendancePdfFilename(`Bell${String.fromCharCode(7)} <Class>|*`, 2026, 0)).toBe(
      'Bell Class — Attendance January 2026.pdf'
    );
  });

  it('falls back to "Class" when nothing survives cleaning', () => {
    expect(attendancePdfFilename('///', 2026, 0)).toBe('Class — Attendance January 2026.pdf');
  });
});

// Regression (review): names outside Atkinson's Latin cmap would silently
// print as .notdef boxes — the renderer must report them so the UI can warn.
describe('renderAttendancePdf unrenderable names', () => {
  it('flags non-Latin names and leaves Latin ones (incl. diacritics) alone', async () => {
    const roster = [
      stu('a', 'Zo\u00eb', 'Chen'),
      stu('b', 'Liam', "O'Brien"),
      stu('c', '\u5c0f\u660e', '\u738b'),
    ];
    const { unrenderable } = await renderAttendancePdf(roster, baseOpts, fonts);
    expect(unrenderable).toHaveLength(1);
    expect(unrenderable[0]).toContain('\u5c0f\u660e');
    const clean = await renderAttendancePdf(roster.slice(0, 2), baseOpts, fonts);
    expect(clean.unrenderable).toEqual([]);
  });

  it('reports on the empty-roster path too', async () => {
    const { unrenderable } = await renderAttendancePdf([], baseOpts, fonts);
    expect(unrenderable).toEqual([]);
  });
});
