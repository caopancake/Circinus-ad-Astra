import { computed, ref } from 'vue';
import type { UnlistenFn } from '@/windows/tauri.events';
import {
  queryEditorEntityBundle,
  loadImportedSpecFile,
  refreshBundleProjectiles,
  refreshBundleResources,
  type EditorEntityBundle,
} from '@/services/editor.service';
import type { EditorSpecKind, EditorWindowKind, EntityKind, RowData } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';
import { formatError } from '@/shared/lib/errors';
import { emitEditorSpecSaved, listenEditorSpecSaved } from '@/orchestrators/editor-window.orchestrator';
import { applyProjectSessionCacheInvalid, listenProjectSessionInvalidated } from '@/orchestrators/project-session-refresh.orchestrator';
import { saveEditorSpecByKind } from '@/services/editor.service';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { hasEntityInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { hasResourceInvalidation, subscribeResourceInvalidations } from '@/services/resource-cache.service';
import { defaultEditorSpec, editorMissingTargetText } from '@/domain/editors/editor-definitions';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { pickEditorSpecFile } from '@/shared/runtime/dialog.runtime';
import { closeCurrentWindow } from '@/windows/current.window';
import type { QueryCacheInvalidationEvent } from '@/services/query-cache.service';
import type { ResourceCacheInvalidationEvent } from '@/services/resource-cache.service';
import type { EditorSpecSavedEvent, ProjectSessionInvalidatedEvent } from '@/windows/window.events';

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
  const editorData = ref<EditorEntityBundle | null>(null);
  const feedback = useAppFeedback();
  const draftSession = useEditTargetDraftSession<RowData, EditorWindowTarget, EditorEntityBundle>({
    emptyValue: {},
    load: async (target) => {
      const data = await queryEditorEntityBundle(target.sessionId, target.kind, target.id);
      return {
        meta: data,
        value: isEditableWindowKind(target.kind) ? primarySpecForBundle(data, target.kind, target.id) : {},
      };
    },
    save: async (target, draft) => {
      if (!isEditableWindowKind(target.kind)) return;
      const kind = target.kind as EditorSpecKind;
      const result = await runConfirmedJsonWrite(feedback, (options) =>
        saveEditorSpecByKind(target.sessionId, target.modRoot, kind, target.id, draft, options),
      );
      if (!result) return;
      await emitEditorSpecSaved({
        kind,
        sessionId: target.sessionId,
        modRoot: target.modRoot,
        id: target.id,
        spec: deepClone(draft),
        writeResult: result,
      });
      return { value: draft };
    },
    targetKey: editorWindowTargetKey,
  });
  const loading = ref(true);
  const errorText = ref('');
  let unlistenEditorSpecSaved: UnlistenFn | null = null;
  let stopSessionInvalidated: UnlistenFn | null = null;
  let stopQueryInvalidation: (() => void) | null = null;
  let stopResourceInvalidation: (() => void) | null = null;
  let editorDataRequestId = 0;
  let derivedDataRequestId = 0;
  let previewDraftSnapshotApplied = false;

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
    return Object.keys(data.weapon).length > 0 ? data.weapon : defaultEditorSpec('weapon', target.id, data.weaponCsvRow);
  });
  const shipSpriteForEditor = computed(() => shipEditorData.value?.shipSpriteData ?? '');
  const draftDirty = draftSession.dirty;
  const draftRevision = draftSession.revision;
  const draftSaving = draftSession.saving;
  const externalUpdateNotice = draftSession.externalUpdateNotice;
  const canSaveSpec = computed(() => isEditableWindowKind(params.kind) && (draftDirty.value || Boolean(editorData.value?.isNew)));

  const missingEditorText = computed(() => {
    const target = editorWindowTarget();
    if (!target) return '缺少 Mod 路径或目标 id。';
    return editorMissingTargetText(params.kind, target.id);
  });

  async function queryEditorData(options: { promptForMissing: boolean; showLoading: boolean }) {
    const requestId = ++editorDataRequestId;
    derivedDataRequestId++;
    const target = editorWindowTarget();
    if (!target) {
      errorText.value = '缺少 Mod 路径或目标 id。';
      loading.value = false;
      return;
    }
    if (options.showLoading) loading.value = true;
    errorText.value = '';
    try {
      const snapshot =
        isEditableWindowKind(params.kind) && target.kind === params.kind
          ? options.promptForMissing
            ? await draftSession.loadTarget(target)
            : await draftSession.refreshTarget(target)
          : { meta: await queryEditorEntityBundle(target.sessionId, params.kind, target.id), value: {} };
      if (requestId !== editorDataRequestId || !sameEditorWindowTarget(target, editorWindowTarget())) return;
      if (!snapshot?.meta) return;
      const data = snapshot.meta;
      applyLoadedEditorData(data);
      if (data.isNew && params.kind !== 'weapon-preview' && options.promptForMissing) {
        const choice = await handleMissingSpec(params.kind, target);
        if (requestId !== editorDataRequestId || !sameEditorWindowTarget(target, editorWindowTarget())) return;
        if (choice.action === 'cancel') {
          void closeCurrentWindow();
          return;
        }
        if (choice.action === 'import') applyImportedSpec(params.kind, target.id, choice.data);
      }
    } catch (error) {
      if (requestId !== editorDataRequestId) return;
      errorText.value = formatError(error);
    } finally {
      if (requestId === editorDataRequestId) loading.value = false;
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
    const target = editorWindowTarget();
    if (target) draftSession.loadBaseForTarget(target, spec);
    editorData.value = applySavedSpecToBundle(editorData.value, kind as EditorSpecKind, id, spec);
    if ('isNew' in editorData.value) editorData.value = { ...editorData.value, isNew: false } as EditorEntityBundle;
  }

  async function saveEditorData(kind: EditorSpecKind, data?: RowData): Promise<void> {
    const target = editorWindowTarget();
    if (!target || draftSession.saving.value) return;
    if (data) draftSession.setDraft(data);
    try {
      const saved = await draftSession.saveDraft();
      if (saved) {
        syncCurrentDraftToBundle(kind, target.id);
        feedback.success(`${target.id} 已保存`);
      }
    } catch (error) {
      feedback.error(error);
    }
  }

  function updateEditorDraft(kind: EditorSpecKind, data: RowData): void {
    const target = editorWindowTarget();
    if (!target || !editorData.value || !isPrimaryEditableKind(params.kind, kind)) return;
    const spec = deepClone(data);
    draftSession.setDraft(spec);
    editorData.value = applySavedSpecToBundle(editorData.value, kind, target.id, spec);
  }

  function loadPendingExternalSpec(): void {
    const target = editorWindowTarget();
    if (!target || !editorData.value || !draftSession.pendingExternalValue.value || !isEditableWindowKind(params.kind)) return;
    draftSession.loadPendingExternal();
    const spec = deepClone(draftSession.draftValue.value);
    editorData.value = applySavedSpecToBundle(editorData.value, params.kind, target.id, spec);
  }

  async function initializeEditorWindow() {
    unlistenEditorSpecSaved = await listenEditorSpecSaved(handleEditorSpecSaved);
    stopSessionInvalidated = await listenProjectSessionInvalidated(onProjectSessionInvalidated);
    stopQueryInvalidation = subscribeQueryInvalidations(handleQueryCacheInvalidated);
    stopResourceInvalidation = subscribeResourceInvalidations(handleResourceCacheInvalidated);
    void queryEditorData({ promptForMissing: true, showLoading: true });
  }

  function disposeEditorWindow() {
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

  function handleEditorSpecSaved(event: EditorSpecSavedEvent) {
    const target = editorWindowTarget();
    if (!target || event.sessionId !== target.sessionId || event.modRoot !== target.modRoot || !editorData.value) return;
    if (!shouldApplySavedSpec(editorData.value, target, event)) return;
    if (isPrimaryEditableKind(params.kind, event.kind) && event.id === target.id) {
      receiveExternalPrimarySpec(event.kind, event.id, event.spec);
      return;
    }
    applySavedSpec(event.kind, event.id, event.spec);
  }

  function applySavedSpec(kind: EditorSpecKind, id: string, data: RowData) {
    if (!editorData.value) return;
    const spec = deepClone(data);
    editorData.value = applySavedSpecToBundle(editorData.value, kind, id, spec);
  }

  function onProjectSessionInvalidated(event: ProjectSessionInvalidatedEvent) {
    const target = editorWindowTarget();
    if (!target || event.manifest.sessionId !== target.sessionId || event.manifest.modRoot !== target.modRoot) return;
    applyProjectSessionCacheInvalid(event);
  }

  function handleQueryCacheInvalidated(event: QueryCacheInvalidationEvent) {
    const target = editorWindowTarget();
    if (!target || event.sessionId !== target.sessionId) return;
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
    const requestId = ++derivedDataRequestId;
    try {
      const projectileRefreshed =
        options.projectileSpecs || options.projectileOptions ? await refreshBundleProjectiles(target.sessionId, bundle, options) : bundle;
      const refreshed = options.resources ? await refreshBundleResources(target.sessionId, projectileRefreshed) : projectileRefreshed;
      if (requestId !== derivedDataRequestId || editorData.value !== bundle || !sameEditorWindowTarget(target, editorWindowTarget()))
        return;
      editorData.value = refreshed;
    } catch (error) {
      feedback.error(error, '刷新编辑器派生数据失败');
    }
  }

  function editorWindowTarget(): EditorWindowTarget | null {
    if (!params.sessionId || !params.modRoot || !params.id) return null;
    return { sessionId: params.sessionId, modRoot: params.modRoot, kind: params.kind, id: params.id };
  }

  return {
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
    draftRevision,
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

  function applyLoadedEditorData(data: EditorEntityBundle): void {
    const target = editorWindowTarget();
    if (!target || !isEditableWindowKind(params.kind)) {
      editorData.value = applyPreviewDraftSnapshotOnce(data);
      draftSession.clearTarget();
      return;
    }
    editorData.value = applySavedSpecToBundle(data, params.kind, target.id, draftSession.draftValue.value);
  }

  function applyPreviewDraftSnapshotOnce(data: EditorEntityBundle): EditorEntityBundle {
    if (params.kind !== 'weapon-preview' || !params.draftSnapshot || previewDraftSnapshotApplied) return data;
    if (data.kind !== 'weapon-preview') return data;
    previewDraftSnapshotApplied = true;
    return { ...data, weapon: deepClone(params.draftSnapshot) };
  }

  function commitSavedSpecToBundle(kind: EditorSpecKind, id: string, data: RowData): void {
    if (!editorData.value) return;
    const spec = deepClone(data);
    const applied = applySavedSpecToBundle(editorData.value, kind, id, spec);
    editorData.value = applied.isNew ? ({ ...applied, isNew: false } as EditorEntityBundle) : applied;
  }

  function syncCurrentDraftToBundle(kind: EditorSpecKind, id: string): void {
    commitSavedSpecToBundle(kind, id, draftSession.draftValue.value);
  }

  function receiveExternalPrimarySpec(kind: EditorSpecKind, id: string, data: RowData): void {
    if (!editorData.value) return;
    const spec = deepClone(data);
    if (stableDeepEqual(draftSession.draftValue.value, spec)) {
      const target = editorWindowTarget();
      if (target) draftSession.loadBaseForTarget(target, spec);
      commitSavedSpecToBundle(kind, id, spec);
      return;
    }
    const target = editorWindowTarget();
    if (!target) return;
    const wasDirty = draftSession.dirty.value;
    draftSession.applyExternalForTarget(target, spec);
    if (!wasDirty) editorData.value = applySavedSpecToBundle(editorData.value, kind, id, spec);
  }
}

function sameEditorWindowTarget(left: EditorWindowTarget, right: EditorWindowTarget | null): boolean {
  return Boolean(right && editorWindowTargetKey(left) === editorWindowTargetKey(right));
}

function editorWindowTargetKey(target: EditorWindowTarget): string {
  return `${target.sessionId}\n${target.modRoot}\n${target.kind}\n${target.id}`;
}

function shouldApplySavedSpec(bundle: EditorEntityBundle, target: EditorWindowTarget, event: EditorSpecSavedEvent): boolean {
  if (event.kind === 'ship') return bundle.kind === 'ship' && event.id === target.id;
  if (event.kind === 'weapon') return (bundle.kind === 'weapon' || bundle.kind === 'weapon-preview') && event.id === target.id;
  if (event.kind === 'projectile') {
    if (bundle.kind === 'projectile') return event.id === target.id;
    if (bundle.kind === 'weapon' || bundle.kind === 'weapon-preview') return event.id in bundle.projectileSpecs;
  }
  if (event.kind === 'system') return bundle.kind === 'system' && event.id === target.id;
  return false;
}

function applySavedSpecToBundle(bundle: EditorEntityBundle, kind: EditorSpecKind, id: string, spec: RowData): EditorEntityBundle {
  if (kind === 'ship' && bundle.kind === 'ship') return { ...bundle, ship: spec };
  if (kind === 'weapon' && (bundle.kind === 'weapon' || bundle.kind === 'weapon-preview')) return { ...bundle, weapon: spec };
  if (kind === 'projectile' && bundle.kind === 'projectile') {
    return { ...bundle, projectile: spec, projectileSpecs: { ...bundle.projectileSpecs, [id]: spec } };
  }
  if (kind === 'projectile' && (bundle.kind === 'weapon' || bundle.kind === 'weapon-preview')) {
    return { ...bundle, projectileSpecs: { ...bundle.projectileSpecs, [id]: spec } };
  }
  if (kind === 'system' && bundle.kind === 'system') return { ...bundle, system: spec };
  return bundle;
}

function isEditableWindowKind(kind: EditorWindowKind): kind is EditableEditorKind {
  return kind === 'ship' || kind === 'weapon' || kind === 'projectile' || kind === 'system';
}

function isPrimaryEditableKind(windowKind: EditorWindowKind, specKind: EditorSpecKind): boolean {
  return isEditableWindowKind(windowKind) && windowKind === specKind;
}

function primarySpecForBundle(bundle: EditorEntityBundle, kind: EditableEditorKind, id: string): RowData {
  if (kind === 'ship' && bundle.kind === 'ship') return deepClone(bundle.ship);
  if (kind === 'weapon' && bundle.kind === 'weapon') {
    return Object.keys(bundle.weapon).length > 0 ? deepClone(bundle.weapon) : defaultEditorSpec('weapon', id, bundle.weaponCsvRow);
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
  const projectileIds = Object.keys(bundle.projectileSpecs);
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
