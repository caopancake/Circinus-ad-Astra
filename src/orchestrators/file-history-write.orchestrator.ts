import type { useProjectStore } from '@/stores/project.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { applyCommittedWriteCacheInvalid, refreshProjectSessionAfterWrite } from '@/orchestrators/project-session-refresh.orchestrator';
import { AppError, withCause } from '@/shared/lib/errors';
import type { WriteResult } from '@/shared/types';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { formatError } from '@/shared/lib/errors';
import { emitEntityIdentityApplied } from '@/orchestrators/entity-events.orchestrator';

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
  applyCommittedWriteCacheInvalid(completion.sessionId, completion.result);
  try {
    await emitEntityIdentityApplied({ sessionId: completion.sessionId, modRoot: completion.modRoot, result: completion.result });
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
    throw withCause('已写盘，项目同步失败', error, 'sync-saved-write');
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
