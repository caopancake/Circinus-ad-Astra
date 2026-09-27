import { describe, expect, it } from 'vitest';
import { isDisabledCsvReference, rowDisplayId, rowSpecId } from './rows';

describe('rowDisplayId', () => {
  it('prefers id, then hullId, then variant id, then name', () => {
    expect(rowDisplayId({ id: 'a', hullId: 'b', name: 'c' })).toBe('a');
    expect(rowDisplayId({ hullId: 'b', name: 'c' })).toBe('b');
    expect(rowDisplayId({ 'variant id': 'v', name: 'c' })).toBe('v');
    expect(rowDisplayId({ name: 'c' })).toBe('c');
    expect(rowDisplayId({})).toBe('');
  });
});

describe('isDisabledCsvReference', () => {
  it('treats hash-prefixed values as disabled references', () => {
    expect(isDisabledCsvReference('#old_ship')).toBe(true);
    expect(isDisabledCsvReference('  #old_ship')).toBe(true);
    expect(isDisabledCsvReference('old_ship')).toBe(false);
    expect(isDisabledCsvReference('')).toBe(false);
  });
});

describe('rowSpecId', () => {
  it('prefers id over hullId for ships', () => {
    expect(rowSpecId({ id: 'a', hullId: 'b' }, 'ships')).toBe('a');
    expect(rowSpecId({ hullId: 'b' }, 'ships')).toBe('b');
  });

  it('drops hash-disabled reference ids for ships', () => {
    expect(rowSpecId({ id: '#old', hullId: 'new' }, 'ships')).toBe('new');
    expect(rowSpecId({ id: '#old', hullId: '#older' }, 'ships')).toBe('');
  });

  it('uses only the id column for weapons, systems and skills', () => {
    expect(rowSpecId({ id: 'w', hullId: 'h' }, 'weapons')).toBe('w');
    expect(rowSpecId({ id: 's', hullId: 'h' }, 'shipSystems')).toBe('s');
    expect(rowSpecId({ id: 'k', hullId: 'h' }, 'skills')).toBe('k');
    expect(rowSpecId({ id: '#disabled', hullId: 'h' }, 'weapons')).toBe('');
  });

  it('falls back to the generic id/hullId order for other tables', () => {
    expect(rowSpecId({ hullId: 'h' }, 'wings')).toBe('h');
  });
});
