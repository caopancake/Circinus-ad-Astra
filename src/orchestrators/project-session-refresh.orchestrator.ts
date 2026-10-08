import { WINDOW_EVENTS, type ProjectSessionInvalidatedEvent } from '@/windows/window.events';
import { emitWindowEvent, listenWindowEvent, type WindowEventHandler } from '@/windows/tauri.events';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { useProjectStore } from '@/stores/project.store';
import { useWriteSyncStore } from '@/stores/write-sync.store';
import { requestProjectSessionRefresh } from '@/services/session.service';
import { invalidateQueryCacheByProject } from '@/services/query-cache.service';
import { invalidateResourceCacheByProject } from '@/services/resource-cache.service';
import { isAbsoluteFsPath, pathBelongsToRoot, pathIsProjectScopedChangedPath } from '@/shared/lib/paths';
import { AppError, formatError } from '@/shared/lib/errors';
import type { ProjectManifest, WriteResult } from '@/shared/types';

function emitProjectSessionInvalidated(event: ProjectSessionInvalidatedEvent) {
  return emitWindowEvent(WINDOW_EVENTS.projectSessionInvalidated, event);
}

export function listenProjectSessionInvalidated(handler: WindowEventHandler<ProjectSessionInvalidatedEvent>) {
  return listenWindowEvent<ProjectSessionInvalidatedEvent>(WINDOW_EVENTS.projectSessionInvalidated, handler, recordWindowEventHandlerError);
}

export function applyProjectSessionCacheInvalid(event: ProjectSessionInvalidatedEvent) {
  invalidateResourceCacheByProject(event.manifest.sessionId, event.invalidation);
  invalidateQueryCacheByProject(event.manifest.sessionId, event.invalidation);
}

export async function refreshProjectSessionAfterWrite(modRoot: string, result: WriteResult, expectedSessionId?: string | null) {
  const project = useProjectStore();
  const manifest = project.getManifest(modRoot);
  if (!manifest) throw new AppError('无法刷新 ProjectSession：Mod 未加载', { action: 'refresh-project-session-after-write' });
  if (expectedSessionId && manifest.sessionId !== expectedSessionId) {
    throw new AppError('无法刷新 ProjectSession：ProjectSession 已变化', { action: 'refresh-project-session-after-write' });
  }
  const scopedChanges = result.changes.filter((change) => pathIsProjectScopedChangedPath(change.path, manifest.modRoot));
  if (scopedChanges.length === 0) {
    throw new AppError('无法刷新 ProjectSession：写入结果没有命中当前 Mod 的文件变更', {
      action: 'refresh-project-session-after-write',
    });
  }
  return refreshProjectSessionByChanges(project, manifest, scopedChanges);
}

export async function refreshLoadedSessionsAfterWrite(result: WriteResult, relativePathModRoot: string | null) {
  const project = useProjectStore();
  const events: ProjectSessionInvalidatedEvent[] = [];
  await Promise.all(
    [...project.manifests.values()].map(async (manifest) => {
      const scopedChanges = result.changes.filter((change) =>
        isAbsoluteFsPath(change.path) ? pathBelongsToRoot(change.path, manifest.modRoot) : manifest.modRoot === relativePathModRoot,
      );
      if (scopedChanges.length === 0) return;
      const event = await refreshProjectSessionByChanges(project, manifest, scopedChanges);
      events.push(event);
    }),
  );
  return events;
}

type PendingWriteEvent = { id: number; event: ProjectSessionInvalidatedEvent };

async function refreshProjectSessionByChanges(
  project: ReturnType<typeof useProjectStore>,
  manifest: ProjectManifest,
  changes: WriteResult['changes'],
): Promise<ProjectSessionInvalidatedEvent> {
  const sync = useWriteSyncStore();
  const entry = sync.enqueue(manifest.modRoot, manifest.sessionId, changes);
  let events: PendingWriteEvent[];
  try {
    events = await retryPendingProjectSessionWrites(project, manifest.sessionId);
  } catch (error) {
    sync.markFailed(entry.id, formatError(error));
    throw error;
  }
  const completed = events.find((event) => event.id === entry.id);
  if (!completed) throw new AppError('会话已关闭，本次同步已结束', { action: 'refresh-project-session-after-write' });
  return completed.event;
}

const syncExecutions = new Map<string, Promise<PendingWriteEvent[]>>();

export async function retryPendingProjectSessionWrites(
  project: ReturnType<typeof useProjectStore>,
  sessionId: string,
): Promise<PendingWriteEvent[]> {
  const running = syncExecutions.get(sessionId);
  if (running) {
    const completed = await running;
    const remaining: PendingWriteEvent[] = await retryPendingProjectSessionWrites(project, sessionId);
    return [...completed, ...remaining];
  }
  const execution = synchronizePendingWrites(project, sessionId);
  syncExecutions.set(sessionId, execution);
  try {
    return await execution;
  } finally {
    syncExecutions.delete(sessionId);
  }
}

async function synchronizePendingWrites(project: ReturnType<typeof useProjectStore>, sessionId: string): Promise<PendingWriteEvent[]> {
  const sync = useWriteSyncStore();
  const events: PendingWriteEvent[] = [];
  for (const entry of sync.pending.filter((entry) => entry.sessionId === sessionId)) {
    if (project.getSessionId(entry.modRoot) !== entry.sessionId || !sync.pending.some((pending) => pending.id === entry.id)) continue;
    if (!entry.refreshed) {
      const refreshed = await requestProjectSessionRefresh(entry.sessionId, entry.changes);
      if (project.getSessionId(entry.modRoot) !== entry.sessionId || !sync.pending.some((pending) => pending.id === entry.id)) continue;
      project.replaceProjectManifest(refreshed.manifest);
      applyProjectSessionCacheInvalid(refreshed);
      sync.markRefreshed(entry.id, refreshed);
    }
    const refreshed = sync.pending.find((pending) => pending.id === entry.id)!.refreshed!;
    await emitProjectSessionInvalidated(refreshed);
    sync.complete(entry.id);
    events.push({ id: entry.id, event: refreshed });
  }
  return events;
}
