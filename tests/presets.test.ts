import { describe, expect, it } from 'vitest';
import {
  AWARD_PRESETS,
  CHECKLIST_PRESETS,
  JOB_PRESETS,
  WORD_LIST_PRESETS,
} from '../src/lib/presets';

const all = [...CHECKLIST_PRESETS, ...JOB_PRESETS, ...WORD_LIST_PRESETS];

describe('preset catalogue', () => {
  it('has unique keys and labels within each family', () => {
    for (const family of [CHECKLIST_PRESETS, JOB_PRESETS, WORD_LIST_PRESETS]) {
      expect(new Set(family.map((p) => p.key)).size).toBe(family.length);
      expect(new Set(family.map((p) => p.label)).size).toBe(family.length);
    }
  });

  it('labels every preset with a key, label and hint', () => {
    for (const p of all) {
      expect(p.key).toMatch(/^[a-z0-9-]+$/);
      expect(p.label.trim()).not.toBe('');
      expect(p.hint.trim()).not.toBe('');
    }
  });

  it('keeps checklist columns inside the tool’s 1–12 / 14-char limits', () => {
    for (const p of CHECKLIST_PRESETS) {
      expect(p.value.length).toBeGreaterThanOrEqual(1);
      expect(p.value.length).toBeLessThanOrEqual(12);
      for (const col of p.value) {
        expect(col.length).toBeLessThanOrEqual(14);
        expect(col.trim()).toBe(col);
      }
    }
  });

  it('keeps job titles inside the 40-char field limit, with no duplicates', () => {
    for (const p of JOB_PRESETS) {
      expect(p.value.length).toBeGreaterThan(0);
      expect(new Set(p.value).size).toBe(p.value.length);
      for (const title of p.value) expect(title.length).toBeLessThanOrEqual(40);
    }
  });

  it('gives every word list enough unique items to fill a 5x5 card', () => {
    for (const p of WORD_LIST_PRESETS) {
      const items = p.value.split('\n').filter((w) => w.trim() !== '');
      // 5x5 with a free centre still needs 24 distinct items.
      expect(items.length).toBeGreaterThanOrEqual(25);
      expect(new Set(items).size).toBe(items.length);
      for (const w of items) expect(w.trim()).toBe(w);
    }
  });

  it('states the real counts in the hints', () => {
    const counts = Object.fromEntries(
      WORD_LIST_PRESETS.map((p) => [p.key, p.value.split('\n').length])
    );
    expect(counts['sight-pre-primer']).toBe(40);
    expect(counts['sight-primer']).toBe(52);
    expect(counts['us-states']).toBe(50);
  });

  it('offers distinct award titles', () => {
    expect(new Set(AWARD_PRESETS).size).toBe(AWARD_PRESETS.length);
    for (const a of AWARD_PRESETS) expect(a.trim()).toBe(a);
  });
});
