import { describe, expect, it } from 'vitest';
import { buildGroups } from '../src/lib/groups';
import { renderGroupsPdf } from '../src/lib/pdfGroups';
import { displayNames } from '../src/lib/names';
import type { Student } from '../src/lib/types';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const stu = (id: string, first: string, last = ''): Student => ({
  id,
  first,
  last,
  absent: false,
  zonePref: null,
});

const roster = (n: number): Student[] =>
  Array.from({ length: n }, (_, i) => stu(`s${i}`, `Kid${i}`));

describe('buildGroups', () => {
  it('is deterministic with a seed', () => {
    const students = roster(20);
    const a = buildGroups({ students, groupSize: 4, apart: [], together: [], seed: 7 });
    const b = buildGroups({ students, groupSize: 4, apart: [], together: [], seed: 7 });
    expect(a.groups.map((g) => g.map((s) => s.id))).toEqual(b.groups.map((g) => g.map((s) => s.id)));
  });

  it('balances group sizes', () => {
    const r = buildGroups({ students: roster(22), groupSize: 4, apart: [], together: [], seed: 1 });
    expect(r.groups.length).toBe(6);
    const sizes = r.groups.map((g) => g.length).sort();
    expect(sizes[0]).toBeGreaterThanOrEqual(3);
    expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(4);
    expect(r.groups.flat().length).toBe(22);
  });

  it('keeps apart pairs in different groups', () => {
    const students = roster(12);
    for (let seed = 1; seed <= 10; seed++) {
      const r = buildGroups({
        students,
        groupSize: 4,
        apart: [
          { a: 's0', b: 's1' },
          { a: 's2', b: 's3' },
        ],
        together: [],
        seed,
      });
      const gOf = new Map(r.groups.flatMap((g, i) => g.map((s) => [s.id, i] as const)));
      expect(gOf.get('s0')).not.toBe(gOf.get('s1'));
      expect(gOf.get('s2')).not.toBe(gOf.get('s3'));
      expect(r.ok).toBe(true);
    }
  });

  it('keeps together pairs in the same group', () => {
    const students = roster(12);
    const r = buildGroups({
      students,
      groupSize: 3,
      apart: [],
      together: [{ a: 's0', b: 's1' }],
      seed: 3,
    });
    const gOf = new Map(r.groups.flatMap((g, i) => g.map((s) => [s.id, i] as const)));
    expect(gOf.get('s0')).toBe(gOf.get('s1'));
    expect(r.ok).toBe(true);
  });

  it('reports impossible constraints instead of dropping students', () => {
    // 2 students, 1 group, must be apart: impossible.
    const students = roster(2);
    const r = buildGroups({
      students,
      groupSize: 2,
      apart: [{ a: 's0', b: 's1' }],
      together: [],
      seed: 1,
    });
    expect(r.groups.flat().length).toBe(2);
    expect(r.ok).toBe(false);
    expect(r.conflicts[0]?.kind).toBe('apart-violated');
  });

  it('handles empty roster', () => {
    const r = buildGroups({ students: [], groupSize: 4, apart: [], together: [], seed: 1 });
    expect(r.groups).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('renderGroupsPdf', () => {
  it('produces a loadable one-page PDF', async () => {
    const fonts = {
      regular: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Regular.ttf')),
      bold: new Uint8Array(readFileSync('public/fonts/AtkinsonHyperlegible-Bold.ttf')),
    };
    const students = [...roster(11), stu('z', 'Zoë', 'Muñoz')];
    const r = buildGroups({ students, groupSize: 4, apart: [], together: [], seed: 5 });
    const bytes = await renderGroupsPdf(r.groups, displayNames(students), {
      paper: 'letter',
      orientation: 'portrait',
      nameScale: 1,
      inkSaver: false,
      showFooter: true,
      title: 'Period 2 — Science',
      subtitle: 'Groups of 4 · today',
    }, fonts);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

// Regression (review finding): the repair pass must never split a keep-together
// closure — including its union-find ROOT member — even while fixing apart
// violations. Before the fix this failed in ~85/200 seeds.
describe('buildGroups repair-pass integrity', () => {
  it('never splits a together pair while repairing apart violations', () => {
    const students = roster(8);
    for (let seed = 1; seed <= 60; seed++) {
      const r = buildGroups({
        students,
        groupSize: 4,
        apart: [
          { a: 's2', b: 's3' },
          { a: 's3', b: 's4' },
          { a: 's2', b: 's4' },
        ],
        together: [{ a: 's0', b: 's1' }],
        seed,
      });
      const gOf = new Map(r.groups.flatMap((g, i) => g.map((s) => [s.id, i] as const)));
      expect(gOf.get('s0'), `seed ${seed}`).toBe(gOf.get('s1'));
    }
  });

  it('drops empty trailing groups when a together-closure exceeds group size', () => {
    const students = roster(6);
    const r = buildGroups({
      students,
      groupSize: 3,
      apart: [],
      together: [
        { a: 's0', b: 's1' },
        { a: 's1', b: 's2' },
        { a: 's2', b: 's3' },
        { a: 's3', b: 's4' },
        { a: 's4', b: 's5' },
      ],
      seed: 2,
    });
    expect(r.groups.every((g) => g.length > 0)).toBe(true);
    expect(r.groups.flat().length).toBe(6);
  });
});
