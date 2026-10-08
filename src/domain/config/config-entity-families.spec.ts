import { describe, expect, it } from 'vitest';
import type { SkinFile, VariantFile } from '@/shared/types';
import { familyFileCompanion, familyFileId, familyFileTitle, skinFamily, variantFamily } from './config-entity-families';

function variantFixture(overrides: Partial<VariantFile> = {}): VariantFile {
  return {
    baseVersions: [],
    variantId: 'v1',
    hullId: 'h1',
    path: '',
    relPath: '',
    data: { variantId: 'v1', hullId: 'h1' },
    weaponGroupCount: 0,
    hullModCount: 0,
    permaModCount: 0,
    wingCount: overrides.wingCount ?? 0,
    ...overrides,
  };
}

function skinFixture(overrides: Partial<SkinFile> = {}): SkinFile {
  return {
    baseVersions: [],
    skinHullId: 'sk1',
    baseHullId: 'h1',
    path: '',
    relPath: '',
    data: { skinHullId: 'sk1', baseHullId: 'h1' },
    builtInModCount: 0,
    builtInWeaponCount: 0,
    builtInWingCount: 0,
    weaponSlotChangeCount: 0,
    engineSlotChangeCount: 0,
    ...overrides,
  };
}

describe('familyFileId', () => {
  it('reads the family id field from the file data', () => {
    expect(
      familyFileId(variantFamily, {
        baseVersions: [],
        data: { variantId: 'v1' },
        relPath: '',
      }),
    ).toBe('v1');
    expect(
      familyFileId(skinFamily, {
        baseVersions: [],
        data: { skinHullId: 'sk1' },
        relPath: '',
      }),
    ).toBe('sk1');
  });

  it('falls back to an empty string for missing id fields', () => {
    expect(
      familyFileId(variantFamily, {
        baseVersions: [],
        data: {},
        relPath: '',
      }),
    ).toBe('');
  });

  it('stringifies non-string id values', () => {
    expect(
      familyFileId(variantFamily, {
        baseVersions: [],
        data: { variantId: 42 },
        relPath: '',
      }),
    ).toBe('42');
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
    expect(familyFileCompanion(skinFamily, skinFixture({ baseHullId: 'h9' }))).toBe('h9');
    expect(familyFileCompanion(skinFamily, skinFixture({ baseHullId: '' }))).toBe('');
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
