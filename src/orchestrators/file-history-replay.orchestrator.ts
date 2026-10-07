import { h } from 'vue';
import type { AppFeedback } from '@/shared/types';
import type { useProjectStore } from '@/stores/project.store';
import type { useTablesStore } from '@/stores/tables.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { replayFileChangeSet } from '@/services/write.service';
import { refreshLoadedSessionsAfterWrite } from '@/orchestrators/project-session-refresh.orchestrator';
import { WINDOW_EVENTS } from '@/windows/window.events';
import { emitWindowEvent } from '@/windows/tauri.events';
import type { FileChangeRecord, FileChangeReplayDirection, FileSaveHistoryEntry } from '@/shared/types';
import { AppError } from '@/shared/lib/errors';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { logFields } from '@/shared/lib/log-fields';
import { joinRootRelativePath, normalizeFsPath } from '@/shared/lib/paths';
import { useWriteSyncStore } from '@/stores/write-sync.store';

type ProjectStore = ReturnType<typeof useProjectStore>;
type TablesStore = ReturnType<typeof useTablesStore>;
export type FileHistoryReplayDirection = FileChangeReplayDirection;

export interface FileHistoryReplayPlan {
  actionText: string;
  direction: FileHistoryReplayDirection;
  entry: FileSaveHistoryEntry;
  modRoot: string;
  sessionId: string;
}

interface FileHistoryReplayBehavior {
  actionText: string;
  commitEntry: (modRoot: string, entryId: string) => boolean;
  peekEntry: (modRoot: string) => FileSaveHistoryEntry | null;
  textForChange: (change: FileChangeRecord) => string | null;
  hasBinaryContent: (change: FileChangeRecord) => boolean;
}

export function replayNextFileUndo(project: ProjectStore, tables: TablesStore, feedback: AppFeedback) {
  return replayNextFileHistoryEntry('undo', project, tables, feedback);
}

export function replayNextFileRedo(project: ProjectStore, tables: TablesStore, feedback: AppFeedback) {
  return replayNextFileHistoryEntry('redo', project, tables, feedback);
}

export function createFileReplayPlan(project: ProjectStore, direction: FileHistoryReplayDirection): FileHistoryReplayPlan | null {
  const modRoot = project.activeModRoot;
  if (!modRoot) return null;
  const sessionId = project.getSessionId(modRoot);
  if (!sessionId) return null;
  const behavior = replayBehavior(direction);
  const entry = behavior.peekEntry(modRoot);
  if (!entry) return null;
  return { actionText: behavior.actionText, direction, entry, modRoot, sessionId };
}

export async function executeFileReplayPlan(plan: FileHistoryReplayPlan, project: ProjectStore, tables: TablesStore): Promise<void> {
  assertReplayPlanStillCurrent(plan, project);
  const result = await replayFileChangeSet(plan.sessionId, plan.modRoot, plan.direction, plan.entry.changes);
  commitReplayPlan(plan);
  const invalidatedSessions = await refreshLoadedSessionsAfterWrite(result, plan.modRoot);
  const sync = useWriteSyncStore().enqueue(plan.modRoot, plan.sessionId, plan.entry.changes);
  await notifyOpenFileEditors(plan.sessionId, plan.modRoot, plan.entry.changes, plan.direction);
  refreshActiveTableIfAffected(project, tables, plan.modRoot, invalidatedSessions);
  syncStoreComplete(sync.id);
  recordLogBestEffort({
    level: 'info',
    code: 'history.replayed',
    message: 'file history replayed',
    path: null,
    line: null,
    fields: logFields({
      modRoot: plan.modRoot,
      sessionId: plan.sessionId,
      direction: plan.direction,
      entryId: plan.entry.id,
      label: plan.entry.label,
      files: plan.entry.changes.length,
    }),
  });
}

function syncStoreComplete(id: number): void {
  useWriteSyncStore().complete(id);
}

function replayNextFileHistoryEntry(
  direction: FileHistoryReplayDirection,
  project: ProjectStore,
  tables: TablesStore,
  feedback: AppFeedback,
) {
  const plan = createFileReplayPlan(project, direction);
  if (!plan) return false;
  confirmFileHistoryReplay(feedback, plan, async () => {
    try {
      await executeFileReplayPlan(plan, project, tables);
      feedback.success(`文件历史已${plan.actionText}`);
    } catch (error) {
      feedback.error(error, `${plan.actionText}文件历史失败`);
    }
  });
  return true;
}

