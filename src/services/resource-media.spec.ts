import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceCacheInvalidationEvent } from '@/services/resource-cache.service';
import type { ResourceRef } from '@/shared/types';
import { ensureResourceMedia, RESOURCE_MEDIA_CACHE_CAPACITY, resourceMediaDataUrl } from '@/services/resource-media.service';
import { WEBVIEW_MEDIA_BUDGET_BYTES } from '@/shared/runtime/media-budget';

const mocks = vi.hoisted(() => ({
  invalidationListener: null as ((event: ResourceCacheInvalidationEvent) => void) | null,
  query: vi.fn(async (_sessionId: string, resources: ResourceRef[]) => resources.map((resource) => `data:${resource.relPath}`)),
  recordPerformance: vi.fn(),
}));

vi.mock('@/services/resource-cache.service', () => ({
  queryResourceDataUrls: mocks.query,
  resourceCacheKey: (sessionId: string, resource: ResourceRef) => JSON.stringify([sessionId, resource.source, resource.relPath]),
  subscribeResourceInvalidations: (listener: (event: ResourceCacheInvalidationEvent) => void) => {
    mocks.invalidationListener = listener;
    return () => undefined;
  },
}));

vi.mock('@/shared/runtime/performance', () => ({ recordPerformance: mocks.recordPerformance }));

describe('resource media service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it('returns oversized content as consumer-owned temporary data', async () => {
    const target = resource(990);
    const oversized = 'x'.repeat(WEBVIEW_MEDIA_BUDGET_BYTES + 1);
    mocks.query.mockResolvedValueOnce([oversized]);
    const loading = ensureResourceMedia('oversized', [target], 'test');
    await vi.runAllTimersAsync();
    const result = await loading;
    expect(result.resolved).toBe(1);
    expect(result.uncachedDataUrls.get(JSON.stringify(['oversized', 'mod', target.relPath]))).toBe(oversized);
    expect(resourceMediaDataUrl('oversized', target)).toBeUndefined();
  });

  it('batches overlapping requests and keeps sessions isolated', async () => {
    const first = ensureResourceMedia('session-a', [resource(0), resource(1)], 'test');
    const second = ensureResourceMedia('session-a', [resource(1), resource(2)], 'test');
    const third = ensureResourceMedia('session-b', [resource(0)], 'test');
    await vi.runAllTimersAsync();
    await Promise.all([first, second, third]);

    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls.map((call) => [call[0], call[1].length])).toEqual([
      ['session-a', 3],
      ['session-b', 1],
    ]);
  });

  it('holds 512 entries, evicts the oldest, and refreshes access order', async () => {
    const initial = Array.from({ length: RESOURCE_MEDIA_CACHE_CAPACITY }, (_, index) => resource(index));
    const loading = ensureResourceMedia('lru-session', initial, 'test');
    await vi.runAllTimersAsync();
    await loading;

    expect(resourceMediaDataUrl('lru-session', initial[0])).toBe('data:graphics/test/000.png');
    const overflow = ensureResourceMedia('lru-session', [resource(RESOURCE_MEDIA_CACHE_CAPACITY)], 'test');
    await vi.runAllTimersAsync();
    await overflow;

    expect(resourceMediaDataUrl('lru-session', initial[0])).toBe('data:graphics/test/000.png');
    expect(resourceMediaDataUrl('lru-session', initial[1])).toBeUndefined();
    expect(resourceMediaDataUrl('lru-session', resource(RESOURCE_MEDIA_CACHE_CAPACITY))).toBe('data:graphics/test/512.png');
  });

  it('clears invalidated resources and queries them again', async () => {
    const target = resource(700);
    const first = ensureResourceMedia('invalidate-session', [target], 'test');
    await vi.runAllTimersAsync();
    await first;
    mocks.invalidationListener?.({
      invalidation: null,
      resources: [target],
      sessionId: 'invalidate-session',
      scope: 'resources',
    });

    const second = ensureResourceMedia('invalidate-session', [target], 'test');
    await vi.runAllTimersAsync();
    await second;
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('releases queued requests when their session closes before the flush', async () => {
    const target = resource(801);
    const queued = ensureResourceMedia('queued-close', [target], 'test');
    const ended = expect(queued).rejects.toMatchObject({ code: 'query.invalidated' });
    mocks.invalidationListener?.({ invalidation: null, resources: [], sessionId: 'queued-close', scope: 'session' });
    await ended;
    await vi.runAllTimersAsync();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(resourceMediaDataUrl('queued-close', target)).toBeUndefined();
  });

  it('releases in-flight requests and keeps replacement results when the old request arrives', async () => {
    const target = resource(802);
    let finishOld!: (value: string[]) => void;
    mocks.query.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        finishOld = resolve;
      }),
    );
    const old = ensureResourceMedia('inflight-close', [target], 'test');
    const ended = expect(old).rejects.toMatchObject({ code: 'query.invalidated' });
    await vi.advanceTimersByTimeAsync(25);
    mocks.invalidationListener?.({ invalidation: null, resources: [target], sessionId: 'inflight-close', scope: 'resources' });
    await ended;
    const current = ensureResourceMedia('inflight-close', [target], 'test');
    await vi.advanceTimersByTimeAsync(25);
    await current;
    finishOld(['data:stale']);
    await vi.runAllTimersAsync();
    expect(resourceMediaDataUrl('inflight-close', target)).toBe('data:graphics/test/802.png');
  });
});

function resource(index: number): ResourceRef {
  return JSON.parse(
    `{"source":"mod","relPath":"graphics/test/${index.toString().padStart(3, '0')}.png","ownerKind":"ship","ownerId":"ship-${index}","key":"sprite"}`,
  ) as ResourceRef;
}
