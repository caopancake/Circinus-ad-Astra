import { WINDOW_EVENTS, type CommittedWriteEvent, type ProjectSessionInvalidatedEvent } from '@/windows/window.events';
import { emitWindowEvent, listenWindowEvent, type WindowEventHandler } from '@/windows/tauri.events';
import { currentWindowLabel } from '@/windows/current.window';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { useProjectStore } from '@/stores/project.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useWriteSyncStore, type PendingWriteSync } from '@/stores/write-sync.store';
import { synchronizeSessionCommit } from '@/services/session.service';
import { invalidateQueryCacheByProject } from '@/services/query-cache.service';
import { invalidateResourceCacheByProject } from '@/services/resource-cache.service';
import { markProjectionPending, markProjectionReady } from '@/shared/runtime/project-projection';
import { AppError, formatError } from '@/shared/lib/errors';
import type { WriteResult } from '@/shared/types';

const acceptedProjections = new WeakMap<ReturnType<typeof useWriteSyncStore>, Set<string>>();
const syncExecutions = new WeakMap<ReturnType<typeof useWriteSyncStore>, Map<string, Promise<void>>>();

export function applyProjectSessionCacheInvalid(event: ProjectSessionInvalidatedEvent) {
  const sync = useWriteSyncStore();
  if (!acceptedProjections.has(sync)) acceptedProjections.set(sync, new Set());
  const key = JSON.stringify([event.manifest.sessionId, event.projectionRevision]);
  if (acceptedProjections.get(sync)!.has(key)) return;
  invalidateResourceCacheByProject(event.manifest.sessionId, event.invalidation);
  invalidateQueryCacheByProject(event.manifest.sessionId, event.invalidation);
  acceptedProjections.get(sync)!.add(key);
}

export function applyCommittedWriteCacheInvalid(sessionId: string, result: WriteResult) {
  const update = result.sessionUpdates.find((update) => update.sessionId === sessionId);
  if (update?.status === 'ready') {
    markProjectionReady(sessionId, update.commitId);
    applyProjectSessionCacheInvalid(update.projection);
  } else if (update?.status === 'pending') markProjectionPending(sessionId, update.commitId);
}

function acceptCommittedWrite(event: CommittedWriteEvent) {
  const project = useProjectStore();
  const sync = useWriteSyncStore();
  if (sync.wasAccepted(event)) return;
  const current = project.getManifest(event.modRoot);
  if (current && event.sessionId && current.sessionId !== event.sessionId) return;
  if (event.sessionId) useFileHistoryStore().applySnapshot(event.modRoot, event.result.history);
  for (const update of event.result.sessionUpdates) {
    if (update.status !== 'ready') continue;
    const manifest = project.getManifest(update.modRoot);
    if (manifest && manifest.sessionId !== update.sessionId) continue;
    markProjectionReady(update.sessionId, update.commitId);
    project.replaceProjectManifest(update.projection.manifest, update.projection.projectionRevision);
    applyProjectSessionCacheInvalid(update.projection);
  }
  sync.markAccepted(event);
}

export async function publishCommittedWrite(
  modRoot: string,
  result: WriteResult,
  sessionId: string | null,
  reason: CommittedWriteEvent['reason'] = 'save',
) {
  const event: CommittedWriteEvent = { modRoot, result, sessionId, reason, originWindowLabel: currentWindowLabel() };
  const sync = useWriteSyncStore();
  if (
    sync.wasAccepted(event) &&
    !sync.pending.some((entry) => entry.event.modRoot === modRoot && entry.event.result.commitId === result.commitId)
  )
    return;
  const entry = sync.enqueue(event);
  await synchronizeEntry(entry);
}

async function synchronizeEntry(entry: PendingWriteSync): Promise<void> {
  const sync = useWriteSyncStore();
  if (!syncExecutions.has(sync)) syncExecutions.set(sync, new Map());
  const running = syncExecutions.get(sync)!.get(entry.id);
  if (running) return running;
  const operation = executeSync(entry)
    .catch((error) => {
      sync.markFailed(entry.id, formatError(error));
      throw error;
    })
    .finally(() => syncExecutions.get(sync)!.delete(entry.id));
  syncExecutions.get(sync)!.set(entry.id, operation);
  return operation;
}

