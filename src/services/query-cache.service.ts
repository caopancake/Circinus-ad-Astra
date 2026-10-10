import { recordPerformance } from '@/shared/runtime/performance';
import { requireProjectionReady } from '@/shared/runtime/project-projection';
import { createRuntimeCache, type RuntimeCache } from '@/shared/runtime/cache';
import { stableStringify } from '@/shared/lib/stable-compare';
import { deepClone } from '@/shared/lib/starsector';
import { createReadTicket, waitForRead, invalidatedRead, type ReadTicket } from '@/shared/runtime/read-request';
import type { QueryCacheKind, QueryIdentity, QueryKind, QueryValue } from '@/shared/types';
import type { EntityKind, InvalidatedQueryScope, ProjectInvalidation } from '@/shared/types';

interface QueryCacheEntry {
  identity: QueryIdentity;
  value: unknown;
}

interface PendingQueryEntry {
  identity: QueryIdentity;
  request: ReadTicket<unknown>;
  promise: Promise<unknown>;
}

export interface QueryCacheInvalidationEvent {
  invalidation: ProjectInvalidation | null;
  queries: QueryIdentity[];
  sessionId: string;
  scope: 'paths' | 'session';
}

type QueryCacheInvalidationListener = (event: QueryCacheInvalidationEvent) => void;

const LRU_CAPACITY: Record<QueryCacheKind, number> = {
  'csv-table-window': 80,
  'csv-source-options': 240,
  'csv-row-preview': 400,
  'hull-references': 128,
  'entity-detail': 128,
  'entity-list': 128,
};

const QUERY_CACHE_KINDS = Object.keys(LRU_CAPACITY) as QueryCacheKind[];
const caches = new Map<QueryCacheKind, RuntimeCache<string, QueryCacheEntry, PendingQueryEntry>>(
  QUERY_CACHE_KINDS.map((queryKind) => [
    queryKind,
    createRuntimeCache<string, QueryCacheEntry, PendingQueryEntry>({ capacity: LRU_CAPACITY[queryKind] }),
  ]),
);
const liveQueries = new Set<PendingQueryEntry>();
const invalidationListeners = new Set<QueryCacheInvalidationListener>();

function cacheFor(queryKind: QueryCacheKind): RuntimeCache<string, QueryCacheEntry, PendingQueryEntry> {
  return caches.get(queryKind)!;
}

export async function queryCached<K extends QueryCacheKind>(
  input: QueryIdentity<K>,
  loader: () => Promise<QueryValue<NoInfer<K>>>,
  signal?: AbortSignal,
): Promise<QueryValue<K>> {
  const identity = deepClone(input);
  const { sessionId, queryKind, parameters } = identity;
  if (signal?.aborted) throw invalidatedRead(identity, 'consumer');
  requireProjectionReady(sessionId);
  const cache = cacheFor(queryKind);
  const key = queryCacheKey(sessionId, queryKind, parameters);
  const startedAt = performance.now();
  const cached = cache.get(key);
  if (cached) {
    recordPerformance('frontend.queryCache', performance.now() - startedAt, { queryKind, hit: true });
    return waitForRead(Promise.resolve(queryValue<K>(cached.value)), identity, signal);
  }
  const pendingQuery = cache.getPending(key);
  if (pendingQuery) {
    recordPerformance('frontend.queryCache', performance.now() - startedAt, { queryKind, hit: true, pending: true });
    return waitForRead(pendingQuery.promise.then(queryValue<K>), identity, signal);
  }
  const request = createReadTicket(identity, () => loader());
  const completed = request.promise
    .then((value) => {
      request.accept();
      requireProjectionReady(sessionId);
      if (cache.getPending(key)?.request === request) cache.set(key, { identity, value });
      return value;
    })
    .finally(() => {
      if (cache.getPending(key)?.request === request) cache.deletePending(key);
    });
  cache.setPending(key, { identity, request, promise: completed });
  const value = await waitForRead(completed, identity, signal);
  recordPerformance('frontend.queryCache', performance.now() - startedAt, { queryKind, hit: false });
  return value;
}

