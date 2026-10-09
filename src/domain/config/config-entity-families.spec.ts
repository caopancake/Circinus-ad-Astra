import { entityTargetFixture } from '@/test/entity-target';
import { describe, expect, it } from 'vitest';
import type { ConfigFamilyFile } from '@/shared/types';
import { familyFileCompanion, familyFileId, familyFileTitle, skinFamily, variantFamily } from './config-entity-families';

function variantFixture(overrides: Partial<ConfigFamilyFile> = {}): ConfigFamilyFile {
  return {
    baseVersions: [],
    target: entityTargetFixture('variant', 'v1'),
    id: 'v1',
    path: '',
    relPath: '',
    data: { variantId: 'v1', hullId: 'h1' },
    ...overrides,
  };
}

function skinFixture(overrides: Partial<ConfigFamilyFile> = {}): ConfigFamilyFile {
  return {
    baseVersions: [],
    target: entityTargetFixture('skin', 'sk1'),
    id: 'sk1',
    path: '',
    relPath: '',
    data: { skinHullId: 'sk1', baseHullId: 'h1' },
    ...overrides,
  };
}

describe('familyFileId', () => {
  it('keeps loaded identity while the draft ID changes', () => {
    expect(familyFileId(variantFixture({ data: { variantId: 'next' } }))).toBe('v1');
    expect(familyFileId(skinFixture({ data: { skinHullId: 'next' } }))).toBe('sk1');
  });
});

describe('familyFileTitle', () => {
  it('composes hull name and display name for variants', () => {
    const file = variantFixture({ data: { variantId: 'v1', hullId: 'h1', displayName: 'Elite' } });
    expect(familyFileTitle(variantFamily, file, { h1: 'Escort' })).toBe('Escort · Elite');
  });

  it('falls back to the hull name, then the hull id, for variants', () => {
    const file = variantFixture();
    expect(familyFileTitle(variantFamily, file, { h1: 'Escort' })).toBe('Escort');
    expect(familyFileTitle(variantFamily, file, {})).toBe('h1');
  });

  it('uses the raw id field for skins without hull name lookup', () => {
    expect(familyFileTitle(skinFamily, skinFixture(), { h1: 'Escort' })).toBe('sk1');
  });
});

describe('familyFileCompanion', () => {
  it('reads the companion field with hull id semantics per family', () => {
    expect(familyFileCompanion(variantFamily, variantFixture())).toBe('h1');
    expect(familyFileCompanion(skinFamily, skinFixture({ data: { baseHullId: 'h9' } }))).toBe('h9');
    expect(familyFileCompanion(skinFamily, skinFixture({ data: { baseHullId: '' } }))).toBe('');
  });
});

describe('family definitions', () => {
  it('keeps the variant/skin ownership split stable', () => {
    expect(variantFamily.usesHullNames).toBe(true);
    expect(variantFamily.idField).toBe('variantId');
    expect(variantFamily.companionField).toBe('hullId');
    expect(skinFamily.usesHullNames).toBe(false);
    expect(skinFamily.idField).toBe('skinHullId');
    expect(skinFamily.companionField).toBe('baseHullId');
    expect(variantFamily.directoryHint).toContain('.variant');
    expect(skinFamily.directoryHint).toContain('.skin');
  });

  it('describes delete confirmations with the family display name', () => {
    expect(variantFamily.deleteConfirmTitle).toContain(variantFamily.displayName);
    expect(skinFamily.deleteConfirmTitle).toContain(skinFamily.displayName);
  });
});
