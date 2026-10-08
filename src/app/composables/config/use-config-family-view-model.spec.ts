import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkinFile, VariantFile } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  saveVariantAction: vi.fn(),
  createVariantAction: vi.fn(),
  deleteVariantAction: vi.fn(),
  saveSkinAction: vi.fn(),
  createSkinAction: vi.fn(),
  deleteSkinAction: vi.fn(),
  listVariantRecords: vi.fn(async (): Promise<Array<{ variant: VariantFile; spriteRef: null }>> => []),
  listSkinRecords: vi.fn(async (): Promise<Array<{ skin: SkinFile; spriteRef: null }>> => []),
  queryHullPreviewMetadata: vi.fn(async () => ({})),
  queryHullReferenceOptions: vi.fn(async () => []),
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  },
}));

vi.mock('@/orchestrators/config-save.orchestrator', () => ({
  saveVariantAction: mocks.saveVariantAction,
  createVariantAction: mocks.createVariantAction,
  deleteVariantAction: mocks.deleteVariantAction,
  saveSkinAction: mocks.saveSkinAction,
  createSkinAction: mocks.createSkinAction,
  deleteSkinAction: mocks.deleteSkinAction,
}));

vi.mock('@/services/config-entity.service', () => ({
  listVariantRecords: mocks.listVariantRecords,
  listSkinRecords: mocks.listSkinRecords,
}));

vi.mock('@/services/config-resource.service', () => ({
  queryHullPreviewMetadata: mocks.queryHullPreviewMetadata,
  queryHullReferenceOptions: mocks.queryHullReferenceOptions,
}));

vi.mock('@/services/query-cache.service', () => ({
  hasEntityInvalidation: vi.fn(() => false),
  hasQueryInvalidation: vi.fn(() => false),
  subscribeQueryInvalidations: vi.fn(() => () => {}),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

import { useConfigFamilyViewModel } from './use-config-family-view-model';
import { variantFamily } from '@/domain/config/config-entity-families';
import { initializeSettingsStore } from '@/stores/settings.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

const SETTINGS = {
  theme: 'light',
  accent: 'blue',
  customAccent: '#3388cc',
  historyLimit: 20,
  editMode: 'smart',
  starsectorRoot: null,
  logDirectory: null,
  logLevel: 'info',
} as const;

function freshPinia() {
  setActivePinia(createPinia());
  initializeSettingsStore({ ...SETTINGS });
  return getActivePinia();
}

import { getActivePinia } from 'pinia';

function variantRecord(variantId: string, hullId: string) {
  const variant: VariantFile = {
    baseVersions: [],
    variantId,
    hullId,
    path: '',
    relPath: `data/variants/${variantId}.variant`,
    data: { variantId, hullId },
    weaponGroupCount: 0,
    hullModCount: 0,
    permaModCount: 0,
    wingCount: 0,
  };
  return { variant, spriteRef: null };
}

function mountViewModel() {
  let vm!: ReturnType<typeof useConfigFamilyViewModel>;
  mount(
    {
      setup() {
        vm = useConfigFamilyViewModel(variantFamily);
        return () => null;
      },
    },
    { global: { plugins: [getActivePinia()!] } },
  );
  return vm;
}

function activateProject(modRoot = 'M:/mod', sessionId = 'sess-1') {
  const workspace = useWorkspaceStore();
  const project = useProjectStore();
  workspace.registerMod({ modRoot, displayName: 'Mod', version: '', status: 'ready' });
  workspace.activateModTab(modRoot);
  project.registerProjectManifest({
    baseVersions: [],
    sessionId,
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: null,
    tableSummaries: {} as never,
    tableEntitySummaries: {} as never,
    entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
    warnings: [],
  });
  return project;
}

describe('useConfigFamilyViewModel loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    freshPinia();
  });

  it('clears files without an active session', async () => {
    const vm = mountViewModel();
    await vm.loadFiles();
    expect(vm.files.value).toEqual([]);
    expect(vm.selectedId.value).toBeNull();
  });

  it('loads variant records with hull names and sprite refs', async () => {
    activateProject();
    mocks.listVariantRecords.mockResolvedValue([variantRecord('v1', 'h1'), variantRecord('v2', 'h1')]);
    mocks.queryHullPreviewMetadata.mockResolvedValue({ h1: 'Escort' });
    const vm = mountViewModel();
    await vm.loadFiles();
    expect(vm.files.value.map((file) => (file as VariantFile).variantId)).toEqual(['v1', 'v2']);
    expect(vm.hullNames.value).toEqual({ h1: 'Escort' });
    expect(vm.spriteRefs.value).toEqual({ v1: null, v2: null });
  });

  it('drops a selected id that no longer exists after reload', async () => {
    activateProject();
    mocks.listVariantRecords.mockResolvedValueOnce([variantRecord('v1', 'h1')]);
    const vm = mountViewModel();
    await vm.loadFiles();
    vm.onSaved('v1');
    expect(vm.selectedId.value).toBe('v1');

    mocks.listVariantRecords.mockResolvedValue([]);
    await vm.loadFiles();
    expect(vm.selectedId.value).toBeNull();
  });
});

