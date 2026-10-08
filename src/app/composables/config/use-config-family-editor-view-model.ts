import { completeConfigSave } from '@/orchestrators/config-save.orchestrator';
import type { ConfigEditTarget } from '@/shared/types';
import { computed, watch, type Ref } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useConfigEditorDraftSession } from '@/app/composables/config/use-config-editor-draft-session';
import type { ConfigEntityFamilyDefinition, ConfigFamilyFile } from '@/domain/config/config-entity-families';
import { familyFileId } from '@/domain/config/config-entity-families';
import type { RowData, SavedConfig, WriteResult } from '@/shared/types';
import { createSchemaRuntimeContext } from '@/app/composables/use-schema-runtime-context';
import { queryBuiltInWeaponSlotOptions } from '@/services/config-resource.service';
import { hasQueryInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';

export function useConfigFamilyEditorViewModel(params: {
  family: ConfigEntityFamilyDefinition;
  dataRevision: Ref<number>;
  modRoot: Ref<string | null>;
  onSaved: (id: string | null) => void | Promise<void>;
  saveFile: (sessionId: string, modRoot: string, current: ConfigFamilyFile, data: RowData) => Promise<SavedConfig<ConfigFamilyFile> | null>;
  sessionId: Ref<string | null>;
  selectedId: Ref<string>;
  files: Ref<ConfigFamilyFile[]>;
}) {
  const feedback = useAppFeedback();
  function editTarget(id: string): ConfigEditTarget {
    return {
      sessionId: params.sessionId.value!,
      modRoot: params.modRoot.value!,
      kind: family.id,
      id,
      relPath: params.files.value.find((file) => familyFileId(family, file) === id)?.relPath ?? null,
    };
  }

  const family = params.family;

  const selectedFile = computed(() => params.files.value.find((file) => familyFileId(family, file) === params.selectedId.value) ?? null);

  const draftSession = useConfigEditorDraftSession<
    RowData,
    ConfigEditTarget,
    { file: ConfigFamilyFile | null; receipt: WriteResult | null }
  >({
    emptyValue: {},
    modRoot: params.modRoot,
    load: (target) => {
      const id = target.id;
      const file = params.files.value.find((candidate) => familyFileId(family, candidate) === id) ?? null;
      return { target, meta: { file, receipt: null }, value: file ? file.data : {}, baseVersions: file?.baseVersions ?? [] };
    },
    save: async (target, data, baseVersions) => {
      const current = params.files.value.find((file) => file.relPath === target.relPath) ?? null;
      const saveModRoot = target.modRoot;
      const saveSessionId = target.sessionId;
      if (!current || !saveModRoot || !saveSessionId) return;
      const saved = await params.saveFile(saveSessionId, saveModRoot, { ...current, baseVersions }, data);
      if (!saved) return;
      return {
        target: { ...target, id: familyFileId(family, saved.entity), relPath: saved.entity.relPath },
        meta: { file: saved.entity, receipt: saved.receipt },
        value: saved.entity.data,
        baseVersions: saved.entity.baseVersions,
        commitId: saved.receipt.commitId,
      };
    },
    targetKey: (target) => JSON.stringify(target),
    afterSaved: async (snapshot) => {
      await completeConfigSave(
        snapshot.target.modRoot,
        snapshot.target.sessionId,
        snapshot.meta.receipt!,
        `保存${family.displayName} ${snapshot.target.id}`,
      );
      if (draftSession.isTargetCurrent(snapshot.target)) await params.onSaved(snapshot.target.id);
    },
  });

  watch(
    () => [params.selectedId.value, params.dataRevision.value, params.sessionId.value, params.modRoot.value] as const,
    ([selectedId]) => {
      const file = selectedFile.value;
      const data = file ? file.data : {};
      if (!draftSession.isTargetCurrent(editTarget(selectedId))) void loadFamilyEditorData(selectedId);
      else
        draftSession.applyExternalForTarget({
          target: editTarget(selectedId),
          value: data,
          meta: { file, receipt: null },
          baseVersions: file?.baseVersions ?? [],
        });
    },
    { immediate: true },
  );

  async function loadFamilyEditorData(selectedId: string) {
    try {
      await draftSession.loadTarget(editTarget(selectedId));
    } catch (error) {
      feedback.error(error, `加载${family.displayName}失败`);
    }
  }

  async function save() {
    if (draftSession.saving.value) {
      await draftSession.waitForSave();
      return;
    }
    try {
      await draftSession.saveDraft();
    } catch (error) {
      feedback.error(error, `保存${family.displayName}失败`);
    }
  }

  const schemaRuntimeContext = computed(() => {
    const root = params.modRoot.value;
    const session = params.sessionId.value;
    if (!root || !session) return null;
    const context = createSchemaRuntimeContext(root, session);
    const baseHullId = draftSession.draftValue.value.baseHullId;
    if (family.id !== 'skin') return context;
    const hullId = typeof baseHullId === 'string' ? baseHullId : '';
    return {
      ...context,
      sourceContextKey: hullId,
      querySourceOptions: (source: string) =>
        source === 'hull:builtInWeaponSlots'
          ? hullId
            ? queryBuiltInWeaponSlotOptions(session, hullId)
            : Promise.resolve([])
          : context.querySourceOptions!(source),
      subscribeSourceOptionInvalidation: (source: string, resources: () => import('@/shared/types').ResourceRef[], listener: () => void) =>
        source === 'hull:builtInWeaponSlots'
          ? subscribeQueryInvalidations((event) => {
              if (event.sessionId === session && hasQueryInvalidation(event, 'hull-references')) listener();
            })
          : context.subscribeSourceOptionInvalidation!(source, resources, listener),
    };
  });

  return {
    draftData: draftSession.draftValue,
    externalUpdateNotice: draftSession.externalUpdateNotice,
    hasPendingExternalData: draftSession.hasPendingExternalValue,
    loadPendingExternalData: draftSession.loadPendingExternal,
    save,
    saving: draftSession.saving,
    selectedFile,
    schemaRuntimeContext,
  };
}
