import { invoke } from '@tauri-apps/api/core';
import type {
  GameOverviewData,
  OpenDirectoryResult,
  FileChangeRecord,
  ProjectManifest,
  ProjectSessionId,
  ProjectSessionInvalidationResult,
} from '@/shared/types';

export function openProjectSession(modRoot: string, starsectorRoot: string | null): Promise<ProjectManifest> {
  return invoke('open_project_session', { payload: { modRoot, starsectorRoot } });
}

export function closeProjectSession(sessionId: ProjectSessionId): Promise<void> {
  return invoke('close_project_session', { payload: { sessionId } });
}

export function invalidateProjectSession(
  sessionId: ProjectSessionId,
  changes: FileChangeRecord[],
): Promise<ProjectSessionInvalidationResult> {
  return invoke('invalidate_project_session', { payload: { sessionId, changes } });
}

export function synchronizeCommittedWrite(
  sessionId: string,
  modRoot: string,
  commitId: number,
): Promise<import('@/shared/types').CommittedSessionUpdate> {
  return invoke('synchronize_committed_write', { payload: { sessionId, modRoot, commitId } });
}

export function invalidateCoreCache(starsectorRoot: string): Promise<void> {
  return invoke('invalidate_core_cache', { payload: { starsectorRoot } });
}

export function detectDirectory(path: string, knownStarsectorRoot: string | null): Promise<OpenDirectoryResult> {
  return invoke('detect_directory', { payload: { path, knownStarsectorRoot } });
}

export function scanGameOverview(starsectorRoot: string): Promise<GameOverviewData> {
  return invoke('scan_game_overview', { payload: { starsectorRoot } });
}
