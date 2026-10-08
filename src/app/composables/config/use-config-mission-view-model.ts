import { computed, onUnmounted, ref, watch } from 'vue';
import { getConfigMissionEditorData, listConfigMissionRecords, queryMissionDraftIcon } from '@/services/config-entity.service';
import { useProjectStore } from '@/stores/project.store';
import type { ConfigMissionEditorData, ResourceRef, RowData } from '@/shared/types';
import { createIndexedEntityAction, deleteIndexedEntityAction, saveIndexedEntityAction } from '@/orchestrators/config-save.orchestrator';
import {
  buildMissionIndexRow,
  configEntityIdInvalidMessage,
  configMissionSaveDraft,
  configMissionEditorModel,
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
  const missionVersions = ref<Record<string, import('@/shared/types').FileVersion[]>>({});
  const missionIconRefs = ref<Record<string, ResourceRef | null>>({});
  const missionIconResourceRefs = ref<ResourceRef[]>([]);
  const listLoadStartedAt = ref(0);
  const project = useProjectStore();
  const feedback = useAppFeedback();

  const modRoot = computed(() => project.activeManifest?.modRoot ?? null);
  const sessionId = computed(() => project.activeManifest?.sessionId ?? null);
  const missionItems = computed(() => missionItemsFromRows(missionRows.value));
  let missionsRequestId = 0;
  const savingSessions = new Set<string>();
  let listSessionKey: string | null = null;
  let disposed = false;

  function sessionKey() {
    return JSON.stringify([sessionId.value, modRoot.value]);
  }

  function handleSaved(missionId: string | null) {
    selectedMission.value = missionId;
    refreshToken.value += 1;
    missionEditorReloadToken.value += 1;
    missionIconRefreshToken.value += 1;
    void queryMissions();
  }

  async function queryMissions() {
    const requestId = ++missionsRequestId;
    const activeSessionId = sessionId.value;
    const key = sessionKey();
    if (key !== listSessionKey) {
      listSessionKey = key;
      missionRows.value = [];
      missionVersions.value = {};
      missionIconRefs.value = {};
      missionIconResourceRefs.value = [];
      selectedMission.value = null;
    }
    if (!activeSessionId || disposed) return false;
    listLoadStartedAt.value = performance.now();
    try {
      const records = await listConfigMissionRecords(activeSessionId);
      if (disposed || requestId !== missionsRequestId || key !== sessionKey()) return false;
      missionRows.value = records.map((record) => record.list);
      missionVersions.value = Object.fromEntries(records.map((record) => [record.id, record.baseVersions]));
      missionIconRefs.value = Object.fromEntries(records.map((record) => [record.id, record.iconRef]));
      missionIconResourceRefs.value = records.flatMap((record) => (record.iconRef ? [record.iconRef] : []));
      normalizeSelectedMission();
      return true;
    } catch (error) {
      if (disposed || requestId !== missionsRequestId || key !== sessionKey()) return false;
      feedback.error(error, '加载战役失败');
      return false;
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
        baseVersions: [],
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
      await queryMissions();
      if (disposed || modRoot.value !== createModRoot || sessionId.value !== createSessionId) return true;
      selectedMission.value = id;
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
    baseVersions: import('@/shared/types').FileVersion[],
  ): Promise<import('@/shared/types').ConfigSaveIdentity | null> {
    const activeModRoot = modRoot.value;
    if (!activeModRoot || activeModRoot !== saveModRoot || sessionId.value !== saveSessionId) return null;
    const draft = configMissionSaveDraft(localMission, schema);
    if (!draft.nextId) {
      feedback.warning('mission 不能为空');
      return null;
    }
    if (!isConfigEntityId(draft.nextId)) {
      feedback.warning(configEntityIdInvalidMessage('战役 ID', draft.nextId), 'config.id_invalid');
      return null;
    }
    const saved = await saveMissionDraft(saveSessionId, saveModRoot, previousId, draft, baseVersions);
    if (!saved) return null;
    const data = configMissionEditorModel({
      list: saved.entity.indexRows.find((row) => row.mission === saved.entity.entityId)!,
      descriptor: saved.entity.entityData!.descriptor as RowData,
      text: saved.entity.entityData!.text as string,
      iconSrc: '',
    }).localMission;
    return { id: saved.entity.entityId, data, receipt: saved.receipt, baseVersions: saved.entity.baseVersions };
  }

  async function saveMissionDraft(
    activeSessionId: string,
    activeModRoot: string,
    previousId: string,
    draft: ConfigMissionSaveDraft,
    baseVersions: import('@/shared/types').FileVersion[],
  ) {
    const idChanged = draft.nextId !== previousId;
    savingSessions.add(activeSessionId);
    missionsRequestId++;
    let saved;
    try {
      saved = await saveIndexedEntityAction(
        {
          sessionId: activeSessionId,
          baseVersions,
          modRoot: activeModRoot,
          kind: 'mission',
          previousId,
          nextId: draft.nextId,
          indexRow: buildMissionIndexRow(
            [draft.list],
            Object.keys(draft.list).length ? Object.keys(draft.list) : ['mission'],
            draft.nextId,
          ),
          entityData: { descriptor: deepClone(draft.descriptor), text: draft.text },
          deletePreviousTarget: idChanged,
        },
        feedback,
      );
    } finally {
      missionsRequestId++;
      savingSessions.delete(activeSessionId);
    }
    if (!saved) return null;
    feedback.success(`战役 "${draft.nextId}" 已保存`);
    return saved;
  }

  async function deleteMission(deleteSessionId: string, deleteModRoot: string, id: string, deleteDirectory: boolean): Promise<boolean> {
    if (disposed || sessionId.value !== deleteSessionId || modRoot.value !== deleteModRoot) return false;
    await deleteIndexedEntityAction(deleteSessionId, deleteModRoot, 'mission', id, deleteDirectory, missionVersions.value[id] ?? []);
    feedback.success(`战役 "${id}" 已删除`);
    if (modRoot.value !== deleteModRoot || sessionId.value !== deleteSessionId) return true;
    const loaded = await queryMissions();
    if (loaded && modRoot.value === deleteModRoot && sessionId.value === deleteSessionId && selectedMission.value === id) {
      selectedMission.value = missionItems.value[0]?.id ?? null;
    }
    return true;
  }

  async function refreshMissionList() {
    await queryMissions();
  }

  function missionExists(id: string): boolean {
    return missionItems.value.some((mission) => mission.id === id);
  }

  function isValidMissionId(id: string): boolean {
    return isConfigEntityId(id);
  }

  watch([sessionId, modRoot], queryMissions, { immediate: true, flush: 'sync' });
  const stopQueryInvalidation = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== sessionId.value) return;
    const missionsChanged = hasEntityInvalidation(event, 'entity-list', 'mission');
    if (missionsChanged && !savingSessions.has(event.sessionId)) void refreshMissionData();
  });
  const stopResourceInvalidation = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== sessionId.value) return;
    if (!hasResourceInvalidation(event, missionIconResourceRefs.value)) return;
    void refreshMissionResources();
  });
  onUnmounted(() => {
    disposed = true;
    missionsRequestId++;
    stopQueryInvalidation();
    stopResourceInvalidation();
  });

  async function refreshMissionData() {
    if (!(await queryMissions())) return;
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
    queryMissionIcon: queryMissionDraftIcon,
    missionExists,
    isValidMissionId,
    saveMission,
  };
}
