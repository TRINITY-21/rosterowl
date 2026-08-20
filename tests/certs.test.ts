import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { renderCertificatesPdf, certsPdfFilename } from '../src/lib/pdfCerts';
import type { CertOptions } from '../src/lib/pdfCerts';
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

const baseOpts: CertOptions = {
  paper: 'letter',
  award: 'Star Reader Award',
  message: 'for outstanding effort and remarkable growth in reading this year',
  dateLine: 'June 5, 2027',
  signedBy: 'Ms Rivera',
  inkSaver: false,
  showFooter: true,
  skipAbsent: false,
};

describe('renderCertificatesPdf', () => {
  it('renders one landscape page per student in a single PDF', async () => {
    const students = [
      stu('a', 'Zoë', 'Muñoz-García'),
      stu('b', 'Liam', "O'Brien"),
      stu('c', 'Wolfgang Amadeus', 'Extraordinarily-Longlastname III'),
    ];
    const { bytes, count } = await renderCertificatesPdf(students, baseOpts, fonts);
    expect(count).toBe(3);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    expect(w).toBeGreaterThan(h); // landscape
  });

  it('skips absent students when asked', async () => {
    const students = [stu('a', 'Ava', 'M'), stu('b', 'Ben', 'K', true)];
    const withAbsent = await renderCertificatesPdf(students, baseOpts, fonts);
    const without = await renderCertificatesPdf(students, { ...baseOpts, skipAbsent: true }, fonts);
    expect(withAbsent.count).toBe(2);
    expect(without.count).toBe(1);
  });

  it('handles empty message/date/signature without throwing', async () => {
    const { count } = await renderCertificatesPdf(
      [stu('a', 'Ava', '')],
      { ...baseOpts, message: '', dateLine: '', signedBy: '' },
      fonts
    );
    expect(count).toBe(1);
  });
});

describe('certsPdfFilename', () => {
  it('keeps spaces and hyphens, strips illegal chars and leading dots', () => {
    expect(certsPdfFilename('Period 3 — English', 'Star Reader Award')).toBe(
      'Period 3 — English — Star Reader Award.pdf'
    );
    expect(certsPdfFilename('.we/ird:na*me', 'A?ward')).toBe('weirdname — Award.pdf');
  });
});
