import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { renderJobsChartPdf, jobsPdfFilename } from '../src/lib/pdfJobs';
import type { JobEntry, JobsChartOptions } from '../src/lib/pdfJobs';

const fonts = {
  regular: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Regular.ttf')),
  bold: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Bold.ttf')),
  display: new Uint8Array(readFileSync('public/fonts/Baloo2-Display.ttf')),
};

const baseOpts: JobsChartOptions = {
  paper: 'letter',
  title: 'Our Classroom Jobs',
  weekLabel: 'Week of Sept 8',
  inkSaver: false,
  showFooter: true,
};

const entriesOf = (n: number): JobEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    title: `Job number ${i + 1}`,
    name: `Studentname Lastname${i + 1}`,
  }));

describe('renderJobsChartPdf', () => {
  it('renders one page at 8 jobs (2-column poster)', async () => {
    const { bytes, pages } = await renderJobsChartPdf(entriesOf(8), baseOpts, fonts);
    expect(pages).toBe(1);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('still renders one page at 20 jobs (3-column poster)', async () => {
    const { bytes, pages } = await renderJobsChartPdf(entriesOf(20), baseOpts, fonts);
    expect(pages).toBe(1);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('handles null names (unassigned jobs) without throwing', async () => {
    const entries: JobEntry[] = [
      { title: 'Line Leader', name: 'Zoe Chen' },
      { title: 'Door Holder', name: null },
      { title: 'Plant Waterer', name: null },
    ];
    const { bytes, pages } = await renderJobsChartPdf(entries, baseOpts, fonts);
    expect(pages).toBe(1);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('handles empty entries without throwing', async () => {
    const { bytes, pages } = await renderJobsChartPdf([], baseOpts, fonts);
    expect(pages).toBe(1);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('renders A4 + ink saver + no week label on one page', async () => {
    const opts: JobsChartOptions = {
      ...baseOpts,
      paper: 'a4',
      weekLabel: '',
      inkSaver: true,
      showFooter: false,
    };
    const { bytes } = await renderJobsChartPdf(entriesOf(13), opts, fonts);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('jobsPdfFilename', () => {
  it('builds a safe, readable filename', () => {
    expect(jobsPdfFilename('Period 3')).toBe('Period 3 — Jobs chart.pdf');
  });

  it('strips filesystem-illegal and control characters', () => {
    expect(jobsPdfFilename('P3: "A/B" <slips>|')).toBe('P3 AB slips — Jobs chart.pdf');
    // Control characters written as escaped ranges on purpose (never literal bytes).
    expect(jobsPdfFilename('A\u0000B\u001fC')).toBe('ABC — Jobs chart.pdf');
    expect(jobsPdfFilename('\u0009tabbed')).toBe('tabbed — Jobs chart.pdf');
  });

  it('falls back to Class when nothing survives cleaning', () => {
    expect(jobsPdfFilename('')).toBe('Class — Jobs chart.pdf');
    expect(jobsPdfFilename('::**')).toBe('Class — Jobs chart.pdf');
  });
});