async function executeSync(entry: PendingWriteSync) {
  const sync = useWriteSyncStore();
  const current = useProjectStore().getManifest(entry.event.modRoot);
  if (current && entry.event.sessionId && current.sessionId !== entry.event.sessionId) {
    sync.complete(entry.id);
    return;
  }
  entry.error = null;
  if (!entry.historyAccepted) {
    if (entry.event.sessionId) useFileHistoryStore().applySnapshot(entry.event.modRoot, entry.event.result.history);
    entry.historyAccepted = true;
  }
  if (entry.step === 'projection') {
    for (let index = 0; index < entry.event.result.sessionUpdates.length; index++) {
      const update = entry.event.result.sessionUpdates[index]!;
      if (update.status === 'pending') {
        markProjectionPending(update.sessionId, update.commitId);
        const restored = await synchronizeSessionCommit(update.sessionId, update.modRoot, update.commitId);
        if (restored.status === 'pending') throw new AppError(restored.error.message, { action: restored.error.code });
        entry.event.result.sessionUpdates[index] = restored;
      }
    }
    entry.step = 'acceptance';
  }
  if (!sync.pending.some((candidate) => candidate.id === entry.id)) return;
  if (entry.step === 'acceptance') {
    acceptCommittedWrite(entry.event);
    entry.step = 'broadcast';
  }
  if (entry.event.result.changes.length > 0) await emitWindowEvent(WINDOW_EVENTS.committedWriteApplied, entry.event);
  sync.complete(entry.id);
}

export async function retryPendingProjectSessionWrites(sessionId: string) {
  const sync = useWriteSyncStore();
  for (const entry of [...sync.pending]) {
    if (entry.event.sessionId === sessionId || entry.event.result.sessionUpdates.some((update) => update.sessionId === sessionId))
      await synchronizeEntry(entry);
  }
}

export function retryPendingWritesForMod(modRoot: string): Promise<void> | undefined {
  const sync = useWriteSyncStore();
  const entries = sync.pending.filter((entry) => entry.event.modRoot === modRoot);
  if (entries.length === 0) return;
  return (async () => {
    for (const entry of entries) await synchronizeEntry(entry);
  })();
}

interface CommitSubscriber {
  handler: WindowEventHandler<CommittedWriteEvent>;
  matches: (event: CommittedWriteEvent) => boolean;
  phase: 'identity' | 'projection';
  delivered: Set<string>;
}
interface CommitListeners {
  subscribers: Set<CommitSubscriber>;
  registration: Promise<() => void>;
}
const commitListeners = new WeakMap<ReturnType<typeof useWriteSyncStore>, CommitListeners>();

export async function listenCommittedWrites(
  handler: WindowEventHandler<CommittedWriteEvent>,
  matches: (event: CommittedWriteEvent) => boolean = () => true,
  phase: CommitSubscriber['phase'] = 'projection',
) {
  const sync = useWriteSyncStore();
  let listeners = commitListeners.get(sync);
  if (!listeners) {
    const subscribers = new Set<CommitSubscriber>();
    const registration = listenWindowEvent<CommittedWriteEvent>(
      WINDOW_EVENTS.committedWriteApplied,
      async (event) => {
        if (event.originWindowLabel === currentWindowLabel()) return;
        const current = useProjectStore().getManifest(event.modRoot);
        if (current && event.sessionId && current.sessionId !== event.sessionId) return;
        const key = JSON.stringify([event.modRoot, event.result.commitId]);
        const selected = [...subscribers].filter((subscriber) => subscriber.matches(event) && !subscriber.delivered.has(key));
        const identities = selected
          .filter((subscriber) => subscriber.phase === 'identity')
          .map((subscriber) => {
            const operation = Promise.resolve(subscriber.handler(event));
            return operation.then(() => subscriber.delivered.add(key));
          });
        acceptCommittedWrite(event);
        await Promise.all(identities);
        for (const subscriber of selected.filter((subscriber) => subscriber.phase === 'projection')) {
          await subscriber.handler(event);
          subscriber.delivered.add(key);
        }
      },
      recordWindowEventHandlerError,
    );
    listeners = { subscribers, registration };
    commitListeners.set(sync, listeners);
  }
  const subscriber: CommitSubscriber = { handler, matches, phase, delivered: new Set() };
  listeners.subscribers.add(subscriber);
  let stop: () => void;
  try {
    stop = await listeners.registration;
  } catch (error) {
    listeners.subscribers.delete(subscriber);
    commitListeners.delete(sync);
    throw error;
  }
  const registration = listeners;
  return () => {
    registration.subscribers.delete(subscriber);
    if (registration.subscribers.size === 0) {
      stop();
      commitListeners.delete(sync);
    }
  };
}

export function listenProjectSessionInvalidated(handler: WindowEventHandler<ProjectSessionInvalidatedEvent>) {
  return listenCommittedWrites(async (event) => {
    for (const update of event.result.sessionUpdates) if (update.status === 'ready') await handler(update.projection);
  });
}
