import { recordPerformance } from '@/shared/runtime/performance';
import { requireProjectionReady } from '@/shared/runtime/project-projection';
import { createRuntimeCache, type RuntimeCache } from '@/shared/runtime/cache';
import { stableStringify } from '@/shared/lib/stable-compare';
import type { EntityKind, InvalidatedQueryScope, ProjectInvalidation } from '@/shared/types';

export type QueryCacheKind =
  'csv-table-window' | 'csv-source-options' | 'csv-row-preview' | 'hull-references' | 'entity-detail' | 'entity-list';

export interface QueryIdentity {
  queryKind: QueryCacheKind;
  parameters: Record<string, unknown>;
}

interface QueryCacheEntry extends QueryIdentity {
  sessionId: string;
  value: unknown;
}

interface PendingQueryEntry extends QueryIdentity {
  promise: Promise<unknown>;
  sessionId: string;
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
const caches = new Map<QueryCacheKind, RuntimeCache<string, QueryCacheEntry>>(
  QUERY_CACHE_KINDS.map((queryKind) => [queryKind, createRuntimeCache<string, QueryCacheEntry>({ capacity: LRU_CAPACITY[queryKind] })]),
);
const invalidationListeners = new Set<QueryCacheInvalidationListener>();

function cacheFor(queryKind: QueryCacheKind): RuntimeCache<string, QueryCacheEntry> {
  return caches.get(queryKind)!;
}

export async function queryCached<T>(
  sessionId: string,
  queryKind: QueryCacheKind,
  parameters: Record<string, unknown>,
  loader: () => Promise<T>,
): Promise<T> {
  requireProjectionReady(sessionId);
  const cache = cacheFor(queryKind);
  const key = queryCacheKey(sessionId, queryKind, parameters);
  const startedAt = performance.now();
  const cached = cache.get(key);
  if (cached) {
    recordPerformance('frontend.queryCache', performance.now() - startedAt, { queryKind, hit: true });
    return cached.value as T;
  }
  const pendingQuery = cache.getPending<PendingQueryEntry>(key);
  if (pendingQuery) {
    recordPerformance('frontend.queryCache', performance.now() - startedAt, { queryKind, hit: true, pending: true });
    return (await pendingQuery.promise) as T;
  }
  const loaded = loader()
    .then((value) => {
      requireProjectionReady(sessionId);
      if (cache.getPending<PendingQueryEntry>(key)?.promise === loaded) {
        cache.set(key, { queryKind, parameters, sessionId, value });
      }
      return value;
    })
    .finally(() => {
      if (cache.getPending<PendingQueryEntry>(key)?.promise === loaded) cache.deletePending(key);
    });
  cache.setPending<PendingQueryEntry>(key, { queryKind, parameters, promise: loaded, sessionId });
  const value = await loaded;
  recordPerformance('frontend.queryCache', performance.now() - startedAt, { queryKind, hit: false });
  return value;
}

export function invalidateQueryCacheForSession(sessionId: string) {
  const invalidatedQueries: QueryIdentity[] = [];
  for (const queryKind of QUERY_CACHE_KINDS) {
    const cache = cacheFor(queryKind);
    for (const key of [...cache.keys()]) {
      const entry = cache.peek(key);
      if (!entry || entry.sessionId !== sessionId) continue;
      invalidatedQueries.push(queryIdentity(entry));
      cache.delete(key);
    }
    for (const key of [...cache.pendingKeys()]) {
      const pendingEntry = cache.getPending<PendingQueryEntry>(key);
      if (!pendingEntry || pendingEntry.sessionId !== sessionId) continue;
      invalidatedQueries.push(queryIdentity(pendingEntry));
      cache.deletePending(key);
    }
  }
  notifyQueryCacheInvalidated(sessionId, invalidatedQueries, 'session', null);
}

export function invalidateQueryCacheByProject(sessionId: string, invalidation: ProjectInvalidation) {
  const invalidatedQueries: QueryIdentity[] = [];
  for (const queryKind of QUERY_CACHE_KINDS) {
    const cache = cacheFor(queryKind);
    for (const key of [...cache.keys()]) {
      const entry = cache.peek(key);
      if (!entry || entry.sessionId !== sessionId) continue;
      if (!shouldInvalidateQuery(entry, invalidation)) continue;
      invalidatedQueries.push(queryIdentity(entry));
      cache.delete(key);
    }
    for (const key of [...cache.pendingKeys()]) {
      const pendingEntry = cache.getPending<PendingQueryEntry>(key);
      if (!pendingEntry || pendingEntry.sessionId !== sessionId) continue;
      if (!shouldInvalidateQuery(pendingEntry, invalidation)) continue;
      invalidatedQueries.push(queryIdentity(pendingEntry));
      cache.deletePending(key);
    }
  }
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

function queryIdentity(query: QueryIdentity): QueryIdentity {
  return {
    parameters: query.parameters,
    queryKind: query.queryKind,
  };
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

function queryCacheKey(sessionId: string, queryKind: QueryCacheKind, parameters: Record<string, unknown>) {
  return JSON.stringify([sessionId, queryKind, stableStringify(parameters)]);
}
