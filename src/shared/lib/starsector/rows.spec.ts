import { describe, expect, it } from 'vitest';
import { rowDisplayId, rowSpecId } from './rows';

describe('rowDisplayId', () => {
  it('prefers id, then hullId, then variant id, then name', () => {
    expect(rowDisplayId({ id: 'a', hullId: 'b', name: 'c' })).toBe('a');
    expect(rowDisplayId({ hullId: 'b', name: 'c' })).toBe('b');
    expect(rowDisplayId({ 'variant id': 'v', name: 'c' })).toBe('v');
    expect(rowDisplayId({ name: 'c' })).toBe('c');
    expect(rowDisplayId({})).toBe('');
  });
});

describe('rowSpecId', () => {
  it('prefers id over hullId for ships', () => {
    expect(rowSpecId({ id: 'a', hullId: 'b' }, 'ships')).toBe('a');
    expect(rowSpecId({ hullId: 'b' }, 'ships')).toBe('b');
  });

  it('reads business ids independently of the parser-owned comment flag', () => {
    expect(rowSpecId({ id: '#old', hullId: 'new' }, 'ships')).toBe('#old');
    expect(rowSpecId({ id: '#old', hullId: '#older' }, 'ships')).toBe('#old');
  });

  it('uses only the id column for weapons, systems and skills', () => {
    expect(rowSpecId({ id: 'w', hullId: 'h' }, 'weapons')).toBe('w');
    expect(rowSpecId({ id: 's', hullId: 'h' }, 'shipSystems')).toBe('s');
    expect(rowSpecId({ id: 'k', hullId: 'h' }, 'skills')).toBe('k');
    expect(rowSpecId({ id: '#quoted', hullId: 'h' }, 'weapons')).toBe('#quoted');
  });

  it('falls back to the generic id/hullId order for other tables', () => {
    expect(rowSpecId({ hullId: 'h' }, 'wings')).toBe('h');
  });
});
