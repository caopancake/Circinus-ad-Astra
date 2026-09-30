import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityData, ResourceRef, RowData, WriteResult } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  querySessionEntity: vi.fn(),
  querySessionEntityList: vi.fn(async () => [] as { id: string }[]),
  queryResourceDataUrls: vi.fn(async () => [] as (string | null)[]),
  writeEditorSpec: vi.fn(),
  loadImportedEditorSpecFile: vi.fn(),
}));

vi.mock('@/services/query.service', () => ({
  querySessionEntity: mocks.querySessionEntity,
  querySessionEntityList: mocks.querySessionEntityList,
}));

vi.mock('@/services/resource-cache.service', () => ({
  queryResourceDataUrls: mocks.queryResourceDataUrls,
}));

vi.mock('@/services/write.service', () => ({
  writeEditorSpec: mocks.writeEditorSpec,
}));

vi.mock('@/services/files.service', () => ({
  loadImportedEditorSpecFile: mocks.loadImportedEditorSpecFile,
}));

import { editorMissingTargetText, defaultEditorSpec, isEditorWindowKind } from '@/domain/editors/editor-definitions';
import {
  queryEditorEntityBundle,
  refreshBundleProjectiles,
  refreshBundleResources,
  saveEditorSpecByKind,
  loadImportedSpecFile,
} from './editor.service';

function entity(data: RowData, refs: Record<string, ResourceRef> = {}): EntityData {
  return { kind: 'ship', id: String(data.id ?? ''), data, resourceRefs: refs };
}

function writeResultFixture(): WriteResult {
  return {
    changes: [],
    invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    keyMap: [],
    refreshedEntity: null,
  };
}

describe('queryEditorEntityBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads a ship bundle with its sprite and isNew=false for existing specs', async () => {
    const spriteRef = { key: 'sprite', mod: 'alpha', path: 'graphics/ship.png' } as unknown as ResourceRef;
    mocks.querySessionEntity.mockResolvedValue(entity({ hullId: 'XY' }, { sprite: spriteRef }));
    mocks.queryResourceDataUrls.mockResolvedValue(['data:image/png;base64,AAA']);

    const bundle = await queryEditorEntityBundle('s1', 'ship', 'XY');
    expect(bundle).toMatchObject({ kind: 'ship', isNew: false, shipSpriteData: 'data:image/png;base64,AAA' });
    expect(bundle.kind === 'ship' && bundle.ship).toEqual({ hullId: 'XY' });
    expect(bundle.kind === 'ship' && bundle.resourceRefs).toEqual([spriteRef]);
  });

  it('marks a missing ship as new and falls back to the default spec', async () => {
    mocks.querySessionEntity.mockResolvedValue(null);
    const bundle = await queryEditorEntityBundle('s1', 'ship', 'XY');
    expect(bundle.kind === 'ship' && bundle.isNew).toBe(true);
    expect(bundle.kind === 'ship' && bundle.ship.hullId).toBe('XY');
    expect(bundle.kind === 'ship' && bundle.shipSpriteData).toBe('');
  });

  it('loads a weapon bundle with csv row, projectile spec and options', async () => {
    mocks.querySessionEntity.mockImplementation(async (_sessionId: string, kind: string, id: string) => {
      if (kind === 'weapon') return entity({ id, spec: { id, projectileSpecId: 'proj1' }, csvRow: { id: 'railgun' } }, {});
      if (kind === 'projectile') return entity({ id: 'proj1' }, {});
      return null;
    });
    mocks.querySessionEntityList.mockResolvedValue([{ id: 'proj1' }, { id: 'proj2' }]);

    const bundle = await queryEditorEntityBundle('s1', 'weapon', 'railgun');
    expect(bundle.kind).toBe('weapon');
    if (bundle.kind !== 'weapon') return;
    expect(bundle.weapon).toEqual({ id: 'railgun', projectileSpecId: 'proj1' });
    expect(bundle.weaponCsvRow).toEqual({ id: 'railgun' });
    expect(bundle.isNew).toBe(false);
    expect(bundle.projectileSpecs).toHaveProperty('proj1');
    expect(bundle.projectileOptions).toEqual([
      { label: 'proj1', value: 'proj1' },
      { label: 'proj2', value: 'proj2' },
    ]);
  });

  it('rejects weapon queries without entity data', async () => {
    mocks.querySessionEntity.mockResolvedValue(null);
    await expect(queryEditorEntityBundle('s1', 'weapon', 'ghost')).rejects.toThrow('找不到 ghost 的 weapon 数据');
  });

  it('treats a weapon spec without fields as new', async () => {
    mocks.querySessionEntity.mockResolvedValue(entity({ id: 'w', spec: {}, csvRow: {} }, {}));
    const bundle = await queryEditorEntityBundle('s1', 'weapon', 'w');
    expect(bundle.kind === 'weapon' && bundle.isNew).toBe(true);
  });

  it('loads projectile and system bundles with new flags', async () => {
    mocks.querySessionEntity.mockResolvedValueOnce(entity({ id: 'p1' }));
    const projectile = await queryEditorEntityBundle('s1', 'projectile', 'p1');
    expect(projectile.kind === 'projectile' && projectile.isNew).toBe(false);

    mocks.querySessionEntity.mockResolvedValueOnce(null);
    const missingSystem = await queryEditorEntityBundle('s1', 'system', 's1');
    expect(missingSystem.kind === 'system' && missingSystem.isNew).toBe(true);
    expect(missingSystem.kind === 'system' && missingSystem.system.type).toBe('STAT_MOD');
  });
});

