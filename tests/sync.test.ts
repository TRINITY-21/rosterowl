// The parts of sync that can lose a teacher's work if they are wrong: the
// revision handshake, and the promise that a refused write is kept rather than
// discarded. The Worker's half of this is exercised against a real D1 in
// the Worker test run in worker/README notes; these cover the client's half.
import { describe, expect, it } from 'vitest';
import { parseBackup, serializeBackup } from '../src/lib/backup';
import { fingerprint } from '../src/lib/versions';
import type { PersistedState } from '../src/lib/types';
import { emptyJobs, emptyWordLists } from '../src/lib/types';

/**
 * Fixtures are built *through* parseBackup on purpose.
 *
 * parseBackup does not just validate, it normalises — it fills in fields an
 * older document may lack (`zonePref`, `pickerHistory`) and rebuilds each
 * object in a fixed key order. A hand-written literal is therefore not the
 * shape the app ever actually holds, and comparing fingerprints against one
 * would be testing the fixture rather than the code.
 */
function stateWith(classNames: string[]): PersistedState {
  const raw: unknown = {
    version: 1,
    rooms: classNames.map((name, i) => ({
      id: `room-${i}`,
      name: `${name} room`,
      desks: [{ id: `d-${i}`, x: 1, y: 1, groupId: null, zones: [] }],
      teacherDesk: { x: 0, y: 0 },
      door: { x: 4, y: 0 },
    })),
    classes: classNames.map((name, i) => ({
      id: `c-${i}`,
      name,
      roomId: `room-${i}`,
      students: [{ id: `s-${i}`, first: 'Ava', last: 'Ng', absent: false }],
      seating: {},
      locked: [],
      apart: [],
      together: [],
      jobs: emptyJobs(),
      wordLists: emptyWordLists(),
    })),
    activeClassId: 'c-0',
    settings: { theme: 'light' },
  };
  return parseBackup(JSON.stringify(raw));
}

describe('sync payload round-trip', () => {
  it('survives the trip through JSON that the API performs', () => {
    const local = stateWith(['Period 2']);
    // What push() sends, and what pull() gets back out of the response body.
    const overTheWire = JSON.parse(JSON.stringify({ doc: local })).doc;
    const restored = parseBackup(JSON.stringify(overTheWire));
    expect(restored.classes.map((c) => c.name)).toEqual(['Period 2']);
    expect(fingerprint(restored)).toBe(fingerprint(local));
  });

  it('rejects a document the server could not have produced', () => {
    // The Worker treats the blob as opaque, so the client is the only thing
    // standing between a malformed document and the UI.
    expect(() => parseBackup(JSON.stringify({ version: 99, rooms: [], classes: [] }))).toThrow();
    expect(() => parseBackup('{"nope":true}')).toThrow();
  });

  it('accepts a document that arrived as a wrapped backup file', () => {
    const wrapped = serializeBackup(stateWith(['Period 1']));
    expect(parseBackup(wrapped).classes[0]!.name).toBe('Period 1');
  });
});

describe('fingerprint drives when a push happens', () => {
  it('is stable across a JSON round-trip, so an unchanged document never re-uploads', () => {
    const state = stateWith(['Period 2']);
    const copy = JSON.parse(JSON.stringify(state)) as PersistedState;
    expect(fingerprint(copy)).toBe(fingerprint(state));
  });

  it('changes when the roster changes', () => {
    const before = stateWith(['Period 2']);
    const after = stateWith(['Period 2']);
    after.classes[0]!.students.push({
      id: 's-new',
      first: 'Kai',
      last: 'Ono',
      absent: false,
      zonePref: null,
    });
    expect(fingerprint(after)).not.toBe(fingerprint(before));
  });

  it('ignores settings, so flipping the theme does not cost a sync', () => {
    const light = stateWith(['Period 2']);
    const dark = stateWith(['Period 2']);
    dark.settings.theme = 'dark';
    expect(fingerprint(dark)).toBe(fingerprint(light));
  });
});

