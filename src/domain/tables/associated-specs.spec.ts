import { describe, expect, it } from 'vitest';
import type { EditorWindowKind, TableKey } from '@/shared/types';
import { associatedSpecEditorKinds, associatedSpecRelPath } from './associated-specs';

const TABLE_WITHOUT_SPECS: TableKey[] = ['wings', 'hullmods', 'industries', 'skills', 'descriptions'];

describe('associatedSpecEditorKinds', () => {
  it('maps ships to the ship editor only', () => {
    expect(associatedSpecEditorKinds('ships')).toEqual(['ship']);
  });

  it('maps weapons to the weapon editor and the fire preview', () => {
    expect(associatedSpecEditorKinds('weapons')).toEqual(['weapon', 'weapon-preview']);
  });

  it('maps ship systems to the system editor', () => {
    expect(associatedSpecEditorKinds('shipSystems')).toEqual(['system']);
  });

  it('returns no editors for tables without associated specs', () => {
    for (const table of TABLE_WITHOUT_SPECS) {
      expect(associatedSpecEditorKinds(table)).toEqual([]);
    }
  });

  it('returns copies so callers cannot mutate the definitions', () => {
    const kinds = associatedSpecEditorKinds('weapons');
    kinds.push('ship' as EditorWindowKind);
    expect(associatedSpecEditorKinds('weapons')).toEqual(['weapon', 'weapon-preview']);
  });
});

describe('associatedSpecRelPath', () => {
  it('builds the spec rel path per table convention', () => {
    expect(associatedSpecRelPath('ships', 'toddlership')).toBe('data/hulls/toddlership.ship');
    expect(associatedSpecRelPath('weapons', 'railgun')).toBe('data/weapons/railgun.wpn');
    expect(associatedSpecRelPath('shipSystems', 'burn_drive')).toBe('data/shipsystems/burn_drive.system');
    expect(associatedSpecRelPath('skills', 'helmanship')).toBe('data/characters/skills/helmanship.skill');
  });

  it('returns null for empty ids or tables without specs', () => {
    expect(associatedSpecRelPath('ships', '')).toBeNull();
    expect(associatedSpecRelPath('wings', 'wing1')).toBeNull();
  });
});
