vi.mock('@/orchestrators/config-save.orchestrator', () => ({ completeConfigSave: vi.fn(async () => {}) }));
import { savedWriteFixture } from '@/test/write-result';
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

import { useConfigFactionEditorViewModel } from './use-config-faction-editor-view-model';
import { initializeSettingsStore } from '@/stores/settings.store';
import type { RowData } from '@/shared/types';
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
  vm: ReturnType<typeof useConfigFactionEditorViewModel>;
  saveFaction: ReturnType<typeof vi.fn>;
  queryPreviewImages: ReturnType<typeof vi.fn>;
  onSaved: ReturnType<typeof vi.fn>;
  factionId: Ref<string>;
  factions: Ref<Record<string, RowData>>;
}

function mountEditor() {
  const factionId = ref('existing');
  const factions = ref<Record<string, RowData>>({
    existing: { id: 'existing', displayName: 'Existing' },
  });
  const saveFaction = vi.fn(async (_sessionId: string, _modRoot: string, previousId: string, data: RowData) => ({
    id: previousId,
    data,
    receipt: savedWriteFixture(),
    baseVersions: [],
  }));
  const queryPreviewImages = vi.fn(async () => ({ logoSrc: 'data:logo', crestSrc: 'data:crest' }));
  const onSaved = vi.fn();
  let vm!: ReturnType<typeof useConfigFactionEditorViewModel>;
  mount(
    {
      setup() {
        vm = useConfigFactionEditorViewModel({
          dataRevision: ref(0),
          factionId,
          factions,
          factionVersions: ref({}),
          modRoot: ref('M:/mod'),
          onSaved,
          previewRevision: ref(0),
          queryPreviewImages,
          saveFaction,
          schema: ref({ sections: [] } as never),
          sessionId: ref('sess-1'),
        });
        return () => null;
      },
    },
    { global: { plugins: [getActivePinia()!] } },
  );
  return { vm, saveFaction, queryPreviewImages, onSaved, factionId, factions } as Harness;
}

describe('useConfigFactionEditorViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({ ...SETTINGS });
    vi.clearAllMocks();
  });

  it('loads the selected faction into the draft and derives the display name', async () => {
    const { vm } = mountEditor();
    await vi.waitFor(() => expect(vm.draftData.value).not.toEqual({}));
    expect(vm.displayName.value).toBe('Existing');
  });

  it('falls back to the faction id as the display name for unknown factions', async () => {
    const { vm, factionId } = mountEditor();
    factionId.value = 'brand-new';
    await vi.waitFor(() => expect(vm.displayName.value).toBe('brand-new'));
  });

  it('saves through the injected callback and reports the saved id', async () => {
    const { vm, saveFaction, onSaved } = mountEditor();
    await vi.waitFor(() => expect(vm.draftData.value).not.toEqual({}));
    await vm.save();
    expect(saveFaction).toHaveBeenCalledWith('sess-1', 'M:/mod', 'existing', expect.anything(), { sections: [] }, []);
    expect(onSaved).toHaveBeenCalledWith('existing', expect.objectContaining({ id: 'existing', receipt: expect.anything() }));
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });

  it('reports save failures and skips the onSaved callback', async () => {
    const { vm, saveFaction, onSaved } = mountEditor();
    saveFaction.mockRejectedValue(new Error('denied'));
    await vi.waitFor(() => expect(vm.draftData.value).not.toEqual({}));
    await vm.save();
    expect(mocks.feedback.error).toHaveBeenCalledWith(expect.anything(), '保存势力失败');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps invalid or cancelled saves dirty without a saved callback', async () => {
    const { vm, saveFaction, onSaved } = mountEditor();
    await vi.waitFor(() => expect(vm.draftData.value).not.toEqual({}));
    vm.draftData.value = { file: { id: 'bad id', displayName: 'Edited' } };
    saveFaction.mockResolvedValue(null);
    await vm.save();
    expect(vm.draftData.value.file).toEqual({ id: 'bad id', displayName: 'Edited' });
    expect(useDraftSessionsStore().hasUnsavedWorkForMod('M:/mod')).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('refreshes logo and crest previews for the active faction', async () => {
    const { vm, queryPreviewImages, factionId } = mountEditor();
    await vi.waitFor(() => expect(vm.logoSrc.value).toBe('data:logo'));
    expect(vm.crestSrc.value).toBe('data:crest');
    expect(queryPreviewImages).toHaveBeenCalledWith('sess-1', 'existing', expect.anything());

    queryPreviewImages.mockResolvedValue({ logoSrc: 'data:new', crestSrc: 'data:new' });
    factionId.value = 'other';
    await vi.waitFor(() => expect(vm.logoSrc.value).toBe('data:new'));
  });
});
