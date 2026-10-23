import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveMakingRoom } from '../src/lib/versions';
import type { VersionEntry } from '../src/lib/versions';
import type { PersistedState } from '../src/lib/types';

// A browser storage with a quota, in characters, like localStorage's.
function quotaStorage(limit: number) {
  const data = new Map<string, string>();
  const used = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const before = data.get(k);
      data.set(k, v);
      if (used() > limit) {
        if (before === undefined) data.delete(k);
        else data.set(k, before);
        throw new DOMException('quota', 'QuotaExceededError');
      }
    },
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

const state = { version: 1, rooms: [], classes: [], activeClassId: null, settings: {} } as unknown as PersistedState;
const entry = (id: string, kind: VersionEntry['kind'], size: number): VersionEntry => ({
  id,
  ts: Number(id.slice(1)),
  kind,
  label: 'x'.repeat(size),
  summary: '',
  state,
});

let store: ReturnType<typeof quotaStorage>;
const original = globalThis.localStorage;
beforeEach(() => {
  store = quotaStorage(4_000);
  (globalThis as { localStorage?: unknown }).localStorage = store;
});
afterEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = original;
});

describe('saveMakingRoom', () => {
  it('saves the main document by dropping the oldest automatic versions first', () => {
    const versions = [entry('v3', 'auto', 900), entry('v2', 'manual', 900), entry('v1', 'auto', 900)];
    store.setItem('rosterowl:versions:v1', JSON.stringify(versions));
    const kept = saveMakingRoom(() => store.setItem('rosterowl:v1', 'd'.repeat(1_500)), versions);
    expect(store.getItem('rosterowl:v1')).toHaveLength(1_500);
    expect(kept.map((v) => v.id)).toEqual(['v3', 'v2']);
    expect(JSON.parse(store.getItem('rosterowl:versions:v1')!).map((v: VersionEntry) => v.id)).toEqual(['v3', 'v2']);
  });

  it('leaves history alone when the document fits', () => {
    const versions = [entry('v1', 'auto', 100)];
    expect(saveMakingRoom(() => store.setItem('rosterowl:v1', 'small'), versions)).toBe(versions);
  });

  it('still fails when even an empty history leaves no room', () => {
    expect(() => saveMakingRoom(() => store.setItem('rosterowl:v1', 'd'.repeat(5_000)), [entry('v1', 'auto', 10)])).toThrow();
  });
});
