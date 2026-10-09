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
import { useConfigListSelection } from '@/app/composables/config/use-config-list-selection';
import { useConfigIdentityReception } from '@/app/composables/config/use-config-identity-reception';
import { warningNotice } from '@/shared/lib/errors';
import type { FileSchema } from '@/domain/schema/schema.types';
import { hasEntityInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { hasResourceInvalidation, subscribeResourceInvalidations } from '@/services/resource-cache.service';

export function useConfigMissionViewModel() {
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
  const selection = useConfigListSelection({ modRoot, sessionId, label: '战役' });
  const selectedMission = selection.selectedId;
  const identity = useConfigIdentityReception({
    target: () =>
      sessionId.value && modRoot.value && selectedMission.value
        ? { sessionId: sessionId.value, modRoot: modRoot.value, kind: 'mission' as const, id: selectedMission.value }
        : null,
    read: getConfigMissionEditorData,
    accept: (record, id) => {
      missionsRequestId++;
      replaceMissionRow(identity.handoff.value!.sourceId, record.list);
      missionVersions.value = { ...missionVersions.value, [id]: record.baseVersions };
      selectedMission.value = id;
      missionEditorReloadToken.value++;
    },
  });
  const missionItems = computed(() => missionItemsFromRows(missionRows.value));
  let missionsRequestId = 0;
  const savingSessions = new Set<string>();
  let listSessionKey: string | null = null;
  let disposed = false;

  function sessionKey() {
    return JSON.stringify([sessionId.value, modRoot.value]);
  }

  function replaceMissionRow(sourceId: string, row: RowData) {
    missionRows.value = missionRows.value.map((current) => (current.mission === sourceId ? deepClone(row) : current));
  }

  function handleSaved(missionId: string | null, saved?: import('@/shared/types').ConfigSaveIdentity) {
    if (saved) {
      replaceMissionRow(selectedMission.value!, saved.data.list as RowData);
      missionVersions.value = { ...missionVersions.value, [saved.id]: saved.baseVersions };
    }
    selectedMission.value = missionId;
    missionIconRefreshToken.value += 1;
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
    selection.reconcile(
      missionItems.value.map((mission) => mission.id),
      identity.receiving.value,
    );
  }

  async function queryMissionEditorData(targetSessionId: string, id: string): Promise<ConfigMissionEditorData | null> {
    if (!id) return null;
    return getConfigMissionEditorData(targetSessionId, id);
  }

  async function createMission(createSessionId: string, createModRoot: string, id: string): Promise<boolean> {
    if (!isConfigEntityId(id)) {
      feedback.warning(warningNotice(configEntityIdInvalidMessage('战役 ID', id), 'config.id_invalid', `Invalid mission ID: ${id}`));
      return false;
    }
    if (missionExists(id)) {
      feedback.warning(warningNotice(`战役 "${id}" 已存在`, 'config.entity_exists', `Mission ID exists: ${id}`));
      return false;
    }
    return selection.mutate({
      sessionId: createSessionId,
      modRoot: createModRoot,
      changesTarget: true,
      label: `战役 "${id}" 已创建`,
      write: async () => {
        missionsRequestId++;
        const saved = await createIndexedEntityAction({
          baseVersions: [],
          sessionId: createSessionId,
          modRoot: createModRoot,
          kind: 'mission',
          previousId: null,
          nextId: id,
          indexRow: buildMissionIndexRow([], ['mission'], id),
          entityData: { descriptor: { title: id }, text: '' },
        });
        return saved.receipt;
      },
      accept: async () => {
        if (!(await queryMissions())) return false;
        if (disposed || modRoot.value !== createModRoot || sessionId.value !== createSessionId) return false;
        selectedMission.value = id;
        selection.reconcile(missionItems.value.map((mission) => mission.id));
        return true;
      },
    });
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
      feedback.warning(warningNotice('mission 不能为空', 'config.missing_field', 'Mission ID is empty'));
      return null;
    }
    if (!isConfigEntityId(draft.nextId)) {
      feedback.warning(
        warningNotice(configEntityIdInvalidMessage('战役 ID', draft.nextId), 'config.id_invalid', `Invalid mission ID: ${draft.nextId}`),
      );
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
    return selection.mutate({
      sessionId: deleteSessionId,
      modRoot: deleteModRoot,
      changesTarget: selectedMission.value === id,
      label: `战役 "${id}" 已删除`,
      write: () => {
        missionsRequestId++;
        return deleteIndexedEntityAction(deleteSessionId, deleteModRoot, 'mission', id, deleteDirectory, missionVersions.value[id]!);
      },
      accept: async () => {
        if (!(await queryMissions())) return false;
        if (disposed || modRoot.value !== deleteModRoot || sessionId.value !== deleteSessionId) return false;
        if (selectedMission.value === id) selectedMission.value = missionItems.value[0]?.id ?? null;
        selection.reconcile(missionItems.value.map((mission) => mission.id));
        return true;
      },
    });
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
    if (missionsChanged && !savingSessions.has(event.sessionId) && !selection.writing.value) void refreshMissionData();
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
    if (!selection.deletedTarget.value) missionEditorReloadToken.value += 1;
    missionIconRefreshToken.value += 1;
  }

  function refreshMissionResources() {
    missionIconRefreshToken.value += 1;
  }

  return {
    selectedMission,
    identityHandoff: identity.handoff,
    selectMission: selection.select,
    actionsLocked: selection.locked,
    actionRunning: selection.writing,
    deletedTarget: selection.deletedTarget,
    discardDeletedTarget: selection.discardDeleted,
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
    queryMissionEditorData,
    queryMissionIcon: queryMissionDraftIcon,
    missionExists,
    isValidMissionId,
    saveMission,
  };
}
