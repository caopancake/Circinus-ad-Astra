import { entityTargetFixture } from '@/test/entity-target';
import { savedWriteFixture } from '@/test/write-result';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfigEntityFamilyView from './ConfigEntityFamilyView.vue';
import ConfigFactionView from './ConfigFactionView.vue';
import { initializeSettingsStore } from '@/stores/settings.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';
import { invalidateQueryCacheByProject } from '@/services/query-cache.service';
import { editorUiStubs } from '@/test/ui-stubs';
import { ref } from 'vue';
import type { AppFeedback, FileVersion, ProjectManifest, RowData } from '@/shared/types';
import type { ConfigFactionRecord, ConfigFamilyRecord } from '@/domain/config/config-records';

const mocks = vi.hoisted(() => ({
  identityHandler: null as null | ((event: import('@/windows/window.events').EntityIdentityAppliedEvent) => Promise<void>),
  variants: vi.fn<() => Promise<ConfigFamilyRecord[]>>(),
  skins: vi.fn<() => Promise<ConfigFamilyRecord[]>>(),
  factions: vi.fn<() => Promise<ConfigFactionRecord[]>>(),
  saveVariant: vi.fn(async () => null),
  saveSkin: vi.fn(async () => null),
  saveFaction: vi.fn(async () => null),
  feedback: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    confirmWarning: vi.fn<AppFeedback['confirmWarning']>(),
    confirmDanger: vi.fn(),
    choose: vi.fn(),
  },
}));

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => mocks.feedback }));
vi.mock('@/services/config-entity.service', () => ({
  getConfigFactionRecord: async () => (await mocks.factions())[0] ?? null,
  getConfigFamilyRecord: async (_session: string, kind: string) =>
    (await (kind === 'variant' ? mocks.variants() : mocks.skins()))[0] ?? null,
  listVariantRecords: mocks.variants,
  listSkinRecords: mocks.skins,
  listConfigFactionRecords: mocks.factions,
  queryFactionPreviewImages: async () => ({ crestSrc: '', logoSrc: '' }),
}));
vi.mock('@/orchestrators/entity-events.orchestrator', () => ({
  listenEntityIdentityApplied: vi.fn(async (handler) => {
    mocks.identityHandler = handler;
    return () => {};
  }),
}));
vi.mock('@/orchestrators/config-save.orchestrator', () => ({
  completeConfigSave: vi.fn(async () => {}),
  saveVariantAction: mocks.saveVariant,
  saveSkinAction: mocks.saveSkin,
  saveIndexedEntityAction: mocks.saveFaction,
  createVariantAction: vi.fn(),
  createSkinAction: vi.fn(),
  createIndexedEntityAction: vi.fn(),
  deleteVariantAction: vi.fn(),
  deleteSkinAction: vi.fn(),
  deleteIndexedEntityAction: vi.fn(),
}));
vi.mock('@/services/config-resource.service', () => ({
  queryHullPreviewMetadata: async () => ({}),
  queryHullReferenceOptions: async () => [],
  queryBuiltInWeaponSlotOptions: async () => [],
}));
vi.mock('@/app/composables/use-visible-resource-media', () => ({
  useVisibleResourceMedia: () => ({
    mediaRef: () => () => {},
    mediaSrc: () => '',
    recordListFirstFrame: async () => {},
    setMediaRoot: () => {},
  }),
}));
vi.mock('@/app/composables/use-schema-runtime-context', () => ({
  useSchemaRuntimeContext: () => null,
  createSchemaRuntimeContext: () => ({ querySourceOptions: async () => [], subscribeSourceOptionInvalidation: () => () => {} }),
}));
vi.mock('@/domain/schema/schema-registry', () => ({
  getSchema: (id: string) => ({
    id,
    sections: [
      {
        id: 'main',
        label: 'Fields',
        fields: [
          { key: 'displayName', label: 'Name', type: 'string' },
          { key: id === 'variant' ? 'variantId' : 'skinHullId', label: 'ID', type: 'string' },
        ],
      },
    ],
  }),
}));
vi.mock('@/app/composables/use-core-assets', () => ({
  useCoreGraphics: () => ({ graphicsPaths: ref([]), loadGraphics: async () => {} }),
  useCoreSchema: () => ({
    loadCoreFields: async () => {},
    getMergedSchema: () => ({
      id: 'faction',
      sources: [{ id: 'file', type: 'json-file', path: 'same.faction' }],
      sections: [
        {
          id: 'main',
          label: 'Fields',
          fields: [
            { key: 'file.displayName', label: 'Name', type: 'string' },
            { key: 'file.id', label: 'ID', type: 'string' },
          ],
        },
      ],
    }),
  }),
}));

