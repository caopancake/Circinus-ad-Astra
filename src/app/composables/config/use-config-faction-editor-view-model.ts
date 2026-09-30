import { computed, ref, watch, type Ref } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useConfigEditorDraftSession } from '@/app/composables/config/use-config-editor-draft-session';
import { configFactionEditorModel } from '@/domain/config/config-entities';
import type { FileSchema } from '@/domain/schema/schema.types';
import { cell, deepClone } from '@/shared/lib/starsector';
import type { RowData } from '@/shared/types';

export function useConfigFactionEditorViewModel(params: {
  dataRevision: Ref<number>;
  factionId: Ref<string>;
  factions: Ref<Record<string, RowData>>;
  modRoot: Ref<string | null>;
  onSaved: (factionId: string | null) => void;
  previewRevision: Ref<number>;
  queryPreviewImages: (sessionId: string, factionId: string) => Promise<{ crestSrc: string; logoSrc: string }>;
  saveFaction: (sessionId: string, modRoot: string, previousId: string, local: RowData, schema: FileSchema) => Promise<string | null>;
  schema: Ref<FileSchema | null>;
  sessionId: Ref<string | null>;
}) {
  const feedback = useAppFeedback();
  const draftSession = useConfigEditorDraftSession<RowData, string, void, string>({
    emptyValue: {},
    modRoot: params.modRoot,
    load: (factionId) => ({
      value: params.factions.value[factionId]
        ? configFactionEditorModel(deepClone(params.factions.value[factionId]))
        : configFactionEditorModel({ id: factionId }),
    }),
    save: async (factionId, data) => {
      const currentSchema = params.schema.value;
      const saveModRoot = params.modRoot.value;
      const saveSessionId = params.sessionId.value;
      if (!currentSchema || !saveModRoot || !saveSessionId) return;
      const savedId = await params.saveFaction(saveSessionId, saveModRoot, factionId, data, currentSchema);
      if (!savedId) return;
      if (params.modRoot.value !== saveModRoot || params.sessionId.value !== saveSessionId) return;
      return { meta: savedId, value: data };
    },
    targetKey: (factionId) => factionId,
  });
  const draftData = draftSession.draftValue;
  const factionFile = computed<RowData>(() => {
    const file = draftData.value.file;
    return file && typeof file === 'object' && !Array.isArray(file) ? (file as RowData) : {};
  });
  const logoSrc = ref('');
  const crestSrc = ref('');
  let previewRequestId = 0;

  watch(
    () => [params.factionId.value, params.dataRevision.value] as const,
    ([id]) => {
      const data = params.factions.value[id]
        ? configFactionEditorModel(deepClone(params.factions.value[id]))
        : configFactionEditorModel({ id });
      if (draftSession.currentTargetKey.value !== id) void loadFactionEditorData(id);
      else draftSession.applyExternalForTarget(id, data);
    },
    { immediate: true },
  );

  watch(
    () => [params.sessionId.value, cell(factionFile.value.logo), cell(factionFile.value.crest), params.previewRevision.value] as const,
    () => refreshImagePreviews(),
    { immediate: true },
  );

  async function loadFactionEditorData(id: string) {
    try {
      await draftSession.loadTarget(id);
    } catch (error) {
      feedback.error(error, '加载势力失败');
    }
  }

  async function refreshImagePreviews() {
    const requestId = ++previewRequestId;
    const factionId = params.factionId.value;
    const sessionId = params.sessionId.value;
    if (!sessionId) {
      logoSrc.value = '';
      crestSrc.value = '';
      return;
    }
    try {
      const images = await params.queryPreviewImages(sessionId, factionId);
      if (requestId !== previewRequestId || sessionId !== params.sessionId.value || factionId !== params.factionId.value) return;
      logoSrc.value = images.logoSrc;
      crestSrc.value = images.crestSrc;
    } catch (error) {
      if (requestId !== previewRequestId) return;
      feedback.error(error, '刷新势力预览失败');
    }
  }

  async function save() {
    try {
      const saved = await draftSession.saveDraft();
      if (saved?.meta) params.onSaved(saved.meta);
    } catch (error) {
      feedback.error(error, '保存势力失败');
    }
  }

  const displayName = computed(() => cell(factionFile.value.displayName) || params.factionId.value);

  return {
    crestSrc,
    displayName,
    draftData,
    externalUpdateNotice: draftSession.externalUpdateNotice,
    hasPendingExternalData: draftSession.hasPendingExternalValue,
    loadPendingExternalData: draftSession.loadPendingExternal,
    logoSrc,
    save,
    saving: draftSession.saving,
  };
}
