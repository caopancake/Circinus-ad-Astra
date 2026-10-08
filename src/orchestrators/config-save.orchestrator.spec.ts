import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  completeSavedWrite: vi.fn(() => Promise.resolve()),
  writeModFiles: vi.fn(),
  writeIndexedConfigEntity: vi.fn(),
  writeCreateIndexedConfigEntity: vi.fn(),
  writeDeleteIndexedConfigEntity: vi.fn(),
  writeVariantEntity: vi.fn(),
  writeCreateVariantEntity: vi.fn(),
  writeDeleteVariantEntity: vi.fn(),
  writeSkinEntity: vi.fn(),
  writeCreateSkinEntity: vi.fn(),
  writeDeleteSkinEntity: vi.fn(),
}));

vi.mock('@/orchestrators/file-history-write.orchestrator', () => ({ completeSavedWrite: mocks.completeSavedWrite }));

vi.mock('@/services/write.service', () => ({
  writeModFiles: mocks.writeModFiles,
  writeIndexedConfigEntity: mocks.writeIndexedConfigEntity,
  writeCreateIndexedConfigEntity: mocks.writeCreateIndexedConfigEntity,
  writeDeleteIndexedConfigEntity: mocks.writeDeleteIndexedConfigEntity,
  writeVariantEntity: mocks.writeVariantEntity,
  writeCreateVariantEntity: mocks.writeCreateVariantEntity,
  writeDeleteVariantEntity: mocks.writeDeleteVariantEntity,
  writeSkinEntity: mocks.writeSkinEntity,
  writeCreateSkinEntity: mocks.writeCreateSkinEntity,
  writeDeleteSkinEntity: mocks.writeDeleteSkinEntity,
}));

import {
  createIndexedEntityAction,
  createSkinAction,
  createVariantAction,
  deleteIndexedEntityAction,
  deleteSkinAction,
  deleteVariantAction,
  saveIndexedEntityAction,
  saveModInfoAction,
  saveSkinAction,
  saveVariantAction,
} from '@/orchestrators/config-save.orchestrator';
import { createDefaultVariant, indexedConfigHistoryLabel } from '@/domain/config/config-entities';

const MOD_ROOT = 'M:\\test-mod';
const SESSION_ID = 'sess-1';

function writeResult(refreshedEntity: Record<string, unknown> | null = null) {
  return {
    baseVersions: [],
    commitId: 1,
    history: { revision: 1, undoStack: [], redoStack: [] },
    changes: [
      {
        path: `${MOD_ROOT}\\x.csv`,
        kind: 'file',
        beforeExists: true,
        beforeText: '',
        beforeDataBase64: null,
        beforeFiles: [],
        afterExists: true,
        afterText: '',
        afterDataBase64: null,
        afterFiles: [],
      },
    ],
    invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    keyMap: [],
    refreshedEntity,
    warnings: [],
  };
}

function indexedEntity(entityId: string) {
  return { entityId, indexPath: `${entityId}.csv`, indexHeader: ['id'], indexRows: [], entityData: null };
}

beforeEach(() => {
  setActivePinia(createPinia());
  for (const mock of Object.values(mocks)) mock.mockResolvedValue(writeResult());
});

