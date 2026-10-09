import { describe, expect, it, vi } from 'vitest';
import type { ResourceDataUrlBatchEntry, ResourceDataUrlBatchResult, ResourceRef } from '@/shared/types';
import * as resourceCacheService from '@/services/resource-cache.service';
import { WEBVIEW_MEDIA_BUDGET_BYTES } from '@/shared/runtime/media-budget';

const { queryResourceDataUrls: queryResources } = resourceCacheService;
const { RESOURCE_DATA_URL_CACHE_CAPACITY } = resourceCacheService;

const mocks = vi.hoisted(() => ({
  queryBatch: vi.fn(async (first: string | ResourceRef[], second?: ResourceRef[]): Promise<ResourceDataUrlBatchResult> => ({
    entries: (second ?? (Array.isArray(first) ? first : [])).map(
      (resource) =>
        ({
          key: resource.key,
          source: resource.source,
          relPath: resource.relPath,
          ['owner' + 'Kind']: resource.ownerKind,
          ['owner' + 'Id']: resource.ownerId,
          dataUrl: `data:${resource.relPath}`,
        }) as unknown as ResourceDataUrlBatchEntry,
    ),
  })),
}));

vi.mock('@/shared/runtime/command.runtime', () => ({
  invokeCommand: (_command: string, args: { payload: { sessionId: string; resources: ResourceRef[] } }) =>
    mocks.queryBatch(args.payload.sessionId, args.payload.resources),
}));

describe('resource data URL cache', () => {
  it('validates the whole batch before caching any result', async () => {
    const first = resource(950),
      second = resource(951);
    mocks.queryBatch.mockResolvedValueOnce({
      entries: [
        { ...first, dataUrl: 'data:bad-batch' },
        { ...second, ownerId: 'wrong', dataUrl: null },
      ],
    });
    await expect(queryResources('atomic-resource', [first, second])).rejects.toMatchObject({ action: 'query-resource-data-urls' });
    expect(await queryResources('atomic-resource', [first])).toEqual(['data:graphics/test/950.png']);
    expect(mocks.queryBatch).toHaveBeenCalledTimes(2);
  });

  it('returns oversized content and leaves ordinary cached content retained', async () => {
    const first = resource(952),
      second = resource(953);
    await queryResources('oversized-resource', [first]);
    const oversized = 'x'.repeat(WEBVIEW_MEDIA_BUDGET_BYTES + 1);
    mocks.queryBatch.mockResolvedValueOnce({ entries: [{ ...second, dataUrl: oversized }] });
    expect((await queryResources('oversized-resource', [second]))[0]).toBe(oversized);
    expect(await queryResources('oversized-resource', [first])).toEqual(['data:graphics/test/952.png']);
    expect(await queryResources('oversized-resource', [second])).toEqual(['data:graphics/test/953.png']);
    expect(mocks.queryBatch).toHaveBeenCalledTimes(3);
  });
  it('holds 512 physical resources and refreshes LRU order on access', async () => {
    const sessionId = 'resource-cache-lru';
    const initial = Array.from({ length: RESOURCE_DATA_URL_CACHE_CAPACITY }, (_, index) => resource(index));
    await queryResources(sessionId, initial);
    await queryResources(sessionId, [initial[0]!]);
    await queryResources(sessionId, [resource(RESOURCE_DATA_URL_CACHE_CAPACITY)]);
    await queryResources(sessionId, [initial[1]!]);
    await queryResources(sessionId, [initial[0]!]);

    expect(mocks.queryBatch.mock.calls.map((call) => call[1]?.length)).toEqual([512, 1, 1]);
  });

  it('shares a cached data URL across owner metadata for one physical path', async () => {
    const sessionId = 'resource-cache-physical-key';
    const first = resource(900);
    const second = JSON.parse(JSON.stringify(first)) as ResourceRef;
    second.ownerId = 'other-owner';
    second.key = 'thumbnail';
    await queryResources(sessionId, [first]);
    const result = await queryResources(sessionId, [second]);

    expect(result).toEqual(['data:graphics/test/900.png']);
    expect(mocks.queryBatch).toHaveBeenCalledTimes(1);
  });

  it('keeps a replacement request when an invalidated request arrives late', async () => {
    const sessionId = 'resource-cache-late';
    const target = resource(901);
    let resolveOld!: (result: ResourceDataUrlBatchResult) => void;
    mocks.queryBatch.mockReturnValueOnce(
      new Promise<ResourceDataUrlBatchResult>((resolve) => {
        resolveOld = resolve;
      }),
    );
    const old = queryResources(sessionId, [target]);
    const ended = expect(old).rejects.toMatchObject({ code: 'query.invalidated' });
    resourceCacheService.invalidateResourceCacheForSession(sessionId);
    await ended;
    await queryResources(sessionId, [target]);
    resolveOld({ entries: [{ ...target, dataUrl: 'data:stale' }] });
    expect(await queryResources(sessionId, [target])).toEqual(['data:graphics/test/901.png']);
    expect(mocks.queryBatch).toHaveBeenCalledTimes(2);
  });

  it('notifies session invalidation when only media projections retain an entry', () => {
    const listener = vi.fn();
    const unsubscribe = resourceCacheService.subscribeResourceInvalidations(listener);
    resourceCacheService.invalidateResourceCacheForSession('projection-only');
    expect(listener).toHaveBeenCalledWith({ invalidation: null, resources: [], sessionId: 'projection-only', scope: 'session' });
    unsubscribe();
  });
});

function resource(index: number): ResourceRef {
  return JSON.parse(
    `{"source":"mod","relPath":"graphics/test/${index}.png","ownerKind":"ship","ownerId":"ship-${index}","key":"sprite"}`,
  ) as ResourceRef;
}
