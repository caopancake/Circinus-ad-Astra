import { invokeCommand } from '@/shared/runtime/command.runtime';
import { requireProjectionReady } from '@/shared/runtime/project-projection';
import { normalizeFsPath } from '@/shared/lib/paths';
import { AppError } from '@/shared/lib/errors';
import { sameResourceRef } from '@/shared/lib/resource-ref';
import { createRuntimeCache } from '@/shared/runtime/cache';
import {
  mediaBudgetBytes,
  registerMediaBudgetEntry,
  removeMediaBudgetEntry,
  touchMediaBudgetEntry,
  WEBVIEW_MEDIA_BUDGET_BYTES,
} from '@/shared/runtime/media-budget';
import { createReadTicket, waitForRead, invalidatedRead, type ReadTicket } from '@/shared/runtime/read-request';
import type {
  ProjectInvalidation,
  ProjectSessionId,
  ResourceDataUrlBatchEntry,
  ResourceDataUrlBatchResult,
  ResourceRef,
} from '@/shared/types';

interface CachedResourceDataUrl {
  dataUrl: string | null;
  relPath: string;
  resource: ResourceRef;
  sessionId: ProjectSessionId;
  source: ResourceRef['source'];
}

interface PendingResource {
  promise: Promise<string | null>;
  request: ReadTicket<string | null>;
  relPath: string;
  resource: ResourceRef;
  sessionId: ProjectSessionId;
  source: ResourceRef['source'];
}

export interface ResourceCacheInvalidationEvent {
  invalidation: ProjectInvalidation | null;
  resources: ResourceRef[];
  sessionId: ProjectSessionId;
  scope: 'resources' | 'session';
}

type ResourceCacheInvalidationListener = (event: ResourceCacheInvalidationEvent) => void;

export const RESOURCE_DATA_URL_CACHE_CAPACITY = 512;

const dataUrlCache = createRuntimeCache<string, CachedResourceDataUrl, PendingResource>({
  capacity: RESOURCE_DATA_URL_CACHE_CAPACITY,
  onEvict: (key) => removeMediaBudgetEntry(`resource:${key}`),
});
const invalidationListeners = new Set<ResourceCacheInvalidationListener>();

export async function queryResourceDataUrls(
  sessionId: ProjectSessionId,
  resources: readonly ResourceRef[],
  signal?: AbortSignal,
): Promise<(string | null)[]> {
  if (signal?.aborted) throw invalidatedRead({ sessionId, resources }, 'consumer');
  requireProjectionReady(sessionId);
  const entries = resources.map((resource) => ({ resource: { ...resource }, key: resourceCacheKey(sessionId, resource) }));
  const missing = new Map<string, { key: string; resource: ResourceRef }>();
  const pendingLoads: Promise<readonly [string, string | null]>[] = [];
  const resolved = new Map<string, string | null>();
  for (const { resource, key } of entries) {
    const cached = dataUrlCache.get(key);
    if (cached !== undefined) {
      resolved.set(key, cached.dataUrl);
      touchMediaBudgetEntry(`resource:${key}`);
      continue;
    }
    const pendingResource = dataUrlCache.getPending(key);
    if (pendingResource) {
      pendingLoads.push(pendingResource.promise.then((value) => [key, value] as const));
      continue;
    }
    missing.set(key, { key, resource });
  }
  if (missing.size > 0) {
    pendingLoads.push(...loadMissingResources(sessionId, [...missing.values()]));
  }
  for (const [key, dataUrl] of await waitForRead(Promise.all(pendingLoads), { sessionId, resources }, signal)) {
    resolved.set(key, dataUrl);
  }
  requireProjectionReady(sessionId);
  return entries.map(({ key }) => resolved.get(key) ?? null);
}

export function invalidateResourceCacheForSession(sessionId: ProjectSessionId) {
  clearSessionResources(sessionId, null);
}

function clearSessionResources(sessionId: ProjectSessionId, invalidation: ProjectInvalidation | null) {
  const invalidated: ResourceRef[] = [];
  for (const key of [...dataUrlCache.keys()]) {
    const entry = dataUrlCache.peek(key);
    if (!entry || entry.sessionId !== sessionId) continue;
    invalidated.push(entry.resource);
    removeCachedResource(key);
  }
  for (const key of [...dataUrlCache.pendingKeys()]) {
    const pendingEntry = dataUrlCache.getPending(key);
    if (!pendingEntry || pendingEntry.sessionId !== sessionId) continue;
    invalidated.push(pendingEntry.resource);
    dataUrlCache.deletePending(key);
    pendingEntry.request.invalidate(invalidation ? 'project' : 'session');
  }
  notifyResourceInvalidated(sessionId, invalidated, invalidation ? 'resources' : 'session', invalidation);
}

