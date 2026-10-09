import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { isReadInvalidated } from '@/shared/runtime/read-request';
import { computed, onUnmounted, ref, watch } from 'vue';
import { listConfigFactionRecords, queryFactionPreviewImages, getConfigFactionRecord } from '@/services/config-entity.service';
import { useConfigIdentityReception } from '@/app/composables/config/use-config-identity-reception';
import { useConfigListSelection } from '@/app/composables/config/use-config-list-selection';
import { warningNotice } from '@/shared/lib/errors';
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
  const factionDataRevision = ref(0);
  const factionPreviewRevision = ref(0);
  const factions = ref<Record<string, RowData>>({});
  const factionVersions = ref<Record<string, import('@/shared/types').FileVersion[]>>({});
  const factionCrestRefs = ref<Record<string, ResourceRef | null>>({});
  const factionCrestResourceRefs = ref<ResourceRef[]>([]);
  const listLoadStartedAt = ref(0);
  const project = useProjectStore();
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  const schemaRuntimeContext = useSchemaRuntimeContext(() => project.activeManifest);
  const modRoot = computed(() => project.activeManifest?.modRoot ?? null);
  const sessionId = computed(() => project.activeManifest?.sessionId ?? null);
  const selection = useConfigListSelection({ modRoot, sessionId, label: '势力' });
  const selectedFaction = selection.selectedId;
  const heldFaction = ref<{ id: string; data: RowData; baseVersions: import('@/shared/types').FileVersion[] } | null>(null);
  const editorFactions = computed(() =>
    heldFaction.value && selectedFaction.value === heldFaction.value.id
      ? { ...factions.value, [heldFaction.value.id]: heldFaction.value.data }
      : factions.value,
  );
  const editorFactionVersions = computed(() =>
    heldFaction.value && selectedFaction.value === heldFaction.value.id
      ? { ...factionVersions.value, [heldFaction.value.id]: heldFaction.value.baseVersions }
      : factionVersions.value,
  );
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
      reads.revoke();
      listSessionKey = key;
      factions.value = {};
      factionVersions.value = {};
      factionCrestRefs.value = {};
      factionCrestResourceRefs.value = [];
      selectedFaction.value = null;
      heldFaction.value = null;
    }
    if (!sessionId || disposed) return false;
    listLoadStartedAt.value = performance.now();
    try {
      const records = await reads.read('list', (signal) => listConfigFactionRecords(sessionId, signal));
      if (disposed || requestId !== factionsRequestId || key !== sessionKey()) return false;
      const selected = selectedFaction.value;
      const held = selected ? factions.value[selected] : null;
      const heldVersions = selected ? factionVersions.value[selected] : [];
      factions.value = Object.fromEntries(records.map((record) => [record.id, record.data]));
      factionVersions.value = Object.fromEntries(records.map((record) => [record.id, record.baseVersions]));
      factionCrestRefs.value = Object.fromEntries(records.map((record) => [record.id, record.crestRef]));
      factionCrestResourceRefs.value = records.flatMap((record) => (record.crestRef ? [record.crestRef] : []));
      selection.reconcile(Object.keys(factions.value).sort(), identity.receiving.value);
      if (selected && selectedFaction.value === selected && !factions.value[selected]) {
        if (held) heldFaction.value = { id: selected, data: held, baseVersions: heldVersions! };
      } else heldFaction.value = null;
      factionPreviewRevision.value += 1;
      if (options.reloadEditorData) factionDataRevision.value += 1;
      return true;
    } catch (error) {
      if (disposed || requestId !== factionsRequestId || key !== sessionKey() || isReadInvalidated(error)) return false;
      feedback.error(error, '加载势力失败');
      return false;
    }
  }

  async function onSaved(id: string | null, saved?: import('@/shared/types').ConfigSaveIdentity) {
    if (saved) {
      const next = { ...factions.value };
      delete next[selectedFaction.value!];
      next[saved.id] = saved.data.file as RowData;
      factions.value = next;
      factionVersions.value = { ...factionVersions.value, [saved.id]: saved.baseVersions };
    }
    selectedFaction.value = id;
    if (!saved) await loadFactions();
  }

  async function createFaction(createSessionId: string, createModRoot: string, id: string): Promise<boolean> {
    if (!isConfigEntityId(id)) {
      feedback.warning(warningNotice(configEntityIdInvalidMessage('势力 ID', id), 'config.id_invalid', `Invalid faction ID: ${id}`));
      return false;
    }
    if (factions.value[id]) {
      feedback.warning(warningNotice(`势力 "${id}" 已存在`, 'config.entity_exists', `Faction ID exists: ${id}`));
      return false;
    }
    return selection.mutate({
      sessionId: createSessionId,
      modRoot: createModRoot,
      changesTarget: true,
      label: `势力 "${id}" 已创建`,
      write: async () => {
        factionsRequestId++;
        const saved = await createIndexedEntityAction({
          baseVersions: [],
          sessionId: createSessionId,
          modRoot: createModRoot,
          kind: 'faction',
          previousId: null,
          nextId: id,
          indexRow: buildFactionIndexRow(id),
          entityData: { file: createDefaultFaction(id) },
        });
        return saved.receipt;
      },
      accept: async () => {
        if (!(await loadFactions())) return false;
        if (disposed || modRoot.value !== createModRoot || sessionId.value !== createSessionId) return false;
        selectedFaction.value = id;
        selection.reconcile(Object.keys(factions.value).sort());
        return true;
      },
    });
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
      feedback.warning(
        warningNotice(configEntityIdInvalidMessage('势力 ID', nextId), 'config.id_invalid', `Invalid faction ID: ${nextId}`),
      );
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
    return { id: nextId, data: saved.entity.entityData!, receipt: saved.receipt, baseVersions: saved.entity.baseVersions };
  }

  async function deleteFaction(deleteSessionId: string, deleteModRoot: string, id: string, deleteFile: boolean): Promise<boolean> {
    if (disposed || sessionId.value !== deleteSessionId || modRoot.value !== deleteModRoot) return false;
    return selection.mutate({
      sessionId: deleteSessionId,
      modRoot: deleteModRoot,
      changesTarget: selectedFaction.value === id,
      label: `势力 "${id}" 已删除`,
      write: () => {
        factionsRequestId++;
        return deleteIndexedEntityAction(deleteSessionId, deleteModRoot, 'faction', id, deleteFile, factionVersions.value[id]!);
      },
      accept: async () => {
        if (!(await loadFactions())) return false;
        if (disposed || modRoot.value !== deleteModRoot || sessionId.value !== deleteSessionId) return false;
        if (selectedFaction.value === id) selectedFaction.value = null;
        selection.reconcile(Object.keys(factions.value).sort());
        return true;
      },
    });
  }

  watch([sessionId, modRoot], () => void loadFactions({ reloadEditorData: true }), { immediate: true, flush: 'sync' });
  const stopQueryInvalidation = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== project.activeSessionId) return;
    if (event.scope === 'session') {
      reads.revoke();
      return;
    }
    const factionsChanged = hasEntityInvalidation(event, 'entity-list', 'faction');
    if (factionsChanged && !savingSessions.has(event.sessionId) && !selection.writing.value)
      reads.schedule('list', () => {
        void loadFactions({ reloadEditorData: true });
      });
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

  async function queryPreviewImages(targetSessionId: string, factionId: string, draft: RowData, signal?: AbortSignal) {
    return queryFactionPreviewImages(targetSessionId, factionId, draft, signal);
  }

  return {
    identityHandoff: identity.handoff,
    selectedFaction,
    selectFaction: selection.select,
    actionsLocked: selection.locked,
    actionRunning: selection.writing,
    deletedTarget: selection.deletedTarget,
    discardDeletedTarget: selection.discardDeleted,
    editorFactions,
    editorFactionVersions,
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