describe('config-save orchestrator', () => {
  it('writes mod_info.json as an associated file change and records history', async () => {
    mocks.writeModFiles.mockResolvedValue(writeResult());

    await saveModInfoAction(SESSION_ID, MOD_ROOT, { id: 'demo' });

    expect(mocks.writeModFiles).toHaveBeenCalledWith(
      SESSION_ID,
      MOD_ROOT,
      [{ relPath: 'mod_info.json', afterText: JSON.stringify({ id: 'demo' }, null, 2), afterDataBase64: null }],
      [],
    );
    expect(mocks.completeSavedWrite).toHaveBeenCalledWith(
      { modRoot: MOD_ROOT, sessionId: SESSION_ID, label: '保存 mod_info.json', result: expect.anything() },
      expect.anything(),
    );
  });

  it('does not record file history when a preserved JSON save has no changes', async () => {
    mocks.writeModFiles.mockResolvedValue({ ...writeResult(), changes: [] });
    await saveModInfoAction(SESSION_ID, MOD_ROOT, { id: 'demo' });
    expect(mocks.completeSavedWrite).not.toHaveBeenCalled();
  });

  it('save indexed entity returns the refreshed entity id and records a save label', async () => {
    mocks.writeIndexedConfigEntity.mockResolvedValue(writeResult(indexedEntity('npc_dave')));

    const entityId = await saveIndexedEntityAction({
      baseVersions: [],
      sessionId: SESSION_ID,
      modRoot: MOD_ROOT,
      kind: 'faction',
      previousId: 'npc_dave',
      nextId: 'npc_dave',
      indexRow: {},
      entityData: {},
      deletePreviousTarget: false,
    });

    expect(entityId).toMatchObject({ entityId: 'npc_dave', baseVersions: [] });
    expect(mocks.completeSavedWrite).toHaveBeenCalledWith(
      { modRoot: MOD_ROOT, sessionId: SESSION_ID, label: '保存 npc_dave.faction', result: expect.anything() },
      expect.anything(),
    );
  });

  it('create indexed entity delegates to the create write and records a create label', async () => {
    mocks.writeCreateIndexedConfigEntity.mockResolvedValue(writeResult(indexedEntity('mission_new')));

    const entityId = await createIndexedEntityAction({
      baseVersions: [],
      sessionId: SESSION_ID,
      modRoot: MOD_ROOT,
      kind: 'mission',
      previousId: null,
      nextId: 'mission_new',
      indexRow: {},
      entityData: {},
      deletePreviousTarget: false,
    });

    expect(entityId).toBe('mission_new');
    expect(mocks.writeCreateIndexedConfigEntity).toHaveBeenCalledTimes(1);
    expect(mocks.writeIndexedConfigEntity).not.toHaveBeenCalled();
    expect(mocks.completeSavedWrite).toHaveBeenCalledWith(
      {
        modRoot: MOD_ROOT,
        sessionId: SESSION_ID,
        label: indexedConfigHistoryLabel('mission', 'create', 'mission_new'),
        result: expect.anything(),
      },
      expect.anything(),
    );
  });

  it('delete indexed entity forwards the delete target flag', async () => {
    mocks.writeDeleteIndexedConfigEntity.mockResolvedValue(writeResult(indexedEntity('npc_old')));

    await deleteIndexedEntityAction(SESSION_ID, MOD_ROOT, 'faction', 'npc_old', true);

    expect(mocks.writeDeleteIndexedConfigEntity).toHaveBeenCalledWith({
      baseVersions: [],
      sessionId: SESSION_ID,
      modRoot: MOD_ROOT,
      kind: 'faction',
      id: 'npc_old',
      deleteTarget: true,
    });
  });

  it('variant create seeds the default variant payload', async () => {
    mocks.writeCreateVariantEntity.mockResolvedValue(
      writeResult({
        baseVersions: [],
        variantId: 'variant_new',
        hullId: 'npc_dave',
        path: 'data/variants/variant_new.variant',
        relPath: 'variants/variant_new.variant',
        data: {},
        weaponGroupCount: 0,
        hullModCount: 0,
        permaModCount: 0,
        wingCount: 0,
      }),
    );

    const variant = await createVariantAction(SESSION_ID, MOD_ROOT, 'npc_dave', 'variant_new');

    expect(variant.variantId).toBe('variant_new');
    const payload = mocks.writeCreateVariantEntity.mock.calls[0]![0];
    expect(payload.nextId).toBe('variant_new');
    expect(payload.data).toEqual(createDefaultVariant('npc_dave', 'variant_new'));
  });

  it('variant save forwards the previous id for renames', async () => {
    mocks.writeVariantEntity.mockResolvedValue(
      writeResult({
        baseVersions: [],
        variantId: 'variant_b',
        hullId: 'npc_dave',
        path: 'data/variants/variant_b.variant',
        relPath: 'variants/variant_b.variant',
        data: {},
        weaponGroupCount: 0,
        hullModCount: 0,
        permaModCount: 0,
        wingCount: 0,
      }),
    );

    await saveVariantAction(SESSION_ID, MOD_ROOT, 'variant_b', { variantId: 'variant_b' }, 'variant_a', 'data/variants/variant_a.variant');

    expect(mocks.writeVariantEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVersions: [],
        sessionId: SESSION_ID,
        modRoot: MOD_ROOT,
        previousId: 'variant_a',
        nextId: 'variant_b',
      }),
      { preserveOriginalJson: false, confirmedSources: [] },
    );
  });

  it('variant delete forwards the relative path', async () => {
    mocks.writeDeleteVariantEntity.mockResolvedValue(writeResult());

    await deleteVariantAction(SESSION_ID, MOD_ROOT, 'variants/old.variant', 'old');

    expect(mocks.writeDeleteVariantEntity).toHaveBeenCalledWith({
      baseVersions: [],
      sessionId: SESSION_ID,
      modRoot: MOD_ROOT,
      relPath: 'variants/old.variant',
      entityId: 'old',
    });
  });

  it('skin create seeds the default skin payload', async () => {
    mocks.writeCreateSkinEntity.mockResolvedValue(
      writeResult({
        baseVersions: [],
        skinHullId: 'skin_new',
        baseHullId: 'npc_dave',
        path: 'data/hulls/skin_new.skin',
        relPath: 'skins/skin_new.skin',
        data: {},
        builtInModCount: 0,
        builtInWeaponCount: 0,
        builtInWingCount: 0,
        weaponSlotChangeCount: 0,
        engineSlotChangeCount: 0,
      }),
    );

    const skin = await createSkinAction(SESSION_ID, MOD_ROOT, 'npc_dave', 'skin_new');

    expect(skin.skinHullId).toBe('skin_new');
    expect(mocks.writeCreateSkinEntity).toHaveBeenCalledTimes(1);
  });

  it('skin save forwards the previous id', async () => {
    mocks.writeSkinEntity.mockResolvedValue(
      writeResult({
        baseVersions: [],
        skinHullId: 'skin_b',
        baseHullId: 'npc_dave',
        path: 'data/hulls/skin_b.skin',
        relPath: 'skins/skin_b.skin',
        data: {},
        builtInModCount: 0,
        builtInWeaponCount: 0,
        builtInWingCount: 0,
        weaponSlotChangeCount: 0,
        engineSlotChangeCount: 0,
      }),
    );

    await saveSkinAction(SESSION_ID, MOD_ROOT, 'skin_b', { skinHullId: 'skin_b' }, 'skin_a', 'data/hulls/skins/skin_a.skin');

    expect(mocks.writeSkinEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVersions: [],
        sessionId: SESSION_ID,
        modRoot: MOD_ROOT,
        previousId: 'skin_a',
        nextId: 'skin_b',
      }),
      { preserveOriginalJson: false, confirmedSources: [] },
    );
  });

  it('skin delete forwards the relative path', async () => {
    mocks.writeDeleteSkinEntity.mockResolvedValue(writeResult());

    await deleteSkinAction(SESSION_ID, MOD_ROOT, 'skins/old.skin', 'old');

    expect(mocks.writeDeleteSkinEntity).toHaveBeenCalledWith({
      baseVersions: [],
      sessionId: SESSION_ID,
      modRoot: MOD_ROOT,
      relPath: 'skins/old.skin',
      entityId: 'old',
    });
  });
});
