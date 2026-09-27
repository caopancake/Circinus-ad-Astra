import { describe, expect, it } from 'vitest';
import { entryKey, entryUid } from './entry-keys';

describe('entryUid', () => {
  it('assigns a stable uid per object identity', () => {
    const object = {};
    expect(entryUid(object)).toBe(entryUid(object));
  });

  it('assigns distinct uids to distinct objects', () => {
    expect(entryUid({})).not.toBe(entryUid({}));
  });

  it('returns null for non-object values', () => {
    expect(entryUid(null)).toBeNull();
    expect(entryUid('text')).toBeNull();
    expect(entryUid(42)).toBeNull();
  });
});

describe('entryKey', () => {
  it('keys by object uid with the given prefix', () => {
    const object = {};
    expect(entryKey('weapon-slot', object, 7)).toBe(`weapon-slot-uid-${entryUid(object)}`);
  });

  it('falls back to the positional key for non-objects', () => {
    expect(entryKey('engine', null, 3)).toBe('engine-pos-3');
    expect(entryKey('engine', 5, 3)).toBe('engine-pos-3');
  });
});
