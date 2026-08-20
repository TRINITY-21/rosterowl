import { describe, it, expect } from 'vitest';
import { safeFilename } from '../src/lib/filenames';
describe('safeFilename', () => {
  it('keeps legitimate characters', () => {
    expect(safeFilename('Grade 3 — Ms. O’Brien')).toBe('Grade 3 — Ms. O’Brien');
    expect(safeFilename('Period 2 - Science')).toBe('Period 2 - Science');
  });
  it('strips filesystem-unsafe characters and control codes', () => {
    expect(safeFilename('A/B\\C:D*E?F"G<H>I|J')).toBe('ABCDEFGHIJ');
    expect(safeFilename('tab\tsep')).toBe('tabsep');
  });
  it('refuses hidden-file and trailing-dot names', () => {
    expect(safeFilename('.Period 1')).toBe('Period 1');
    expect(safeFilename('  .Period 1')).toBe('Period 1');
    expect(safeFilename('Period 1.')).toBe('Period 1');
  });
  it('falls back when nothing survives', () => {
    expect(safeFilename('   ')).toBe('Class');
    expect(safeFilename('///', 'Seating chart')).toBe('Seating chart');
  });
});
