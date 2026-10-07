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
  slotOptions: vi.fn(async (_session: string, hull: string) => [
    { origin: 'mod', options: [{ value: `${hull}_slot`, label: `${hull}_slot`, origin: 'mod', description: null, resourceRef: null }] },
  ]),
}));

vi.mock('@/services/config-resource.service', () => ({ queryBuiltInWeaponSlotOptions: mocks.slotOptions }));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

import { useConfigFamilyEditorViewModel } from './use-config-family-editor-view-model';
import { variantFamily, skinFamily } from '@/domain/config/config-entity-families';
import { initializeSettingsStore } from '@/stores/settings.store';
import type { RowData } from '@/shared/types';
import type { ConfigFamilyFile } from '@/domain/config/config-entity-families';

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

function fileFixture(variantId: string): ConfigFamilyFile {
  return { data: { variantId, hullId: 'h1' }, relPath: `data/variants/${variantId}.variant` };
}

interface EditorParams {
  saveFile: ReturnType<typeof vi.fn>;
  files: Ref<ConfigFamilyFile[]>;
  selectedId: Ref<string>;
  onSaved: ReturnType<typeof vi.fn>;
}

function mountEditor(family = variantFamily) {
  const files = ref<ConfigFamilyFile[]>(
    family.id === 'skin'
      ? [{ data: { skinHullId: 'v1', baseHullId: 'h1' }, relPath: 'data/hulls/skins/v1.skin' }]
      : [fileFixture('v1'), fileFixture('v2')],
  );
  const selectedId = ref('v1');
  const saveFile = vi.fn(
    async (_sessionId: string, _modRoot: string, current: ConfigFamilyFile, data: RowData): Promise<ConfigFamilyFile | null> => ({
      data,
      relPath: current.relPath,
    }),
  );
  const onSaved = vi.fn();
  let vm!: ReturnType<typeof useConfigFamilyEditorViewModel>;
  mount(
    {
      setup() {
        vm = useConfigFamilyEditorViewModel({
          family,
          dataRevision: ref(0),
          modRoot: ref('M:/mod'),
          onSaved,
          saveFile,
          sessionId: ref('sess-1'),
          selectedId,
          files,
        });
        return () => null;
      },
    },
    { global: { plugins: [getActivePinia()!] } },
  );
  return { vm, saveFile, onSaved, selectedId, files } as EditorParams & { vm: typeof vm };
}

describe('useConfigFamilyEditorViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({ ...SETTINGS });
    vi.clearAllMocks();
  });

  it('queries removal slot ids for the current draft base hull', async () => {
    const { vm } = mountEditor(skinFamily);
    await vi.waitFor(() => expect(vm.draftData.value.baseHullId).toBe('h1'));
    expect(vm.schemaRuntimeContext.value!.sourceContextKey).toBe('h1');
    const first = await vm.schemaRuntimeContext.value!.querySourceOptions!('hull:builtInWeaponSlots');
    expect(first[0]!.options[0]!.value).toBe('h1_slot');
    vm.draftData.value = { ...vm.draftData.value, baseHullId: 'h2' };
    const next = await vm.schemaRuntimeContext.value!.querySourceOptions!('hull:builtInWeaponSlots');
    expect(vm.schemaRuntimeContext.value!.sourceContextKey).toBe('h2');
    expect(next[0]!.options[0]!.value).toBe('h2_slot');
    expect(mocks.slotOptions).toHaveBeenLastCalledWith('sess-1', 'h2');
  });

  it('loads the selected file data into the draft', async () => {
    const { vm } = mountEditor();
    await vm.save(); // no-op dirty check: saving a clean draft still writes current data
    expect(vm.selectedFile.value?.data.variantId).toBe('v1');
  });

  it('saves the current draft through the injected save callback', async () => {
    const { vm, saveFile, onSaved } = mountEditor();
    vm.draftData.value = { variantId: 'v1', hullId: 'h1', displayName: 'Edited' };
    await vm.save();
    expect(saveFile).toHaveBeenCalledWith(
      'sess-1',
      'M:/mod',
      expect.objectContaining({ relPath: 'data/variants/v1.variant' }),
      expect.objectContaining({ displayName: 'Edited' }),
    );
    expect(onSaved).toHaveBeenCalledWith('v1');
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });

  it('reports save failures without invoking onSaved', async () => {
    const { vm, saveFile, onSaved } = mountEditor();
    saveFile.mockRejectedValue(new Error('locked'));
    await vm.save();
    expect(mocks.feedback.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('保存'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('switches the draft target when the selection changes', async () => {
    const { vm, selectedId } = mountEditor();
    selectedId.value = 'v2';
    await vi.waitFor(() => expect(vm.selectedFile.value?.data.variantId).toBe('v2'));
    await vm.save();
    // The save targets the newly selected file.
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });
});