type Kind = 'variant' | 'skin' | 'faction';
let wrapper: VueWrapper | null = null;

function versions(root: string, fingerprint = 'v1'): FileVersion[] {
  return [{ path: `${root}/same.file`, fingerprint }];
}

function variant(root: string, name: string, fingerprint = 'v1'): ConfigFamilyRecord {
  return {
    spriteRef: null,
    file: {
      target: entityTargetFixture('variant', 'same'),
      id: 'same',
      path: `${root}/same.file`,
      relPath: 'same.file',
      baseVersions: versions(root, fingerprint),
      data: { variantId: 'same', hullId: 'hull', displayName: name },
    },
  };
}

function skin(root: string, name: string, fingerprint = 'v1'): ConfigFamilyRecord {
  return {
    spriteRef: null,
    file: {
      target: entityTargetFixture('skin', 'same'),
      id: 'same',
      path: `${root}/same.file`,
      relPath: 'same.file',
      baseVersions: versions(root, fingerprint),
      data: { skinHullId: 'same', baseHullId: 'hull', displayName: name },
    },
  };
}

function setRecords(kind: Kind, root: string, name: string, fingerprint = 'v1') {
  if (kind === 'variant') mocks.variants.mockResolvedValue([variant(root, name, fingerprint)]);
  if (kind === 'skin') mocks.skins.mockResolvedValue([skin(root, name, fingerprint)]);
  if (kind === 'faction')
    mocks.factions.mockResolvedValue([
      { id: 'same', data: { id: 'same', displayName: name }, crestRef: null, baseVersions: versions(root, fingerprint) },
    ]);
}

function deferRecords(kind: Kind, root: string, name: string) {
  let release!: () => void;
  let reject!: (error: Error) => void;
  if (kind === 'variant')
    mocks.variants.mockImplementation(
      () =>
        new Promise((resolve, fail) => {
          release = () => resolve([variant(root, name)]);
          reject = fail;
        }),
    );
  if (kind === 'skin')
    mocks.skins.mockImplementation(
      () =>
        new Promise((resolve, fail) => {
          release = () => resolve([skin(root, name)]);
          reject = fail;
        }),
    );
  if (kind === 'faction')
    mocks.factions.mockImplementation(
      () =>
        new Promise((resolve, fail) => {
          release = () => resolve([{ id: 'same', data: { id: 'same', displayName: name }, crestRef: null, baseVersions: versions(root) }]);
          reject = fail;
        }),
    );
  return { release: () => release(), reject: (error: Error) => reject(error) };
}

function activate(root: string, kind: Kind) {
  useWorkspaceStore().activateModConfig(root, kind === 'faction' ? 'factions' : kind === 'skin' ? 'skins' : 'variants');
}

async function select(kind: Kind) {
  if (kind !== 'faction') await wrapper!.get('.config-entity-list-item').trigger('click');
  await flushPromises();
}

async function mountPage(kind: Kind) {
  activate('M:/A', kind);
  setRecords(kind, 'M:/A', 'A');
  wrapper =
    kind === 'faction'
      ? mount(ConfigFactionView, { global: { stubs: { ...editorUiStubs, 'n-modal': true } } })
      : mount(ConfigEntityFamilyView, { props: { familyId: kind }, global: { stubs: { ...editorUiStubs, 'n-modal': true } } });
  await flushPromises();
  await select(kind);
}