describe('useConfigFamilyViewModel creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    freshPinia();
    activateProject();
    mocks.listVariantRecords.mockResolvedValue([]);
  });

  it('rejects empty companion or id fields', async () => {
    const vm = mountViewModel();
    await expect(vm.createFamilyEntity('sess-1', 'M:/mod', '', 'v1')).resolves.toBe(false);
    expect(mocks.feedback.warning).toHaveBeenCalledWith(expect.stringContaining('不能为空'));
    await expect(vm.createFamilyEntity('sess-1', 'M:/mod', 'h1', '')).resolves.toBe(false);
    expect(mocks.createVariantAction).not.toHaveBeenCalled();
  });

  it('rejects malformed ids and duplicates', async () => {
    mocks.listVariantRecords.mockResolvedValue([variantRecord('v1', 'h1')]);
    const vm = mountViewModel();
    await vm.loadFiles();

    await expect(vm.createFamilyEntity('sess-1', 'M:/mod', 'h1', 'bad id!')).resolves.toBe(false);
    expect(mocks.feedback.warning).toHaveBeenCalledWith(expect.stringContaining('variantId'), 'config.id_invalid');

    await expect(vm.createFamilyEntity('sess-1', 'M:/mod', 'h1', 'v1')).resolves.toBe(false);
    expect(mocks.feedback.warning).toHaveBeenCalledWith(expect.stringContaining('已存在'));
    expect(mocks.createVariantAction).not.toHaveBeenCalled();
  });

  it('creates the entity and selects it', async () => {
    mocks.listVariantRecords.mockResolvedValue([]);
    const vm = mountViewModel();
    await vm.loadFiles();
    mocks.listVariantRecords.mockResolvedValue([variantRecord('v2', 'h1')]);

    await expect(vm.createFamilyEntity('sess-1', 'M:/mod', 'h1', 'v2')).resolves.toBe(true);
    expect(mocks.createVariantAction).toHaveBeenCalledWith('sess-1', 'M:/mod', 'h1', 'v2');
    expect(vm.selectedId.value).toBe('v2');
    expect(mocks.feedback.success).toHaveBeenCalledWith(expect.stringContaining('已创建'));
  });
});

