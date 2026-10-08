import type { useProjectStore } from '@/stores/project.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { refreshProjectSessionAfterWrite } from '@/orchestrators/project-session-refresh.orchestrator';
import { AppError } from '@/shared/lib/errors';
import type { WriteResult } from '@/shared/types';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { formatError } from '@/shared/lib/errors';

type ProjectStore = ReturnType<typeof useProjectStore>;

export interface SavedWriteCompletion {
  label: string;
  modRoot: string;
  result: WriteResult;
  sessionId: string;
}

/** Owner of saved-write recording: a successful WriteResult enters file history and triggers ProjectSession refresh. */
export async function completeSavedWrite(completion: SavedWriteCompletion, project: ProjectStore): Promise<void> {
  validateSavedWriteCompletion(completion);
  assertSavedWriteSessionCurrent(completion, project);
  const fileHistory = useFileHistoryStore();
  fileHistory.applySnapshot(completion.modRoot, completion.result.history);
  try {
    await refreshProjectSessionAfterWrite(completion.modRoot, completion.result, completion.sessionId);
  } catch (error) {
    recordLogBestEffort({
      level: 'warning',
      code: 'write.sync_pending',
      message: formatError(error),
      path: completion.modRoot,
      line: null,
      fields: { sessionId: completion.sessionId },
    });
  }
}

function validateSavedWriteCompletion(completion: SavedWriteCompletion): void {
  if (!completion.modRoot) throw new AppError('无法记录文件历史：缺少 Mod 根目录', { action: 'complete-saved-write' });
  if (!completion.sessionId) throw new AppError('无法记录文件历史：缺少 ProjectSession', { action: 'complete-saved-write' });
  if (completion.result.changes.length === 0) {
    throw new AppError('无法记录文件历史：写入结果没有文件变更', { action: 'complete-saved-write' });
  }
}

function assertSavedWriteSessionCurrent(completion: SavedWriteCompletion, project: ProjectStore): void {
  const manifest = project.getManifest(completion.modRoot);
  if (!manifest || manifest.sessionId !== completion.sessionId) {
    throw new AppError('无法记录文件历史：ProjectSession 已变化', { action: 'complete-saved-write' });
  }
}
