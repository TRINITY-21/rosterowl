import { describe, expect, it } from 'vitest';
import { backupFilename, parseBackup, serializeBackup } from '../src/lib/backup';
import type { PersistedState } from '../src/lib/types';

function fullState(): PersistedState {
  return {
    version: 1,
    rooms: [
      {
        id: 'room-1',
        name: 'Room 12',
        desks: [
          { id: 'd1', x: 1, y: 2, groupId: null, zones: ['near-teacher'] },
          { id: 'd2', x: 2.5, y: 2, groupId: 'g1', zones: [] },
        ],
        teacherDesk: { x: 0, y: 0 },
        door: null,
      },
    ],
    classes: [
      {
        id: 'class-1',
        name: 'Period 3',
        roomId: 'room-1',
        students: [
          { id: 's1', first: 'Maya', last: 'Larsen', absent: false, zonePref: 'near-teacher' },
          { id: 's2', first: 'Omar', last: '', absent: true, zonePref: null },
        ],
        apart: [{ a: 's1', b: 's2' }],
        together: [],
        seating: { d1: 's1' },
        locked: ['d1'],
        pickerHistory: ['s1'],
        jobs: { titles: ['Line Leader', 'Door Holder'], wheel: ['s2', 's1'], offset: 1 },
        wordLists: { bingo: 'cat\ndog', flashcards: '' },
      },
    ],
    activeClassId: 'class-1',
    settings: { theme: 'dark', backupPromptShown: true },
  };
}

describe('serializeBackup', () => {
  it('wraps state with app tag and ISO timestamp, pretty-printed', () => {
    const json = serializeBackup(fullState());
    expect(json).toContain('\n  ');
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe('rosterowl');
    expect(new Date(parsed.exportedAt).toISOString()).toBe(parsed.exportedAt);
    expect(parsed.state.version).toBe(1);
  });
});

