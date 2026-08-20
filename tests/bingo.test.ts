import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import {
  buildBingoCards,
  renderBingoPdf,
  bingoPdfFilename,
  parseItems,
  cellsNeeded,
  FREE_CELL,
} from '../src/lib/pdfBingo';
import type { BingoBuildOptions, BingoRenderOptions } from '../src/lib/pdfBingo';

// Deterministic PRNG (mulberry32) so card tests are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fonts = {
  regular: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Regular.ttf')),
  bold: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Bold.ttf')),
  display: new Uint8Array(readFileSync('public/fonts/Baloo2-Display.ttf')),
};

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`);
const names = (n: number) => Array.from({ length: n }, (_, i) => `Student ${i}`);

const build = (items: string[], opts: Partial<BingoBuildOptions>, seed = 42) =>
  buildBingoCards(
    items,
    { size: 4, freeCenter: false, count: 10, ...opts },
    mulberry32(seed)
  );

const renderOpts = (over: Partial<BingoRenderOptions> = {}): BingoRenderOptions => ({
  paper: 'letter',
  perPage: 1,
  callerList: true,
  items: words(30),
  inkSaver: false,
  showFooter: true,
  ...over,
});

describe('parseItems', () => {
  it('trims, drops blanks, and ignores duplicates case-insensitively', () => {
    expect(parseItems(' cat \n\ndog\nCat\n  \ndog ')).toEqual(['cat', 'dog']);
  });
});

describe('cellsNeeded', () => {
  it('subtracts the free center only on odd sizes', () => {
    expect(cellsNeeded(5, true)).toBe(24);
    expect(cellsNeeded(5, false)).toBe(25);
    expect(cellsNeeded(3, true)).toBe(8);
    expect(cellsNeeded(4, true)).toBe(16); // even grid has no single center
  });
});

describe('buildBingoCards', () => {
  it('never repeats an item within a card', () => {
    const cards = build(words(30), { size: 5, freeCenter: true, count: 20 });
    expect(cards).toHaveLength(20);
    for (const card of cards) {
      expect(card.cells).toHaveLength(25);
      expect(new Set(card.cells).size).toBe(25);
    }
  });

  it('puts the free center exactly mid-grid when enabled', () => {
    const five = build(words(30), { size: 5, freeCenter: true, count: 5 });
    for (const card of five) {
      expect(card.cells[12]).toBe(FREE_CELL);
      expect(card.cells.filter((c) => c === FREE_CELL)).toHaveLength(1);
    }
    const three = build(words(30), { size: 3, freeCenter: true, count: 5 });
    for (const card of three) expect(card.cells[4]).toBe(FREE_CELL);
  });

  it('has no free cell when disabled or on even grids', () => {
    const off = build(words(30), { size: 5, freeCenter: false, count: 5 });
    for (const card of off) expect(card.cells).not.toContain(FREE_CELL);
    const even = build(words(30), { size: 4, freeCenter: true, count: 5 });
    for (const card of even) {
      expect(card.cells).toHaveLength(16);
      expect(card.cells).not.toContain(FREE_CELL);
    }
  });

  it('names mode: one card per student, own name excluded from own grid', () => {
    const roster = names(20);
    const cards = build(roster, { size: 4, excludeHeader: true });
    expect(cards).toHaveLength(20); // count is ignored: one card per item
    cards.forEach((card, i) => {
      expect(card.header).toBe(roster[i]);
      expect(card.cells).not.toContain(roster[i]);
    });
  });

  it('custom mode: the title heads every card', () => {
    const cards = build(words(20), { count: 3, title: 'Class Bingo' });
    for (const card of cards) expect(card.header).toBe('Class Bingo');
  });

  it('makes every card in the set different (dedupe by joined cells)', () => {
    // Tight pool on purpose: 17 items for 16 cells, 40 cards.
    const cards = build(words(17), { size: 4, count: 40 });
    const keys = new Set(cards.map((c) => c.cells.join('\n')));
    expect(keys.size).toBe(40);
  });

  it('is deterministic for the same seed', () => {
    const a = build(words(25), { size: 5, freeCenter: true, count: 8 }, 7);
    const b = build(words(25), { size: 5, freeCenter: true, count: 8 }, 7);
    expect(a).toEqual(b);
  });

  it('throws a clean error when the pool is too small', () => {
    expect(() => build(words(10), { size: 4, count: 5 })).toThrow(
      '4×4 needs 16 items — you have 10'
    );
    // Names mode: each card loses its own header, so 24 students can't fill
    // a 5×5 free-center grid (needs 24, have 23).
    expect(() => build(names(24), { size: 5, freeCenter: true, excludeHeader: true })).toThrow(
      '5×5 needs 24 items — you have 23'
    );
  });
});

describe('renderBingoPdf', () => {
  it('22 cards 1-up + caller list = 23 loadable pages', async () => {
    const roster = names(22);
    const cards = build(roster, { size: 4, excludeHeader: true });
    const { bytes, pages } = await renderBingoPdf(cards, renderOpts({ items: roster }), fonts);
    expect(pages).toBe(23);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(23);
  });

  it('22 cards 2-up + caller list = 12 pages; without the caller list, 11', async () => {
    const roster = names(22);
    const cards = build(roster, { size: 4, excludeHeader: true });
    const twoUp = await renderBingoPdf(
      cards,
      renderOpts({ perPage: 2, items: roster }),
      fonts
    );
    expect(twoUp.pages).toBe(12);
    const noCaller = await renderBingoPdf(
      cards,
      renderOpts({ perPage: 2, callerList: false, items: roster }),
      fonts
    );
    expect(noCaller.pages).toBe(11);
    const doc = await PDFDocument.load(noCaller.bytes);
    expect(doc.getPageCount()).toBe(11);
  });

  it('renders A4, ink saver, free center, and long two-word items loadably', async () => {
    const longItems = Array.from({ length: 30 }, (_, i) => `Extraordinarily Longwinded${i} Phrase${i}`);
    const cards = buildBingoCards(
      longItems,
      { size: 5, freeCenter: true, count: 3, title: 'Vocab Bingo' },
      mulberry32(3)
    );
    const { bytes, pages } = await renderBingoPdf(
      cards,
      renderOpts({ paper: 'a4', inkSaver: true, items: longItems }),
      fonts
    );
    expect(pages).toBe(4);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
  });
});

describe('bingoPdfFilename', () => {
  it('builds a safe, readable filename', () => {
    expect(bingoPdfFilename('Period 3')).toBe('Period 3 — Bingo cards.pdf');
  });
  it('strips filesystem-illegal characters and falls back to Class', () => {
    expect(bingoPdfFilename('P3 / Math: "Stars"')).toBe('P3 Math Stars — Bingo cards.pdf');
    expect(bingoPdfFilename('***')).toBe('Class — Bingo cards.pdf');
  });
});
