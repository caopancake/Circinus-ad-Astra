import { computed, ref, watch } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { loadEditableFileData, writeEditableFileText, queryFileTextIdentityIntent, followFileTextIdentity } from '@/services/files.service';
import {
  emitFileEditorSaved,
  listenFileEditorFocusLine,
  listenFileEditorProjectInvalidated,
  listenFileEditorTextApplied,
} from '@/orchestrators/file-editor-window.orchestrator';
import { isAbsoluteFsPath, joinRootRelativePath, normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import type { UnlistenFn } from '@/windows/tauri.events';
import { useEditTargetDraftSession, type EditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { useSnapshotHistory } from '@/app/composables/use-snapshot-history';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useSaveCommandStore } from '@/stores/save-command.store';
import {
  createEntitySavePreparation,
  reserveFileIdentityIntent,
  retargetFileWindow,
  releaseCommittedIdentityTargets,
} from '@/orchestrators/entity-identity.orchestrator';
import { listenEntityIdentityApplied } from '@/orchestrators/entity-events.orchestrator';
import type { EntityIdentityAppliedEvent } from '@/windows/window.events';
import type { EntityIdentityChange } from '@/shared/types';
import { formatError, errorDiagnosticOf } from '@/shared/lib/errors';
import { AppError } from '@/shared/lib/errors';
import { captureIdentityVersions, handoffTableVersions } from '@/domain/editors/entity-identity';
import type { WriteResult, EntityEditInfo } from '@/shared/types';

export interface FileEditorViewModelParams {
  mode: 'session' | 'recovery';
  filePath: string | null;
  modRoot: string | null;
  sessionId: string | null;
  title: string;
  contextLabel: string;
  contextSeverity: string;
  contextMessage: string;
  line: string | null;
  column: string | null;
}

interface FileEditorTarget {
  filePath: string;
  mode: 'session' | 'recovery';
  modRoot: string;
  sessionId: string | null;
}

export function useFileEditorViewModel(params: FileEditorViewModelParams) {
  const completedLocalWrites = new Set<number>();
  const feedback = useAppFeedback();
  const currentPath = ref(params.filePath);
  let identityPreparation: Awaited<ReturnType<typeof createEntitySavePreparation>> | null = null;
  let pendingIdentity: {
    change: EntityIdentityChange;
    event: EntityIdentityAppliedEvent;
    target: FileEditorTarget;
    preserve: boolean;
  } | null = null;
  const identityNotice = ref('');
  let identitySequence = 0;
  type TextMeta = { entity: EntityEditInfo | null; receipt: WriteResult | null };

  const title = ref(params.title);
  const contextLabel = ref(params.contextLabel);
  const contextSeverity = ref(params.contextSeverity);
  const contextMessage = ref(params.contextMessage);
  const targetLine = ref(normalizeLine(params.line));
  const targetColumn = ref(normalizeLine(params.column));
  const draftSession: EditTargetDraftSession<string, FileEditorTarget, TextMeta> = useEditTargetDraftSession<
    string,
    FileEditorTarget,
    TextMeta
  >({
    emptyValue: '',
    load: async (target) => {
      const loaded = await loadEditableFileData(target.sessionId, target.modRoot, target.filePath);
      return { target, value: loaded.text, baseVersions: loaded.baseVersions, meta: { entity: loaded.entity, receipt: null } };
    },
    save: async (target, draft, baseVersions) => {
      const entity = draftSession.baselineSnapshot.value!.meta.entity;
      let versions = baseVersions;
      if (entity && target.sessionId) {
        const intent = await queryFileTextIdentityIntent(target.sessionId, entity.target, draft);
        await reserveFileIdentityIntent(target.sessionId, target.modRoot, intent);
        versions = captureIdentityVersions(baseVersions, intent.destinationVersion);
      }
      const result = await writeEditableFileText(target.sessionId, target.modRoot, target.filePath, draft, versions);
      const change = result.identityChanges[0];
      return {
        target: { ...target, filePath: change?.after.write.path ?? target.filePath },
        value: typeof result.refreshedEntity?.text === 'string' ? result.refreshedEntity.text : draft,
        baseVersions: result.baseVersions,
        meta: { entity: change ? { target: change.after, baseVersions: result.baseVersions } : entity, receipt: result },
        commitId: result.commitId,
      };
    },
    withSavePreparation: async (target, submit) => {
      const entity = draftSession.baselineSnapshot.value!.meta.entity;
      if (!entity || target.sessionId === null) return submit(target);
      return identityPreparation!.withPreparation(target.sessionId, target.modRoot, entity.target, async (info, receipt) => {
        if (info && info.target.id !== entity.target.id) {
          const change = receipt!.identityChanges.find(
            (change) => change.before.id === entity.target.id && change.before.kind === entity.target.kind,
          )!;
          pendingIdentity = {
            change,
            event: { sessionId: target.sessionId!, modRoot: target.modRoot, result: receipt! },
            target,
            preserve: true,
          };
          await followPendingIdentity();
          if (pendingIdentity)
            throw new AppError(contextMessage.value || '文本身份交接正在处理，请完成输入后重试', { action: 'prepare-file-identity' });
          return submit(draftSession.currentTarget.value!);
        }
        if (info) {
          const versions = handoffTableVersions(draftSession.baselineSnapshot.value!.baseVersions, info);
          draftSession.adoptIdentity(
            target,
            {
              target,
              value: draftSession.baselineSnapshot.value!.value,
              baseVersions: versions,
              meta: { entity: { target: info.target, baseVersions: versions }, receipt: null },
            },
            (text) => text,
            'save',
          );
        }
        return submit(target);
      });
    },
    afterSaved: async (snapshot) => {
      const target = snapshot.target;
      if (target.sessionId) {
        if (!completedLocalWrites.has(snapshot.meta.receipt!.commitId)) {
          await identityPreparation?.finish(snapshot.meta.receipt!);
          if (snapshot.meta.entity) await retargetFileWindow(target.sessionId, target.modRoot, target.filePath, title.value);
          await releaseCommittedIdentityTargets();
          completedLocalWrites.add(snapshot.meta.receipt!.commitId);
        }
      }
      await emitFileEditorSaved({
        modRoot: target.modRoot,
        path: target.filePath,
        sessionId: target.sessionId,
        writeResult: snapshot.meta.receipt!,
      });
    },
    targetKey: (target) => fileEditorTargetKey(target),
  });
  watch(
    draftSession.baselineSnapshot,
    (snapshot) => {
      if (snapshot) currentPath.value = snapshot.target.filePath;
    },
    { flush: 'sync' },
  );
  const textHistory = useSnapshotHistory<string>(
    draftSession.context,
    100,
    (text) => text,
    (left, right) => left === right,
  );
  const unregisterSave = useSaveCommandStore().registerSaveSession({
    targetKey: draftSession.currentTargetKey,
    modRoot: computed(() => params.modRoot),
    saving: draftSession.saving,
    pendingSynchronization: draftSession.hasPendingSynchronization,
    waitForSave: draftSession.waitForSave,
  });
  const { confirmDiscard } = useFieldInputActions(draftSession.inputs);
  let unlistenFocusLine: UnlistenFn | null = null;
  let unlistenTextApplied: UnlistenFn | null = null;
  let unlistenProjectInvalidated: UnlistenFn | null = null;
  let unlistenIdentity: UnlistenFn | null = null;
  let disposed = false;

  const text = draftSession.draftValue;
  const dirty = draftSession.dirty;
  const lineCount = computed(() => Math.max(1, text.value.split(/\r\n|\r|\n/).length));
  const canUndo = textHistory.canUndo;
  const canRedo = textHistory.canRedo;
  const isErrorContext = computed(() => contextSeverity.value === 'error');
  const isWarningContext = computed(() => contextSeverity.value === 'warning');
  const hasPendingExternalText = computed(() => draftSession.hasPendingExternalValue.value || identityNotice.value !== '');
  const externalTextNotice = computed(
    () => identityNotice.value || (draftSession.hasPendingExternalValue.value ? '外部文本已更新，当前未保存草稿已保留。' : ''),
  );

  async function initialize() {
    disposed = false;
    identityPreparation = await createEntitySavePreparation();
    if (disposed) {
      identityPreparation.dispose();
      return;
    }
    await loadFile();
    if (disposed) return;
    unlistenIdentity = await listenEntityIdentityApplied(handleIdentityApplied);
    if (disposed) {
      unlistenIdentity();
      unlistenIdentity = null;
      return;
    }
    unlistenFocusLine = await listenFileEditorFocusLine((event) => {
      if (disposed) return;
      contextMessage.value = event.message ?? '';
      contextLabel.value = event.contextLabel ?? '信息';
      contextSeverity.value = event.contextSeverity ?? 'info';
      targetLine.value = normalizeEventLine(event.line);
      targetColumn.value = normalizeEventLine(event.column);
    });
    if (disposed) {
      unlistenFocusLine?.();
      unlistenFocusLine = null;
      return;
    }
    unlistenTextApplied = await listenFileEditorTextApplied((event) => {
      if (disposed) return;
      if (!currentPath.value || !params.modRoot || !params.sessionId || pendingIdentity) return;
      if (event.sessionId !== params.sessionId) return;
      if (normalizeFsPath(event.modRoot) !== normalizeFsPath(params.modRoot)) return;
      if (normalizeFsPath(event.path) !== normalizeFsPath(currentPath.value)) return;
      applyExternalText(event.text, event.baseVersions, event.commitId);
    });
    if (disposed) {
      unlistenTextApplied?.();
      unlistenTextApplied = null;
      return;
    }
    const syncFilePath = currentPath.value;
    const syncModRoot = params.modRoot;
    const syncSessionId = params.sessionId;
    if (syncFilePath === null || syncModRoot === null || syncSessionId === null) return;
    unlistenProjectInvalidated = await listenFileEditorProjectInvalidated(async (event) => {
      if (disposed || pendingIdentity) return;
      if (event.manifest.sessionId !== syncSessionId) return;
      if (normalizeFsPath(event.manifest.modRoot) !== normalizeFsPath(syncModRoot)) return;
      const affected = event.invalidation.paths.some((path) => {
        const changedPath = isAbsoluteFsPath(path) ? path : joinRootRelativePath(syncModRoot, path);
        return pathBelongsToRoot(currentPath.value!, changedPath);
      });
      if (!affected) return;
      try {
        await draftSession.refreshTarget({
          sessionId: syncSessionId,
          modRoot: syncModRoot,
          filePath: currentPath.value!,
          mode: params.mode,
        });
      } catch (error) {
        feedback.error(error, '外部文件更新同步失败');
      }
    });
    if (disposed) {
      unlistenProjectInvalidated?.();
      unlistenProjectInvalidated = null;
    }
  }

  function dispose() {
    disposed = true;
    unregisterSave();
    identityPreparation?.dispose();
    unlistenIdentity?.();
    identitySequence++;
    pendingIdentity = null;
    draftSession.dispose();
    unlistenFocusLine?.();
    unlistenFocusLine = null;
    unlistenTextApplied?.();
    unlistenTextApplied = null;
    unlistenProjectInvalidated?.();
    unlistenProjectInvalidated = null;
  }

  async function loadFile() {
    const target = fileEditorTarget();
    if (!target) return;
    try {
      const loaded = await draftSession.loadTarget(target);
      if (loaded) return;
    } catch (error) {
      feedback.error(error, '打开文件失败');
    }
  }

  async function saveFile() {
    if (!fileEditorTarget()) return;
    if (draftSession.saving.value) {
      await draftSession.waitForSave();
      return;
    }
    try {
      if (pendingIdentity) {
        await followPendingIdentity();
        if (pendingIdentity) {
          await followFileTextIdentity(pendingIdentity.change.after.kind, text.value, pendingIdentity.change.after.id);
          return;
        }
      }
      const saved = await draftSession.saveDraft();
      if (!saved || disposed) return;
      feedback.success('文件已保存');
    } catch (error) {
      const location = errorDiagnosticOf(error).location;
      if (location?.line) {
        targetLine.value = location.line;
        targetColumn.value = location.column ?? undefined;
        contextMessage.value = formatError(error);
        contextSeverity.value = 'error';
      }
      feedback.error(error, '保存文件失败');
    }
  }

  function cancelChanges() {
    if (draftSession.saving.value)
      void draftSession.waitForSave().then((saved) => {
        if (saved && !disposed) draftSession.resetDraft();
      });
    else draftSession.resetDraft();
  }

  function loadPendingExternalText() {
    if (pendingIdentity) {
      void followPendingIdentity();
      return;
    }
    const key = draftSession.currentTargetKey.value;
    const adopt = () => {
      if (disposed || key !== draftSession.currentTargetKey.value) return;
      confirmDiscard(
        () => {
          draftSession.loadPendingExternal();
        },
        draftSession.dirty.value,
        () => draftSession.currentTargetKey.value,
      );
    };
    if (draftSession.saving.value)
      void draftSession.waitForSave().then((saved) => {
        if (saved) adopt();
      });
    else adopt();
  }

  function updateText(nextText: string) {
    if (nextText === text.value) return;
    textHistory.push(text.value, nextText);
    draftSession.setDraft(nextText);
    if (pendingIdentity) void followPendingIdentity();
  }

  async function handleIdentityApplied(event: EntityIdentityAppliedEvent) {
    const target = fileEditorTarget();
    if (!target || target.sessionId !== event.sessionId || normalizeFsPath(target.modRoot) !== normalizeFsPath(event.modRoot)) return;
    if (event.result.commitId <= (draftSession.savedSnapshot.value?.commitId ?? -1)) return;
    const reference = pendingIdentity?.change.after.write.path ?? target.filePath;
    const change = event.result.identityChanges.find(
      (change) =>
        normalizeFsPath(change.before.write.path) === normalizeFsPath(reference) &&
        (change.before.write.path !== change.after.write.path || change.before.id !== change.after.id),
    );
    if (!change) return;
    if (draftSession.saving.value && !(await draftSession.waitForSave())) return;
    if (disposed || fileEditorTargetKey(target) !== draftSession.currentTargetKey.value) return;
    const preserve = draftSession.dirty.value;
    if (preserve && !pendingIdentity) {
      const choice = await feedback.choose({
        title: '跟随文件重命名？',
        content: '保留当前文本，并接纳新的文件路径和基线。',
        choices: [{ label: '保留文本并跟随', value: 'follow', type: 'primary' }],
      });
      if (choice !== 'follow' || disposed || fileEditorTargetKey(target) !== draftSession.currentTargetKey.value) return;
    }
    pendingIdentity = { change, event, target, preserve };
    await followPendingIdentity();
  }

  async function followPendingIdentity() {
    const pending = pendingIdentity;
    if (!pending) return;
    const sequence = ++identitySequence;
    const raw = text.value;
    try {
      const followed = pending.preserve ? await followFileTextIdentity(pending.change.after.kind, raw, pending.change.after.id) : null;
      const loaded = await loadEditableFileData(pending.target.sessionId, pending.target.modRoot, pending.change.after.write.path);
      if (disposed || sequence !== identitySequence || pending !== pendingIdentity || raw !== text.value) return;
      const target = { ...pending.target, filePath: pending.change.after.write.path };
      await retargetFileWindow(pending.event.sessionId, pending.event.modRoot, target.filePath, title.value);
      if (disposed || sequence !== identitySequence || pending !== pendingIdentity || raw !== text.value) return;
      draftSession.adoptIdentity(
        pending.target,
        {
          target,
          value: loaded.text,
          baseVersions: loaded.baseVersions,
          meta: { entity: loaded.entity, receipt: null },
          commitId: pending.event.result.commitId,
        },
        () => followed ?? loaded.text,
      );
      pendingIdentity = null;
      identityNotice.value = '';
    } catch (error) {
      if (disposed || sequence !== identitySequence || pending !== pendingIdentity) return;
      identityNotice.value = '实体已重命名，当前文本已保留；修正文本后接纳新身份。';
      contextMessage.value = formatError(error);
      contextSeverity.value = 'error';
      const position = errorDiagnosticOf(error).location;
      if (position?.line) {
        targetLine.value = position.line;
        targetColumn.value = position.column ?? undefined;
      }
    }
  }

  function undoEdit() {
    if (!canUndo.value) return;
    draftSession.setDraft(textHistory.undo()!);
  }

  function redoEdit() {
    if (!canRedo.value) return;
    draftSession.setDraft(textHistory.redo()!);
  }

  function applyExternalText(nextText: string, baseVersions?: import('@/shared/types').FileVersion[], commitId?: number) {
    const target = fileEditorTarget();
    if (!target) return;
    draftSession.applyExternalForTarget({
      target,
      value: nextText,
      baseVersions: baseVersions ?? [],
      commitId,
      meta: { entity: draftSession.baselineSnapshot.value?.meta.entity ?? null, receipt: null },
    });
  }

  return {
    filePath: currentPath,
    title,
    contextLabel,
    contextSeverity,
    contextMessage,
    targetLine,
    targetColumn,
    text,
    loading: computed(() => draftSession.loading.value && draftSession.baselineSnapshot.value === null),
    saving: draftSession.saving,
    waitForSave: draftSession.waitForSave,
    dirty,
    canSave: computed(() => draftSession.ready.value && (dirty.value || draftSession.hasPendingSynchronization.value)),
    hasPendingExternalText,
    externalTextNotice,
    lineCount,
    canUndo,
    canRedo,
    isErrorContext,
    isWarningContext,
    initialize,
    dispose,
    saveFile,
    cancelChanges,
    loadPendingExternalText,
    updateText,
    undoEdit,
    redoEdit,
  };

  function fileEditorTarget(): FileEditorTarget | null {
    if (!currentPath.value) {
      feedback.error('缺少文件路径');
      return null;
    }
    if (!params.modRoot) {
      feedback.error('缺少文件读取根目录');
      return null;
    }
    if (params.mode === 'session' && !params.sessionId) {
      feedback.error('缺少文件编辑器 session');
      return null;
    }
    return { filePath: currentPath.value, mode: params.mode, modRoot: params.modRoot, sessionId: params.sessionId };
  }
}

function fileEditorTargetKey(target: FileEditorTarget): string {
  return `${target.mode}\n${target.sessionId ?? ''}\n${normalizeFsPath(target.modRoot)}\n${normalizeFsPath(target.filePath)}`;
}

function normalizeLine(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeEventLine(value: number | null): number | undefined {
  return value !== null && Number.isFinite(value) && value > 0 ? value : undefined;
}
