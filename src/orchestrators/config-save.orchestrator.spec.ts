import { beforeEach, describe, expect, it, vi } from 'vitest';
import { entityTargetFixture } from '@/test/entity-target';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  completeSavedWrite: vi.fn(() => Promise.resolve()),
  writeModInfo: vi.fn(),
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
vi.mock('@/services/config-entity.service', () => ({
  captureConfigIdentityIntent: async (_session: string, kind: import('@/shared/types').EntityKind, sourceId: string, nextId: string) => {
    const source = entityTargetFixture(kind, sourceId);
    const next = entityTargetFixture(kind, nextId);
    return {
      info: { target: source, baseVersions: [] },
      intent: { source, nextId, nextWrite: next.write, destinationVersion: { path: next.write.path, fingerprint: null } },
    };
  },
}));
vi.mock('@/orchestrators/entity-identity.orchestrator', () => ({ reserveFileIdentityIntent: vi.fn(async () => {}) }));
vi.mock('@/services/window.service', () => ({ releaseNativeWindowTargets: vi.fn(async () => {}) }));

vi.mock('@/services/write.service', () => ({
  writeModInfo: mocks.writeModInfo,
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
  completeConfigSave,
  saveSkinAction,
  saveVariantAction,
} from '@/orchestrators/config-save.orchestrator';
import { createDefaultVariant, indexedConfigHistoryLabel } from '@/domain/config/config-entities';

const MOD_ROOT = 'M:\\test-mod';
const SESSION_ID = 'sess-1';

function writeResult(refreshedEntity: Record<string, unknown> | null = null) {
  const kind = refreshedEntity?.variantId ? 'variant' : 'skin';
  const id = (refreshedEntity?.variantId ?? refreshedEntity?.skinHullId ?? '') as string;
  const target = entityTargetFixture(kind, id);
  return {
    sessionUpdates: [],
    baseVersions: [],
    commitId: 1,
    history: { revision: 1, undoStack: [], redoStack: [] },
    changes: [
      {
        beforePath: `${MOD_ROOT}\\x.csv`,
        afterPath: `${MOD_ROOT}\\x.csv`,
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
    identityChanges: id ? [{ before: target, after: target }] : [],
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
  it.each(['variant', 'skin'] as const)('preserves %s loaded credentials for same-ID and case-only writes', async (kind) => {
    const source = entityTargetFixture(kind, 'Demo');
    const baseVersions = [{ path: source.write.path, fingerprint: 'loaded-spec' }];
    const save = kind === 'variant' ? saveVariantAction : saveSkinAction;
    const write = kind === 'variant' ? mocks.writeVariantEntity : mocks.writeSkinEntity;
    const field = kind === 'variant' ? 'variantId' : 'skinHullId';
    for (const nextId of ['Demo', 'demo']) {
      write.mockResolvedValue(writeResult({ [field]: nextId, data: { [field]: nextId } }));
      await save(SESSION_ID, MOD_ROOT, nextId, { [field]: nextId }, 'Demo', source.write.relPath, undefined, baseVersions);
      expect(write.mock.lastCall?.[0].baseVersions).toEqual(baseVersions);
    }
  });
  it('writes canonical mod info and synchronizes its captured receipt', async () => {
    mocks.writeModInfo.mockResolvedValue(writeResult());

    const result = await saveModInfoAction(SESSION_ID, MOD_ROOT, { id: 'demo' });
    await completeConfigSave(MOD_ROOT, SESSION_ID, result!, '保存 mod_info.json');

    expect(mocks.writeModInfo).toHaveBeenCalledWith(
      SESSION_ID,
      MOD_ROOT,
      { id: 'demo' },
      { preserveOriginalJson: false, confirmedSources: [] },
      [],
    );
    expect(mocks.completeSavedWrite).toHaveBeenCalledWith({
      modRoot: MOD_ROOT,
      sessionId: SESSION_ID,
      label: '保存 mod_info.json',
      result: expect.anything(),
    });
  });

  it('does not record file history when a preserved JSON save has no changes', async () => {
    mocks.writeModInfo.mockResolvedValue({ ...writeResult(), changes: [] });
    const result = await saveModInfoAction(SESSION_ID, MOD_ROOT, { id: 'demo' });
    await completeConfigSave(MOD_ROOT, SESSION_ID, result!, '保存 mod_info.json');
    expect(mocks.completeSavedWrite).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ changes: [] }) }));
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
    });

    expect(entityId?.entity).toMatchObject({ entityId: 'npc_dave', baseVersions: [] });
    await completeConfigSave(MOD_ROOT, SESSION_ID, entityId!.receipt, '保存 npc_dave.faction');
    expect(mocks.completeSavedWrite).toHaveBeenCalledWith({
      modRoot: MOD_ROOT,
      sessionId: SESSION_ID,
      label: '保存 npc_dave.faction',
      result: expect.anything(),
    });
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
    });

    expect(entityId).toBe('mission_new');
    expect(mocks.writeCreateIndexedConfigEntity).toHaveBeenCalledTimes(1);
    expect(mocks.writeIndexedConfigEntity).not.toHaveBeenCalled();
    expect(mocks.completeSavedWrite).toHaveBeenCalledWith({
      modRoot: MOD_ROOT,
      sessionId: SESSION_ID,
      label: indexedConfigHistoryLabel('mission', 'create', 'mission_new'),
      result: expect.anything(),
    });
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

    expect(variant.id).toBe('variant_new');
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
        baseVersions: [{ path: 'M:/mod/data/variants/variant_b.variant', fingerprint: null }],
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

    expect(skin.id).toBe('skin_new');
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
        baseVersions: [{ path: 'M:/mod/data/hulls/skins/skin_b.skin', fingerprint: null }],
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
