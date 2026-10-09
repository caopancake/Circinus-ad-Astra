import { describe, expect, it, vi } from 'vitest';
import { invalidateQueryCacheByProject, invalidateQueryCacheForSession, queryCached, queryLive } from '@/services/query-cache.service';
import type { QueryValue } from '@/shared/types';
import { markProjectionPending, markProjectionReady } from '@/shared/runtime/project-projection';

describe('query pending ownership', () => {
  it('does not start a loader for an already released consumer', async () => {
    const controller = new AbortController();
    controller.abort();
    const loader = vi.fn(async () => []);
    await expect(
      queryCached({ sessionId: 'already-ended', queryKind: 'entity-list', parameters: { kind: 'ship' } }, loader, controller.signal),
    ).rejects.toMatchObject({ code: 'query.invalidated' });
    expect(loader).not.toHaveBeenCalled();
  });
  it('shares one loader while a released consumer ends only its own wait', async () => {
    const identity = { sessionId: 'shared-query', queryKind: 'entity-list' as const, parameters: { kind: 'ship' as const } };
    let finish!: (value: QueryValue<'entity-list'>) => void;
    const loader = vi.fn(
      () =>
        new Promise<QueryValue<'entity-list'>>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const first = queryCached(identity, loader, controller.signal);
    const second = queryCached(identity, loader);
    const ended = expect(first).rejects.toMatchObject({ code: 'query.invalidated', cause: { reason: 'consumer' } });
    controller.abort();
    await ended;
    finish([]);
    await expect(second).resolves.toEqual([]);
    await queryCached(identity, loader);
    expect(loader).toHaveBeenCalledOnce();
    invalidateQueryCacheForSession(identity.sessionId);
  });

  it('retries failed reads and isolates sessions at the same query identity', async () => {
    const identity = { sessionId: 'failed-query', queryKind: 'csv-source-options' as const, parameters: { source: 'csv:ships.id' } };
    const loader = vi.fn().mockRejectedValueOnce(new Error('read failure')).mockResolvedValue([]);
    await expect(queryCached(identity, loader)).rejects.toThrow('read failure');
    await queryCached(identity, loader);
    await queryCached({ ...identity, sessionId: 'other-query' }, loader);
    expect(loader).toHaveBeenCalledTimes(3);
    invalidateQueryCacheForSession(identity.sessionId);
    invalidateQueryCacheForSession('other-query');
  });

  it('ends a live draft-resource request immediately when the source detail changes', async () => {
    const identity = {
      sessionId: 'live-query',
      queryKind: 'editor-draft-resources' as const,
      parameters: { kind: 'ship' as const, id: 'demo', draft: {} },
    };
    let finish!: (value: QueryValue<'editor-draft-resources'>) => void;
    const read = queryLive(
      identity,
      () =>
        new Promise<QueryValue<'editor-draft-resources'>>((resolve) => {
          finish = resolve;
        }),
    );
    const ended = expect(read).rejects.toMatchObject({ code: 'query.invalidated', cause: { identity, reason: 'project' } });
    invalidateQueryCacheByProject(identity.sessionId, {
      paths: [],
      tables: [],
      entities: [],
      resources: [],
      session: false,
      queryScopes: [{ kind: 'entity-detail', table: null, source: null, entity: { kind: 'ship', id: 'demo' }, resource: null }],
    });
    await ended;
    finish({});
    invalidateQueryCacheForSession(identity.sessionId);
  });
  it('keeps cached values behind the formal pending-projection query gate', async () => {
    const session = 'projection-gated';
    const loader = vi.fn(async () => []);
    const identity = { sessionId: session, queryKind: 'entity-list' as const, parameters: { kind: 'skin' as const } };
    await queryCached(identity, loader);
    markProjectionPending(session, 3);
    await expect(queryCached(identity, loader)).rejects.toMatchObject({
      action: 'query-session',
      code: 'session.projection_pending',
    });
    markProjectionReady(session, 2);
    await expect(queryCached(identity, loader)).rejects.toMatchObject({
      action: 'query-session',
      code: 'session.projection_pending',
    });
    markProjectionReady(session, 3);
    await expect(queryCached(identity, loader)).resolves.toEqual([]);
    expect(loader).toHaveBeenCalledOnce();
    invalidateQueryCacheForSession(session);
  });
  it('keeps replacement data after an invalidated request arrives late', async () => {
    const session = 'query-late';
    let resolveOld!: (value: []) => void;
    const oldLoader = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const currentLoader = vi.fn(async () => []);
    const identity = { sessionId: session, queryKind: 'csv-source-options' as const, parameters: { source: 'csv:commodities.tags' } };
    const old = queryCached(identity, oldLoader);
    const ended = expect(old).rejects.toMatchObject({ code: 'query.invalidated' });
    invalidateQueryCacheByProject(session, {
      paths: [],
      tables: ['specialItems'],
      entities: [],
      resources: [],
      session: false,
      queryScopes: [{ kind: 'csv-source-options', table: null, source: 'csv:commodities.tags', entity: null, resource: null }],
    });
    await ended;
    await expect(queryCached(identity, currentLoader)).resolves.toEqual([]);
    resolveOld([]);
    await expect(queryCached(identity, currentLoader)).resolves.toEqual([]);
    expect(currentLoader).toHaveBeenCalledOnce();
    invalidateQueryCacheForSession(session);
  });

  it('does not store a response for a closed session', async () => {
    const session = 'query-closed';
    let resolveOld!: (value: []) => void;
    const old = queryCached(
      { sessionId: session, queryKind: 'entity-list', parameters: { kind: 'ship' } },
      () =>
        new Promise<[]>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const ended = expect(old).rejects.toMatchObject({ code: 'query.invalidated' });
    invalidateQueryCacheForSession(session);
    await ended;
    resolveOld([]);
    const currentLoader = vi.fn(async () => []);
    await expect(
      queryCached({ sessionId: session, queryKind: 'entity-list', parameters: { kind: 'ship' } }, currentLoader),
    ).resolves.toEqual([]);
    expect(currentLoader).toHaveBeenCalledOnce();
    invalidateQueryCacheForSession(session);
  });
});
