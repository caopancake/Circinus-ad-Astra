import { computed, watch, type Ref } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useConfigEditorDraftSession } from '@/app/composables/config/use-config-editor-draft-session';
import type { ConfigEntityFamilyDefinition, ConfigFamilyFile } from '@/domain/config/config-entity-families';
import { familyFileId } from '@/domain/config/config-entity-families';
import type { RowData } from '@/shared/types';
import { createSchemaRuntimeContext } from '@/app/composables/use-schema-runtime-context';
import { queryBuiltInWeaponSlotOptions } from '@/services/config-resource.service';
import { hasQueryInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';

export function useConfigFamilyEditorViewModel(params: {
  family: ConfigEntityFamilyDefinition;
  dataRevision: Ref<number>;
  modRoot: Ref<string | null>;
  onSaved: (id: string | null) => void;
  saveFile: (sessionId: string, modRoot: string, current: ConfigFamilyFile, data: RowData) => Promise<ConfigFamilyFile | null>;
  sessionId: Ref<string | null>;
  selectedId: Ref<string>;
  files: Ref<ConfigFamilyFile[]>;
}) {
  const feedback = useAppFeedback();
  const family = params.family;

  const selectedFile = computed(() => params.files.value.find((file) => familyFileId(family, file) === params.selectedId.value) ?? null);

  const draftSession = useConfigEditorDraftSession<RowData, string, ConfigFamilyFile | null, ConfigFamilyFile>({
    emptyValue: {},
    modRoot: params.modRoot,
    load: (id) => {
      const file = params.files.value.find((candidate) => familyFileId(family, candidate) === id) ?? null;
      return { meta: file, value: file ? file.data : {} };
    },
    save: async (_id, data) => {
      const current = selectedFile.value;
      const saveModRoot = params.modRoot.value;
      const saveSessionId = params.sessionId.value;
      if (!current || !saveModRoot || !saveSessionId) return;
      const saved = await params.saveFile(saveSessionId, saveModRoot, current, data);
      if (params.modRoot.value !== saveModRoot || params.sessionId.value !== saveSessionId || !saved) return;
      return { meta: saved, value: saved.data };
    },
    targetKey: (id) => id,
  });

  watch(
    () => [params.selectedId.value, params.dataRevision.value] as const,
    ([selectedId]) => {
      const file = selectedFile.value;
      const data = file ? file.data : {};
      if (draftSession.currentTargetKey.value !== selectedId) void loadFamilyEditorData(selectedId);
      else draftSession.applyExternalForTarget(selectedId, data);
    },
    { immediate: true },
  );

  async function loadFamilyEditorData(selectedId: string) {
    try {
      await draftSession.loadTarget(selectedId);
    } catch (error) {
      feedback.error(error, `加载${family.displayName}失败`);
    }
  }

  async function save() {
    try {
      const saved = await draftSession.saveDraft();
      if (saved?.meta) params.onSaved(familyFileId(family, saved.meta));
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
