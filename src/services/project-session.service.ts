import { invokeCommand } from '@/shared/runtime/command.runtime';
import { measurePerformanceAsync } from '@/shared/runtime/performance';
import type { CommittedSessionUpdate, FileChangeRecord, ProjectManifest, ProjectSessionInvalidationResult } from '@/shared/types';

export function openProject(modRoot: string, starsectorRoot: string | null): Promise<ProjectManifest> {
  const fields = { modRoot, hasStarsectorRoot: Boolean(starsectorRoot) };
  return measurePerformanceAsync('frontend.openProjectSession', fields, () =>
    measurePerformanceAsync('frontend.openProjectSession.invoke', fields, () =>
      invokeCommand('open_project_session', { payload: { modRoot, starsectorRoot } }),
    ),
  );
}

export function closeProject(sessionId: string): Promise<void> {
  return invokeCommand('close_project_session', { payload: { sessionId } });
}

export function requestProjectSessionRefresh(sessionId: string, changes: FileChangeRecord[]): Promise<ProjectSessionInvalidationResult> {
  return invokeCommand('invalidate_project_session', { payload: { sessionId, changes } });
}

export function synchronizeSessionCommit(sessionId: string, modRoot: string, commitId: number): Promise<CommittedSessionUpdate> {
  return invokeCommand('synchronize_committed_write', { payload: { sessionId, modRoot, commitId } });
}
