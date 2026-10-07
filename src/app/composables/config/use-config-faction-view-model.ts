import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { listConfigFactionRecords, queryFactionPreviewImages } from '@/services/config-entity.service';
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
  const factionCrestRefs = ref<Record<string, ResourceRef | null>>({});
  const factionCrestResourceRefs = ref<ResourceRef[]>([]);
  const listLoadStartedAt = ref(0);
  const project = useProjectStore();
  const feedback = useAppFeedback();
  const schemaRuntimeContext = useSchemaRuntimeContext(() => project.activeManifest);
  const modRoot = computed(() => project.activeManifest?.modRoot ?? null);
  const sessionId = computed(() => project.activeManifest?.sessionId ?? null);
  let factionsRequestId = 0;

  async function loadFactions(options: { reloadEditorData: boolean } = { reloadEditorData: true }) {
    const requestId = ++factionsRequestId;
    const sessionId = project.activeSessionId;
    if (!sessionId) {
      factions.value = {};
      factionCrestRefs.value = {};
      factionCrestResourceRefs.value = [];
      selectedFaction.value = null;
      return;
    }
    listLoadStartedAt.value = performance.now();
    try {
      const records = await listConfigFactionRecords(sessionId);
      if (requestId !== factionsRequestId || sessionId !== project.activeSessionId) return;
      factions.value = Object.fromEntries(records.map((record) => [record.id, record.data]));
      factionCrestRefs.value = Object.fromEntries(records.map((record) => [record.id, record.crestRef]));
      factionCrestResourceRefs.value = records.flatMap((record) => (record.crestRef ? [record.crestRef] : []));
      if (selectedFaction.value && !factions.value[selectedFaction.value]) selectedFaction.value = null;
      if (!selectedFaction.value) selectedFaction.value = Object.keys(factions.value).sort()[0] ?? null;
      factionPreviewRevision.value += 1;
      if (options.reloadEditorData) factionDataRevision.value += 1;
    } catch (error) {
      if (requestId !== factionsRequestId || sessionId !== project.activeSessionId) return;
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
        sessionId: createSessionId,
        modRoot: createModRoot,
        kind: 'faction',
        previousId: null,
        nextId: id,
        indexRow: buildFactionIndexRow(id),
        entityData: { file: createDefaultFaction(id) },
        deletePreviousTarget: false,
      });
      feedback.success(`势力 "${id}" 已创建`);
      if (project.activeManifest?.modRoot !== createModRoot || project.activeManifest.sessionId !== createSessionId) return true;
      selectedFaction.value = id;
      await loadFactions();
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
  ): Promise<string | null> {
    const draft = configFactionSaveDraft(local, schema);
    const nextId = draft.nextId;
    if (!isConfigEntityId(nextId)) {
      feedback.warning(configEntityIdInvalidMessage('势力 ID', nextId), 'config.id_invalid');
      return null;
    }
    const idChanged = nextId !== previousId;
    const saved = await saveIndexedEntityAction(
      {
        sessionId: saveSessionId,
        modRoot: saveModRoot,
        kind: 'faction',
        previousId,
        nextId,
        indexRow: buildFactionIndexRow(nextId),
        entityData: { file: draft.file },
        deletePreviousTarget: idChanged,
      },
      feedback,
    );
    if (!saved) return null;
    feedback.success(`势力 "${nextId}" 已保存`);
    if (project.activeManifest?.modRoot !== saveModRoot || project.activeManifest.sessionId !== saveSessionId) return nextId;
    selectedFaction.value = nextId;
    await loadFactions();
    return nextId;
  }

  async function deleteFaction(deleteSessionId: string, deleteModRoot: string, id: string, deleteFile: boolean): Promise<boolean> {
    await deleteIndexedEntityAction(deleteSessionId, deleteModRoot, 'faction', id, deleteFile);
    feedback.success(`势力 "${id}" 已删除`);
    if (project.activeManifest?.modRoot !== deleteModRoot || project.activeManifest.sessionId !== deleteSessionId) return true;
    if (selectedFaction.value === id) selectedFaction.value = null;
    await loadFactions();
    return true;
  }

  onMounted(loadFactions);
  watch(
    () => project.activeSessionId,
    () => void loadFactions({ reloadEditorData: true }),
  );
  const stopQueryInvalidation = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== project.activeSessionId) return;
    const factionsChanged = hasEntityInvalidation(event, 'entity-list', 'faction');
    if (factionsChanged) void loadFactions({ reloadEditorData: true });
  });
  const stopResourceInvalidation = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== project.activeSessionId) return;
    if (!hasResourceInvalidation(event, factionCrestResourceRefs.value)) return;
    factionPreviewRevision.value += 1;
  });
  onUnmounted(() => {
    stopQueryInvalidation();
    stopResourceInvalidation();
  });

  async function queryPreviewImages(targetSessionId: string, factionId: string) {
    return queryFactionPreviewImages(targetSessionId, factionId);
  }

  return {
    selectedFaction,
    factionDataRevision,
    factionPreviewRevision,
    listLoadStartedAt,
    factions,
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
