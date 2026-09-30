import { computed, ref, watch, type Ref } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useConfigEditorDraftSession } from '@/app/composables/config/use-config-editor-draft-session';
import { configMissionEditingId, configMissionEditorModel, configMissionSaveDraft } from '@/domain/config/config-entities';
import type { FileSchema } from '@/domain/schema/schema.types';
import type { ConfigMissionEditorData, RowData } from '@/shared/types';

export function useConfigMissionEditorViewModel(params: {
  editorReloadToken: Ref<number>;
  iconRefreshToken: Ref<number>;
  missionId: Ref<string>;
  modRoot: Ref<string | null>;
  onSaved: (missionId: string | null) => void;
  queryMissionEditorData: (sessionId: string, id: string) => Promise<ConfigMissionEditorData | null>;
  saveMission: (
    sessionId: string,
    modRoot: string,
    previousId: string,
    localMission: RowData,
    schema: FileSchema,
  ) => Promise<string | null>;
  schema: Ref<FileSchema | null>;
  sessionId: Ref<string | null>;
}) {
  const feedback = useAppFeedback();
  const loadedMissionId = ref<string | null>(null);
  const iconSrc = ref('');
  let editorRequestId = 0;
  let iconRequestId = 0;
  const draftSession = useConfigEditorDraftSession<RowData, string, ConfigMissionEditorData | null, string>({
    emptyValue: {},
    modRoot: params.modRoot,
    load: async (missionId) => {
      const targetSessionId = params.sessionId.value;
      if (!params.modRoot.value || !targetSessionId || !missionId) return { meta: null, value: {} };
      const data = await params.queryMissionEditorData(targetSessionId, missionId);
      const model = data ? configMissionEditorModel(data) : null;
      return { meta: data, value: model ? model.localMission : {} };
    },
    save: async (missionId, data) => {
      const currentSchema = params.schema.value;
      if (!params.modRoot.value || !currentSchema) return;
      const saveModRoot = params.modRoot.value;
      const saveSessionId = params.sessionId.value;
      if (!saveSessionId) return;
      const draft = configMissionSaveDraft(data, currentSchema);
      if (!draft.nextId) {
        feedback.warning('mission 不能为空');
        return;
      }
      const savedId = await params.saveMission(saveSessionId, saveModRoot, missionId, data, currentSchema);
      if (!savedId) return;
      if (params.modRoot.value !== saveModRoot || params.sessionId.value !== saveSessionId) return;
      return {
        meta: savedId,
        value: configMissionEditorModel({
          descriptor: draft.descriptor,
          iconSrc: iconSrc.value,
          list: draft.list,
          text: draft.text,
        }).localMission,
      };
    },
    targetKey: (missionId) => missionId,
  });
  const draftData = draftSession.draftValue;
  const editingMissionId = computed(() => configMissionEditingId(draftData.value));

  watch(() => [params.missionId.value, params.modRoot.value, params.editorReloadToken.value] as const, loadConfigMissionEditor, {
    immediate: true,
  });
  watch(() => params.iconRefreshToken.value, refreshMissionIcon);

  async function loadConfigMissionEditor() {
    const requestId = ++editorRequestId;
    const missionId = params.missionId.value;
    const targetSessionId = params.sessionId.value;
    if (!targetSessionId || !missionId) {
      draftSession.clearTarget();
      loadedMissionId.value = null;
      iconSrc.value = '';
      return;
    }
    const targetChanged = draftSession.currentTargetKey.value !== missionId;
    if (targetChanged) {
      loadedMissionId.value = null;
      iconSrc.value = '';
    }
    if (!params.modRoot.value || !targetSessionId || !missionId) return;
    try {
      const snapshot = targetChanged ? await draftSession.loadTarget(missionId) : await draftSession.refreshTarget(missionId);
      if (requestId !== editorRequestId || targetSessionId !== params.sessionId.value || missionId !== params.missionId.value) return;
      const data = snapshot?.meta ?? null;
      if (!data) return;
      const model = configMissionEditorModel(data);
      loadedMissionId.value = params.missionId.value;
      iconSrc.value = model.iconSrc;
    } catch (error) {
      feedback.error(error, '加载战役失败');
    }
  }

  async function refreshMissionIcon() {
    const requestId = ++iconRequestId;
    const missionId = loadedMissionId.value;
    const targetSessionId = params.sessionId.value;
    if (!params.modRoot.value || !targetSessionId || !missionId) return;
    try {
      const data = await params.queryMissionEditorData(targetSessionId, missionId);
      if (requestId !== iconRequestId || targetSessionId !== params.sessionId.value || missionId !== loadedMissionId.value) return;
      iconSrc.value = data?.iconSrc ?? '';
    } catch (error) {
      feedback.error(error, '刷新战役图标失败');
    }
  }

  async function save() {
    try {
      const saved = await draftSession.saveDraft();
      if (!saved?.meta) return;
      loadedMissionId.value = saved.meta;
      params.onSaved(saved.meta);
    } catch (error) {
      feedback.error(error, '保存战役失败');
    }
  }

  function clearMissionTarget(): void {
    loadedMissionId.value = null;
    draftSession.clearTarget();
    iconSrc.value = '';
  }

  return {
    clearMissionTarget,
    draftData,
    editingMissionId,
    externalUpdateNotice: draftSession.externalUpdateNotice,
    hasPendingExternalData: draftSession.hasPendingExternalValue,
    iconSrc,
    loadPendingExternalData: draftSession.loadPendingExternal,
    loadedMissionId,
    save,
    saving: draftSession.saving,
  };
}