describe('bundle refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes the ship sprite data from the sprite resource ref', async () => {
    const spriteRef = { key: 'sprite', mod: 'alpha', path: 'graphics/ship.png' } as unknown as ResourceRef;
    mocks.querySessionEntity.mockResolvedValue(entity({ hullId: 'XY' }, { sprite: spriteRef }));
    mocks.queryResourceDataUrls.mockResolvedValue(['data:image/png;base64,BBB']);
    const bundle = await queryEditorEntityBundle('s1', 'ship', 'XY');
    const refreshed = await refreshBundleResources('s1', bundle);
    expect(refreshed.kind === 'ship' && refreshed.shipSpriteData).toBe('data:image/png;base64,BBB');
  });

  it('refreshes weapon projectile specs and drops vanished projectiles', async () => {
    mocks.querySessionEntity.mockImplementation(async (_sessionId: string, kind: string, id: string) => {
      if (kind === 'weapon') return entity({ id, spec: { id, projectileSpecId: 'proj1' }, csvRow: {} }, {});
      if (id === 'proj1') return entity({ id: 'proj1', updated: true }, {});
      return null;
    });
    const bundle = await queryEditorEntityBundle('s1', 'weapon', 'railgun');
    const refreshed = await refreshBundleProjectiles('s1', bundle, { projectileSpecs: true, projectileOptions: false });
    expect(refreshed.kind === 'weapon' && refreshed.projectileSpecs.proj1).toEqual({ id: 'proj1', updated: true });

    mocks.querySessionEntity.mockImplementation(async () => null);
    const emptied = await refreshBundleProjectiles('s1', refreshed, { projectileSpecs: true, projectileOptions: false });
    expect(emptied.kind === 'weapon' && emptied.projectileSpecs).toEqual({});
  });

  it('leaves projectile and system bundles untouched by resource refresh', async () => {
    mocks.querySessionEntity.mockResolvedValue(entity({ id: 'p1' }));
    const bundle = await queryEditorEntityBundle('s1', 'projectile', 'p1');
    await expect(refreshBundleResources('s1', bundle)).resolves.toBe(bundle);
  });
});

describe('saveEditorSpecByKind and import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps write failures with the spec save cause', async () => {
    mocks.writeEditorSpec.mockRejectedValue(new Error('disk on fire'));
    await expect(saveEditorSpecByKind('s1', 'C:/mods/alpha', 'ship', 'XY', { hullId: 'XY' })).rejects.toThrow('保存 XY spec 失败');
    expect(mocks.writeEditorSpec).toHaveBeenCalledWith('s1', 'C:/mods/alpha', 'ship', 'XY', { hullId: 'XY' }, undefined);
  });

  it('passes successful writes through unchanged', async () => {
    const result = writeResultFixture();
    mocks.writeEditorSpec.mockResolvedValue(result);
    await expect(saveEditorSpecByKind('s1', 'C:/mods/alpha', 'system', 'S1', { id: 'S1' })).resolves.toBe(result);
  });

  it('rejects saves without a mod root or id before touching the writer', async () => {
    await expect(saveEditorSpecByKind('s1', '', 'ship', 'XY', {})).rejects.toMatchObject({ action: 'save-spec' });
    await expect(saveEditorSpecByKind('s1', 'C:/mods/alpha', 'ship', '', {})).rejects.toMatchObject({ action: 'save-spec' });
    expect(mocks.writeEditorSpec).not.toHaveBeenCalled();
  });

  it('delegates imported spec file loads', async () => {
    mocks.loadImportedEditorSpecFile.mockResolvedValue({ id: 'imported' });
    await expect(loadImportedSpecFile('ship', 'C:/temp/x.ship')).resolves.toEqual({ id: 'imported' });
  });
});

describe('editor definitions helpers', () => {
  it('recognizes window kinds and reports missing target text', () => {
    expect(isEditorWindowKind('ship')).toBe(true);
    expect(isEditorWindowKind('weapon-preview')).toBe(true);
    expect(isEditorWindowKind('not-a-kind')).toBe(false);
    expect(isEditorWindowKind(null)).toBe(false);
    expect(editorMissingTargetText('ship', 'XY')).toContain('spec');
    expect(editorMissingTargetText('weapon-preview', 'XY')).toContain('预览数据');
  });

  it('builds a beam weapon default when the csv row declares beam speed', () => {
    const beam = defaultEditorSpec('weapon', 'laser', { 'beam speed': 1 });
    expect(beam.specClass).toBe('beam');
    expect(beam.fringeColor).toBeDefined();
    const projectile = defaultEditorSpec('weapon', 'cannon', {});
    expect(projectile.specClass).toBe('projectile');
  });
});
