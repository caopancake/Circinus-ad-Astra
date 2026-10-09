import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigMissionRecord } from '@/domain/config/config-records';

const mocks = vi.hoisted(() => ({
  createIndexedEntityAction: vi.fn(),
  deleteIndexedEntityAction: vi.fn(),
  saveIndexedEntityAction: vi.fn(async () => ({
    entity: {
      entityId: 'm2',
      indexRows: [{ mission: 'm2', title: 'Renamed' }],
      entityData: { descriptor: { title: 'Renamed' }, text: 'body' },
      baseVersions: [],
    },
    receipt: {},
  })),
  listConfigMissionRecords: vi.fn(async (): Promise<ConfigMissionRecord[]> => []),
  getConfigMissionEditorData: vi.fn(),
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
  createIndexedEntityAction: mocks.createIndexedEntityAction,
  deleteIndexedEntityAction: mocks.deleteIndexedEntityAction,
  saveIndexedEntityAction: mocks.saveIndexedEntityAction,
}));

vi.mock('@/services/config-entity.service', () => ({
  listConfigMissionRecords: mocks.listConfigMissionRecords,
  getConfigMissionEditorData: mocks.getConfigMissionEditorData,
  queryMissionDraftIcon: vi.fn(async () => ''),
}));

vi.mock('@/services/query-cache.service', () => ({
  hasEntityInvalidation: vi.fn(() => false),
  subscribeQueryInvalidations: vi.fn(() => () => {}),
}));