function confirmFileHistoryReplay(feedback: AppFeedback, plan: FileHistoryReplayPlan, onConfirm: () => Promise<void>) {
  feedback.confirmWarning({
    title: `${plan.actionText}文件历史`,
    content: () => renderConfirmContent(plan.entry, plan.actionText),
    actionText: plan.actionText,
    onConfirm,
  });
}

function renderConfirmContent(entry: FileSaveHistoryEntry, action: string) {
  const paths = historyEntryPaths(entry);
  return h('div', { class: 'file-history-confirm' }, [
    h('p', `${action}会直接写回磁盘。`),
    h('p', `历史记录：${entry.label}`),
    h('p', `涉及文件：${paths.length} 个`),
    h(
      'ul',
      { class: 'file-history-confirm-list' },
      paths.map((path) => h('li', { key: path }, path)),
    ),
  ]);
}

function historyEntryPaths(entry: FileSaveHistoryEntry): string[] {
  return entry.changes.map((change) => change.path);
}

function assertReplayPlanStillCurrent(plan: FileHistoryReplayPlan, project: ProjectStore): void {
  const behavior = replayBehavior(plan.direction);
  const currentEntry = behavior.peekEntry(plan.modRoot);
  if (currentEntry?.id !== plan.entry.id) {
    throw new AppError(`${plan.actionText}文件历史失败：历史栈状态已变化`, { action: 'execute-file-history-replay' });
  }
  const currentSessionId = project.getSessionId(plan.modRoot);
  if (currentSessionId !== plan.sessionId) {
    throw new AppError(`${plan.actionText}文件历史失败：ProjectSession 已变化`, { action: 'execute-file-history-replay' });
  }
}

function commitReplayPlan(plan: FileHistoryReplayPlan): void {
  const committed = replayBehavior(plan.direction).commitEntry(plan.modRoot, plan.entry.id);
  if (!committed) {
    throw new AppError(`${plan.actionText}文件历史失败：历史栈状态已变化`, { action: 'commit-file-history-replay' });
  }
}

function replayBehavior(direction: FileHistoryReplayDirection): FileHistoryReplayBehavior {
  const fileHistory = useFileHistoryStore();
  if (direction === 'undo') {
    return {
      actionText: '撤销',
      peekEntry: (modRoot) => fileHistory.peekSavedWriteUndo(modRoot),
      commitEntry: (modRoot, entryId) => fileHistory.commitReplayUndo(modRoot, entryId),
      textForChange: (change) => change.beforeText ?? null,
      hasBinaryContent: (change) => Boolean(change.beforeDataBase64),
    };
  }
  return {
    actionText: '重做',
    peekEntry: (modRoot) => fileHistory.peekSavedWriteRedo(modRoot),
    commitEntry: (modRoot, entryId) => fileHistory.commitReplayRedo(modRoot, entryId),
    textForChange: (change) => change.afterText ?? null,
    hasBinaryContent: (change) => Boolean(change.afterDataBase64),
  };
}

async function notifyOpenFileEditors(
  sessionId: string,
  modRoot: string,
  changes: FileChangeRecord[],
  direction: FileHistoryReplayDirection,
): Promise<void> {
  const behavior = replayBehavior(direction);
  await Promise.all(
    changes.map(async (change) => {
      if (change.kind === 'directory') {
        const targetFiles = direction === 'undo' ? change.beforeFiles : change.afterFiles;
        const snapshots = new Map(targetFiles.map((file) => [normalizeFsPath(file.relPath), file]));
        const paths = new Set([...change.beforeFiles, ...change.afterFiles].map((file) => file.relPath));
        await Promise.all(
          [...paths].map(async (relPath) => {
            const snapshot = snapshots.get(normalizeFsPath(relPath));
            if (snapshot?.dataBase64) return;
            await emitWindowEvent(WINDOW_EVENTS.fileEditorTextApplied, {
              modRoot,
              path: joinRootRelativePath(change.path, relPath),
              sessionId,
              text: snapshot?.text ?? '',
            });
          }),
        );
        return;
      }
      const text = behavior.textForChange(change);
      if (text === null && behavior.hasBinaryContent(change)) return;
      await emitWindowEvent(WINDOW_EVENTS.fileEditorTextApplied, { modRoot, path: change.path, sessionId, text: text ?? '' });
    }),
  );
}

function refreshActiveTableIfAffected(
  project: ProjectStore,
  tables: TablesStore,
  targetModRoot: string,
  invalidatedSessions: Awaited<ReturnType<typeof refreshLoadedSessionsAfterWrite>>,
) {
  if (!invalidatedSessions.some((event) => event.manifest.modRoot === targetModRoot)) return;
  if (project.activeModRoot !== targetModRoot) return;
  tables.selectRowByKey(null);
}
