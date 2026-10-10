import { reactive } from 'vue';
import {
  queryResourceDataUrls,
  resourceCacheKey,
  subscribeResourceInvalidations,
  type ResourceCacheInvalidationEvent,
} from '@/services/resource-cache.service';
import { recordPerformance } from '@/shared/runtime/performance';
import {
  mediaBudgetBytes,
  registerMediaBudgetEntry,
  removeMediaBudgetEntry,
  touchMediaBudgetEntry,
  WEBVIEW_MEDIA_BUDGET_BYTES,
} from '@/shared/runtime/media-budget';
import { createReadTicket, invalidatedRead, waitForRead, type ReadTicket } from '@/shared/runtime/read-request';
import { requireProjectionReady } from '@/shared/runtime/project-projection';
import type { ProjectSessionId, ResourceRef } from '@/shared/types';

export const RESOURCE_MEDIA_CACHE_CAPACITY = 512;
export const RESOURCE_MEDIA_FLUSH_DELAY_MS = 25;

export interface ResourceMediaBatchResult {
  observed: number;
  requested: number;
  cacheHits: number;
  resolved: number;
  failed: number;
  failedResources: ResourceRef[];
  uncachedDataUrls: ReadonlyMap<string, string>;
}

interface PendingMedia {
  sessionId: ProjectSessionId;
  resource: ResourceRef;
  ticket: ReadTicket<string | null>;
  resolve: (value: string | null) => void;
  reject: (error: unknown) => void;
}

type ResourceMediaInvalidationListener = (event: ResourceCacheInvalidationEvent) => void;

const media = reactive(new Map<string, string | null>());
const accessOrder = new Map<string, true>();
const pending = new Map<string, PendingMedia>();
const inFlight = new Map<string, PendingMedia>();
const invalidationListeners = new Set<ResourceMediaInvalidationListener>();
let flushHandle: number | null = null;

export function resourceMediaDataUrl(
  sessionId: ProjectSessionId | null | undefined,
  resource: ResourceRef | null | undefined,
): string | undefined {
  if (!sessionId || !resource) return undefined;
  const key = resourceCacheKey(sessionId, resource);
  if (!media.has(key)) return undefined;
  touchMedia(key);
  touchMediaBudgetEntry(`media:${key}`);
  return media.get(key) ?? undefined;
}

export async function ensureResourceMedia(
  sessionId: ProjectSessionId,
  resources: ResourceRef[],
  surface: string,
  signal?: AbortSignal,
): Promise<ResourceMediaBatchResult> {
  if (signal?.aborted) throw invalidatedRead({ sessionId, resources }, 'consumer');
  requireProjectionReady(sessionId);
  const startedAt = performance.now();
  const unique = new Map(resources.map((resource) => [resourceCacheKey(sessionId, resource), resource]));
  const waitFor: Promise<readonly [string, string | null]>[] = [];
  const values = new Map<string, string | null>();
  let cacheHits = 0;
  let requested = 0;

  for (const [key, resource] of unique) {
    if (media.has(key)) {
      cacheHits += 1;
      touchMedia(key);
      touchMediaBudgetEntry(`media:${key}`);
      values.set(key, media.get(key)!);
      continue;
    }
    const existing = pending.get(key) ?? inFlight.get(key);
    if (existing) {
      waitFor.push(existing.ticket.promise.then((value) => [key, value] as const));
      continue;
    }
    let resolve!: (value: string | null) => void;
    let reject!: (error: unknown) => void;
    const ticket = createReadTicket(
      { sessionId, resource },
      () =>
        new Promise<string | null>((doneResolve, doneReject) => {
          resolve = doneResolve;
          reject = doneReject;
        }),
    );
    pending.set(key, { sessionId, resource, ticket, resolve, reject });
    waitFor.push(ticket.promise.then((value) => [key, value] as const));
    requested += 1;
  }

  scheduleFlush();
  let loadError: unknown = null;
  try {
    for (const [key, value] of await waitForRead(Promise.all(waitFor), { sessionId, resources }, signal)) values.set(key, value);
  } catch (error) {
    loadError = error;
  }
  const failedResources = [...unique].flatMap(([key, resource]) => (values.get(key) === null ? [resource] : []));
  const resolved = [...values.values()].filter((value) => value !== null).length;
  const uncachedDataUrls = new Map(
    [...values].flatMap(([key, value]) => (value !== null && !media.has(key) ? [[key, value] as const] : [])),
  );
  const result = {
    observed: unique.size,
    requested,
    cacheHits,
    resolved,
    failed: failedResources.length,
    failedResources,
    uncachedDataUrls,
  };
  recordPerformance('frontend.media.visibleBatch', performance.now() - startedAt, {
    surface,
    observed: result.observed,
    requested: result.requested,
    cacheHits: result.cacheHits,
    resolved: result.resolved,
    failed: result.failed,
  });
  if (loadError) throw loadError;
  return result;
}