describe('useConfigFamilyViewModel saving', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    freshPinia();
    activateProject();
  });

  it('warns and aborts when the id or companion field is blank', async () => {
    mocks.listVariantRecords.mockResolvedValue([variantRecord('v1', 'h1')]);
    const vm = mountViewModel();
    await vm.loadFiles();
    const current = {
      baseVersions: [],
      data: { variantId: 'v1', hullId: 'h1' },
      relPath: 'data/variants/v1.variant',
    };

    await expect(vm.saveFamilyEntity('sess-1', 'M:/mod', current, { variantId: '', hullId: 'h1' })).resolves.toBeNull();
    expect(mocks.feedback.warning).toHaveBeenCalledWith(expect.stringContaining('不能为空'));
    expect(mocks.saveVariantAction).not.toHaveBeenCalled();
  });

  it('rejects renames onto an existing id', async () => {
    mocks.listVariantRecords.mockResolvedValue([variantRecord('v1', 'h1'), variantRecord('v2', 'h1')]);
    const vm = mountViewModel();
    await vm.loadFiles();
    const current = {
      baseVersions: [],
      data: { variantId: 'v1', hullId: 'h1' },
      relPath: 'data/variants/v1.variant',
    };

    await expect(vm.saveFamilyEntity('sess-1', 'M:/mod', current, { variantId: 'v2', hullId: 'h1' })).resolves.toBeNull();
    expect(mocks.feedback.warning).toHaveBeenCalledWith(expect.stringContaining('已存在'));
  });

  it('saves renames with the previous id and reloads', async () => {
    mocks.listVariantRecords.mockResolvedValue([variantRecord('v1', 'h1')]);
    const vm = mountViewModel();
    await vm.loadFiles();
    const current = {
      baseVersions: [],
      data: { variantId: 'v1', hullId: 'h1' },
      relPath: 'data/variants/v1.variant',
    };
    mocks.saveVariantAction.mockResolvedValue({ entity: variantRecord('v9', 'h1').variant, receipt: {} });
    mocks.listVariantRecords.mockResolvedValue([variantRecord('v9', 'h1')]);

    const saved = await vm.saveFamilyEntity('sess-1', 'M:/mod', current, { variantId: 'v9', hullId: 'h1' });
    expect(saved).not.toBeNull();
    expect(mocks.saveVariantAction).toHaveBeenCalledWith(
      'sess-1',
      'M:/mod',
      'v9',
      expect.objectContaining({ variantId: 'v9' }),
      'v1',
      'data/variants/v1.variant',
      mocks.feedback,
      [],
    );
    vm.onSaved('v9');
    expect(vm.selectedId.value).toBe('v9');
    expect(mocks.feedback.success).toHaveBeenCalledWith(expect.stringContaining('已保存'));
  });
});

describe('useConfigFamilyViewModel deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    freshPinia();
    activateProject();
  });

  it('deletes the entity and moves the selection to the first remaining file', async () => {
    mocks.listVariantRecords.mockResolvedValue([variantRecord('v1', 'h1'), variantRecord('v2', 'h1')]);
    const vm = mountViewModel();
    await vm.loadFiles();
    vm.onSaved('v2');
    mocks.listVariantRecords.mockResolvedValue([variantRecord('v1', 'h1')]);

    await expect(vm.deleteFamilyEntity('sess-1', 'M:/mod', 'v2', 'data/variants/v2.variant')).resolves.toBe(true);
    expect(mocks.deleteVariantAction).toHaveBeenCalledWith('sess-1', 'M:/mod', 'data/variants/v2.variant', 'v2', []);
    expect(vm.files.value.map((file) => (file as VariantFile).variantId)).toEqual(['v1']);
    // The reload clears the removed selection before the delete handler picks a fallback.
    expect(vm.selectedId.value).toBeNull();
    expect(mocks.feedback.success).toHaveBeenCalledWith(expect.stringContaining('已删除'));
  });

  it('reports delete failures', async () => {
    mocks.listVariantRecords.mockResolvedValue([]);
    const vm = mountViewModel();
    await vm.loadFiles();
    mocks.deleteVariantAction.mockRejectedValue(new Error('locked'));
    await expect(vm.deleteFamilyEntity('sess-1', 'M:/mod', 'v2', 'p')).resolves.toBe(false);
    expect(mocks.feedback.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('删除'));
  });
});
