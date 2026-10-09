import { computed, onUnmounted, ref, watch } from 'vue';
import {
  createSkinAction,
  createVariantAction,
  deleteSkinAction,
  deleteVariantAction,
  saveSkinAction,
  saveVariantAction,
} from '@/orchestrators/config-save.orchestrator';
import {
  configEntityIdInvalidMessage,
  configEntityRenameContext,
  hasConfigEntityIdConflict,
  isConfigEntityId,
  trimmedConfigStringField,
} from '@/domain/config/config-entities';
import {
  familyFileId,
  familyFileCompanion,
  type ConfigEntityFamilyDefinition,
  type ConfigFamilyFile,
} from '@/domain/config/config-entity-families';
import { listSkinRecords, listVariantRecords, getConfigFamilyRecord } from '@/services/config-entity.service';
import { useConfigIdentityReception } from '@/app/composables/config/use-config-identity-reception';
import { queryHullPreviewMetadata, queryHullReferenceOptions } from '@/services/config-resource.service';
import { useProjectStore } from '@/stores/project.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { ResourceRef, RowData, SavedConfig } from '@/shared/types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { SelectOption } from '@/domain/schema/schema-options';
import { hasEntityInvalidation, hasQueryInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

export function useConfigFamilyViewModel(family: ConfigEntityFamilyDefinition) {
  const selectedId = ref<string | null>(null);
  const files = ref<ConfigFamilyFile[]>([]);
  const spriteRefs = ref<Record<string, ResourceRef | null>>({});
  const hullNames = ref<Record<string, string>>({});
  const hullOptions = ref<SelectOption[]>([]);
  const dataRevision = ref(0);
  const listLoadStartedAt = ref(0);
  const project = useProjectStore();
  const settings = useSettingsStore();
  const feedback = useAppFeedback();
  const modRoot = computed(() => project.activeManifest?.modRoot ?? null);
  const sessionId = computed(() => project.activeManifest?.sessionId ?? null);
  let filesRequestId = 0;
  const savingSessions = new Set<string>();
  let hullNamesRequestId = 0;
  let hullOptionsRequestId = 0;
  const hullOptionsLoaded = ref(false);
  let listSessionKey: string | null = null;
  let disposed = false;
  const identity = useConfigIdentityReception({
    target: () =>
      sessionId.value && modRoot.value && selectedId.value
        ? { sessionId: sessionId.value, modRoot: modRoot.value, kind: family.id, id: selectedId.value }
        : null,
    read: (session, id) => getConfigFamilyRecord(session, family.id, id),
    accept: (record, id) => {
      filesRequestId++;
      files.value = [...files.value.filter((file) => file.id !== identity.handoff.value!.sourceId && file.id !== id), record.file];
      selectedId.value = id;
      dataRevision.value++;
    },
  });

  function sessionKey() {
    return JSON.stringify([sessionId.value, modRoot.value]);
  }

  function idOf(file: ConfigFamilyFile): string {
    return file.id;
  }

  async function loadFiles() {
    const requestId = ++filesRequestId;
    const activeSessionId = project.activeSessionId;
    const key = sessionKey();
    if (key !== listSessionKey) {
      listSessionKey = key;
      files.value = [];
      spriteRefs.value = {};
      hullNames.value = {};
      hullOptions.value = [];
      hullOptionsLoaded.value = false;
      hullNamesRequestId++;
      hullOptionsRequestId++;
      selectedId.value = null;
      dataRevision.value += 1;
    }
    if (!activeSessionId || disposed) return;
    listLoadStartedAt.value = performance.now();
    try {
      const records = family.id === 'variant' ? await listVariantRecords(activeSessionId) : await listSkinRecords(activeSessionId);
      if (disposed || requestId !== filesRequestId || key !== sessionKey()) return;
      const previousSelected = files.value.find((file) => idOf(file) === selectedId.value);
      files.value = records.map((record) => record.file);
      if (identity.receiving.value && previousSelected && !files.value.some((file) => file.id === previousSelected.id))
        files.value.push(previousSelected);
      spriteRefs.value = Object.fromEntries(records.map((record) => [record.file.id, record.spriteRef]));
      const nextSelected = files.value.find((file) => idOf(file) === selectedId.value);
      if (selectedEntityDataChanged(previousSelected, nextSelected)) dataRevision.value += 1;
      if (selectedId.value && !files.value.some((file) => idOf(file) === selectedId.value)) selectedId.value = null;
      if (family.usesHullNames) {
        await loadFamilyHullNames(activeSessionId, ++hullNamesRequestId, files.value);
      }
    } catch (error) {
      if (disposed || requestId !== filesRequestId || key !== sessionKey()) return;
      feedback.error(error, `加载${family.displayName}失败`);
    }
  }

  async function loadFamilyHullNames(activeSessionId: string, requestId: number, sourceFiles: ConfigFamilyFile[]): Promise<void> {
    if (sourceFiles.length === 0) {
      hullNames.value = {};
      return;
    }
    try {
      const hullIds = sourceFiles.map((file) => familyFileCompanion(family, file));
      const result = await queryHullPreviewMetadata(activeSessionId, hullIds);
      if (disposed || requestId !== hullNamesRequestId || activeSessionId !== project.activeSessionId) return;
      hullNames.value = result;
    } catch (error) {
      if (disposed || requestId !== hullNamesRequestId || activeSessionId !== project.activeSessionId) return;
      feedback.error(error, `读取${family.displayName}引用失败`);
    }
  }

  async function loadHullOptions() {
    const requestId = ++hullOptionsRequestId;
    const activeSessionId = project.activeSessionId;
    if (!activeSessionId || settings.isPlainEditMode) {
      hullOptions.value = [];
      hullOptionsLoaded.value = false;
      return;
    }
    try {
      const options = await queryHullReferenceOptions(activeSessionId, []);
      if (disposed || requestId !== hullOptionsRequestId || activeSessionId !== project.activeSessionId) return;
      hullOptions.value = options;
      hullOptionsLoaded.value = true;
    } catch (error) {
      if (disposed || requestId !== hullOptionsRequestId || activeSessionId !== project.activeSessionId) return;
      feedback.error(error, '读取舰船引用失败');
    }
  }

  async function createFamilyEntity(createSessionId: string, createModRoot: string, companionId: string, id: string): Promise<boolean> {
    if (disposed || sessionId.value !== createSessionId || modRoot.value !== createModRoot) return false;
    if (!companionId || !id) {
      feedback.warning(`${family.companionLabel} 和 ${family.idField} 不能为空`);
      return false;
    }
    if (!isConfigEntityId(id)) {
      feedback.warning(configEntityIdInvalidMessage(family.idField, id), 'config.id_invalid');
      return false;
    }
    if (hasConfigEntityIdConflict(files.value, id, null, idOf)) {
      feedback.warning(`${family.displayName} "${id}" 已存在`);
      return false;
    }
    try {
      if (family.id === 'variant') {
        await createVariantAction(createSessionId, createModRoot, companionId, id);
      } else {
        await createSkinAction(createSessionId, createModRoot, companionId, id);
      }
      if (project.activeManifest?.modRoot !== createModRoot || project.activeManifest.sessionId !== createSessionId) return true;
      await loadFiles();
      if (disposed || project.activeManifest?.modRoot !== createModRoot || project.activeManifest.sessionId !== createSessionId)
        return true;
      selectedId.value = id;
      feedback.success(`${family.displayName} "${id}" 已创建`);
      return true;
    } catch (error) {
      feedback.error(error, `创建${family.displayName}失败`);
      return false;
    }
  }

  async function deleteFamilyEntity(deleteSessionId: string, deleteModRoot: string, id: string, relPath: string): Promise<boolean> {
    if (disposed || sessionId.value !== deleteSessionId || modRoot.value !== deleteModRoot) return false;
    try {
      if (family.id === 'variant') {
        await deleteVariantAction(
          deleteSessionId,
          deleteModRoot,
          relPath,
          id,
          files.value.find((file) => idOf(file) === id)?.baseVersions ?? [],
        );
      } else {
        await deleteSkinAction(
          deleteSessionId,
          deleteModRoot,
          relPath,
          id,
          files.value.find((file) => idOf(file) === id)?.baseVersions ?? [],
        );
      }
      if (project.activeManifest?.modRoot !== deleteModRoot || project.activeManifest.sessionId !== deleteSessionId) return true;
      await loadFiles();
      feedback.success(`${family.displayName} "${id}" 已删除`);
      return true;
    } catch (error) {
      feedback.error(error, `删除${family.displayName}失败`);
      return false;
    }
  }

  async function saveFamilyEntity(
    saveSessionId: string,
    saveModRoot: string,
    current: ConfigFamilyFile,
    data: RowData,
  ): Promise<SavedConfig<ConfigFamilyFile> | null> {
    const manifest = project.activeManifest;
    if (disposed || !manifest || manifest.modRoot !== saveModRoot || manifest.sessionId !== saveSessionId) return null;
    const currentId = familyFileId(current);
    const nextId = trimmedConfigStringField(data, family.idField);
    const nextCompanionId = trimmedConfigStringField(data, family.companionField);
    if (!nextId || !nextCompanionId) {
      feedback.warning(`${family.idField} 和 ${family.companionField} 不能为空`);
      return null;
    }
    if (!isConfigEntityId(nextId)) {
      feedback.warning(configEntityIdInvalidMessage(family.idField, nextId), 'config.id_invalid');
      return null;
    }
    if (hasConfigEntityIdConflict(files.value, nextId, currentId, idOf)) {
      feedback.warning(`${family.displayName} "${nextId}" 已存在`);
      return null;
    }
    const renameContext = configEntityRenameContext(currentId, nextId);
    savingSessions.add(saveSessionId);
    filesRequestId++;
    let saved: SavedConfig<ConfigFamilyFile> | null;
    try {
      saved =
        family.id === 'variant'
          ? await saveVariantAction(
              saveSessionId,
              saveModRoot,
              nextId,
              data,
              renameContext.previousId,
              current.relPath,
              feedback,
              current.baseVersions,
            )
          : await saveSkinAction(
              saveSessionId,
              saveModRoot,
              nextId,
              data,
              renameContext.previousId,
              current.relPath,
              feedback,
              current.baseVersions,
            );
    } finally {
      filesRequestId++;
      savingSessions.delete(saveSessionId);
    }
    if (!saved) return null;
    if (disposed || project.activeManifest?.modRoot !== saveModRoot || project.activeManifest.sessionId !== saveSessionId) return saved;
    files.value = files.value.map((file) => (idOf(file) === currentId ? saved.entity : file));
    feedback.success(`${family.displayName} "${nextId}" 已保存`);
    return saved;
  }

  function onSaved(id: string | null) {
    selectedId.value = id;
    void loadFiles();
  }

  watch([sessionId, modRoot], loadFiles, { immediate: true, flush: 'sync' });
  watch(
    () => settings.isPlainEditMode,
    () => {
      if (settings.isPlainEditMode) {
        hullOptionsRequestId++;
        hullOptions.value = [];
        hullOptionsLoaded.value = false;
      }
    },
  );
  const stopQueryInvalidation = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== project.activeSessionId) return;
    const filesChanged = hasEntityInvalidation(event, 'entity-list', family.entityKind);
    const hullReferenceQueryChanged = hasQueryInvalidation(event, 'hull-references');
    if (filesChanged && !savingSessions.has(event.sessionId)) void loadFiles();
    if (hullReferenceQueryChanged) {
      if (family.usesHullNames) {
        const requestId = ++hullNamesRequestId;
        void loadFamilyHullNames(project.activeSessionId, requestId, files.value);
      }
      if (hullOptionsLoaded.value) void loadHullOptions();
    }
  });
  onUnmounted(() => {
    disposed = true;
    filesRequestId++;
    hullNamesRequestId++;
    hullOptionsRequestId++;
    stopQueryInvalidation();
  });

  return {
    identityHandoff: computed(() =>
      identity.handoff.value ? { ...identity.handoff.value, record: identity.handoff.value.record.file } : null,
    ),
    selectedId,
    modRoot,
    sessionId,
    files,
    spriteRefs,
    hullNames,
    hullOptions,
    loadHullOptions,
    dataRevision,
    listLoadStartedAt,
    createFamilyEntity,
    deleteFamilyEntity,
    loadFiles,
    onSaved,
    saveFamilyEntity,
    idOf,
  };
}

function selectedEntityDataChanged(previous: ConfigFamilyFile | null | undefined, next: ConfigFamilyFile | null | undefined): boolean {
  return !stableDeepEqual(
    previous ? [previous.data, previous.relPath, previous.baseVersions] : null,
    next ? [next.data, next.relPath, next.baseVersions] : null,
  );
}