function input() {
  return wrapper!.get('.schema-section textarea');
}

async function save(kind: Kind) {
  await wrapper!
    .findAll('button')
    .find((button) => button.text() === '保存')!
    .trigger('click');
  await flushPromises();
  const calls = (kind === 'variant' ? mocks.saveVariant : kind === 'skin' ? mocks.saveSkin : mocks.saveFaction).mock.calls as unknown[][];
  const call = calls.at(-1)!;
  if (kind === 'faction') {
    const payload = call[0] as { sessionId: string; modRoot: string; baseVersions: FileVersion[]; entityData: { file: RowData } };
    return { session: payload.sessionId, root: payload.modRoot, base: payload.baseVersions, data: payload.entityData.file };
  }
  return { session: call[0], root: call[1], base: call[7], data: call[3] as RowData };
}

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore({
    theme: 'light',
    accent: 'blue',
    customAccent: '#3388cc',
    historyLimit: 20,
    editMode: 'plain',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  });
  for (const letter of ['A', 'B', 'C']) {
    const modRoot = `M:/${letter}`;
    useWorkspaceStore().registerMod({ modRoot, displayName: letter, version: '', status: 'ready' });
    useProjectStore().registerProjectManifest({
      sessionId: `s${letter}`,
      modRoot,
      baseVersions: [],
      starsectorRoot: null,
      coreAvailable: false,
      associatedSpecTables: [],
      modInfo: null,
      tableSummaries: {} as ProjectManifest['tableSummaries'],
      tableEntitySummaries: {} as ProjectManifest['tableEntitySummaries'],
      entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
      warnings: [],
    });
  }
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('configuration page session baselines', () => {
  it.each(['variant', 'skin', 'faction'] as const)('%s adopts a local rename without replacing the active control', async (kind) => {
    await mountPage(kind);
    const source = kind === 'variant' ? mocks.saveVariant : kind === 'skin' ? mocks.saveSkin : mocks.saveFaction;
    let release!: (saved: unknown) => void;
    source.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }) as never,
    );
    await input().setValue('submitted');
    await wrapper!.findAll('.schema-section textarea')[1]!.setValue('next');
    await wrapper!
      .findAll('button')
      .find((button) => button.text() === '保存')!
      .trigger('click');
    await flushPromises();
    expect(source).toHaveBeenCalledOnce();
    const field = input().element;
    await input().setValue('later typing');
    const receipt = savedWriteFixture();
    receipt.baseVersions = versions('M:/A', 'v2');
    receipt.identityChanges = [{ before: entityTargetFixture(kind, 'same'), after: entityTargetFixture(kind, 'next') }];
    if (kind === 'faction') {
      release({
        entity: {
          entityId: 'next',
          indexPath: 'factions.csv',
          indexHeader: ['faction'],
          indexRows: [],
          baseVersions: receipt.baseVersions,
          entityData: { file: { id: 'next', displayName: 'submitted' } },
        },
        receipt,
      });
    } else {
      const record = kind === 'variant' ? variant('M:/A', 'submitted', 'v2') : skin('M:/A', 'submitted', 'v2');
      record.file.id = 'next';
      record.file.target = entityTargetFixture(kind, 'next');
      record.file.relPath = 'next.file';
      record.file.data[kind === 'variant' ? 'variantId' : 'skinHullId'] = 'next';
      release({ entity: record.file, receipt });
    }
    await flushPromises();
    expect(input().element).toBe(field);
    expect((input().element as HTMLTextAreaElement).value).toBe('later typing');
    expect(wrapper!.get('.config-entity-list-item.active').text()).toContain(kind === 'faction' ? 'submitted' : 'next');
    source.mockResolvedValueOnce(null);
    expect((await save(kind)).data).toMatchObject({ displayName: 'later typing' });
    const calls = source.mock.calls as unknown[][];
    expect(kind === 'faction' ? calls.at(-1)![0] : calls.at(-1)![2]).toEqual(
      kind === 'faction' ? expect.objectContaining({ previousId: 'next' }) : 'next',
    );
  });
  it.each(['variant', 'skin', 'faction'] as const)('%s accepts an external rename while retaining the mounted raw field', async (kind) => {
    await mountPage(kind);
    await input().setValue('local typing');
    const id = 'next';
    const nextTarget = entityTargetFixture(kind, id);
    if (kind === 'faction')
      mocks.factions.mockResolvedValue([
        { id, data: { id, displayName: 'External' }, crestRef: null, baseVersions: versions('M:/A', 'v2') },
      ]);
    else {
      const record = kind === 'variant' ? variant('M:/A', 'External', 'v2') : skin('M:/A', 'External', 'v2');
      record.file = {
        ...record.file,
        id,
        target: nextTarget,
        data: { ...record.file.data, [kind === 'variant' ? 'variantId' : 'skinHullId']: id },
      };
      (kind === 'variant' ? mocks.variants : mocks.skins).mockResolvedValue([record]);
    }
    mocks.feedback.choose.mockResolvedValueOnce('follow');
    const receipt = savedWriteFixture();
    receipt.commitId = 10;
    receipt.identityChanges = [{ before: entityTargetFixture(kind, 'same'), after: nextTarget }];
    await mocks.identityHandler!({ sessionId: 'sA', modRoot: 'm:/a/', result: receipt });
    await flushPromises();
    expect((input().element as HTMLTextAreaElement).value).toBe('local typing');
    expect((await save(kind)).base).toEqual(versions('M:/A', 'v2'));
    expect(mocks.feedback.choose).toHaveBeenCalledOnce();
  });
  it.each(['variant', 'skin', 'faction'] as const)('%s waits for its new session after confirming discard', async (kind) => {
    await mountPage(kind);
    await input().setValue('A dirty');
    const pending = deferRecords(kind, 'M:/B', 'B');
    useWorkspaceNavigationActions().navigateToModConfig('M:/B', kind === 'faction' ? 'factions' : kind === 'skin' ? 'skins' : 'variants');
    expect(mocks.feedback.confirmWarning).toHaveBeenCalledTimes(1);
    await mocks.feedback.confirmWarning.mock.calls[0]![0].onConfirm!();
    await flushPromises();
    expect(wrapper!.find('.schema-form').exists()).toBe(false);
    expect(wrapper!.findAll('.config-entity-list-item')).toHaveLength(0);
    pending.release();
    await flushPromises();
    await select(kind);
    expect((input().element as HTMLInputElement).value).toBe('B');
    await input().setValue('B edited');
    expect(await save(kind)).toMatchObject({ session: 'sB', root: 'M:/B', base: versions('M:/B'), data: { displayName: 'B edited' } });
  });

  it.each(['variant', 'skin'] as const)('%s adopts B credentials even when the contents match A', async (kind) => {
    await mountPage(kind);
    const pending = deferRecords(kind, 'M:/B', 'A');
    activate('M:/B', kind);
    await flushPromises();
    expect(wrapper!.find('.schema-form').exists()).toBe(false);
    pending.release();
    await flushPromises();
    await select(kind);
    await input().setValue('B edited');
    expect((await save(kind)).base).toEqual(versions('M:/B'));
  });

  it.each(['variant', 'skin'] as const)('%s updates credentials for an unchanged clean entity', async (kind) => {
    await mountPage(kind);
    setRecords(kind, 'M:/A', 'A', 'v2');
    invalidateQueryCacheByProject('sA', {
      paths: [],
      tables: [],
      entities: [],
      resources: [],
      session: false,
      queryScopes: [{ kind: 'entity-list', entity: { kind, id: null }, table: null, source: null, resource: null }],
    });
    await flushPromises();
    await input().setValue('edited');
    expect((await save(kind)).base).toEqual(versions('M:/A', 'v2'));
  });

  it.each(['variant', 'skin', 'faction'] as const)('%s retries a failed new-session list', async (kind) => {
    await mountPage(kind);
    const pending = deferRecords(kind, 'M:/B', 'B');
    activate('M:/B', kind);
    await flushPromises();
    pending.reject(new Error('query failed'));
    await flushPromises();
    expect(wrapper!.find('.schema-form').exists()).toBe(false);
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
    setRecords(kind, 'M:/B', 'B');
    invalidateQueryCacheByProject('sB', {
      paths: [],
      tables: [],
      entities: [],
      resources: [],
      session: false,
      queryScopes: [{ kind: 'entity-list', entity: { kind, id: null }, table: null, source: null, resource: null }],
    });
    await flushPromises();
    await select(kind);
    expect((input().element as HTMLInputElement).value).toBe('B');
  });

  it.each(['variant', 'skin', 'faction'] as const)('%s keeps pending contents and credentials together', async (kind) => {
    await mountPage(kind);
    await input().setValue('local');
    setRecords(kind, 'M:/A', 'external', 'v2');
    invalidateQueryCacheByProject('sA', {
      paths: [],
      tables: [],
      entities: [],
      resources: [],
      session: false,
      queryScopes: [{ kind: 'entity-list', entity: { kind, id: null }, table: null, source: null, resource: null }],
    });
    await flushPromises();
    expect((input().element as HTMLTextAreaElement).value).toBe('local');
    expect((await save(kind)).base).toEqual(versions('M:/A'));
    await wrapper!
      .findAll('button')
      .find((button) => button.text() === '载入外部版本')!
      .trigger('click');
    await flushPromises();
    expect((input().element as HTMLTextAreaElement).value).toBe('local');
    await mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
    await flushPromises();
    expect((input().element as HTMLTextAreaElement).value).toBe('external');
    await input().setValue('accepted edit');
    expect((await save(kind)).base).toEqual(versions('M:/A', 'v2'));
  });

  it.each(['variant', 'skin', 'faction'] as const)('%s refreshes B while an A save is still pending', async (kind) => {
    await mountPage(kind);
    await input().setValue('A submitted');
    let release!: () => void;
    const writer = kind === 'variant' ? mocks.saveVariant : kind === 'skin' ? mocks.saveSkin : mocks.saveFaction;
    writer.mockImplementationOnce(() => new Promise<null>((resolve) => (release = () => resolve(null))));
    await wrapper!
      .findAll('button')
      .find((button) => button.text() === '保存')!
      .trigger('click');
    await flushPromises();
    setRecords(kind, 'M:/B', 'B');
    activate('M:/B', kind);
    await flushPromises();
    await select(kind);
    setRecords(kind, 'M:/B', 'B refreshed', 'v2');
    invalidateQueryCacheByProject('sB', {
      paths: [],
      tables: [],
      entities: [],
      resources: [],
      session: false,
      queryScopes: [{ kind: 'entity-list', entity: { kind, id: null }, table: null, source: null, resource: null }],
    });
    await flushPromises();
    expect((input().element as HTMLTextAreaElement).value).toBe('B refreshed');
    release();
    await flushPromises();
    expect((input().element as HTMLTextAreaElement).value).toBe('B refreshed');
  });

  it.each(['variant', 'skin', 'faction'] as const)('%s ignores old list responses after another switch and unmount', async (kind) => {
    await mountPage(kind);
    const pending = deferRecords(kind, 'M:/B', 'B');
    activate('M:/B', kind);
    await flushPromises();
    setRecords(kind, 'M:/C', 'C');
    activate('M:/C', kind);
    await flushPromises();
    await select(kind);
    pending.release();
    await flushPromises();
    expect((input().element as HTMLInputElement).value).toBe('C');
    const closing = deferRecords(kind, 'M:/B', 'B');
    activate('M:/B', kind);
    await flushPromises();
    wrapper!.unmount();
    wrapper = null;
    closing.reject(new Error('closed query'));
    await flushPromises();
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });
});
