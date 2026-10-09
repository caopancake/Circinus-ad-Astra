import { completeConfigSave } from '@/orchestrators/config-save.orchestrator';
import type { ConfigEditTarget } from '@/shared/types';
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useConfigEditorDraftSession } from '@/app/composables/config/use-config-editor-draft-session';
import { configFactionEditorModel } from '@/domain/config/config-entities';
import type { FileSchema } from '@/domain/schema/schema.types';
import { cell, deepClone } from '@/shared/lib/starsector';
import type { RowData, WriteResult } from '@/shared/types';

export function useConfigFactionEditorViewModel(params: {
  dataRevision: Ref<number>;
  factionId: Ref<string>;
  factions: Ref<Record<string, RowData>>;
  factionVersions: Ref<Record<string, import('@/shared/types').FileVersion[]>>;
  identityHandoff?: Readonly<
    Ref<import('@/shared/types').ConfigIdentityHandoff<import('@/domain/config/config-records').ConfigFactionRecord> | null>
  >;
  modRoot: Ref<string | null>;
  onSaved: (factionId: string | null, saved?: import('@/shared/types').ConfigSaveIdentity) => void | Promise<void>;
  previewRevision: Ref<number>;
  queryPreviewImages: (sessionId: string, factionId: string, draft: RowData) => Promise<{ crestSrc: string; logoSrc: string }>;
  saveFaction: (
    sessionId: string,
    modRoot: string,
    previousId: string,
    local: RowData,
    schema: FileSchema,
    baseVersions: import('@/shared/types').FileVersion[],
  ) => Promise<import('@/shared/types').ConfigSaveIdentity | null>;
  schema: Ref<FileSchema | null>;
  sessionId: Ref<string | null>;
}) {
  const adoptedCommits = new Set<number>();
  const feedback = useAppFeedback();
  function editTarget(id: string): ConfigEditTarget {
    return { sessionId: params.sessionId.value!, modRoot: params.modRoot.value!, kind: 'faction', id, relPath: null };
  }

  const draftSession = useConfigEditorDraftSession<RowData, ConfigEditTarget, { id: string; receipt: WriteResult | null }>({
    emptyValue: {},
    modRoot: params.modRoot,
    load: (target) => ({
      target,
      meta: { id: target.id, receipt: null },
      baseVersions: params.factionVersions.value[target.id] ?? [],
      value: params.factions.value[target.id]
        ? configFactionEditorModel(deepClone(params.factions.value[target.id]!))
        : configFactionEditorModel({ id: target.id }),
    }),
    save: async (target, data, baseVersions) => {
      const currentSchema = params.schema.value;
      const saveModRoot = target.modRoot;
      const saveSessionId = target.sessionId;
      if (!currentSchema || !saveModRoot || !saveSessionId) return;
      const savedId = await params.saveFaction(saveSessionId, saveModRoot, target.id, data, currentSchema, baseVersions);
      if (!savedId) return;
      return {
        target: { ...target, id: savedId.id },
        meta: { id: savedId.id, receipt: savedId.receipt },
        value: savedId.data,
        baseVersions: savedId.baseVersions,
        commitId: savedId.receipt.commitId,
      };
    },
    targetKey: (target) => JSON.stringify(target),
    afterSaved: async (snapshot) => {
      if (!adoptedCommits.has(snapshot.commitId!)) {
        if (draftSession.isTargetCurrent(snapshot.target))
          await params.onSaved(snapshot.target.id, {
            id: snapshot.target.id,
            data: snapshot.value,
            baseVersions: snapshot.baseVersions,
            receipt: snapshot.meta.receipt!,
          });
        adoptedCommits.add(snapshot.commitId!);
      }
      await completeConfigSave(
        snapshot.target.modRoot,
        snapshot.target.sessionId,
        snapshot.meta.receipt!,
        `保存势力 ${snapshot.target.id}`,
      );
    },
  });
  const draftData = draftSession.draftValue;
  const factionFile = computed<RowData>(() => {
    const file = draftData.value.file;
    return file && typeof file === 'object' && !Array.isArray(file) ? (file as RowData) : {};
  });
  const logoSrc = ref('');
  const crestSrc = ref('');
  let previewRequestId = 0;
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    previewRequestId++;
  });

  watch(
    () => [params.factionId.value, params.dataRevision.value, params.sessionId.value, params.modRoot.value] as const,
    ([id]) => {
      const handoff = params.identityHandoff?.value;
      if (handoff && handoff.sourceId === draftSession.currentTarget.value?.id && handoff.record.id === id) {
        const record = handoff.record;
        draftSession.adoptIdentity(
          draftSession.currentTarget.value,
          {
            target: editTarget(id),
            value: configFactionEditorModel(record.data),
            baseVersions: record.baseVersions,
            meta: { id, receipt: null },
            commitId: handoff.commitId,
          },
          (draft) =>
            handoff.preserveDraft ? { ...draft, file: { ...(draft.file as RowData), id } } : configFactionEditorModel(record.data),
        );
        return;
      }
      const data = params.factions.value[id]
        ? configFactionEditorModel(deepClone(params.factions.value[id]))
        : configFactionEditorModel({ id });
      if (!draftSession.isTargetCurrent(editTarget(id))) void loadFactionEditorData(id);
      else
        draftSession.applyExternalForTarget({
          target: editTarget(id),
          value: data,
          meta: { id, receipt: null },
          baseVersions: params.factionVersions.value[id] ?? [],
        });
    },
    { immediate: true },
  );

  watch(
    () => [params.sessionId.value, cell(factionFile.value.logo), cell(factionFile.value.crest), params.previewRevision.value] as const,
    () => refreshImagePreviews(),
    { immediate: true },
  );

  async function loadFactionEditorData(id: string) {
    try {
      await draftSession.loadTarget(editTarget(id));
    } catch (error) {
      feedback.error(error, '加载势力失败');
    }
  }

  async function refreshImagePreviews() {
    const requestId = ++previewRequestId;
    logoSrc.value = '';
    crestSrc.value = '';
    const factionId = params.factionId.value;
    const sessionId = params.sessionId.value;
    if (!sessionId) {
      logoSrc.value = '';
      crestSrc.value = '';
      return;
    }
    try {
      const images = await params.queryPreviewImages(sessionId, factionId, deepClone(factionFile.value));
      if (disposed || requestId !== previewRequestId || sessionId !== params.sessionId.value || factionId !== params.factionId.value)
        return;
      logoSrc.value = images.logoSrc;
      crestSrc.value = images.crestSrc;
    } catch (error) {
      if (disposed || requestId !== previewRequestId) return;
      feedback.error(error, '刷新势力预览失败');
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
      feedback.error(error, '保存势力失败');
    }
  }

  const displayName = computed(() => cell(factionFile.value.displayName) || params.factionId.value);

  return {
    crestSrc,
    displayName,
    draftData,
    externalUpdateNotice: draftSession.externalUpdateNotice,
    hasPendingExternalData: draftSession.hasPendingExternalValue,
    loadPendingExternalData: draftSession.loadPendingExternal,
    logoSrc,
    save,
    saving: draftSession.saving,
  };
}