describe('parseBackup normalises, which is why sync marks are computed after it', () => {
  it('fills in fields an older or hand-made document lacks', () => {
    const sparse = parseBackup(
      JSON.stringify({
        version: 1,
        rooms: [{ id: 'room-0', name: 'Room 12', desks: [], teacherDesk: null, door: null }],
        classes: [
          {
            id: 'c-0',
            name: 'Period 2',
            roomId: 'room-0',
            students: [{ id: 's-0', first: 'Ava', last: 'Ng', absent: false }],
            seating: {},
            locked: [],
            apart: [],
            together: [],
            jobs: emptyJobs(),
            wordLists: emptyWordLists(),
          },
        ],
        activeClassId: 'c-0',
        settings: {},
      })
    );
    // A document written by an older build is still safe to adopt from sync.
    expect(sparse.classes[0]!.students[0]).toHaveProperty('zonePref');
    expect(sparse.classes[0]!.name).toBe('Period 2');
  });
});

describe('a device still on the pre-attendance build', () => {
  it('cannot erase the log, and the adopting device differs from the server so it pushes the log back', () => {
    const local = stateWith(['Period 2']);
    local.classes[0]!.attendance.days['2026-10-21'] = { at: 100, marks: { 's-0': 'absent' } };
    const stripped = JSON.parse(JSON.stringify(local));
    delete stripped.classes[0].attendance;
    const adopted = parseBackup(JSON.stringify(stripped), local.classes);
    expect(adopted.classes[0]!.attendance).toEqual(local.classes[0]!.attendance);
    expect(fingerprint(adopted)).not.toBe(fingerprint(parseBackup(JSON.stringify(stripped))));
  });

  // The rollout order that wiped logs in review: device B opens on the old
  // build (which strips the log and saves that), then takes the update. Its
  // first pull is "in step", and its push used to replace the server's log
  // with an empty one that device A then adopted as written.
  it('survives the update order: B updates, pushes, A pulls — the log is intact everywhere', () => {
    const a = stateWith(['Period 2']);
    a.classes[0]!.attendance.days['2026-10-21'] = { at: 100, marks: { 's-0': 'absent' } };
    const serverRevN = JSON.parse(JSON.stringify(a));
    const strippedByOldB = JSON.parse(JSON.stringify(a));
    delete strippedByOldB.classes[0].attendance;
    const bAfterUpdate = parseBackup(JSON.stringify(strippedByOldB)); // load(): nothing to merge with
    expect(bAfterUpdate.classes[0]!.attendance.days).toEqual({});
    // In-step pull: the server's log is merged into B's own document first.
    const bPushes = parseBackup(JSON.stringify(bAfterUpdate), parseBackup(JSON.stringify(serverRevN)).classes);
    expect(bPushes.classes[0]!.attendance).toEqual(a.classes[0]!.attendance);
    // And even a B that pushed its empty log can't erase A's copy.
    const aPulls = parseBackup(JSON.stringify(bAfterUpdate), a.classes);
    expect(aPulls.classes[0]!.attendance).toEqual(a.classes[0]!.attendance);
  });

  it('a device that marks before it has the log adds to it instead of replacing it', () => {
    const a = stateWith(['Period 2']);
    a.classes[0]!.attendance.days['2026-10-19'] = { at: 100, marks: { 's-0': 'absent' } };
    const b = stateWith(['Period 2']);
    b.classes[0]!.attendance.days['2026-10-22'] = { at: 200, marks: {} };
    const aPulls = parseBackup(JSON.stringify(b), a.classes);
    expect(Object.keys(aPulls.classes[0]!.attendance.days).sort()).toEqual(['2026-10-19', '2026-10-22']);
  });

  it('a stale device cannot roll back newer days, and a clear still reaches it', () => {
    const c = stateWith(['Period 2']);
    c.classes[0]!.attendance.days = {
      '2026-10-19': { at: 1, marks: {} },
      '2026-10-20': { at: 5, marks: { 's-0': 'late' } },
      '2026-10-21': { at: 9, marks: {}, cleared: true },
    };
    const staleA = stateWith(['Period 2']);
    staleA.classes[0]!.attendance.days = {
      '2026-10-19': { at: 1, marks: {} },
      '2026-10-21': { at: 4, marks: { 's-0': 'absent' } },
    };
    const cPulls = parseBackup(JSON.stringify(staleA), c.classes);
    expect(cPulls.classes[0]!.attendance.days).toEqual(c.classes[0]!.attendance.days);
    const aPulls = parseBackup(JSON.stringify(c), staleA.classes);
    expect(aPulls.classes[0]!.attendance.days['2026-10-21']).toEqual({ at: 9, marks: {}, cleared: true });
  });
});
