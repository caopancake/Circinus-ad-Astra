import { publishCommittedWrite } from '@/orchestrators/project-session-refresh.orchestrator';
import { withCause, formatError } from '@/shared/lib/errors';
import type { WriteResult } from '@/shared/types';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';

export interface SavedWriteCompletion {
  label: string;
  modRoot: string;
  result: WriteResult;
  sessionId: string;
}
export async function completeSavedWrite(completion: SavedWriteCompletion): Promise<void> {
  try {
    await publishCommittedWrite(completion.modRoot, completion.result, completion.sessionId);
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
