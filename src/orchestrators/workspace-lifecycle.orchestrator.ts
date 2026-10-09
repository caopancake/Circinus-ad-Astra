import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { closeProject, invalidateCoreCacheForRoot } from '@/services/session.service';
import { invalidateQueryCacheForSession } from '@/services/query-cache.service';
import { invalidateResourceCacheForSession } from '@/services/resource-cache.service';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { logFields } from '@/shared/lib/log-fields';
import { useWriteSyncStore } from '@/stores/write-sync.store';
import { closeNativeSessionWindows } from '@/services/window.service';
import { retryPendingWritesForMod } from '@/orchestrators/project-session-refresh.orchestrator';
import { markProjectionReady } from '@/shared/runtime/project-projection';

export interface WorkspaceCloseTarget {
  gameOverviewRoot: string | null;
  modRoots: string[];
  starsectorRoots: string[];
}

export async function closeWorkspaceWindows(): Promise<boolean> {
  for (const manifest of useProjectStore().manifests.values()) {
    await retryPendingWritesForMod(manifest.modRoot);
    if (!(await closeNativeSessionWindows(manifest.sessionId))) return false;
  }
  return true;
}

export function captureWorkspaceCloseTarget(): WorkspaceCloseTarget {
  const workspace = useWorkspaceStore();
  const project = useProjectStore();
  const starsectorRoots = new Set(
    [workspace.gameOverview?.starsectorRoot, ...[...project.manifests.values()].map((manifest) => manifest.starsectorRoot)].filter(
      (root): root is string => Boolean(root),
    ),
  );
  return {
    gameOverviewRoot: workspace.gameOverview?.starsectorRoot ?? null,
    modRoots: workspace.loadedModList.map((mod) => mod.modRoot),
    starsectorRoots: [...starsectorRoots],
  };
}

// Sole use case for the 5-store removal sequence: workspace/tables/fileHistory/csvEditHistory/project.
// Cache invalidation, Rust session close and view rollback are composed by callers outside the case.
export function removeModRuntimeState(modRoot: string) {
  const workspace = useWorkspaceStore();
  const project = useProjectStore();
  const tables = useTablesStore();
  const fileHistory = useFileHistoryStore();
  const csvEditHistory = useTablesEditHistoryStore();
  const writeSync = useWriteSyncStore();
  workspace.removeLoadedModEntry(modRoot);
  tables.removeModState(modRoot);
  fileHistory.removeModState(modRoot);
  csvEditHistory.clearForMod(modRoot);
  writeSync.removeModState(modRoot);
  project.removeProjectManifest(modRoot);
}

export async function removeLoadedModRuntime(modRoot: string) {
  await retryPendingWritesForMod(modRoot);
  const project = useProjectStore();
  const sessionId = project.getSessionId(modRoot);
  if (sessionId && !(await closeNativeSessionWindows(sessionId))) return false;

  if (sessionId) {
    markProjectionReady(sessionId);
    invalidateQueryCacheForSession(sessionId);
    invalidateResourceCacheForSession(sessionId);
  }

  removeModRuntimeState(modRoot);

  recordLogBestEffort({
    level: 'info',
    code: 'mod.session_closed',
    message: 'mod session closed',
    path: null,
    line: null,
    fields: logFields({ modRoot, sessionId }),
  });

  if (sessionId) await closeProject(sessionId);
  return true;
}

export async function closeWorkspaceRuntime(target: WorkspaceCloseTarget) {
  const workspace = useWorkspaceStore();
  workspace.revokeWorkspaceGeneration();
  for (const modRoot of target.modRoots) {
    if (!(await removeLoadedModRuntime(modRoot))) return false;
  }
  await Promise.all(target.starsectorRoots.map((root) => invalidateCoreCacheForRoot(root)));
  if (workspace.gameOverview?.starsectorRoot === target.gameOverviewRoot) {
    workspace.setGameOverview(null);
  }
  workspace.clearModOpeningFailures();
  if (!workspace.activeModRoot) workspace.showOverview();
  return true;
}
