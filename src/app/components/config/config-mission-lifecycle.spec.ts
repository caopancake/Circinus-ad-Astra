import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfigMissionView from './ConfigMissionView.vue';
import ConfigMissionList from './ConfigMissionList.vue';
import { initializeSettingsStore } from '@/stores/settings.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useWriteSyncStore } from '@/stores/write-sync.store';
import { invalidateQueryCacheByProject } from '@/services/query-cache.service';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/write-result';
import { editorUiStubs } from '@/test/ui-stubs';
import type { AppFeedback, CommittedWriteEvent, ConfigMissionEditorData, RowData } from '@/shared/types';
import type { ConfigMissionRecord } from '@/domain/config/config-records';

const mocks = vi.hoisted(() => ({
  list: vi.fn<() => Promise<ConfigMissionRecord[]>>(),
  detail: vi.fn(),
  save: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  feedback: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    confirmWarning: vi.fn<AppFeedback['confirmWarning']>(),
    confirmDanger: vi.fn<AppFeedback['confirmDanger']>(),
    choose: vi.fn(),
  },
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => mocks.feedback }));
vi.mock('@/services/config-entity.service', () => ({
  listConfigMissionRecords: mocks.list,
  getConfigMissionEditorData: mocks.detail,
  queryMissionDraftIcon: async () => '',
}));
vi.mock('@/orchestrators/config-save.orchestrator', () => ({
  saveIndexedEntityAction: mocks.save,
  createIndexedEntityAction: mocks.create,
  deleteIndexedEntityAction: mocks.remove,
  completeConfigSave: async (modRoot: string, _session: string, result: CommittedWriteEvent['result']) => {
    useWriteSyncStore().markAccepted({ modRoot, result } as CommittedWriteEvent);
  },
}));
vi.mock('@/orchestrators/entity-events.orchestrator', () => ({ listenEntityIdentityApplied: vi.fn(async () => () => {}) }));
vi.mock('@/app/composables/use-visible-resource-media', () => ({
  useVisibleResourceMedia: () => ({
    mediaRef: () => () => {},
    mediaSrc: () => '',
    recordListFirstFrame: async () => {},
    setMediaRoot: () => {},
  }),
}));
vi.mock('@/app/composables/use-core-assets', () => ({ useCoreGraphics: () => ({ graphicsPaths: ref([]), loadGraphics: async () => {} }) }));

let wrapper: VueWrapper;
function record(id: string): ConfigMissionRecord {
  return { id, list: { mission: id }, baseVersions: [{ path: `M:/mod/${id}`, fingerprint: 'v1' }], iconRef: null };
}
function detail(id: string): ConfigMissionEditorData {
  return { list: { mission: id }, descriptor: { title: id }, text: 'Mission text', iconSrc: '', baseVersions: record(id).baseVersions };
}
async function mountPage() {
  wrapper = mount(ConfigMissionView, { global: { stubs: { ...editorUiStubs, 'n-modal': true } } });
  await flushPromises();
}
function titleInput() {
  return wrapper.findAll('textarea')[1]!;
}
function saved(nextId: string, title = 'Submitted') {
  return {
    entity: {
      entityId: nextId,
      indexRows: [{ mission: nextId }],
      entityData: { descriptor: { title }, text: 'Mission text' },
      baseVersions: [{ path: `M:/mod/${nextId}`, fingerprint: 'v2' }],
    },
    receipt: savedWriteFixture(),
  };
}
function invalidate() {
  invalidateQueryCacheByProject('s1', {
    paths: [],
    tables: [],
    entities: [],
    resources: [],
    session: false,
    queryScopes: [{ kind: 'entity-list', entity: { kind: 'mission', id: null }, table: null, source: null, resource: null }],
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
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
  useWorkspaceStore().registerMod({ modRoot: 'M:/mod', displayName: 'Mod', version: '', status: 'ready' });
  useWorkspaceStore().activateModConfig('M:/mod', 'mission');
  const update = sessionUpdateFixture('s1', 'M:/mod');
  if (update.status === 'ready') useProjectStore().registerProjectManifest(update.projection.manifest);
  mocks.list.mockResolvedValue([record('a'), record('b')]);
  mocks.detail.mockImplementation(async (_session: string, id: string) => detail(id));
});
afterEach(() => wrapper?.unmount());

describe('Mission view, list and editor lifecycle', () => {
  it('loads the list once and selects its first indexed mission', async () => {
    await mountPage();
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.detail).toHaveBeenCalledExactlyOnceWith('s1', 'a', expect.any(AbortSignal));
    expect(wrapper.get('.mission-file-item.active').text()).toContain('a');
  });

  it('accepts saved identity and versions while retaining subsequent raw input', async () => {
    await mountPage();
    await wrapper.findAll('textarea')[0]!.setValue('next');
    await titleInput().setValue('Submitted');
    let finish!: (receipt: ReturnType<typeof saved>) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '保存')!
      .trigger('click');
    await flushPromises();
    const field = titleInput().element;
    await titleInput().setValue('Later raw input');
    finish(saved('next'));
    await flushPromises();
    expect(titleInput().element).toBe(field);
    expect((field as HTMLTextAreaElement).value).toBe('Later raw input');
    expect(wrapper.get('.mission-file-item.active').text()).toContain('next');
    mocks.save.mockResolvedValueOnce(null);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '保存')!
      .trigger('click');
    await flushPromises();
    expect(mocks.save.mock.lastCall![0]).toMatchObject({ previousId: 'next', baseVersions: [{ path: 'M:/mod/next', fingerprint: 'v2' }] });
    expect((mocks.save.mock.lastCall![0].entityData as RowData).descriptor).toMatchObject({ title: 'Later raw input' });
  });

  it('preserves a deleted target field and confirms before releasing it', async () => {
    await mountPage();
    await titleInput().setValue('Retained');
    const field = titleInput().element;
    mocks.list.mockResolvedValue([record('b')]);
    invalidate();
    await flushPromises();
    expect(wrapper.findAll('.mission-file-item')).toHaveLength(1);
    expect(titleInput().element).toBe(field);
    expect((field as HTMLTextAreaElement).value).toBe('Retained');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '放弃编辑并继续')!
      .trigger('click');
    await flushPromises();
    mocks.feedback.confirmWarning.mock.lastCall![0].onConfirm();
    await flushPromises();
    expect(wrapper.get('.mission-file-item.active').text()).toContain('b');
    expect((titleInput().element as HTMLTextAreaElement).value).toBe('b');
  });

  it('creates and deletes through the list action owner with one refresh per action', async () => {
    await mountPage();
    mocks.create.mockResolvedValue({ entity: { entityId: 'c' }, receipt: savedWriteFixture() });
    mocks.list.mockResolvedValue([record('a'), record('b'), record('c')]);
    expect(await wrapper.getComponent(ConfigMissionList).props().createMission('s1', 'M:/mod', 'c')).toBe(true);
    await flushPromises();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(wrapper.get('.mission-file-item.active').text()).toContain('c');
    mocks.remove.mockResolvedValue({ ...savedWriteFixture(), commitId: 2 });
    mocks.list.mockResolvedValue([record('a'), record('b')]);
    expect(await wrapper.getComponent(ConfigMissionList).props().deleteMission('s1', 'M:/mod', 'c', true)).toBe(true);
    await flushPromises();
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(wrapper.get('.mission-file-item.active').text()).toContain('a');
    expect(mocks.remove).toHaveBeenCalledWith('s1', 'M:/mod', 'mission', 'c', true, record('c').baseVersions);
  });
});
