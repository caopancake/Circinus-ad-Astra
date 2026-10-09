import { describe, expect, it, vi } from 'vitest';
import { invalidateQueryCacheByProject, invalidateQueryCacheForSession, queryCached } from '@/services/query-cache.service';
import { markProjectionPending, markProjectionReady } from '@/shared/runtime/project-projection';

describe('query pending ownership', () => {
  it('keeps cached values behind the formal pending-projection query gate', async () => {
    const session = 'projection-gated';
    const loader = vi.fn(async () => 'loaded');
    await queryCached(session, 'entity-list', { kind: 'skin' }, loader);
    markProjectionPending(session, 3);
    await expect(queryCached(session, 'entity-list', { kind: 'skin' }, loader)).rejects.toMatchObject({
      action: 'query-session',
      code: 'session.projection_pending',
    });
    markProjectionReady(session, 2);
    await expect(queryCached(session, 'entity-list', { kind: 'skin' }, loader)).rejects.toMatchObject({
      action: 'query-session',
      code: 'session.projection_pending',
    });
    markProjectionReady(session, 3);
    await expect(queryCached(session, 'entity-list', { kind: 'skin' }, loader)).resolves.toBe('loaded');
    expect(loader).toHaveBeenCalledOnce();
    invalidateQueryCacheForSession(session);
  });
  it('keeps replacement data after an invalidated request arrives late', async () => {
    const session = 'query-late';
    let resolveOld!: (value: string) => void;
    const oldLoader = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const currentLoader = vi.fn(async () => 'current');
    const old = queryCached(session, 'csv-source-options', { source: 'csv:commodities.tags' }, oldLoader);
    invalidateQueryCacheByProject(session, {
      paths: [],
      tables: ['specialItems'],
      entities: [],
      resources: [],
      session: false,
      queryScopes: [{ kind: 'csv-source-options', table: null, source: 'csv:commodities.tags', entity: null, resource: null }],
    });
    await expect(queryCached(session, 'csv-source-options', { source: 'csv:commodities.tags' }, currentLoader)).resolves.toBe('current');
    resolveOld('stale');
    await old;
    await expect(queryCached(session, 'csv-source-options', { source: 'csv:commodities.tags' }, currentLoader)).resolves.toBe('current');
    expect(currentLoader).toHaveBeenCalledOnce();
    invalidateQueryCacheForSession(session);
  });

  it('does not store a response for a closed session', async () => {
    const session = 'query-closed';
    let resolveOld!: (value: string) => void;
    const old = queryCached(
      session,
      'entity-list',
      { kind: 'ship' },
      () =>
        new Promise<string>((resolve) => {
          resolveOld = resolve;
        }),
    );
    invalidateQueryCacheForSession(session);
    resolveOld('stale');
    await old;
    const currentLoader = vi.fn(async () => 'current');
    await expect(queryCached(session, 'entity-list', { kind: 'ship' }, currentLoader)).resolves.toBe('current');
    expect(currentLoader).toHaveBeenCalledOnce();
    invalidateQueryCacheForSession(session);
  });
});