export function invalidateResourceCacheByProject(sessionId: ProjectSessionId, invalidation: ProjectInvalidation) {
  if (invalidation.session) {
    clearSessionResources(sessionId, invalidation);
    return;
  }
  if (invalidation.resources.length === 0) return;
  const invalidated: ResourceRef[] = [];
  for (const key of [...dataUrlCache.keys()]) {
    const entry = dataUrlCache.peek(key);
    if (!entry || entry.sessionId !== sessionId) continue;
    if (invalidation.resources.some((scope) => scope.source === entry.source && normalizeFsPath(scope.relPath) === entry.relPath)) {
      invalidated.push(entry.resource);
      removeCachedResource(key);
    }
  }
  for (const key of [...dataUrlCache.pendingKeys()]) {
    const pendingEntry = dataUrlCache.getPending(key);
    if (!pendingEntry || pendingEntry.sessionId !== sessionId) continue;
    if (
      invalidation.resources.some(
        (scope) => scope.source === pendingEntry.source && normalizeFsPath(scope.relPath) === pendingEntry.relPath,
      )
    ) {
      invalidated.push(pendingEntry.resource);
      dataUrlCache.deletePending(key);
      pendingEntry.request.invalidate('project');
    }
  }
  notifyResourceInvalidated(sessionId, invalidated, 'resources', invalidation);
}

export function subscribeResourceInvalidations(listener: ResourceCacheInvalidationListener): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

export function hasResourceInvalidation(event: ResourceCacheInvalidationEvent, resources: ResourceRef[]): boolean {
  if (resources.length === 0) return false;
  if (event.scope === 'session') return true;
  if (event.invalidation) {
    return event.invalidation.resources.some((scope) =>
      resources.some(
        (resource) => scope.source === resource.source && normalizeFsPath(scope.relPath) === normalizeFsPath(resource.relPath),
      ),
    );
  }
  return event.resources.some((resource) => resources.some((candidate) => sameResourceRef(candidate, resource)));
}

export function resourceCacheKey(sessionId: ProjectSessionId, resource: Pick<ResourceRef, 'source' | 'relPath'>): string {
  return JSON.stringify([sessionId, resource.source, normalizeFsPath(resource.relPath)]);
}

function loadMissingResources(
  sessionId: ProjectSessionId,
  missing: { key: string; resource: ResourceRef }[],
): Promise<readonly [string, string | null]>[] {
  const resources = missing.map((entry) => entry.resource);
  const batch = invokeCommand<ResourceDataUrlBatchResult>('query_resource_data_urls', { payload: { sessionId, resources } }).then(
    (result) => {
      validateResourceBatch(resources, result.entries);
      return result.entries;
    },
  );
  return missing.map((entry, index) => {
    const request = createReadTicket({ sessionId, resource: entry.resource }, () => batch.then((entries) => entries[index]!.dataUrl));
    const promise = request.promise
      .then((value) => {
        request.accept();
        requireProjectionReady(sessionId);
        if (dataUrlCache.getPending(entry.key)?.request === request) cacheResourceResult(sessionId, entry.resource, value);
        return value;
      })
      .finally(() => {
        if (dataUrlCache.getPending(entry.key)?.request === request) dataUrlCache.deletePending(entry.key);
      });
    dataUrlCache.setPending(entry.key, {
      promise,
      request,
      relPath: normalizeFsPath(entry.resource.relPath),
      resource: entry.resource,
      sessionId,
      source: entry.resource.source,
    });
    return promise.then((value) => [entry.key, value] as const);
  });
}

function validateResourceBatch(request: ResourceRef[], entries: ResourceDataUrlBatchEntry[]): void {
  if (entries.length !== request.length) {
    throw new AppError('资源批量查询返回数量和请求数量不一致', { action: 'query-resource-data-urls' });
  }
  entries.forEach((entry, index) => {
    const resource = request[index]!;
    ensureResourceEntryMatch(entry, resource);
    if (entry.dataUrl !== null && typeof entry.dataUrl !== 'string')
      throw new AppError('资源批量查询返回内容类型无效', { action: 'query-resource-data-urls' });
  });
}

function cacheResourceResult(sessionId: string, resource: ResourceRef, dataUrl: string | null): void {
  const bytes = mediaBudgetBytes(dataUrl);
  if (bytes > WEBVIEW_MEDIA_BUDGET_BYTES) return;
  const key = resourceCacheKey(sessionId, resource);
  dataUrlCache.set(key, {
    dataUrl,
    relPath: normalizeFsPath(resource.relPath),
    resource,
    sessionId,
    source: resource.source,
  });
  if (dataUrlCache.has(key)) {
    registerMediaBudgetEntry(`resource:${key}`, bytes, () => removeCachedResource(key));
  }
}

function removeCachedResource(key: string): void {
  dataUrlCache.delete(key);
  removeMediaBudgetEntry(`resource:${key}`);
}

function ensureResourceEntryMatch(entry: ResourceDataUrlBatchEntry, resource: ResourceRef): void {
  if (sameResourceRef(entry, resource)) {
    return;
  }
  throw new AppError('资源批量查询返回项和请求资源不一致', { action: 'query-resource-data-urls' });
}

function notifyResourceInvalidated(
  sessionId: ProjectSessionId,
  resources: ResourceRef[],
  scope: ResourceCacheInvalidationEvent['scope'],
  invalidation: ProjectInvalidation | null,
) {
  if (resources.length === 0 && scope !== 'session' && !invalidation) return;
  const event: ResourceCacheInvalidationEvent = {
    invalidation,
    resources,
    sessionId,
    scope,
  };
  for (const listener of invalidationListeners) listener(event);
}