vi.mock('@/services/resource-cache.service', () => ({
  hasResourceInvalidation: vi.fn(() => false),
  subscribeResourceInvalidations: vi.fn(() => () => {}),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

import { useConfigMissionViewModel } from './use-config-mission-view-model';
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

const MISSION_SCHEMA = {
  sections: [],
  sources: [
    { id: 'list', type: 'csv-row', path: 'data/missions/mission_list.csv', keyField: 'mission' },
    { id: 'descriptor', type: 'json-file', path: 'descriptor.json' },
    { id: 'text', type: 'text-file', path: 'mission_text.txt' },
  ],
} as never;

function missionRecord(id: string, title: string) {
  return { id, list: { mission: id, title }, iconRef: null, baseVersions: [{ path: `M:/mod/${id}`, fingerprint: title }] };
}

let wrapper: VueWrapper;
afterEach(() => wrapper?.unmount());
function mountViewModel() {
  let vm!: ReturnType<typeof useConfigMissionViewModel>;
  wrapper = mount(
    {
      setup() {
        vm = useConfigMissionViewModel();
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
}

describe('useConfigMissionViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({ ...SETTINGS });
    vi.clearAllMocks();
  });

  it('clears mission state without an active session', async () => {
    const vm = mountViewModel();
    await vm.queryMissions();
    expect(vm.missionRows.value).toEqual([]);
    expect(vm.selectedMission.value).toBeNull();
  });

  it('loads missions and selects the first one', async () => {
    activateProject();
    mocks.listConfigMissionRecords.mockResolvedValue([missionRecord('m1', 'One'), missionRecord('m2', 'Two')]);
    const vm = mountViewModel();
    await vm.queryMissions();
    expect(vm.missionItems.value.map((mission) => mission.id)).toEqual(['m1', 'm2']);
    expect(vm.selectedMission.value).toBe('m1');
    expect(vm.missionExists('m1')).toBe(true);
    expect(vm.missionExists('m9')).toBe(false);
  });

  it('rejects malformed mission ids on creation', async () => {
    activateProject();
    const vm = mountViewModel();
    await expect(vm.createMission('sess-1', 'M:/mod', 'bad id')).resolves.toBe(false);
    expect(mocks.feedback.warning).toHaveBeenCalledWith(expect.stringContaining('战役 ID'), 'config.id_invalid');
    expect(mocks.createIndexedEntityAction).not.toHaveBeenCalled();
  });

  it('creates a mission with a descriptor stub and refreshes the list', async () => {
    activateProject();
    mocks.listConfigMissionRecords.mockResolvedValue([]);
    const vm = mountViewModel();
    await vm.queryMissions();
    mocks.listConfigMissionRecords.mockResolvedValue([missionRecord('m5', 'Five')]);

    await expect(vm.createMission('sess-1', 'M:/mod', 'm5')).resolves.toBe(true);
    expect(mocks.createIndexedEntityAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'mission', previousId: null, nextId: 'm5' }),
    );
    expect(vm.selectedMission.value).toBe('m5');
    expect(mocks.feedback.success).toHaveBeenCalledWith(expect.stringContaining('已创建'));
  });

  it('aborts saves with an empty mission id', async () => {
    activateProject();
    const vm = mountViewModel();
    const schema = MISSION_SCHEMA;
    const localMission = { list: { mission: '  ' }, descriptor: { title: 'One' }, text: 'body' };
    const nextId = await vm.saveMission('sess-1', 'M:/mod', 'm1', localMission, schema, []);
    expect(nextId).toBeNull();
    expect(mocks.feedback.warning).toHaveBeenCalledWith('mission 不能为空');
    expect(mocks.saveIndexedEntityAction).not.toHaveBeenCalled();
  });

  it('returns no saved id when the mission id is invalid or the session changed', async () => {
    activateProject();
    const vm = mountViewModel();
    const localMission = { list: { mission: 'bad id' }, descriptor: { title: 'One' }, text: 'body' };
    expect(await vm.saveMission('sess-1', 'M:/mod', 'm1', localMission, MISSION_SCHEMA, [])).toBeNull();
    expect(await vm.saveMission('sess-2', 'M:/mod', 'm1', localMission, MISSION_SCHEMA, [])).toBeNull();
    expect(mocks.saveIndexedEntityAction).not.toHaveBeenCalled();
  });

  it('saves a mission draft with rename semantics', async () => {
    activateProject();
    mocks.listConfigMissionRecords.mockResolvedValue([missionRecord('m1', 'One')]);
    const vm = mountViewModel();
    await vm.queryMissions();
    mocks.listConfigMissionRecords.mockResolvedValue([missionRecord('m2', 'Renamed')]);

    const localMission = { list: { mission: 'm2', title: 'Renamed' }, descriptor: { title: 'Renamed' }, text: 'body' };
    const nextId = await vm.saveMission('sess-1', 'M:/mod', 'm1', localMission, MISSION_SCHEMA, []);
    expect(nextId).toMatchObject({ id: 'm2' });
    expect(mocks.saveIndexedEntityAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'mission', previousId: 'm1', nextId: 'm2' }),
      mocks.feedback,
    );
    expect(mocks.feedback.success).toHaveBeenCalledWith(expect.stringContaining('已保存'));
  });

  it('deletes missions and propagates failures to the caller', async () => {
    activateProject();
    mocks.listConfigMissionRecords.mockResolvedValue([missionRecord('m1', 'One')]);
    const vm = mountViewModel();
    await vm.queryMissions();

    mocks.deleteIndexedEntityAction.mockRejectedValue(new Error('locked'));
    await expect(vm.deleteMission('sess-1', 'M:/mod', 'm1', false)).rejects.toThrow('locked');
    expect(mocks.feedback.success).not.toHaveBeenCalled();

    mocks.deleteIndexedEntityAction.mockResolvedValue({});
    mocks.listConfigMissionRecords.mockResolvedValue([]);
    await expect(vm.deleteMission('sess-1', 'M:/mod', 'm1', true)).resolves.toBe(true);
    expect(mocks.deleteIndexedEntityAction).toHaveBeenCalledWith(
      'sess-1',
      'M:/mod',
      'mission',
      'm1',
      true,
      missionRecord('m1', 'One').baseVersions,
    );
    expect(vm.selectedMission.value).toBeNull();
  });

  it('queries editor data through the service', async () => {
    activateProject();
    mocks.getConfigMissionEditorData.mockResolvedValue({
      baseVersions: [],
      descriptor: { title: 'T' },
      list: {},
      text: '',
      iconSrc: 'data:',
    });
    const vm = mountViewModel();
    const data = await vm.queryMissionEditorData('sess-1', 'm1');
    expect(mocks.getConfigMissionEditorData).toHaveBeenCalledWith('sess-1', 'm1');
    expect(data).not.toBeNull();
    expect(vm.isValidMissionId('m1')).toBe(true);
    expect(vm.isValidMissionId('bad id')).toBe(false);
  });

  it('clears the previous session and uses the new deletion credentials', async () => {
    activateProject();
    mocks.listConfigMissionRecords.mockResolvedValue([missionRecord('same', 'A')]);
    const vm = mountViewModel();
    await flushPromises();
    let release!: (records: ConfigMissionRecord[]) => void;
    mocks.listConfigMissionRecords.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    activateProject('M:/B', 'sB');
    await flushPromises();
    expect(vm.selectedMission.value).toBeNull();
    expect(vm.missionRows.value).toEqual([]);
    expect(vm.missionIconRefs.value).toEqual({});
    expect(await vm.deleteMission('sess-1', 'M:/mod', 'same', true)).toBe(false);
    expect(mocks.deleteIndexedEntityAction).not.toHaveBeenCalled();
    const next = { ...missionRecord('same', 'B'), baseVersions: [{ path: 'M:/B/same', fingerprint: 'B' }] };
    release([next]);
    await flushPromises();
    mocks.listConfigMissionRecords.mockResolvedValue([]);
    mocks.deleteIndexedEntityAction.mockResolvedValue({});
    await vm.deleteMission('sB', 'M:/B', 'same', true);
    expect(mocks.deleteIndexedEntityAction).toHaveBeenCalledWith('sB', 'M:/B', 'mission', 'same', true, next.baseVersions);
  });

  it('ignores old results across rapid switches and session reopening', async () => {
    activateProject();
    mocks.listConfigMissionRecords.mockResolvedValue([missionRecord('same', 'A')]);
    const vm = mountViewModel();
    await flushPromises();
    let release!: (records: ConfigMissionRecord[]) => void;
    mocks.listConfigMissionRecords.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    activateProject('M:/B', 'sB');
    await flushPromises();
    const oldRelease = release;
    mocks.listConfigMissionRecords.mockResolvedValue([missionRecord('same', 'B reopened')]);
    activateProject('M:/B', 'sB2');
    await flushPromises();
    oldRelease([missionRecord('same', 'B old')]);
    await flushPromises();
    expect(vm.missionRows.value[0]?.title).toBe('B reopened');
    expect(vm.selectedMission.value).toBe('same');
  });

  it('keeps a failed new session empty until a successful retry', async () => {
    activateProject();
    mocks.listConfigMissionRecords.mockResolvedValue([missionRecord('same', 'A')]);
    const vm = mountViewModel();
    await flushPromises();
    mocks.listConfigMissionRecords.mockRejectedValue(new Error('query failed'));
    activateProject('M:/B', 'sB');
    await flushPromises();
    expect(vm.selectedMission.value).toBeNull();
    expect(vm.missionRows.value).toEqual([]);
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
    mocks.listConfigMissionRecords.mockResolvedValue([missionRecord('same', 'B')]);
    await vm.queryMissions();
    expect(vm.missionRows.value[0]?.title).toBe('B');
  });

  it('releases pending list responses on unmount', async () => {
    activateProject();
    let release!: (records: ConfigMissionRecord[]) => void;
    mocks.listConfigMissionRecords.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const vm = mountViewModel();
    wrapper.unmount();
    release([missionRecord('same', 'late')]);
    await flushPromises();
    expect(vm.missionRows.value).toEqual([]);
    expect(vm.selectedMission.value).toBeNull();
  });
});
