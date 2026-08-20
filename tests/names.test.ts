import { describe, expect, it } from 'vitest';
import { displayNames, nameStamp, rosterStamp } from '../src/lib/names';
import type { Student } from '../src/lib/types';

let n = 0;
function student(first: string, last = ''): Student {
  return { id: `s${++n}`, first, last, absent: false, zonePref: null };
}

describe('displayNames', () => {
  it('uses bare first names when unique', () => {
    const a = student('Maya', 'Larsen');
    const b = student('Omar', 'Reyes');
    const c = student('Priya', 'Shah');
    const names = displayNames([a, b, c]);
    expect(names.get(a.id)).toBe('Maya');
    expect(names.get(b.id)).toBe('Omar');
    expect(names.get(c.id)).toBe('Priya');
  });

  it('adds last initials for duplicate first names', () => {
    const a = student('Maya', 'Larsen');
    const b = student('Maya', 'Chen');
    const c = student('Omar', 'Reyes');
    const names = displayNames([a, b, c]);
    expect(names.get(a.id)).toBe('Maya L.');
    expect(names.get(b.id)).toBe('Maya C.');
    expect(names.get(c.id)).toBe('Omar');
  });

  it('extends the prefix letter by letter on deeper collisions', () => {
    const a = student('Maya', 'Larsen');
    const b = student('Maya', 'Larkin');
    const names = displayNames([a, b]);
    expect(names.get(a.id)).toBe('Maya Lars.');
    expect(names.get(b.id)).toBe('Maya Lark.');
  });

  it('falls back to the full last name when never unique', () => {
    const a = student('Maya', 'Lars');
    const b = student('Maya', 'Lars');
    const names = displayNames([a, b]);
    expect(names.get(a.id)).toBe('Maya Lars');
    expect(names.get(b.id)).toBe('Maya Lars');
  });

  it('uses the full last name without a period when the whole name is the unique prefix', () => {
    const a = student('Maya', 'Lo');
    const b = student('Maya', 'Lough');
    const names = displayNames([a, b]);
    expect(names.get(a.id)).toBe('Maya Lo');
    expect(names.get(b.id)).toBe('Maya Lou.');
  });

  it('leaves students without a last name as bare "First" even when colliding', () => {
    const a = student('Maya');
    const b = student('Maya', 'Larsen');
    const c = student('Maya');
    const names = displayNames([a, b, c]);
    expect(names.get(a.id)).toBe('Maya');
    expect(names.get(c.id)).toBe('Maya');
    expect(names.get(b.id)).toBe('Maya L.');
  });

  it('compares case-insensitively but preserves original casing in output', () => {
    const a = student('maya', 'larsen');
    const b = student('Maya', 'LARKIN');
    const names = displayNames([a, b]);
    expect(names.get(a.id)).toBe('maya lars.');
    expect(names.get(b.id)).toBe('Maya LARK.');
  });

  it('is stable: same input order gives the same output', () => {
    const roster = [
      student('Maya', 'Larsen'),
      student('Maya', 'Larkin'),
      student('Omar', 'Reyes'),
      student('Omar', ''),
      student('Priya', 'Shah'),
    ];
    const first = displayNames(roster);
    const second = displayNames(roster);
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it('handles an empty roster', () => {
    expect(displayNames([]).size).toBe(0);
  });
});

describe('rosterStamp / nameStamp', () => {
  it('changes when a name or absent flag changes', () => {
    const a = student('Maya', 'Larsen');
    const b = student('Omar', 'Reyes');
    const first = rosterStamp([a, b]);
    expect(rosterStamp([a, b])).toBe(first);
    expect(rosterStamp([a, { ...b, absent: true }])).not.toBe(first);
    expect(rosterStamp([a, { ...b, first: 'Omarito' }])).not.toBe(first);
    expect(rosterStamp(undefined)).toBe('');
  });

  it('nameStamp ignores absent flags', () => {
    const a = student('Maya', 'Larsen');
    a.absent = true;
    expect(nameStamp([a])).toBe(nameStamp([{ ...a, absent: false }]));
    expect(nameStamp([a])).toBe('Maya Larsen');
  });
});
