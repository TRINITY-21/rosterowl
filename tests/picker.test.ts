import { describe, expect, it } from 'vitest';
import { pickNext, roundProgress } from '../src/lib/picker';
import type { Student } from '../src/lib/types';

const stu = (id: string, absent = false): Student => ({
  id,
  first: id,
  last: '',
  absent,
  zonePref: null,
});

describe('pickNext', () => {
  it('never repeats within a round', () => {
    const students = ['a', 'b', 'c', 'd'].map((id) => stu(id));
    const history: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const r = pickNext(students, history, () => 0.4);
      expect(r.student).not.toBeNull();
      expect(seen.has(r.student!.id)).toBe(false);
      expect(r.newRound).toBe(false);
      seen.add(r.student!.id);
      history.push(r.student!.id);
    }
    expect(seen.size).toBe(4);
  });

  it('starts a new round when everyone has been picked', () => {
    const students = ['a', 'b'].map((id) => stu(id));
    const r = pickNext(students, ['a', 'b'], () => 0);
    expect(r.newRound).toBe(true);
    expect(r.student).not.toBeNull();
  });

  it('skips absent students', () => {
    const students = [stu('a'), stu('b', true), stu('c')];
    for (let i = 0; i < 20; i++) {
      const r = pickNext(students, [], () => i / 20);
      expect(r.student?.id).not.toBe('b');
    }
  });

  it('returns null when everyone is absent', () => {
    const r = pickNext([stu('a', true)], []);
    expect(r.student).toBeNull();
  });

  it('a student marked absent mid-round does not block round completion', () => {
    const students = [stu('a'), stu('b', true), stu('c')];
    // a and c picked; b absent -> next pick is a NEW round, not a stall.
    const r = pickNext(students, ['a', 'c'], () => 0);
    expect(r.newRound).toBe(true);
  });
});

describe('roundProgress', () => {
  it('counts only present students', () => {
    const students = [stu('a'), stu('b', true), stu('c')];
    expect(roundProgress(students, ['a', 'b'])).toEqual({ done: 1, total: 2 });
  });
});

// Regression (review finding): a round rollover must not immediately re-pick
// the student who was just called.
describe('pickNext round boundary', () => {
  it('never picks the same student twice in a row across a new round', () => {
    const students = ['a', 'b', 'c'].map((id) => stu(id));
    for (let r = 0; r < 30; r++) {
      const rand = () => (r % 10) / 10;
      const res = pickNext(students, ['b', 'c', 'a'], rand); // 'a' was last
      expect(res.newRound).toBe(true);
      expect(res.student?.id).not.toBe('a');
    }
  });
});
