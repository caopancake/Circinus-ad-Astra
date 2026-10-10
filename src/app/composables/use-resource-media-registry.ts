import { onUnmounted, shallowReactive } from 'vue';
import { ensureResourceMedia, resourceMediaDataUrl, subscribeResourceMediaInvalidations } from '@/services/resource-media.service';
import { resourceCacheKey } from '@/services/resource-cache.service';
import { createReadTicket, isReadInvalidated, type ReadTicket } from '@/shared/runtime/read-request';
import type { ResourceRef } from '@/shared/types';

interface MediaReference {
  resource: ResourceRef;
  count: number;
  ticket: ReadTicket<string | null> | null;
}

export interface MediaCollectionChange {
  id: string;
  resources: readonly ResourceRef[];
}

export function useResourceMediaRegistry(options: {
  surface: string;
  onError: (error: unknown) => void;
  onFailures: (resources: readonly ResourceRef[]) => void;
}) {
  const collections = new Map<string, Map<string, ResourceRef>>();
  const references = new Map<string, MediaReference>();
  const temporary = shallowReactive(new Map<string, string>());
  const reportedFailures = new Set<string>();
  let sessionId: string | null = null;

  function clear() {
    for (const entry of references.values()) entry.ticket?.invalidate('consumer');
    references.clear();
    collections.clear();
    temporary.clear();
    reportedFailures.clear();
  }

  async function read(keys: readonly string[]): Promise<void> {
    const capturedSession = sessionId!;
    const entries = keys.map((key) => [key, references.get(key)!] as const);
    const batch = ensureResourceMedia(
      capturedSession,
      entries.map(([, entry]) => entry.resource),
      options.surface,
    ).then((result) => ({
      failedKeys: new Set(result.failedResources.map((resource) => resourceCacheKey(capturedSession, resource))),
      uncachedDataUrls: result.uncachedDataUrls,
    }));
    let reportedError = false;
    const failures: Array<{ key: string; entry: MediaReference }> = [];
    await Promise.all(
      entries.map(async ([key, entry]) => {
        const ticket = createReadTicket({ sessionId: capturedSession, resource: entry.resource }, () =>
          batch.then((result) => {
            if (result.failedKeys.has(key)) return null;
            return result.uncachedDataUrls.get(key) ?? '';
          }),
        );
        entry.ticket = ticket;
        try {
          const value = await ticket.promise;
          ticket.accept();
          if (value === null) failures.push({ key, entry });
          else if (value) temporary.set(key, value);
        } catch (error) {
          if (entry.ticket === ticket) entry.ticket = null;
          if (!isReadInvalidated(error) && !ticket.signal.aborted && !reportedError) {
            reportedError = true;
            options.onError(error);
          }
        }
      }),
    );
    const activeFailures = failures.filter(({ key, entry }) => references.get(key) === entry && !reportedFailures.has(key));
    for (const { key } of activeFailures) reportedFailures.add(key);
    if (activeFailures.length) options.onFailures(activeFailures.map(({ entry }) => entry.resource));
  }

  function replaceCollections(nextSession: string | null | undefined, changes: readonly MediaCollectionChange[]): Promise<void> {
    if (sessionId !== (nextSession ?? null)) {
      clear();
      sessionId = nextSession ?? null;
    }
    if (!sessionId) return Promise.resolve();
    const deltas = new Map<string, { resource: ResourceRef; count: number }>();
    const requestedKeys = new Set<string>();
    function changeCount(key: string, resource: ResourceRef, count: number) {
      const current = deltas.get(key);
      deltas.set(key, { resource, count: (current?.count ?? 0) + count });
    }
    for (const change of changes) {
      const previous = collections.get(change.id);
      const next = new Map(change.resources.map((resource) => [resourceCacheKey(sessionId!, resource), resource]));
      for (const key of next.keys()) requestedKeys.add(key);
      for (const [key, resource] of previous ?? []) if (!next.has(key)) changeCount(key, resource, -1);
      for (const [key, resource] of next) if (!previous?.has(key)) changeCount(key, resource, 1);
      if (next.size) collections.set(change.id, next);
      else collections.delete(change.id);
    }
    for (const [key, delta] of deltas) {
      const entry = references.get(key) ?? { resource: delta.resource, count: 0, ticket: null };
      entry.count += delta.count;
      if (entry.count === 0) {
        entry.ticket?.invalidate('consumer');
        references.delete(key);
        temporary.delete(key);
      } else {
        references.set(key, entry);
      }
    }
    const missing = [...requestedKeys].filter((key) => references.has(key) && !references.get(key)!.ticket);
    return missing.length ? read(missing) : Promise.resolve();
  }

  const stopInvalidation = subscribeResourceMediaInvalidations((event) => {
    if (event.sessionId !== sessionId) return;
    if (event.scope === 'session') {
      clear();
      sessionId = null;
      return;
    }
    const keys = event.invalidation?.session
      ? [...references.keys()]
      : [
          ...new Set(
            [...event.resources, ...(event.invalidation?.resources ?? [])].map((resource) => resourceCacheKey(event.sessionId, resource)),
          ),
        ];
    const affected = keys.filter((key) => references.has(key));
    for (const key of affected) {
      references.get(key)!.ticket?.invalidate('project');
      temporary.delete(key);
      reportedFailures.delete(key);
    }
    if (affected.length) void read(affected);
  });

  onUnmounted(() => {
    stopInvalidation();
    clear();
  });

  return {
    replaceCollections,
    replaceCollection: (session: string | null | undefined, id: string, resources: readonly ResourceRef[]) =>
      replaceCollections(session, [{ id, resources }]),
    releaseCollection: (id: string) => replaceCollections(sessionId, [{ id, resources: [] }]),
    clear,
    dataUrl: (session: string | null | undefined, resource: ResourceRef | null | undefined) =>
      (session && resource ? temporary.get(resourceCacheKey(session, resource)) : undefined) ?? resourceMediaDataUrl(session, resource),
  };
}
