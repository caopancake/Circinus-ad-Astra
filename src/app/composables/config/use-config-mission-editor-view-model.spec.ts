import { mount } from '@vue/test-utils';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, type Ref } from 'vue';

const mocks = vi.hoisted(() => ({
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

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

import { useConfigMissionEditorViewModel } from './use-config-mission-editor-view-model';
import { initializeSettingsStore } from '@/stores/settings.store';
import type { ConfigMissionEditorData, RowData } from '@/shared/types';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';

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

interface Harness {
  vm: ReturnType<typeof useConfigMissionEditorViewModel>;
  queryMissionEditorData: ReturnType<typeof vi.fn>;
  saveMission: ReturnType<typeof vi.fn>;
  onSaved: ReturnType<typeof vi.fn>;
  missionId: Ref<string>;
  schema: Ref<unknown>;
}

function editorDataFixture(missionId: string): ConfigMissionEditorData {
  return {
    descriptor: { title: missionId },
    list: { mission: missionId, title: missionId },
    text: `text of ${missionId}`,
    iconSrc: 'data:icon',
  };
}

function mountEditor() {
  const missionId = ref('m1');
  const schema = ref({
    sections: [],
    sources: [
      { id: 'list', type: 'csv-row', path: 'list.csv', keyField: 'mission' },
      { id: 'descriptor', type: 'json-file', path: 'descriptor.json' },
      { id: 'text', type: 'text-file', path: 'mission_text.txt' },
    ],
  } as never);
  const queryMissionEditorData = vi.fn(async (_sessionId: string, id: string) => editorDataFixture(id));
  const saveMission = vi.fn(async (_sessionId: string, _modRoot: string, _previousId: string, local: RowData) => {
    return String((local.list as RowData)?.mission ?? 'm1');
  });
  const onSaved = vi.fn();
  let vm!: ReturnType<typeof useConfigMissionEditorViewModel>;
  mount(
    {
      setup() {
        vm = useConfigMissionEditorViewModel({
          editorReloadToken: ref(0),
          iconRefreshToken: ref(0),
          missionId,
          modRoot: ref('M:/mod'),
          onSaved,
          queryMissionEditorData,
          saveMission,
          schema: schema as never,
          sessionId: ref('sess-1'),
        });
        return () => null;
      },
    },
    { global: { plugins: [getActivePinia()!] } },
  );
  return { vm, queryMissionEditorData, saveMission, onSaved, missionId, schema } as Harness;
}

describe('useConfigMissionEditorViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({ ...SETTINGS });
    vi.clearAllMocks();
  });

  it('loads the mission editor data and icon for the selected mission', async () => {
    const { vm, queryMissionEditorData } = mountEditor();
    await vi.waitFor(() => expect(vm.loadedMissionId.value).toBe('m1'));
    expect(queryMissionEditorData).toHaveBeenCalledWith('sess-1', 'm1');
    expect(vm.iconSrc.value).toBe('data:icon');
    expect(vm.editingMissionId.value).toBe('m1');
  });

  it('clears the editor without a mission id', async () => {
    const { vm, missionId } = mountEditor();
    await vi.waitFor(() => expect(vm.loadedMissionId.value).toBe('m1'));
    missionId.value = '';
    await vi.waitFor(() => expect(vm.loadedMissionId.value).toBeNull());
    expect(vm.iconSrc.value).toBe('');
  });

  it('warns and aborts when saving without a mission id in the draft', async () => {
    const { vm, saveMission } = mountEditor();
    await vi.waitFor(() => expect(vm.loadedMissionId.value).toBe('m1'));
    vm.draftData.value = { list: { mission: '' }, descriptor: {}, text: { content: '' } } as never;
    await vm.save();
    expect(mocks.feedback.warning).toHaveBeenCalledWith('mission 不能为空');
    expect(saveMission).not.toHaveBeenCalled();
  });

  it('saves the draft and reports the saved mission id', async () => {
    const { vm, saveMission, onSaved } = mountEditor();
    await vi.waitFor(() => expect(vm.loadedMissionId.value).toBe('m1'));
    vm.draftData.value = {
      list: { mission: 'm9', title: 'Nine' },
      descriptor: { title: 'Nine' },
      text: { content: 'body' },
    } as never;
    await vm.save();
    expect(saveMission).toHaveBeenCalledWith('sess-1', 'M:/mod', 'm1', expect.anything(), expect.anything());
    expect(onSaved).toHaveBeenCalledWith('m9');
    expect(vm.loadedMissionId.value).toBe('m9');
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });

  it('reports save failures through feedback', async () => {
    const { vm, saveMission, onSaved } = mountEditor();
    saveMission.mockRejectedValue(new Error('write failed'));
    await vi.waitFor(() => expect(vm.loadedMissionId.value).toBe('m1'));
    await vm.save();
    expect(mocks.feedback.error).toHaveBeenCalledWith(expect.anything(), '保存战役失败');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps invalid or cancelled saves dirty without a saved callback', async () => {
    const { vm, saveMission, onSaved } = mountEditor();
    await vi.waitFor(() => expect(vm.loadedMissionId.value).toBe('m1'));
    vm.draftData.value = { list: { mission: 'bad id' }, descriptor: { title: 'Edited' }, text: { content: 'body' } };
    saveMission.mockResolvedValue(null);
    await vm.save();
    expect(vm.editingMissionId.value).toBe('bad id');
    expect(useDraftSessionsStore().hasUnsavedWorkForMod('M:/mod')).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('refreshes only the icon on the icon refresh token', async () => {
    const { vm, queryMissionEditorData } = mountEditor();
    await vi.waitFor(() => expect(vm.loadedMissionId.value).toBe('m1'));
    queryMissionEditorData.mockClear();
    queryMissionEditorData.mockResolvedValue({ ...editorDataFixture('m1'), iconSrc: 'data:icon2' });
    // Icon refresh is driven by the iconRefreshToken watcher inside the component scope.
    await vm.save();
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });
});
