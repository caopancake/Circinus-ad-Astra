import { computed, onUnmounted, ref, watch } from 'vue';
import { getConfigMissionEditorData, listConfigMissionRecords } from '@/services/config-entity.service';
import { useProjectStore } from '@/stores/project.store';
import type { ConfigMissionEditorData, ResourceRef, RowData } from '@/shared/types';
import { createIndexedEntityAction, deleteIndexedEntityAction, saveIndexedEntityAction } from '@/orchestrators/config-save.orchestrator';
import {
  buildMissionIndexRow,
  configEntityIdInvalidMessage,
  configMissionSaveDraft,
  isConfigEntityId,
  missionItemsFromRows,
  type ConfigMissionSaveDraft,
} from '@/domain/config/config-entities';
import { deepClone } from '@/shared/lib/starsector';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { FileSchema } from '@/domain/schema/schema.types';
import { hasEntityInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { hasResourceInvalidation, subscribeResourceInvalidations } from '@/services/resource-cache.service';

export function useConfigMissionViewModel() {
  const selectedMission = ref<string | null>(null);
  const refreshToken = ref(0);
  const missionEditorReloadToken = ref(0);
  const missionIconRefreshToken = ref(0);
  const missionRows = ref<RowData[]>([]);
  const missionIconRefs = ref<Record<string, ResourceRef | null>>({});
  const missionIconResourceRefs = ref<ResourceRef[]>([]);
  const listLoadStartedAt = ref(0);
  const project = useProjectStore();
  const feedback = useAppFeedback();

  const modRoot = computed(() => project.activeManifest?.modRoot ?? null);
  const sessionId = computed(() => project.activeManifest?.sessionId ?? null);
  const missionItems = computed(() => missionItemsFromRows(missionRows.value));
  let missionsRequestId = 0;

  function handleSaved(missionId: string | null) {
    selectedMission.value = missionId;
    refreshToken.value += 1;
    missionEditorReloadToken.value += 1;
    missionIconRefreshToken.value += 1;
  }

  async function queryMissions() {
    const requestId = ++missionsRequestId;
    const activeSessionId = sessionId.value;
    if (!activeSessionId) {
      missionRows.value = [];
      missionIconRefs.value = {};
      missionIconResourceRefs.value = [];
      selectedMission.value = null;
      return;
    }
    listLoadStartedAt.value = performance.now();
    try {
      const records = await listConfigMissionRecords(activeSessionId);
      if (requestId !== missionsRequestId || activeSessionId !== sessionId.value) return;
      missionRows.value = records.map((record) => record.list);
      missionIconRefs.value = Object.fromEntries(records.map((record) => [record.id, record.iconRef]));
      missionIconResourceRefs.value = records.flatMap((record) => (record.iconRef ? [record.iconRef] : []));
      normalizeSelectedMission();
    } catch (error) {
      if (requestId !== missionsRequestId || activeSessionId !== sessionId.value) return;
      feedback.error(error, '加载战役失败');
    }
  }

  function normalizeSelectedMission() {
    const missions = missionItems.value.map((mission) => mission.id);
    if (!selectedMission.value && missions[0]) selectedMission.value = missions[0];
    if (selectedMission.value && !missions.includes(selectedMission.value)) selectedMission.value = missions[0] ?? null;
  }

  async function queryMissionEditorData(targetSessionId: string, id: string): Promise<ConfigMissionEditorData | null> {
    if (!id) return null;
    return getConfigMissionEditorData(targetSessionId, id);
  }

  async function createMission(createSessionId: string, createModRoot: string, id: string): Promise<boolean> {
    if (!isConfigEntityId(id)) {
      feedback.warning(configEntityIdInvalidMessage('战役 ID', id), 'config.id_invalid');
      return false;
    }
    try {
      await createIndexedEntityAction({
        sessionId: createSessionId,
        modRoot: createModRoot,
        kind: 'mission',
        previousId: null,
        nextId: id,
        indexRow: buildMissionIndexRow([], ['mission'], id),
        entityData: { descriptor: { title: id }, text: '' },
        deletePreviousTarget: false,
      });
      feedback.success(`战役 "${id}" 已创建`);
      if (modRoot.value !== createModRoot || sessionId.value !== createSessionId) return true;
      selectedMission.value = id;
      await queryMissions();
      return true;
    } catch (error) {
      feedback.error(error, '创建战役失败');
      return false;
    }
  }

  async function saveMission(
    saveSessionId: string,
    saveModRoot: string,
    previousId: string,
    localMission: RowData,
    schema: FileSchema,
  ): Promise<string | null> {
    const activeModRoot = modRoot.value;
    if (!activeModRoot || activeModRoot !== saveModRoot || sessionId.value !== saveSessionId) return previousId;
    const draft = configMissionSaveDraft(localMission, schema);
    if (!draft.nextId) {
      feedback.warning('mission 不能为空');
      return previousId;
    }
    if (!isConfigEntityId(draft.nextId)) {
      feedback.warning(configEntityIdInvalidMessage('战役 ID', draft.nextId), 'config.id_invalid');
      return previousId;
    }
    if (!(await saveMissionDraft(saveSessionId, saveModRoot, previousId, draft))) return null;
    return draft.nextId;
  }

  async function saveMissionDraft(activeSessionId: string, activeModRoot: string, previousId: string, draft: ConfigMissionSaveDraft) {
    const idChanged = draft.nextId !== previousId;
    const saved = await saveIndexedEntityAction(
      {
        sessionId: activeSessionId,
        modRoot: activeModRoot,
        kind: 'mission',
        previousId,
        nextId: draft.nextId,
        indexRow: buildMissionIndexRow([draft.list], Object.keys(draft.list).length ? Object.keys(draft.list) : ['mission'], draft.nextId),
        entityData: { descriptor: deepClone(draft.descriptor), text: draft.text },
        deletePreviousTarget: idChanged,
      },
      feedback,
    );
    if (!saved) return false;
    feedback.success(`战役 "${draft.nextId}" 已保存`);
    if (modRoot.value !== activeModRoot || sessionId.value !== activeSessionId) return true;
    selectedMission.value = draft.nextId;
    await queryMissions();
    return true;
  }

  async function deleteMission(deleteSessionId: string, deleteModRoot: string, id: string, deleteDirectory: boolean): Promise<boolean> {
    await deleteIndexedEntityAction(deleteSessionId, deleteModRoot, 'mission', id, deleteDirectory);
    feedback.success(`战役 "${id}" 已删除`);
    if (modRoot.value !== deleteModRoot || sessionId.value !== deleteSessionId) return true;
    await queryMissions();
    if (selectedMission.value === id) {
      selectedMission.value = missionItems.value[0]?.id ?? null;
    }
    return true;
  }

  async function refreshMissionList() {
    await queryMissions();
    normalizeSelectedMission();
  }

  function missionExists(id: string): boolean {
    return missionItems.value.some((mission) => mission.id === id);
  }

  function isValidMissionId(id: string): boolean {
    return isConfigEntityId(id);
  }

  watch(() => project.activeSessionId, queryMissions, { immediate: true });
  const stopQueryInvalidation = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== sessionId.value) return;
    const missionsChanged = hasEntityInvalidation(event, 'entity-list', 'mission');
    if (missionsChanged) void refreshMissionData();
  });
  const stopResourceInvalidation = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== sessionId.value) return;
    if (!hasResourceInvalidation(event, missionIconResourceRefs.value)) return;
    void refreshMissionResources();
  });
  onUnmounted(() => {
    stopQueryInvalidation();
    stopResourceInvalidation();
  });

  async function refreshMissionData() {
    await queryMissions();
    refreshToken.value += 1;
    missionEditorReloadToken.value += 1;
    missionIconRefreshToken.value += 1;
  }

  function refreshMissionResources() {
    missionIconRefreshToken.value += 1;
  }

  return {
    selectedMission,
    refreshToken,
    missionEditorReloadToken,
    missionIconRefreshToken,
    listLoadStartedAt,
    missionRows,
    missionItems,
    missionIconRefs,
    modRoot,
    sessionId,
    handleSaved,
    createMission,
    deleteMission,
    queryMissions,
    refreshMissionList,
    queryMissionEditorData,
    missionExists,
    isValidMissionId,
    saveMission,
  };
}