export async function queryLive<K extends QueryKind>(
  input: QueryIdentity<K>,
  loader: (identity: QueryIdentity<NoInfer<K>>) => Promise<QueryValue<NoInfer<K>>>,
  signal?: AbortSignal,
): Promise<QueryValue<K>> {
  const identity = deepClone(input);
  if (signal?.aborted) throw invalidatedRead(identity, 'consumer');
  requireProjectionReady(identity.sessionId);
  const request = createReadTicket(identity, () => loader(identity));
  const entry: PendingQueryEntry = { identity, request, promise: request.promise };
  liveQueries.add(entry);
  const completed = request.promise
    .then((value) => {
      request.accept();
      requireProjectionReady(identity.sessionId);
      return value;
    })
    .finally(() => liveQueries.delete(entry));
  return waitForRead(completed, identity, signal);
}

export function invalidateQueryCacheForSession(sessionId: string) {
  const invalidatedQueries: QueryIdentity[] = [];
  for (const queryKind of QUERY_CACHE_KINDS) {
    const cache = cacheFor(queryKind);
    for (const key of [...cache.keys()]) {
      const entry = cache.peek(key);
      if (!entry || entry.identity.sessionId !== sessionId) continue;
      invalidatedQueries.push(entry.identity);
      cache.delete(key);
    }
    for (const key of [...cache.pendingKeys()]) {
      const pendingEntry = cache.getPending(key);
      if (!pendingEntry || pendingEntry.identity.sessionId !== sessionId) continue;
      invalidatedQueries.push(pendingEntry.identity);
      cache.deletePending(key);
      pendingEntry.request.invalidate('session');
    }
  }
  invalidateLiveQueries(sessionId, null, invalidatedQueries);
  notifyQueryCacheInvalidated(sessionId, invalidatedQueries, 'session', null);
}

export function invalidateQueryCacheByProject(sessionId: string, invalidation: ProjectInvalidation) {
  const invalidatedQueries: QueryIdentity[] = [];
  for (const queryKind of QUERY_CACHE_KINDS) {
    const cache = cacheFor(queryKind);
    for (const key of [...cache.keys()]) {
      const entry = cache.peek(key);
      if (!entry || entry.identity.sessionId !== sessionId) continue;
      if (!shouldInvalidateQuery(entry.identity, invalidation)) continue;
      invalidatedQueries.push(entry.identity);
      cache.delete(key);
    }
    for (const key of [...cache.pendingKeys()]) {
      const pendingEntry = cache.getPending(key);
      if (!pendingEntry || pendingEntry.identity.sessionId !== sessionId) continue;
      if (!shouldInvalidateQuery(pendingEntry.identity, invalidation)) continue;
      invalidatedQueries.push(pendingEntry.identity);
      cache.deletePending(key);
      pendingEntry.request.invalidate('project');
    }
  }
  invalidateLiveQueries(sessionId, invalidation, invalidatedQueries);
  notifyQueryCacheInvalidated(sessionId, invalidatedQueries, 'paths', invalidation);
}

export function subscribeQueryInvalidations(listener: QueryCacheInvalidationListener): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

export function hasQueryInvalidation(event: QueryCacheInvalidationEvent, queryKind: QueryCacheKind): boolean {
  if (event.scope === 'session') return true;
  if (event.invalidation) return event.invalidation.queryScopes.some((scope) => scope.kind === queryKind);
  return event.queries.some((query) => query.queryKind === queryKind);
}

export function hasEntityInvalidation(
  event: QueryCacheInvalidationEvent,
  queryKind: 'entity-detail' | 'entity-list',
  kind: EntityKind,
  id: string | null = null,
): boolean {
  if (event.scope === 'session') return true;
  if (event.invalidation) {
    return event.invalidation.queryScopes.some((scope) => queryScopeMatchesEntity(scope, queryKind, kind, id));
  }
  return event.queries.some((query) => {
    if (query.queryKind !== queryKind) return false;
    if (queryParameterText(query.parameters, 'kind') !== kind) return false;
    if (id === null) return true;
    return queryParameterText(query.parameters, 'id') === id;
  });
}

export function hasSourceInvalidation(event: QueryCacheInvalidationEvent, source: string): boolean {
  if (event.scope === 'session') return true;
  if (event.invalidation) {
    return event.invalidation.queryScopes.some((scope) => queryScopeMatchesSourceOptions(scope, source));
  }
  return event.queries.some(
    (query) => query.queryKind === 'csv-source-options' && queryParameterText(query.parameters, 'source') === source,
  );
}

export function hasTableInvalidation(event: QueryCacheInvalidationEvent, queryKind: 'csv-table-window', table: string): boolean {
  if (event.scope === 'session') return true;
  if (event.invalidation) {
    return event.invalidation.queryScopes.some((scope) => scope.kind === queryKind && (!scope.table || scope.table === table));
  }
  return event.queries.some((query) => query.queryKind === queryKind && queryParameterText(query.parameters, 'table') === table);
}

