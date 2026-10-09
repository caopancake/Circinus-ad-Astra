import { computed, onUnmounted, ref, watch } from 'vue';
import { listConfigFactionRecords, queryFactionPreviewImages, getConfigFactionRecord } from '@/services/config-entity.service';
import { useConfigIdentityReception } from '@/app/composables/config/use-config-identity-reception';
import { createIndexedEntityAction, deleteIndexedEntityAction, saveIndexedEntityAction } from '@/orchestrators/config-save.orchestrator';
import {
  buildFactionIndexRow,
  configEntityIdInvalidMessage,
  configFactionSaveDraft,
  createDefaultFaction,
  isConfigEntityId,
} from '@/domain/config/config-entities';
import type { FileSchema } from '@/domain/schema/schema.types';
import type { RowData } from '@/shared/types';
import type { ResourceRef } from '@/shared/types';
import { useProjectStore } from '@/stores/project.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSchemaRuntimeContext } from '@/app/composables/use-schema-runtime-context';
import { hasEntityInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { hasResourceInvalidation, subscribeResourceInvalidations } from '@/services/resource-cache.service';

export function useConfigFactionViewModel() {
  const selectedFaction = ref<string | null>(null);
  const factionDataRevision = ref(0);
  const factionPreviewRevision = ref(0);
  const factions = ref<Record<string, RowData>>({});
  const factionVersions = ref<Record<string, import('@/shared/types').FileVersion[]>>({});
  const factionCrestRefs = ref<Record<string, ResourceRef | null>>({});
  const factionCrestResourceRefs = ref<ResourceRef[]>([]);
  const listLoadStartedAt = ref(0);
  const project = useProjectStore();
  const feedback = useAppFeedback();
  const schemaRuntimeContext = useSchemaRuntimeContext(() => project.activeManifest);
  const modRoot = computed(() => project.activeManifest?.modRoot ?? null);
  const sessionId = computed(() => project.activeManifest?.sessionId ?? null);
  let factionsRequestId = 0;
  const savingSessions = new Set<string>();
  let listSessionKey: string | null = null;
  let disposed = false;
  const identity = useConfigIdentityReception({
    target: () =>
      sessionId.value && modRoot.value && selectedFaction.value
        ? { sessionId: sessionId.value, modRoot: modRoot.value, kind: 'faction' as const, id: selectedFaction.value }
        : null,
    read: getConfigFactionRecord,
    accept: (record, id) => {
      factionsRequestId++;
      const next = { ...factions.value };
      delete next[identity.handoff.value!.sourceId];
      next[id] = record.data;
      factions.value = next;
      factionVersions.value = { ...factionVersions.value, [id]: record.baseVersions };
      selectedFaction.value = id;
      factionDataRevision.value++;
    },
  });

  function sessionKey() {
    return JSON.stringify([sessionId.value, modRoot.value]);
  }

  async function loadFactions(options: { reloadEditorData: boolean } = { reloadEditorData: true }) {
    const requestId = ++factionsRequestId;
    const sessionId = project.activeSessionId;
    const key = sessionKey();
    if (key !== listSessionKey) {
      listSessionKey = key;
      factions.value = {};
      factionVersions.value = {};
      factionCrestRefs.value = {};
      factionCrestResourceRefs.value = [];
      selectedFaction.value = null;
    }
    if (!sessionId || disposed) return;
    listLoadStartedAt.value = performance.now();
    try {
      const records = await listConfigFactionRecords(sessionId);
      if (disposed || requestId !== factionsRequestId || key !== sessionKey()) return;
      const selected = selectedFaction.value;
      const held = selected ? factions.value[selected] : null;
      factions.value = Object.fromEntries(records.map((record) => [record.id, record.data]));
      if (identity.receiving.value && selected && held && !factions.value[selected]) factions.value[selected] = held;
      factionVersions.value = Object.fromEntries(records.map((record) => [record.id, record.baseVersions]));
      factionCrestRefs.value = Object.fromEntries(records.map((record) => [record.id, record.crestRef]));
      factionCrestResourceRefs.value = records.flatMap((record) => (record.crestRef ? [record.crestRef] : []));
      if (selectedFaction.value && !factions.value[selectedFaction.value]) selectedFaction.value = null;
      if (!selectedFaction.value) selectedFaction.value = Object.keys(factions.value).sort()[0] ?? null;
      factionPreviewRevision.value += 1;
      if (options.reloadEditorData) factionDataRevision.value += 1;
    } catch (error) {
      if (disposed || requestId !== factionsRequestId || key !== sessionKey()) return;
      feedback.error(error, '加载势力失败');
    }
  }

  async function onSaved(id: string | null) {
    selectedFaction.value = id;
    await loadFactions();
  }

  async function createFaction(createSessionId: string, createModRoot: string, id: string): Promise<boolean> {
    if (!isConfigEntityId(id)) {
      feedback.warning(configEntityIdInvalidMessage('势力 ID', id), 'config.id_invalid');
      return false;
    }
    try {
      await createIndexedEntityAction({
        baseVersions: [],
        sessionId: createSessionId,
        modRoot: createModRoot,
        kind: 'faction',
        previousId: null,
        nextId: id,
        indexRow: buildFactionIndexRow(id),
        entityData: { file: createDefaultFaction(id) },
      });
      feedback.success(`势力 "${id}" 已创建`);
      if (project.activeManifest?.modRoot !== createModRoot || project.activeManifest.sessionId !== createSessionId) return true;
      await loadFactions();
      if (disposed || project.activeManifest?.modRoot !== createModRoot || project.activeManifest.sessionId !== createSessionId)
        return true;
      selectedFaction.value = id;
      return true;
    } catch (error) {
      feedback.error(error, '创建势力失败');
      return false;
    }
  }

  async function saveFaction(
    saveSessionId: string,
    saveModRoot: string,
    previousId: string,
    local: RowData,
    schema: FileSchema,
    baseVersions: import('@/shared/types').FileVersion[],
  ): Promise<import('@/shared/types').ConfigSaveIdentity | null> {
    const draft = configFactionSaveDraft(local, schema);
    const nextId = draft.nextId;
    if (!isConfigEntityId(nextId)) {
      feedback.warning(configEntityIdInvalidMessage('势力 ID', nextId), 'config.id_invalid');
      return null;
    }
    savingSessions.add(saveSessionId);
    factionsRequestId++;
    let saved;
    try {
      saved = await saveIndexedEntityAction(
        {
          sessionId: saveSessionId,
          baseVersions,
          modRoot: saveModRoot,
          kind: 'faction',
          previousId,
          nextId,
          indexRow: buildFactionIndexRow(nextId),
          entityData: { file: draft.file },
        },
        feedback,
      );
    } finally {
      factionsRequestId++;
      savingSessions.delete(saveSessionId);
    }
    if (!saved) return null;
    feedback.success(`势力 "${nextId}" 已保存`);
    if (disposed || project.activeManifest?.modRoot !== saveModRoot || project.activeManifest.sessionId !== saveSessionId)
      return { id: nextId, data: saved.entity.entityData!, receipt: saved.receipt, baseVersions: saved.entity.baseVersions };
    const nextFactions = { ...factions.value };
    delete nextFactions[previousId];
    nextFactions[nextId] = saved.entity.entityData!.file as RowData;
    factions.value = nextFactions;
    const nextVersions = { ...factionVersions.value };
    delete nextVersions[previousId];
    nextVersions[nextId] = saved.entity.baseVersions;
    factionVersions.value = nextVersions;
    return { id: nextId, data: saved.entity.entityData!, receipt: saved.receipt, baseVersions: saved.entity.baseVersions };
  }

  async function deleteFaction(deleteSessionId: string, deleteModRoot: string, id: string, deleteFile: boolean): Promise<boolean> {
    if (disposed || sessionId.value !== deleteSessionId || modRoot.value !== deleteModRoot) return false;
    await deleteIndexedEntityAction(deleteSessionId, deleteModRoot, 'faction', id, deleteFile, factionVersions.value[id] ?? []);
    feedback.success(`势力 "${id}" 已删除`);
    if (project.activeManifest?.modRoot !== deleteModRoot || project.activeManifest.sessionId !== deleteSessionId) return true;
    if (selectedFaction.value === id) selectedFaction.value = null;
    await loadFactions();
    return true;
  }

  watch([sessionId, modRoot], () => void loadFactions({ reloadEditorData: true }), { immediate: true, flush: 'sync' });
  const stopQueryInvalidation = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== project.activeSessionId) return;
    const factionsChanged = hasEntityInvalidation(event, 'entity-list', 'faction');
    if (factionsChanged && !savingSessions.has(event.sessionId)) void loadFactions({ reloadEditorData: true });
  });
  const stopResourceInvalidation = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== project.activeSessionId) return;
    if (!hasResourceInvalidation(event, factionCrestResourceRefs.value)) return;
    factionPreviewRevision.value += 1;
  });
  onUnmounted(() => {
    disposed = true;
    factionsRequestId++;
    stopQueryInvalidation();
    stopResourceInvalidation();
  });

  async function queryPreviewImages(targetSessionId: string, factionId: string, draft: RowData) {
    return queryFactionPreviewImages(targetSessionId, factionId, draft);
  }

  return {
    identityHandoff: identity.handoff,
    selectedFaction,
    factionDataRevision,
    factionPreviewRevision,
    listLoadStartedAt,
    factions,
    factionVersions,
    factionCrestRefs,
    modRoot,
    sessionId,
    schemaRuntimeContext,
    createFaction,
    deleteFaction,
    loadFactions,
    onSaved,
    queryFactionPreviewImages: queryPreviewImages,
    saveFaction,
  };
}
