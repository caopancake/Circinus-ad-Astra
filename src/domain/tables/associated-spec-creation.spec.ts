import { describe, expect, it } from 'vitest';
import { associatedSpecCreateParams, inferWeaponSpecClass } from './associated-spec-creation';

describe('CSV spec creation parameters', () => {
  it.each([
    [{}, 'projectile'],
    [{ 'damage/second': '1', 'energy/second': '2', 'damage/shot': '3' }, 'beam'],
    [{ 'damage/shot': '1', 'energy/shot': '2', 'beam speed': '3' }, 'projectile'],
    [{ 'damage/shot': '1', 'beam speed': '2' }, 'projectile'],
    [{ 'damage/shot': '   ', 'beam speed': '0' }, 'beam'],
    [{ 'damage/shot': '0', 'energy/shot': '0', 'beam speed': '5' }, 'projectile'],
  ] as const)('scores populated columns in %j as %s', (row, expected) => {
    expect(inferWeaponSpecClass(row)).toBe(expected);
  });

  it('projects only the creation parameters owned by the format', () => {
    expect(associatedSpecCreateParams('ships', 's', { name: '  Ship  ' })).toEqual({ kind: 'ship', id: 's', hullName: '  Ship  ' });
    expect(associatedSpecCreateParams('ships', 's', { name: 'Ship', _rowKey: 'business', damage: '1' })).toEqual({
      kind: 'ship',
      id: 's',
      hullName: 'Ship',
    });
    expect(associatedSpecCreateParams('weapons', 'w', { type: 'KINETIC', 'beam speed': '10' })).toEqual({
      kind: 'weapon',
      id: 'w',
      specClass: 'beam',
    });
    expect(associatedSpecCreateParams('shipSystems', 's', { name: 'System' })).toEqual({ kind: 'system', id: 's' });
    expect(associatedSpecCreateParams('skills', 's', { name: 'Skill' })).toEqual({ kind: 'skill', id: 's' });
  });
});