function invalidateLiveQueries(sessionId: string, invalidation: ProjectInvalidation | null, identities: QueryIdentity[]) {
  for (const entry of liveQueries) {
    if (entry.identity.sessionId !== sessionId || (invalidation && !shouldInvalidateQuery(entry.identity, invalidation))) continue;
    identities.push(entry.identity);
    liveQueries.delete(entry);
    entry.request.invalidate(invalidation ? 'project' : 'session');
  }
}

function notifyQueryCacheInvalidated(
  sessionId: string,
  queries: QueryIdentity[],
  scope: QueryCacheInvalidationEvent['scope'],
  invalidation: ProjectInvalidation | null,
) {
  if (queries.length === 0 && scope !== 'session' && !invalidation) return;
  const event: QueryCacheInvalidationEvent = {
    invalidation,
    queries,
    sessionId,
    scope,
  };
  for (const listener of invalidationListeners) listener(event);
}

function shouldInvalidateQuery(entry: QueryIdentity, invalidation: ProjectInvalidation): boolean {
  if (invalidation.session) return true;
  if (invalidation.queryScopes.length === 0) return false;
  switch (entry.queryKind) {
    case 'csv-table-window':
    case 'csv-row-preview': {
      const table = queryParameterText(entry.parameters, 'table');
      return invalidation.queryScopes.some((scope) => scope.kind === entry.queryKind && (!scope.table || scope.table === table));
    }
    case 'csv-source-options': {
      const source = queryParameterText(entry.parameters, 'source');
      return invalidation.queryScopes.some((scope) => queryScopeMatchesSourceOptions(scope, source));
    }
    case 'hull-references':
      return invalidation.queryScopes.some((scope) => scope.kind === 'hull-references');
    case 'entity-detail': {
      const kind = queryParameterText(entry.parameters, 'kind');
      const id = queryParameterText(entry.parameters, 'id');
      return invalidation.queryScopes.some((scope) => queryScopeMatchesEntity(scope, 'entity-detail', kind, id));
    }
    case 'entity-list': {
      const kind = queryParameterText(entry.parameters, 'kind');
      const id = queryParameterText(entry.parameters, 'id');
      return invalidation.queryScopes.some((scope) => queryScopeMatchesEntity(scope, 'entity-list', kind, id));
    }
    case 'entity-edit-target':
    case 'editor-draft-resources':
      return invalidation.queryScopes.some((scope) =>
        queryScopeMatchesEntity(scope, 'entity-detail', entry.parameters.kind, entry.parameters.id),
      );
    case 'entity-identity-intent':
      return invalidation.queryScopes.some(
        (scope) =>
          queryScopeMatchesEntity(scope, 'entity-detail', entry.parameters.source.kind, entry.parameters.source.id) ||
          queryScopeMatchesEntity(scope, 'entity-detail', entry.parameters.source.kind, entry.parameters.nextId),
      );
    case 'resource-reference':
      return false;
  }
}

function queryScopeMatchesSourceOptions(scope: InvalidatedQueryScope, source: string | null): boolean {
  if (scope.kind !== 'csv-source-options') return false;
  if (scope.source) return scope.source === source;
  if (scope.table) return sourceTable(source) === scope.table;
  return true;
}

function sourceTable(source: string | null): string | null {
  if (!source) return null;
  const trimmed = source.startsWith('csv:') ? source.slice(4) : source;
  const separator = trimmed.indexOf('.');
  return separator > 0 ? trimmed.slice(0, separator) : null;
}

function queryParameterText(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function queryScopeMatchesEntity(
  scope: InvalidatedQueryScope,
  queryKind: 'entity-detail' | 'entity-list',
  kind: string | null,
  id: string | null,
): boolean {
  if (scope.kind !== queryKind) return false;
  if (!scope.entity) return true;
  return scope.entity.kind === kind && (!scope.entity.id || !id || scope.entity.id === id);
}

function queryCacheKey(sessionId: string, queryKind: QueryCacheKind, parameters: object) {
  return JSON.stringify([sessionId, queryKind, stableStringify(parameters)]);
}

// Storage is heterogeneous; the key binds this value to its query kind.
function queryValue<K extends QueryKind>(value: unknown): QueryValue<K> {
  return value as QueryValue<K>;
}
