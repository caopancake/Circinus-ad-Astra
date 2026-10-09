import { describe, expect, it } from 'vitest';
import type { EditorWindowKind, TableKey } from '@/shared/types';
import { associatedSpecEditorKinds, associatedSpecKind } from './associated-specs';

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

describe('associatedSpecKind', () => {
  it('builds the spec rel path per table convention', () => {
    expect(associatedSpecKind('ships')).toBe('ship');
    expect(associatedSpecKind('weapons')).toBe('weapon');
    expect(associatedSpecKind('shipSystems')).toBe('system');
    expect(associatedSpecKind('skills')).toBe('skill');
  });

  it('identifies tables without specs', () => {
    expect(associatedSpecKind('wings')).toBeNull();
  });
});
