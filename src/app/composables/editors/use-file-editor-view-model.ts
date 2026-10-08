import { computed, ref } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { loadEditableFileData, writeEditableFileText } from '@/services/files.service';
import {
  emitFileEditorSaved,
  listenFileEditorFocusLine,
  listenFileEditorProjectInvalidated,
  listenFileEditorTextApplied,
} from '@/orchestrators/file-editor-window.orchestrator';
import { isAbsoluteFsPath, joinRootRelativePath, normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import type { UnlistenFn } from '@/windows/tauri.events';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { useSnapshotHistory } from '@/app/composables/use-snapshot-history';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { applyCommittedWriteCacheInvalid } from '@/orchestrators/project-session-refresh.orchestrator';
import type { WriteResult } from '@/shared/types';

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
  const feedback = useAppFeedback();
  const title = ref(params.title);
  const contextLabel = ref(params.contextLabel);
  const contextSeverity = ref(params.contextSeverity);
  const contextMessage = ref(params.contextMessage);
  const targetLine = ref(normalizeLine(params.line));
  const targetColumn = ref(normalizeLine(params.column));
  const draftSession = useEditTargetDraftSession<string, FileEditorTarget, WriteResult | null>({
    emptyValue: '',
    load: async (target) => {
      const loaded = await loadEditableFileData(target.sessionId, target.modRoot, target.filePath);
      return { target, value: loaded.text, baseVersions: loaded.baseVersions, meta: null };
    },
    save: async (target, draft, baseVersions) => {
      const result = await writeEditableFileText(target.sessionId, target.modRoot, target.filePath, draft, baseVersions);
      return { target, value: draft, baseVersions: result.baseVersions, meta: result, commitId: result.commitId };
    },
    afterSaved: async (snapshot) => {
      const target = snapshot.target;
      if (target.sessionId) {
        applyCommittedWriteCacheInvalid(target.sessionId, snapshot.meta!);
        await emitFileEditorSaved({
          modRoot: target.modRoot,
          path: target.filePath,
          sessionId: target.sessionId,
          writeResult: snapshot.meta!,
        });
      }
    },
    targetKey: (target) => fileEditorTargetKey(target),
  });
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
    waitForSave: draftSession.waitForSave,
  });
  const { confirmDiscard } = useFieldInputActions(draftSession.inputs);
  let unlistenFocusLine: UnlistenFn | null = null;
  let unlistenTextApplied: UnlistenFn | null = null;
  let unlistenProjectInvalidated: UnlistenFn | null = null;
  let disposed = false;

  const text = draftSession.draftValue;
  const dirty = draftSession.dirty;
  const lineCount = computed(() => Math.max(1, text.value.split(/\r\n|\r|\n/).length));
  const canUndo = textHistory.canUndo;
  const canRedo = textHistory.canRedo;
  const isErrorContext = computed(() => contextSeverity.value === 'error');
  const isWarningContext = computed(() => contextSeverity.value === 'warning');
  const hasPendingExternalText = draftSession.hasPendingExternalValue;
  const externalTextNotice = computed(() => (draftSession.hasPendingExternalValue.value ? '外部文本已更新，当前未保存草稿已保留。' : ''));

  async function initialize() {
    disposed = false;
    await loadFile();
    if (disposed) return;
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
      if (!params.filePath || !params.modRoot || !params.sessionId) return;
      if (event.sessionId !== params.sessionId) return;
      if (normalizeFsPath(event.modRoot) !== normalizeFsPath(params.modRoot)) return;
      if (normalizeFsPath(event.path) !== normalizeFsPath(params.filePath)) return;
      applyExternalText(event.text, event.baseVersions);
    });
    if (disposed) {
      unlistenTextApplied?.();
      unlistenTextApplied = null;
      return;
    }
    const syncFilePath = params.filePath;
    const syncModRoot = params.modRoot;
    const syncSessionId = params.sessionId;
    if (syncFilePath === null || syncModRoot === null || syncSessionId === null) return;
    unlistenProjectInvalidated = await listenFileEditorProjectInvalidated(async (event) => {
      if (disposed) return;
      if (event.manifest.sessionId !== syncSessionId) return;
      if (normalizeFsPath(event.manifest.modRoot) !== normalizeFsPath(syncModRoot)) return;
      const affected = event.invalidation.paths.some((path) => {
        const changedPath = isAbsoluteFsPath(path) ? path : joinRootRelativePath(syncModRoot, path);
        return pathBelongsToRoot(syncFilePath, changedPath);
      });
      if (!affected) return;
      try {
        await draftSession.refreshTarget({ sessionId: syncSessionId, modRoot: syncModRoot, filePath: syncFilePath, mode: params.mode });
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
      const saved = await draftSession.saveDraft();
      if (!saved || disposed) return;
      feedback.success('文件已保存');
    } catch (error) {
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
  }

  function undoEdit() {
    if (!canUndo.value) return;
    draftSession.setDraft(textHistory.undo()!);
  }

  function redoEdit() {
    if (!canRedo.value) return;
    draftSession.setDraft(textHistory.redo()!);
  }

  function applyExternalText(nextText: string, baseVersions?: import('@/shared/types').FileVersion[]) {
    const target = fileEditorTarget();
    if (!target) return;
    draftSession.applyExternalForTarget({ target, value: nextText, baseVersions: baseVersions ?? [], meta: null });
  }

  return {
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
    if (!params.filePath) {
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
    return { filePath: params.filePath, mode: params.mode, modRoot: params.modRoot, sessionId: params.sessionId };
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
