import { createReadTicketOwner, isReadInvalidated } from '@/shared/runtime/read-request';
import { computed, ref, watch } from 'vue';
import type { UnlistenFn } from '@/windows/tauri.events';
import {
  queryEditorEntityBundle,
  loadImportedSpecFile,
  refreshBundleProjectiles,
  refreshBundleResources,
  queryDraftEditorImages,
  type EditorEntityBundle,
} from '@/services/editor.service';
import type { EditorSpecKind, EditorWindowKind, EntityKind, RowData, WriteResult } from '@/shared/types';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { deepClone } from '@/shared/lib/starsector';
import { formatError } from '@/shared/lib/errors';
import { normalizeFsPath } from '@/shared/lib/paths';
import { captureIdentityVersions, handoffTableVersions } from '@/domain/editors/entity-identity';
import { emitEditorSpecSaved, listenEditorPreviewDraftUpdated, listenEditorSpecSaved } from '@/orchestrators/editor-window.orchestrator';
import { applyProjectSessionCacheInvalid, listenProjectSessionInvalidated } from '@/orchestrators/project-session-refresh.orchestrator';
import { saveEditorSpecByKind } from '@/services/editor.service';
import {
  createEntitySavePreparation,
  reserveEntityIntent,
  retargetEntityWindow,
  releaseCommittedIdentityTargets,
} from '@/orchestrators/entity-identity.orchestrator';
import { listenEntityIdentityApplied } from '@/orchestrators/entity-events.orchestrator';
import type { EntityIdentityAppliedEvent } from '@/windows/window.events';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { hasEntityInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { hasResourceInvalidation, subscribeResourceInvalidations } from '@/services/resource-cache.service';
import { editorMissingTargetText } from '@/domain/editors/editor-definitions';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { WEAPON_SPRITE_FIELDS } from '@/domain/editors/lib/weapon-sprite-fields';
import { useEditTargetDraftSession, type EditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { pickEditorSpecFile } from '@/shared/runtime/dialog.runtime';
import { closeCurrentWindow } from '@/windows/current.window';
import type { QueryCacheInvalidationEvent } from '@/services/query-cache.service';
import type { ResourceCacheInvalidationEvent } from '@/services/resource-cache.service';
import type { EditorPreviewDraftUpdatedEvent, EditorSpecSavedEvent, ProjectSessionInvalidatedEvent } from '@/windows/window.events';

interface EditorWindowTarget {
  id: string;
  kind: EditorWindowKind;
  modRoot: string;
  sessionId: string;
}

type MissingSpecChoice = { action: 'create' } | { action: 'import'; data: RowData } | { action: 'cancel' };
type EditableEditorKind = 'ship' | 'weapon' | 'projectile' | 'system';

export function useEditorWindowViewModel(params: {
  sessionId: string | null;
  modRoot: string | null;
  id: string | null;
  kind: EditorWindowKind;
  draftSnapshot?: RowData | null;
}) {
  let previewDraftSnapshot = params.draftSnapshot ?? null;
  const completedLocalWrites = new Set<number>();
  const currentId = ref(params.id);
  const editorData = ref<EditorEntityBundle | null>(null);
  const feedback = useAppFeedback();
  const reads = createReadTicketOwner();
  let missingSpecIntent: object | null = null;
  let identityPreparation: Awaited<ReturnType<typeof createEntitySavePreparation>> | null = null;
  const draftSession: EditTargetDraftSession<RowData, EditorWindowTarget, { bundle: EditorEntityBundle; receipt: WriteResult | null }> =
    useEditTargetDraftSession<RowData, EditorWindowTarget, { bundle: EditorEntityBundle; receipt: WriteResult | null }>({
      emptyValue: {},
      load: async (target, signal) => {
        const data = await queryEditorEntityBundle(target.sessionId, target.kind, target.id, previewDraftSnapshot ?? undefined, signal);
        return {
          target,
          meta: { bundle: data, receipt: null },
          baseVersions: data.baseVersions,
          value: isEditableWindowKind(target.kind) ? primarySpecForBundle(data, target.kind) : {},
        };
      },
      save: async (target, draft, baseVersions) => {
        if (!isEditableWindowKind(target.kind)) return;
        const kind = target.kind as EditorSpecKind;
        const submittedBundle = deepClone(editorData.value!);
        const intent = await reserveEntityIntent(target.sessionId, target.modRoot, submittedBundle.target, draft);
        const versions = captureIdentityVersions(baseVersions, intent.destinationVersion);
        const result = await runConfirmedJsonWrite(feedback, (options) =>
          saveEditorSpecByKind(target.sessionId, target.modRoot, submittedBundle.target, draft, options, versions),
        );
        if (!result) return;
        const value = result.refreshedEntity!;
        const savedTarget = result.identityChanges[0]!.after;
        return {
          target: { ...target, id: savedTarget.id },
          value,
          baseVersions: result.baseVersions,
          commitId: result.commitId,
          meta: {
            bundle: {
              ...applySavedSpecToBundle(submittedBundle, kind, savedTarget.id, value),
              target: savedTarget,
              isNew: false,
              baseVersions: result.baseVersions,
            },
            receipt: result,
          },
        };
      },
      targetKey: editorWindowTargetKey,
      withSavePreparation: async (target, submit) =>
        identityPreparation!.withPreparation(target.sessionId, target.modRoot, editorData.value!.target, async (info) => {
          if (info) {
            const nextTarget = { ...target, id: info.target.id };
            const previousId = target.id;
            const baseline = draftSession.baselineSnapshot.value!;
            const renamed = previousId !== nextTarget.id;
            const fresh = renamed ? await queryEditorEntityBundle(target.sessionId, target.kind, nextTarget.id) : editorData.value!;
            const value = renamed ? primarySpecForBundle(fresh, target.kind as EditableEditorKind) : baseline.value;
            const versions = renamed ? fresh.baseVersions : handoffTableVersions(baseline.baseVersions, info);
            draftSession.adoptIdentity(
              target,
              {
                target: nextTarget,
                value,
                baseVersions: versions,
                meta: { bundle: { ...fresh, target: info.target, baseVersions: versions }, receipt: null },
              },
              (draft) =>
                previousId !== nextTarget.id && draft[params.kind === 'ship' ? 'hullId' : 'id'] === previousId
                  ? { ...draft, [params.kind === 'ship' ? 'hullId' : 'id']: nextTarget.id }
                  : draft,
              previousId === nextTarget.id ? 'save' : 'external',
            );
            return submit(nextTarget);
          }
          return submit(target);
        }),
      afterSaved: async (snapshot) => {
        const result = snapshot.meta.receipt!;
        if (!completedLocalWrites.has(result.commitId)) {
          await identityPreparation!.finish(result);
          await retargetEntityWindow(
            snapshot.target.sessionId,
            snapshot.target.modRoot,
            snapshot.target.kind as EditorSpecKind,
            snapshot.target.id,
          );
          await releaseCommittedIdentityTargets();
          completedLocalWrites.add(result.commitId);
        }
        await emitEditorSpecSaved({
          kind: snapshot.target.kind as EditorSpecKind,
          sessionId: snapshot.target.sessionId,
          modRoot: snapshot.target.modRoot,
          id: snapshot.target.id,
          spec: snapshot.value,
          writeResult: result,
        });
      },
    });
  const unregisterSave = useSaveCommandStore().registerSaveSession({
    targetKey: draftSession.currentTargetKey,
    modRoot: computed(() => params.modRoot),
    saving: draftSession.saving,
    pendingSynchronization: draftSession.hasPendingSynchronization,
    waitForSave: draftSession.waitForSave,
  });
  const previewLoading = ref(false);
  const loading = computed(() => draftSession.loading.value || previewLoading.value);
  const { confirmDiscard } = useFieldInputActions(draftSession.inputs);
  const errorText = ref('');
  let unlistenEditorSpecSaved: UnlistenFn | null = null;
  let unlistenPreviewDraftUpdated: UnlistenFn | null = null;
  let unlistenIdentity: UnlistenFn | null = null;
  let identityCommitId = -1;
  let stopSessionInvalidated: UnlistenFn | null = null;
  let stopQueryInvalidation: (() => void) | null = null;
  let stopResourceInvalidation: (() => void) | null = null;
  let disposed = false;
  const relatedCommitIds = new Map<string, number>();
  const resourceRevision = ref(0);

  const draftImageKey = computed(() =>
    JSON.stringify(
      (params.kind === 'ship' ? ['spriteName'] : WEAPON_SPRITE_FIELDS).map((field) => draftSession.draftValue.value[field] ?? null),
    ),
  );
  watch([draftImageKey, resourceRevision], refreshDraftResources);
  watch(
    draftSession.baselineSnapshot,
    (snapshot) => {
      if (snapshot) currentId.value = snapshot.target.id;
      if (snapshot && !disposed) {
        reads.revoke();
        applyLoadedEditorData(snapshot.meta.bundle, snapshot.meta.receipt !== null);
      }
    },
    { flush: 'sync' },
  );

  function refreshDraftProjectiles() {
    const bundle = editorData.value;
    if (disposed || bundle?.kind !== 'weapon') return;
    const id = typeof bundle.weapon.projectileSpecId === 'string' ? bundle.weapon.projectileSpecId : '';
    const ids = Object.keys(bundle.projectileSpecs);
    if (id ? ids.length === 1 && ids[0] === id : ids.length === 0) return;
    editorData.value = { ...bundle, projectileSpecs: {} };
    void refreshEditorDerivedData({ projectileSpecs: true, projectileOptions: false, resources: false });
  }

  async function refreshDraftResources() {
    const key = draftImageKey.value;
    const target = editorWindowTarget();
    if (disposed || !target || !editorData.value || (params.kind !== 'ship' && params.kind !== 'weapon')) return;
    const kind = params.kind;
    const draft = draftSession.draftValue.value;
    editorData.value = clearBundleImages(editorData.value);
    await reads.consume(
      'images',
      { ...target, draftKey: key },
      (signal) => queryDraftEditorImages(target.sessionId, kind, target.id, draft, signal),
      {
        ready: (images) => {
          if (editorData.value?.kind === 'ship')
            editorData.value = { ...editorData.value, resourceRefs: images.resourceRefs, shipSpriteData: images.shipSpriteData };
          if (editorData.value?.kind === 'weapon')
            editorData.value = { ...editorData.value, resourceRefs: images.resourceRefs, weaponSpriteData: images.weaponSpriteData };
        },
        error: (error) => feedback.error(error, '读取草稿贴图失败'),
      },
    );
  }

  const shipEditorData = computed(() => (editorData.value?.kind === 'ship' ? editorData.value : null));
  const weaponEditorData = computed(() => (editorData.value?.kind === 'weapon' ? editorData.value : null));
  const projectileEditorData = computed(() => (editorData.value?.kind === 'projectile' ? editorData.value : null));
  const weaponPreviewData = computed(() => (editorData.value?.kind === 'weapon-preview' ? editorData.value : null));
  const systemEditorData = computed(() => (editorData.value?.kind === 'system' ? editorData.value : null));
  const weaponLikeEditorData = computed(() => {
    const data = editorData.value;
    return data?.kind === 'weapon' || data?.kind === 'weapon-preview' ? data : null;
  });
  const weaponForEditor = computed<RowData>(() => {
    const data = weaponLikeEditorData.value;
    const target = editorWindowTarget();
    if (!data || !target) return {};
    return data.weapon;
  });
  const shipSpriteForEditor = computed(() => shipEditorData.value?.shipSpriteData ?? '');
  const draftDirty = draftSession.dirty;
  const editContext = draftSession.context;
  const draftSaving = draftSession.saving;
  const externalUpdateNotice = draftSession.externalUpdateNotice;
  const canSaveSpec = computed(
    () =>
      draftSession.ready.value &&
      isEditableWindowKind(params.kind) &&
      (draftSession.hasPendingSynchronization.value || draftDirty.value || Boolean(editorData.value?.isNew)),
  );

  const missingEditorText = computed(() => {
    const target = editorWindowTarget();
    if (!target) return '缺少 Mod 路径或目标 id。';
    return editorMissingTargetText(params.kind, target.id);
  });

  async function queryEditorData(options: { promptForMissing: boolean; showLoading: boolean }) {
    const intent = {};
    missingSpecIntent = intent;
    reads.revoke();
    const target = editorWindowTarget();
    if (!target) {
      errorText.value = '缺少 Mod 路径或目标 id。';
      previewLoading.value = false;
      return;
    }
    errorText.value = '';
    if (!isEditableWindowKind(params.kind)) {
      previewLoading.value = options.showLoading;
      await reads.consume(
        'preview',
        target,
        (signal) => queryEditorEntityBundle(target.sessionId, target.kind, target.id, previewDraftSnapshot ?? undefined, signal),
        {
          ready: applyLoadedEditorData,
          error: (error) => {
            if (options.showLoading) errorText.value = formatError(error);
            else feedback.error(error, '刷新编辑器失败');
          },
          settled: () => {
            previewLoading.value = false;
          },
        },
      );
      return;
    }
    try {
      const snapshot = options.promptForMissing ? await draftSession.loadTarget(target) : await draftSession.refreshTarget(target);
      if (!snapshot?.meta) return;
      const data = snapshot.meta.bundle;
      if (data.isNew && options.promptForMissing) {
        const choice = await handleMissingSpec(params.kind, target);
        if (missingSpecIntent !== intent) return;
        if (choice.action === 'cancel') {
          void closeCurrentWindow();
          return;
        }
        if (choice.action === 'import') applyImportedSpec(params.kind, target.id, choice.data);
      }
    } catch (error) {
      if (isReadInvalidated(error)) return;
      if (options.showLoading) errorText.value = formatError(error);
      else feedback.error(error, '刷新编辑器失败');
    }
  }

  async function handleMissingSpec(kind: EditorWindowKind, target: EditorWindowTarget): Promise<MissingSpecChoice> {
    const specKind = kind as EditorSpecKind;
    const choice = await feedback.choose({
      title: `找不到 ${target.id} 的 spec`,
      content: '目标文件不存在，请选择操作：',
      choices: [
        { label: '新建文件', value: 'create', type: 'primary' },
        { label: '导入已有文件', value: 'import' },
      ],
    });
    if (!choice) return { action: 'cancel' };
    if (choice === 'import') {
      const path = await pickEditorSpecFile();
      if (!path) return { action: 'cancel' };
      try {
        const data = await loadImportedSpecFile(specKind, path);
        return { action: 'import', data };
      } catch (error) {
        feedback.error(error, '无法读取或解析所选文件');
        return { action: 'cancel' };
      }
    }
    return { action: 'create' };
  }

  function applyImportedSpec(kind: EditorWindowKind, id: string, data: RowData) {
    if (!editorData.value) return;
    const spec = deepClone(data);
    draftSession.setDraft(spec);
    editorData.value = applySavedSpecToBundle(editorData.value, kind as EditorSpecKind, id, spec);
    resourceRevision.value++;
  }

  async function saveEditorData(kind: EditorSpecKind, data?: RowData): Promise<void> {
    const target = editorWindowTarget();
    if (!target) return;
    if (draftSession.saving.value) {
      await draftSession.waitForSave();
      return;
    }
    if (data) updateEditorDraft(kind, data);
    try {
      const saved = await draftSession.saveDraft();
      if (saved) {
        feedback.success(`${target.id} 已保存`);
      }
    } catch (error) {
      feedback.error(error);
    }
  }

  function updateEditorDraft(kind: EditorSpecKind, data: RowData): void {
    const target = editorWindowTarget();
    if (!target || !editorData.value || !isPrimaryEditableKind(params.kind, kind)) return;
    const previousReference = bundleReferenceKey(editorData.value);
    const spec = deepClone(data);
    draftSession.setDraft(spec);
    editorData.value = applySavedSpecToBundle(editorData.value, kind, target.id, spec);
    if (previousReference !== bundleReferenceKey(editorData.value)) refreshDraftProjectiles();
  }

  function loadPendingExternalSpec(): void {
    const target = editorWindowTarget();
    if (!target || !editorData.value || !draftSession.pendingExternalValue.value || !isEditableWindowKind(params.kind)) return;
    if (draftSession.saving.value) {
      void draftSession.waitForSave().then((saved) => {
        if (saved && !disposed) loadPendingExternalSpec();
      });
      return;
    }
    confirmDiscard(adoptPendingExternalSpec, draftSession.dirty.value, () => draftSession.currentTargetKey.value);
  }

  function adoptPendingExternalSpec(): void {
    draftSession.loadPendingExternal();
  }

  async function initializeEditorWindow() {
    identityPreparation = await createEntitySavePreparation();
    if (disposed) {
      identityPreparation.dispose();
      return;
    }
    unlistenIdentity = await listenEntityIdentityApplied(handleIdentityApplied);
    if (disposed) {
      unlistenIdentity();
      unlistenIdentity = null;
      return;
    }
    unlistenPreviewDraftUpdated = await listenEditorPreviewDraftUpdated(handlePreviewDraftUpdated);
    if (disposed) {
      unlistenPreviewDraftUpdated();
      unlistenPreviewDraftUpdated = null;
      return;
    }
    unlistenEditorSpecSaved = await listenEditorSpecSaved(handleEditorSpecSaved);
    if (disposed) {
      unlistenEditorSpecSaved();
      unlistenEditorSpecSaved = null;
      return;
    }
    stopSessionInvalidated = await listenProjectSessionInvalidated(onProjectSessionInvalidated);
    if (disposed) {
      stopSessionInvalidated();
      stopSessionInvalidated = null;
      return;
    }
    stopQueryInvalidation = subscribeQueryInvalidations(handleQueryCacheInvalidated);
    stopResourceInvalidation = subscribeResourceInvalidations(handleResourceCacheInvalidated);
    void queryEditorData({ promptForMissing: true, showLoading: true });
  }

  function disposeEditorWindow() {
    disposed = true;
    missingSpecIntent = null;
    reads.revoke();
    identityPreparation?.dispose();
    unlistenIdentity?.();
    unlistenIdentity = null;
    unregisterSave();
    unlistenPreviewDraftUpdated?.();
    unlistenPreviewDraftUpdated = null;
    unlistenEditorSpecSaved?.();
    unlistenEditorSpecSaved = null;
    stopSessionInvalidated?.();
    stopSessionInvalidated = null;
    stopQueryInvalidation?.();
    stopQueryInvalidation = null;
    stopResourceInvalidation?.();
    stopResourceInvalidation = null;
    draftSession.dispose();
  }

  function handlePreviewDraftUpdated(event: EditorPreviewDraftUpdatedEvent) {
    const target = editorWindowTarget();
    if (
      !target ||
      params.kind !== 'weapon-preview' ||
      event.sessionId !== target.sessionId ||
      normalizeFsPath(event.modRoot) !== normalizeFsPath(target.modRoot) ||
      event.id !== target.id
    )
      return;
    previewDraftSnapshot = deepClone(event.draft);
    void queryEditorData({ promptForMissing: false, showLoading: false });
  }

  async function handleIdentityApplied(event: EntityIdentityAppliedEvent) {
    const target = editorWindowTarget();
    if (
      !target ||
      event.sessionId !== target.sessionId ||
      normalizeFsPath(event.modRoot) !== normalizeFsPath(target.modRoot) ||
      event.result.commitId <= identityCommitId
    )
      return;
    const change = event.result.identityChanges.find(
      (change) =>
        change.before.kind === editorWindowEntityKind(target.kind) && change.before.id === target.id && change.after.id !== target.id,
    );
    if (!change) return;
    if (draftSession.saving.value && !(await draftSession.waitForSave())) return;
    if (disposed || !sameEditorWindowTarget(target, editorWindowTarget())) return;
    if (target.kind === 'weapon-preview') {
      const snapshot = previewDraftSnapshot ? { ...previewDraftSnapshot, id: change.after.id } : undefined;
      const data = await queryEditorEntityBundle(target.sessionId, target.kind, change.after.id, snapshot);
      if (disposed || !sameEditorWindowTarget(target, editorWindowTarget())) return;
      await retargetEntityWindow(target.sessionId, target.modRoot, target.kind, change.after.id);
      currentId.value = change.after.id;
      previewDraftSnapshot = snapshot ?? null;
      applyLoadedEditorData(data);
      identityCommitId = event.result.commitId;
      return;
    }
    if (draftSession.dirty.value) {
      const choice = await feedback.choose({
        title: '跟随实体重命名？',
        content: '保留当前草稿和活动输入，并接纳新的正式身份与文件基线。',
        choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
      });
      if (choice !== 'follow' || disposed || !sameEditorWindowTarget(target, editorWindowTarget())) return;
    }
    const data = await queryEditorEntityBundle(target.sessionId, target.kind, change.after.id);
    if (disposed || !sameEditorWindowTarget(target, editorWindowTarget())) return;
    const nextTarget = { ...target, id: change.after.id };
    const next = primarySpecForBundle(data, target.kind);
    await retargetEntityWindow(target.sessionId, target.modRoot, target.kind, nextTarget.id);
    const accepted = draftSession.adoptIdentity(
      target,
      {
        target: nextTarget,
        value: next,
        baseVersions: data.baseVersions,
        meta: { bundle: data, receipt: null },
        commitId: event.result.commitId,
      },
      (draft) => (draftSession.dirty.value ? { ...draft, [target.kind === 'ship' ? 'hullId' : 'id']: nextTarget.id } : next),
    );
    if (accepted) identityCommitId = event.result.commitId;
  }

  function handleEditorSpecSaved(event: EditorSpecSavedEvent) {
    const target = editorWindowTarget();
    if (
      !target ||
      event.sessionId !== target.sessionId ||
      normalizeFsPath(event.modRoot) !== normalizeFsPath(target.modRoot) ||
      !editorData.value
    )
      return;
    if (!shouldApplySavedSpec(editorData.value, target, event)) return;
    if (params.kind === 'weapon-preview' && event.kind === 'weapon') {
      if (!previewDraftSnapshot) void queryEditorData({ promptForMissing: false, showLoading: false });
      return;
    }
    if (isPrimaryEditableKind(params.kind, event.kind) && event.id === target.id) {
      receiveExternalPrimarySpec(event.kind, event.id, event.spec, event.writeResult);
      return;
    }
    const key = JSON.stringify([event.kind, event.id]);
    if (event.writeResult.commitId <= (relatedCommitIds.get(key) ?? -1)) return;
    relatedCommitIds.set(key, event.writeResult.commitId);
    applySavedSpec(event.kind, event.id, event.spec);
  }

  function applySavedSpec(kind: EditorSpecKind, id: string, data: RowData) {
    if (!editorData.value) return;
    const spec = deepClone(data);
    editorData.value = applySavedSpecToBundle(editorData.value, kind, id, spec);
  }

  function onProjectSessionInvalidated(event: ProjectSessionInvalidatedEvent) {
    const target = editorWindowTarget();
    if (
      !target ||
      event.manifest.sessionId !== target.sessionId ||
      normalizeFsPath(event.manifest.modRoot) !== normalizeFsPath(target.modRoot)
    )
      return;
    applyProjectSessionCacheInvalid(event);
  }

  function handleQueryCacheInvalidated(event: QueryCacheInvalidationEvent) {
    const target = editorWindowTarget();
    if (!target || event.sessionId !== target.sessionId) return;
    if (event.scope === 'session') {
      reads.revoke('session');
      missingSpecIntent = null;
      previewLoading.value = false;
      return;
    }
    if (hasPrimaryDetailInvalidation(event, params.kind, target.id)) {
      void queryEditorData({ promptForMissing: false, showLoading: false });
      return;
    }
    const projectileSpecsChanged = hasProjectileSpecInvalidation(event, editorData.value);
    const projectileOptionsChanged = hasProjectileListInvalidation(event, params.kind);
    if (projectileSpecsChanged || projectileOptionsChanged) {
      void refreshEditorDerivedData({
        projectileOptions: projectileOptionsChanged,
        projectileSpecs: projectileSpecsChanged,
        resources: false,
      });
    }
  }

  function handleResourceCacheInvalidated(event: ResourceCacheInvalidationEvent) {
    const target = editorWindowTarget();
    if (!target || event.sessionId !== target.sessionId) return;
    if (event.scope === 'session') {
      return;
    }
    if (params.kind === 'ship' || params.kind === 'weapon') {
      const paths = (params.kind === 'ship' ? ['spriteName'] : WEAPON_SPRITE_FIELDS)
        .map((field) => draftSession.draftValue.value[field])
        .filter((path): path is string => typeof path === 'string')
        .map(normalizeFsPath);
      const resources = event.invalidation?.resources ?? event.resources;
      if (event.invalidation?.session || resources.some((resource) => paths.includes(normalizeFsPath(resource.relPath))))
        resourceRevision.value++;
      return;
    }
    if (!editorResourceInvalidated(event, editorData.value)) return;
    void refreshEditorDerivedData({
      projectileOptions: false,
      projectileSpecs: false,
      resources: true,
    });
  }

  async function refreshEditorDerivedData(options: { projectileSpecs: boolean; projectileOptions: boolean; resources: boolean }) {
    const target = editorWindowTarget();
    const bundle = editorData.value;
    if (!target || !bundle) return;
    const reference = bundleReferenceKey(bundle);
    const error = (error: unknown) => feedback.error(error, '刷新编辑器派生数据失败');
    const tasks: Promise<boolean>[] = [];
    if (options.projectileSpecs)
      tasks.push(
        reads.consume(
          'projectiles',
          { ...target, reference },
          (signal) => refreshBundleProjectiles(target.sessionId, bundle, { projectileSpecs: true, projectileOptions: false }, signal),
          {
            ready: (refreshed) => {
              const current = editorData.value;
              if (
                (current?.kind === 'weapon' || current?.kind === 'weapon-preview') &&
                (refreshed.kind === 'weapon' || refreshed.kind === 'weapon-preview')
              )
                editorData.value = { ...current, projectileSpecs: refreshed.projectileSpecs };
            },
            error,
          },
        ),
      );
    if (options.projectileOptions)
      tasks.push(
        reads.consume(
          'projectile-options',
          target,
          (signal) => refreshBundleProjectiles(target.sessionId, bundle, { projectileSpecs: false, projectileOptions: true }, signal),
          {
            ready: (refreshed) => {
              if (editorData.value?.kind === 'weapon' && refreshed.kind === 'weapon')
                editorData.value = { ...editorData.value, projectileOptions: refreshed.projectileOptions };
            },
            error,
          },
        ),
      );
    if (options.resources)
      tasks.push(
        reads.consume('resources', { ...target, reference }, (signal) => refreshBundleResources(target.sessionId, bundle, signal), {
          ready: (refreshed) => {
            const current = editorData.value;
            if (
              (current?.kind === 'weapon' || current?.kind === 'weapon-preview') &&
              (refreshed.kind === 'weapon' || refreshed.kind === 'weapon-preview')
            )
              editorData.value = { ...current, resourceRefs: refreshed.resourceRefs, weaponSpriteData: refreshed.weaponSpriteData };
          },
          error,
        }),
      );
    await Promise.all(tasks);
  }

  function editorWindowTarget(): EditorWindowTarget | null {
    if (!params.sessionId || !params.modRoot || !currentId.value) return null;
    return { sessionId: params.sessionId, modRoot: params.modRoot, kind: params.kind, id: currentId.value };
  }

  return {
    currentTarget: computed(editorWindowTarget),
    editorData,
    shipEditorData,
    weaponEditorData,
    projectileEditorData,
    weaponPreviewData,
    systemEditorData,
    loading,
    errorText,
    weaponForEditor,
    shipSpriteForEditor,
    draftValue: draftSession.draftValue,
    draftDirty,
    editContext,
    waitForSave: draftSession.waitForSave,
    saving: draftSession.saving,
    draftSaving,
    canSaveSpec,
    externalUpdateNotice,
    missingEditorText,
    initializeEditorWindow,
    disposeEditorWindow,
    saveEditorData,
    updateEditorDraft,
    loadPendingExternalSpec,
  };

  function applyLoadedEditorData(data: EditorEntityBundle, preserveCatalog = false): void {
    const target = editorWindowTarget();
    if (!target || !isEditableWindowKind(params.kind)) {
      editorData.value = data;
      draftSession.clearTarget();
      return;
    }
    const projected = clearBundleImages(applySavedSpecToBundle(data, params.kind, target.id, draftSession.draftValue.value));
    editorData.value =
      preserveCatalog && projected.kind === 'weapon' && editorData.value?.kind === 'weapon'
        ? { ...projected, projectileOptions: editorData.value.projectileOptions }
        : projected;
    resourceRevision.value++;
    refreshDraftProjectiles();
  }

  function receiveExternalPrimarySpec(kind: EditorSpecKind, id: string, data: RowData, result: WriteResult): void {
    if (!editorData.value) return;
    const spec = deepClone(data);
    const target = editorWindowTarget();
    if (!target) return;
    draftSession.applyExternalForTarget({
      target,
      value: spec,
      baseVersions: result.baseVersions,
      commitId: result.commitId,
      meta: { bundle: applySavedSpecToBundle(editorData.value, kind, id, spec), receipt: result },
    });
  }
}

function sameEditorWindowTarget(left: EditorWindowTarget, right: EditorWindowTarget | null): boolean {
  return Boolean(right && editorWindowTargetKey(left) === editorWindowTargetKey(right));
}

function bundleReferenceKey(bundle: EditorEntityBundle | null): string | null {
  return bundle?.kind === 'weapon' || bundle?.kind === 'weapon-preview'
    ? JSON.stringify([bundle.kind, bundle.weapon.projectileSpecId ?? null])
    : null;
}

function editorWindowTargetKey(target: EditorWindowTarget): string {
  return JSON.stringify([target.sessionId, normalizeFsPath(target.modRoot), target.kind, target.id]);
}

function shouldApplySavedSpec(bundle: EditorEntityBundle, target: EditorWindowTarget, event: EditorSpecSavedEvent): boolean {
  if (event.kind === 'ship') return bundle.kind === 'ship' && event.id === target.id;
  if (event.kind === 'weapon') return (bundle.kind === 'weapon' || bundle.kind === 'weapon-preview') && event.id === target.id;
  if (event.kind === 'projectile') {
    if (bundle.kind === 'projectile') return event.id === target.id;
    if (bundle.kind === 'weapon' || bundle.kind === 'weapon-preview')
      return event.id in bundle.projectileSpecs || bundle.weapon.projectileSpecId === event.id;
  }
  if (event.kind === 'system') return bundle.kind === 'system' && event.id === target.id;
  return false;
}

function applySavedSpecToBundle(bundle: EditorEntityBundle, kind: EditorSpecKind, id: string, spec: RowData): EditorEntityBundle {
  if (kind === 'ship' && bundle.kind === 'ship') {
    const images = bundle.ship.spriteName === spec.spriteName ? {} : { resourceRefs: [], shipSpriteData: '' };
    return { ...bundle, ...images, ship: spec };
  }
  if (kind === 'weapon' && (bundle.kind === 'weapon' || bundle.kind === 'weapon-preview')) {
    const images = WEAPON_SPRITE_FIELDS.every((field) => bundle.weapon[field] === spec[field])
      ? {}
      : { resourceRefs: [], weaponSpriteData: {} };
    return { ...bundle, ...images, weapon: spec };
  }
  if (kind === 'projectile' && bundle.kind === 'projectile') {
    return { ...bundle, projectile: spec, projectileSpecs: { ...bundle.projectileSpecs, [id]: spec } };
  }
  if (kind === 'projectile' && (bundle.kind === 'weapon' || bundle.kind === 'weapon-preview')) {
    return { ...bundle, projectileSpecs: { ...bundle.projectileSpecs, [id]: spec } };
  }
  if (kind === 'system' && bundle.kind === 'system') return { ...bundle, system: spec };
  return bundle;
}

function clearBundleImages(bundle: EditorEntityBundle): EditorEntityBundle {
  if (bundle.kind === 'ship') return { ...bundle, resourceRefs: [], shipSpriteData: '' };
  if (bundle.kind === 'weapon') return { ...bundle, resourceRefs: [], weaponSpriteData: {} };
  return bundle;
}

function isEditableWindowKind(kind: EditorWindowKind): kind is EditableEditorKind {
  return kind === 'ship' || kind === 'weapon' || kind === 'projectile' || kind === 'system';
}

function isPrimaryEditableKind(windowKind: EditorWindowKind, specKind: EditorSpecKind): boolean {
  return isEditableWindowKind(windowKind) && windowKind === specKind;
}

function primarySpecForBundle(bundle: EditorEntityBundle, kind: EditableEditorKind): RowData {
  if (kind === 'ship' && bundle.kind === 'ship') return deepClone(bundle.ship);
  if (kind === 'weapon' && bundle.kind === 'weapon') {
    return deepClone(bundle.weapon);
  }
  if (kind === 'projectile' && bundle.kind === 'projectile') return deepClone(bundle.projectile);
  if (kind === 'system' && bundle.kind === 'system') return deepClone(bundle.system);
  return {};
}

function hasPrimaryDetailInvalidation(event: QueryCacheInvalidationEvent, windowKind: EditorWindowKind, id: string): boolean {
  const primaryKind = editorWindowEntityKind(windowKind);
  return hasEntityInvalidation(event, 'entity-detail', primaryKind, id);
}

function hasProjectileSpecInvalidation(event: QueryCacheInvalidationEvent, bundle: EditorEntityBundle | null): boolean {
  if (bundle?.kind !== 'weapon' && bundle?.kind !== 'weapon-preview') return false;
  const projectileIds = [
    ...Object.keys(bundle.projectileSpecs),
    ...(typeof bundle.weapon.projectileSpecId === 'string' ? [bundle.weapon.projectileSpecId] : []),
  ];
  if (projectileIds.length === 0) return false;
  return projectileIds.some((id) => hasEntityInvalidation(event, 'entity-detail', 'projectile', id));
}

function hasProjectileListInvalidation(event: QueryCacheInvalidationEvent, windowKind: EditorWindowKind): boolean {
  if (windowKind !== 'weapon') return false;
  return hasEntityInvalidation(event, 'entity-list', 'projectile');
}

function editorResourceInvalidated(event: ResourceCacheInvalidationEvent, bundle: EditorEntityBundle | null): boolean {
  if (!bundle || !('resourceRefs' in bundle)) return false;
  return hasResourceInvalidation(event, bundle.resourceRefs);
}

function editorWindowEntityKind(windowKind: EditorWindowKind): EntityKind {
  return windowKind === 'weapon-preview' ? 'weapon' : windowKind;
}