export function subscribeResourceMediaInvalidations(listener: ResourceMediaInvalidationListener): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

function scheduleFlush(): void {
  if (pending.size === 0 || flushHandle !== null) return;
  flushHandle = window.setTimeout(() => {
    flushHandle = null;
    void flushPendingMedia();
  }, RESOURCE_MEDIA_FLUSH_DELAY_MS);
}

async function flushPendingMedia(): Promise<void> {
  const entries = [...pending.entries()];
  for (const [key, item] of entries) {
    pending.delete(key);
    inFlight.set(key, item);
  }
  const sessions = new Map<ProjectSessionId, Array<[string, PendingMedia]>>();
  for (const entry of entries) {
    const group = sessions.get(entry[1].sessionId) ?? [];
    group.push(entry);
    sessions.set(entry[1].sessionId, group);
  }

  await Promise.all(
    [...sessions].map(async ([sessionId, group]) => {
      try {
        const dataUrls = await queryResourceDataUrls(
          sessionId,
          group.map(([, item]) => item.resource),
        );
        group.forEach(([key, item], index) => {
          const value = dataUrls[index] ?? null;
          if (!item.ticket.signal.aborted) {
            item.ticket.accept();
            storeMedia(key, value);
          }
          item.resolve(value);
        });
      } catch (error) {
        group.forEach(([, item]) => item.reject(error));
      } finally {
        group.forEach(([key, item]) => {
          if (inFlight.get(key) === item) inFlight.delete(key);
        });
      }
    }),
  );
  scheduleFlush();
}

function storeMedia(key: string, dataUrl: string | null): void {
  if (mediaBudgetBytes(dataUrl) > WEBVIEW_MEDIA_BUDGET_BYTES) return;
  media.set(key, dataUrl);
  touchMedia(key);
  registerMediaBudgetEntry(`media:${key}`, mediaBudgetBytes(dataUrl), () => removeMediaKey(key));
  while (accessOrder.size > RESOURCE_MEDIA_CACHE_CAPACITY) {
    const oldestKey = accessOrder.keys().next().value as string | undefined;
    if (oldestKey === undefined) return;
    accessOrder.delete(oldestKey);
    removeMediaKey(oldestKey);
  }
}

function touchMedia(key: string): void {
  accessOrder.delete(key);
  accessOrder.set(key, true);
}

function removeMediaKey(key: string): void {
  media.delete(key);
  accessOrder.delete(key);
  removeMediaBudgetEntry(`media:${key}`);
}

subscribeResourceInvalidations((event) => {
  if (event.scope === 'session' || event.invalidation?.session) {
    const prefix = JSON.stringify([event.sessionId]).slice(0, -1);
    const keys = new Set([...media.keys(), ...pending.keys(), ...inFlight.keys()]);
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      invalidateMediaKey(key, event.scope === 'session' ? 'session' : 'project');
    }
  } else {
    for (const resource of event.resources) {
      const key = resourceCacheKey(event.sessionId, resource);
      invalidateMediaKey(key);
    }
    for (const scope of event.invalidation?.resources ?? []) {
      invalidateMediaKey(resourceCacheKey(event.sessionId, scope));
    }
  }
  for (const listener of invalidationListeners) listener(event);
});

function invalidateMediaKey(key: string, reason: 'project' | 'session' = 'project'): void {
  removeMediaKey(key);
  pending.get(key)?.ticket.invalidate(reason);
  pending.delete(key);
  inFlight.get(key)?.ticket.invalidate(reason);
  inFlight.delete(key);
}