describe('backupFilename', () => {
  it('formats the given date', () => {
    expect(backupFilename(new Date(2026, 7, 19))).toBe('rosterowl-backup-2026-08-19.json');
  });

  it('zero-pads month and day', () => {
    expect(backupFilename(new Date(2026, 0, 5))).toBe('rosterowl-backup-2026-01-05.json');
  });

  it('defaults to today', () => {
    expect(backupFilename()).toMatch(/^rosterowl-backup-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe('parseBackup', () => {
  it('round-trips serialize -> parse', () => {
    const state = fullState();
    expect(parseBackup(serializeBackup(state))).toEqual(state);
  });

  it('accepts a bare PersistedState', () => {
    const state = fullState();
    expect(parseBackup(JSON.stringify(state))).toEqual(state);
  });

  it('accepts the wrapped form', () => {
    const state = fullState();
    const wrapped = JSON.stringify({ app: 'rosterowl', exportedAt: 'whenever', state });
    expect(parseBackup(wrapped)).toEqual(state);
  });

  it('rejects non-JSON garbage', () => {
    expect(() => parseBackup('hello')).toThrow(/RosterOwl backup/);
  });

  it('rejects JSON that is not an object', () => {
    expect(() => parseBackup('42')).toThrow(/RosterOwl backup/);
    expect(() => parseBackup('[1,2,3]')).toThrow(/RosterOwl backup/);
    expect(() => parseBackup('null')).toThrow(/RosterOwl backup/);
  });

  it('rejects another app\'s wrapped JSON even with a plausible state', () => {
    const wrapped = JSON.stringify({ app: 'gradebook', state: fullState() });
    expect(() => parseBackup(wrapped)).toThrow(/RosterOwl backup/);
  });

  it('rejects wrong versions', () => {
    expect(() => parseBackup(JSON.stringify({ ...fullState(), version: 2 }))).toThrow(
      /RosterOwl backup/,
    );
  });

  it('rejects desks without numeric x/y', () => {
    const state: any = fullState();
    state.rooms[0].desks[0].x = 'left';
    expect(() => parseBackup(JSON.stringify(state))).toThrow(/RosterOwl backup/);
  });

  it('rejects classes missing students array or seating object', () => {
    const noStudents: any = fullState();
    delete noStudents.classes[0].students;
    expect(() => parseBackup(JSON.stringify(noStudents))).toThrow(/RosterOwl backup/);

    const noSeating: any = fullState();
    delete noSeating.classes[0].seating;
    expect(() => parseBackup(JSON.stringify(noSeating))).toThrow(/RosterOwl backup/);
  });

  it('defaults missing optional fields on partial student objects', () => {
    const state: any = fullState();
    state.classes[0].students = [{ id: 's1', first: 'Maya' }];
    const parsed = parseBackup(JSON.stringify(state));
    expect(parsed.classes[0].students[0]).toEqual({
      id: 's1',
      first: 'Maya',
      last: '',
      absent: false,
      zonePref: null,
    });
  });

  it('defaults missing optional fields on desks, classes, and settings', () => {
    const state: any = fullState();
    delete state.rooms[0].desks[0].zones;
    delete state.rooms[0].teacherDesk;
    delete state.classes[0].apart;
    delete state.classes[0].together;
    delete state.classes[0].locked;
    delete state.settings;
    delete state.activeClassId;
    const parsed = parseBackup(JSON.stringify(state));
    expect(parsed.rooms[0].desks[0].zones).toEqual([]);
    expect(parsed.rooms[0].teacherDesk).toBeNull();
    expect(parsed.classes[0].apart).toEqual([]);
    expect(parsed.classes[0].together).toEqual([]);
    expect(parsed.classes[0].locked).toEqual([]);
    expect(parsed.activeClassId).toBe('class-1');
    expect(parsed.settings).toEqual({ theme: 'system', backupPromptShown: false });
  });

  it('drops unknown extra fields by rebuilding clean objects', () => {
    const state: any = fullState();
    state.junk = 'top-level';
    state.rooms[0].color = 'blue';
    state.rooms[0].desks[0].sticky = true;
    state.classes[0].gradeLevel = 7;
    state.classes[0].students[0].nickname = 'M';
    state.settings.fontSize = 14;
    const parsed: any = parseBackup(JSON.stringify(state));
    expect(parsed.junk).toBeUndefined();
    expect(parsed.rooms[0].color).toBeUndefined();
    expect(parsed.rooms[0].desks[0].sticky).toBeUndefined();
    expect(parsed.classes[0].gradeLevel).toBeUndefined();
    expect(parsed.classes[0].students[0].nickname).toBeUndefined();
    expect(parsed.settings.fontSize).toBeUndefined();
    expect(parsed).toEqual(fullState());
  });

  it('sanitizes malformed nested values instead of crashing later', () => {
    const state: any = fullState();
    state.classes[0].apart = [{ a: 's1' }, { a: 's1', b: 's2' }, 'nope'];
    state.classes[0].locked = ['d1', 7, null];
    state.classes[0].seating = { d1: 's1', d2: 99 };
    state.rooms[0].desks[0].zones = ['near-teacher', 'bogus-zone', 3];
    state.classes[0].students[0].zonePref = 'under-a-window';
    state.settings.theme = 'neon';
    const parsed = parseBackup(JSON.stringify(state));
    expect(parsed.classes[0].apart).toEqual([{ a: 's1', b: 's2' }]);
    expect(parsed.classes[0].locked).toEqual(['d1']);
    expect(parsed.classes[0].seating).toEqual({ d1: 's1' });
    expect(parsed.rooms[0].desks[0].zones).toEqual(['near-teacher']);
    expect(parsed.classes[0].students[0].zonePref).toBeNull();
    expect(parsed.settings.theme).toBe('system');
  });

  it('falls back when activeClassId is missing from the class list', () => {
    const state = fullState();
    state.activeClassId = 'gone';
    expect(parseBackup(JSON.stringify(state)).activeClassId).toBe('class-1');
  });

  it('defaults missing jobs and word lists (pre-jobs backups still load)', () => {
    const state: any = fullState();
    delete state.classes[0].jobs;
    delete state.classes[0].wordLists;
    const parsed = parseBackup(JSON.stringify(state));
    expect(parsed.classes[0].jobs).toEqual({ titles: [], wheel: [], offset: 0 });
    expect(parsed.classes[0].wordLists).toEqual({ bingo: '', flashcards: '' });
  });

  it('sanitizes malformed jobs: bad ids dropped, duplicates deduped, offset normalized', () => {
    const state: any = fullState();
    state.classes[0].jobs = {
      titles: ['Line Leader', 7, 'Messenger'],
      wheel: ['s1', 'ghost', 's2', 's1', 42],
      offset: 5,
    };
    state.classes[0].wordLists = { bingo: 9, flashcards: 'sun\nmoon' };
    const parsed = parseBackup(JSON.stringify(state));
    expect(parsed.classes[0].jobs).toEqual({
      titles: ['Line Leader', 'Messenger'],
      wheel: ['s1', 's2'],
      offset: 1,
    });
    expect(parsed.classes[0].wordLists).toEqual({ bingo: '', flashcards: 'sun\nmoon' });
  });

  it('drops seating, locks, and rules that point at unknown ids', () => {
    const state = fullState();
    state.classes[0].seating = { d1: 's1', missingDesk: 's1', d2: 'ghost' };
    state.classes[0].locked = ['d1', 'missingDesk'];
    state.classes[0].apart = [{ a: 's1', b: 'ghost' }, { a: 's1', b: 's2' }];
    state.classes[0].pickerHistory = ['s1', 'ghost'];
    const parsed = parseBackup(JSON.stringify(state));
    expect(parsed.classes[0].seating).toEqual({ d1: 's1' });
    expect(parsed.classes[0].locked).toEqual(['d1']);
    expect(parsed.classes[0].apart).toEqual([{ a: 's1', b: 's2' }]);
    expect(parsed.classes[0].pickerHistory).toEqual(['s1']);
  });
});
