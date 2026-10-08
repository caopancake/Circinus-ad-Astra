import { computed, watch } from 'vue';
import { useProjectStore } from '@/stores/project.store';
import { completeConfigSave, saveModInfoAction } from '@/orchestrators/config-save.orchestrator';
import { deepClone } from '@/shared/lib/starsector';
import type { FileSchema } from '@/domain/schema/schema.types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSchemaRuntimeContext } from '@/app/composables/use-schema-runtime-context';
import { configModInfoEditorModel, configModInfoSaveData } from '@/domain/config/config-entities';
import { useConfigEditorDraftSession } from '@/app/composables/config/use-config-editor-draft-session';
import type { ProjectManifest, RowData } from '@/shared/types';

type ModInfoTarget = Pick<ProjectManifest, 'modRoot' | 'sessionId'>;

export function useConfigModInfoViewModel() {
  const project = useProjectStore();
  const feedback = useAppFeedback();
  const schemaRuntimeContext = useSchemaRuntimeContext(() => project.activeManifest);
  const draftSession = useConfigEditorDraftSession<RowData, ModInfoTarget, import('@/shared/types').WriteResult | null>({
    emptyValue: {},
    modRoot: computed(() => project.activeManifest?.modRoot ?? null),
    load: (target) => {
      const manifest = project.getManifest(target.modRoot)!;
      return {
        target,
        value: configModInfoEditorModel(deepClone(manifest.modInfo ?? {})),
        baseVersions: manifest.baseVersions,
        meta: null,
      };
    },
    save: async (target, data, baseVersions) => {
      const schema = pendingSaveSchema;
      if (!schema) return;
      const file = configModInfoSaveData(data, schema);
      const saved = await saveModInfoAction(target.sessionId, target.modRoot, file, feedback, baseVersions);
      if (!saved) return;
      return {
        target,
        value: configModInfoEditorModel(deepClone(saved.refreshedEntity!)),
        baseVersions: saved.baseVersions,
        meta: saved,
        commitId: saved.commitId,
      };
    },
    targetKey: (target) => `${target.sessionId}\n${target.modRoot}`,
    afterSaved: (snapshot) => completeConfigSave(snapshot.target.modRoot, snapshot.target.sessionId, snapshot.meta!, '保存 mod_info.json'),
  });
  let pendingSaveSchema: FileSchema | null = null;

  watch(
    () => project.activeManifest,
    (manifest) => {
      if (!manifest) {
        draftSession.clearTarget();
        return;
      }
      const target = manifest;
      const data = configModInfoEditorModel(deepClone(target.modInfo ?? {}));
      if (draftSession.currentTargetKey.value !== `${target.sessionId}\n${target.modRoot}`) void draftSession.loadTarget(target);
      else draftSession.applyExternalForTarget({ target, value: data, baseVersions: manifest.baseVersions, meta: null });
    },
    { immediate: true },
  );

  async function saveModInfo(schema: FileSchema | null) {
    if (draftSession.saving.value) {
      await draftSession.waitForSave();
      return;
    }
    const manifest = project.activeManifest;
    if (!manifest || !schema) return;
    pendingSaveSchema = schema;
    try {
      const saved = await draftSession.saveDraft();
      if (!saved) return;
      feedback.success('mod_info.json 已保存');
    } catch (error) {
      feedback.error(error, '保存 mod_info.json 失败');
    } finally {
      pendingSaveSchema = null;
    }
  }

  return {
    dirty: draftSession.dirty,
    draftData: draftSession.draftValue,
    externalUpdateNotice: draftSession.externalUpdateNotice,
    hasPendingExternalData: draftSession.hasPendingExternalValue,
    loadPendingExternalData: draftSession.loadPendingExternal,
    saving: draftSession.saving,
    schemaRuntimeContext,
    saveModInfo,
  };
}
