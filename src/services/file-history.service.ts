import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { FileChangeReplayDirection, FileHistorySnapshot } from '@/shared/types';

export function loadFileHistory(sessionId: string, modRoot: string): Promise<FileHistorySnapshot> {
  return invokeCommand('query_file_history', { payload: { sessionId, modRoot } });
}

export function clearSavedFileHistory(sessionId: string, modRoot: string): Promise<FileHistorySnapshot> {
  return invokeCommand('clear_file_history', { payload: { sessionId, modRoot } });
}

export function replayFileChangeSet(
  sessionId: string,
  modRoot: string,
  direction: FileChangeReplayDirection,
  entryId: number,
  revision: number,
): Promise<import('@/shared/types').WriteResult> {
  return invokeCommand('apply_file_change_set', { payload: { sessionId, modRoot, direction, entryId, revision } });
}
