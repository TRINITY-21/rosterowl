import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import {
  renderFlashcardsPdf,
  flashcardsPdfFilename,
  parseItems,
} from '../src/lib/pdfFlashcards';
import type { FlashcardOptions } from '../src/lib/pdfFlashcards';

const fonts = {
  regular: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Regular.ttf')),
  bold: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Bold.ttf')),
  display: new Uint8Array(readFileSync('public/fonts/Baloo2-Display.ttf')),
};

const baseOpts: FlashcardOptions = {
  paper: 'letter',
  size: 'large',
  showCutLines: true,
  cornerLabel: 'Period 3',
  inkSaver: false,
};

const items = (n: number): string[] => Array.from({ length: n }, (_, i) => `Word${i}`);

describe('parseItems', () => {
  it('splits one item per line, trims, and drops blank lines', () => {
    expect(parseItems('  cat \n\ndog\r\n\r\n  \nsun  ')).toEqual(['cat', 'dog', 'sun']);
  });

  it('KEEPS duplicates — a sight-word list may legitimately repeat', () => {
    expect(parseItems('the\nthe\nthe\nand')).toEqual(['the', 'the', 'the', 'and']);
  });
});

describe('renderFlashcardsPdf page-count math (22 items)', () => {
  it('fills 6 pages at 4-up (large)', async () => {
    const { bytes, count, pages } = await renderFlashcardsPdf(items(22), baseOpts, fonts);
    expect(count).toBe(22);
    expect(pages).toBe(6);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(6);
    expect(doc.getPage(0).getHeight()).toBeGreaterThan(doc.getPage(0).getWidth()); // portrait
  });

  it('fills 11 pages at 2-up (jumbo, landscape)', async () => {
    const opts: FlashcardOptions = { ...baseOpts, size: 'jumbo' };
    const { pages, bytes } = await renderFlashcardsPdf(items(22), opts, fonts);
    expect(pages).toBe(11);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(11);
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight()); // landscape
  });

  it('fills 3 pages at 8-up (small)', async () => {
    const opts: FlashcardOptions = { ...baseOpts, size: 'small' };
    const { pages, bytes } = await renderFlashcardsPdf(items(22), opts, fonts);
    expect(pages).toBe(3);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
  });
});

describe('renderFlashcardsPdf content handling', () => {
  it('renders duplicate items as separate cards', async () => {
    const { count, pages } = await renderFlashcardsPdf(
      ['the', 'the', 'the'],
      { ...baseOpts, size: 'jumbo' },
      fonts,
    );
    expect(count).toBe(3);
    expect(pages).toBe(2);
  });

  it('splits a long phrase onto two lines without throwing and stays loadable', async () => {
    const long = 'What is the capital of the United States of America?';
    for (const size of ['jumbo', 'large', 'small'] as const) {
      const { bytes } = await renderFlashcardsPdf([long], { ...baseOpts, size }, fonts);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
    }
  });

  it('handles a long single word with no spaces (shrinks, never wraps)', async () => {
    const { bytes } = await renderFlashcardsPdf(
      ['antidisestablishmentarianism'],
      { ...baseOpts, size: 'small' },
      fonts,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('renders diacritics ("Zoë") without throwing', async () => {
    const { bytes, count } = await renderFlashcardsPdf(
      ['Zoë', 'José Ibáñez', 'Muñoz-García'],
      baseOpts,
      fonts,
    );
    expect(count).toBe(3);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('reports zero pages for an empty list (component disables download)', async () => {
    const { count, pages } = await renderFlashcardsPdf([], baseOpts, fonts);
    expect(count).toBe(0);
    expect(pages).toBe(0);
  });

  it('supports a4, ink saver, no cut guides, no corner label', async () => {
    const opts: FlashcardOptions = {
      ...baseOpts,
      paper: 'a4',
      size: 'small',
      showCutLines: false,
      cornerLabel: '',
      inkSaver: true,
    };
    const { bytes, pages } = await renderFlashcardsPdf(items(8), opts, fonts);
    expect(pages).toBe(1);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1); // a4 portrait
  });
});

describe('flashcardsPdfFilename', () => {
  it('labels each item mode', () => {
    expect(flashcardsPdfFilename('Period 3', 'names')).toBe('Period 3 — Name cards.pdf');
    expect(flashcardsPdfFilename('Period 3', 'custom')).toBe('Period 3 — Flashcards.pdf');
  });

  it('keeps spaces and hyphens, strips illegal chars and leading dots', () => {
    expect(flashcardsPdfFilename('Period 3 — English', 'custom')).toBe(
      'Period 3 — English — Flashcards.pdf'
    );
    expect(flashcardsPdfFilename('.we/ird:na*me', 'names')).toBe('weirdname — Name cards.pdf');
    expect(flashcardsPdfFilename('tab\tand\u0000nul', 'custom')).toBe(
      'tabandnul — Flashcards.pdf'
    );
    expect(flashcardsPdfFilename('', 'custom')).toBe('Class — Flashcards.pdf');
  });
});
