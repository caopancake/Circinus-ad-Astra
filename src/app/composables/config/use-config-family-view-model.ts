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
import { familyFileId, type ConfigEntityFamilyDefinition, type ConfigFamilyFile } from '@/domain/config/config-entity-families';
import { listSkinRecords, listVariantRecords } from '@/services/config-entity.service';
import { queryHullPreviewMetadata, queryHullReferenceOptions } from '@/services/config-resource.service';
import { useProjectStore } from '@/stores/project.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { ResourceRef, RowData, SkinFile, VariantFile } from '@/shared/types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { SelectOption } from '@/domain/schema/schema-options';
import { hasEntityInvalidation, hasQueryInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';

export function useConfigFamilyViewModel(family: ConfigEntityFamilyDefinition) {
  const selectedId = ref<string | null>(null);
  const files = ref<(VariantFile | SkinFile)[]>([]);
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
  let hullNamesRequestId = 0;
  let hullOptionsRequestId = 0;
  const hullOptionsLoaded = ref(false);

  function idOf(file: VariantFile | SkinFile): string {
    return family.id === 'variant' ? (file as VariantFile).variantId : (file as SkinFile).skinHullId;
  }

  function idOfFamilyFile(file: ConfigFamilyFile): string {
    return familyFileId(family, file);
  }

  async function loadFiles() {
    const requestId = ++filesRequestId;
    const activeSessionId = project.activeSessionId;
    if (!activeSessionId) {
      files.value = [];
      spriteRefs.value = {};
      if (family.usesHullNames) hullNames.value = {};
      selectedId.value = null;
      dataRevision.value += 1;
      return;
    }
    listLoadStartedAt.value = performance.now();
    const selectedIdAtStart = selectedId.value;
    const previousSelected = selectedIdAtStart ? files.value.find((file) => idOf(file) === selectedIdAtStart) : null;
    try {
      const records = family.id === 'variant' ? await listVariantRecords(activeSessionId) : await listSkinRecords(activeSessionId);
      if (requestId !== filesRequestId || activeSessionId !== project.activeSessionId) return;
      files.value = records.map((record) =>
        family.id === 'variant' ? (record as { variant: VariantFile }).variant : (record as { skin: SkinFile }).skin,
      );
      spriteRefs.value = Object.fromEntries(
        records.map((record) => [
          family.id === 'variant' ? (record as { variant: VariantFile }).variant.variantId : (record as { skin: SkinFile }).skin.skinHullId,
          record.spriteRef,
        ]),
      );
      if (family.usesHullNames) {
        const hullNamesRequestIdAtStart = ++hullNamesRequestId;
        await loadFamilyHullNames(activeSessionId, hullNamesRequestIdAtStart, files.value);
      }
      const nextSelected = selectedIdAtStart ? files.value.find((file) => idOf(file) === selectedIdAtStart) : null;
      if (selectedEntityDataChanged(previousSelected, nextSelected)) dataRevision.value += 1;
      if (selectedId.value && !files.value.some((file) => idOf(file) === selectedId.value)) selectedId.value = null;
    } catch (error) {
      if (requestId !== filesRequestId || activeSessionId !== project.activeSessionId) return;
      feedback.error(error, `加载${family.displayName}失败`);
    }
  }

  async function loadFamilyHullNames(activeSessionId: string, requestId: number, sourceFiles: (VariantFile | SkinFile)[]): Promise<void> {
    if (sourceFiles.length === 0) {
      hullNames.value = {};
      return;
    }
    try {
      const hullIds = sourceFiles.map((file) => (file as VariantFile).hullId);
      const result = await queryHullPreviewMetadata(activeSessionId, hullIds);
      if (requestId !== hullNamesRequestId || activeSessionId !== project.activeSessionId) return;
      hullNames.value = result;
    } catch (error) {
      if (requestId !== hullNamesRequestId) return;
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
      if (requestId !== hullOptionsRequestId || activeSessionId !== project.activeSessionId) return;
      hullOptions.value = options;
      hullOptionsLoaded.value = true;
    } catch (error) {
      feedback.error(error, '读取舰船引用失败');
    }
  }

  async function createFamilyEntity(createSessionId: string, createModRoot: string, companionId: string, id: string): Promise<boolean> {
    if (!companionId || !id) {
      feedback.warning(`${family.companionLabel} 和 ${family.idField} 不能为空`);
      return false;
    }
    if (!isConfigEntityId(id)) {
      feedback.warning(configEntityIdInvalidMessage(family.idField, id), 'config.id_invalid');
      return false;
    }
    if (hasConfigEntityIdConflict(files.value as VariantFile[], id, null, idOf)) {
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
      selectedId.value = id;
      feedback.success(`${family.displayName} "${id}" 已创建`);
      return true;
    } catch (error) {
      feedback.error(error, `创建${family.displayName}失败`);
      return false;
    }
  }

  async function deleteFamilyEntity(deleteSessionId: string, deleteModRoot: string, id: string, relPath: string): Promise<boolean> {
    try {
      if (family.id === 'variant') {
        await deleteVariantAction(deleteSessionId, deleteModRoot, relPath, id);
      } else {
        await deleteSkinAction(deleteSessionId, deleteModRoot, relPath, id);
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
  ): Promise<ConfigFamilyFile | null> {
    const manifest = project.activeManifest;
    if (!manifest || manifest.modRoot !== saveModRoot || manifest.sessionId !== saveSessionId) return null;
    const currentId = idOfFamilyFile(current);
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
    if (hasConfigEntityIdConflict(files.value as VariantFile[], nextId, currentId, idOf)) {
      feedback.warning(`${family.displayName} "${nextId}" 已存在`);
      return null;
    }
    const renameContext = configEntityRenameContext(currentId, nextId);
    const saved =
      family.id === 'variant'
        ? await saveVariantAction(saveSessionId, saveModRoot, nextId, data, renameContext.previousId, current.relPath, feedback)
        : await saveSkinAction(saveSessionId, saveModRoot, nextId, data, renameContext.previousId, current.relPath, feedback);
    if (!saved) return null;
    if (project.activeManifest?.modRoot !== saveModRoot || project.activeManifest.sessionId !== saveSessionId) return saved;
    await loadFiles();
    selectedId.value = nextId;
    feedback.success(`${family.displayName} "${nextId}" 已保存`);
    return saved;
  }

  function onSaved(id: string | null) {
    selectedId.value = id;
  }

  watch(() => project.activeSessionId, loadFiles, { immediate: true });
  watch(
    () => settings.isPlainEditMode,
    () => {
      if (settings.isPlainEditMode) {
        hullOptions.value = [];
        hullOptionsLoaded.value = false;
      }
    },
  );
  const stopQueryInvalidation = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== project.activeSessionId) return;
    const filesChanged = hasEntityInvalidation(event, 'entity-list', family.entityKind);
    const hullReferenceQueryChanged = hasQueryInvalidation(event, 'hull-references');
    if (filesChanged) void loadFiles();
    if (hullReferenceQueryChanged) {
      if (family.usesHullNames) {
        const requestId = ++hullNamesRequestId;
        void loadFamilyHullNames(project.activeSessionId, requestId, files.value);
      }
      if (hullOptionsLoaded.value) void loadHullOptions();
    }
  });
  onUnmounted(() => {
    stopQueryInvalidation();
  });

  return {
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

function selectedEntityDataChanged(previous: { data: RowData } | null | undefined, next: { data: RowData } | null | undefined): boolean {
  if (!previous && !next) return false;
  if (!previous || !next) return true;
  return JSON.stringify(previous.data) !== JSON.stringify(next.data);
}
