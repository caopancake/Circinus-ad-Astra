import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useResourceMediaRegistry } from './use-resource-media-registry';
import type { ResourceRef } from '@/shared/types';
import type { ResourceCacheInvalidationEvent } from '@/services/resource-cache.service';

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  key: vi.fn((session: string, resource: ResourceRef) => JSON.stringify([session, resource.source, resource.relPath])),
  invalidation: null as ((event: ResourceCacheInvalidationEvent) => void) | null,
  error: vi.fn(),
  failures: vi.fn(),
}));
vi.mock('@/services/resource-cache.service', () => ({ resourceCacheKey: mocks.key }));
vi.mock('@/services/resource-media.service', () => ({
  ensureResourceMedia: mocks.ensure,
  resourceMediaDataUrl: () => undefined,
  subscribeResourceMediaInvalidations: (listener: (event: ResourceCacheInvalidationEvent) => void) => {
    mocks.invalidation = listener;
    return () => {
      mocks.invalidation = null;
    };
  },
}));

function resource(id: number): ResourceRef {
  return { source: 'mod', relPath: `graphics/${id}.png`, ownerKind: 'ship', ownerId: String(id), key: 'sprite' };
}

function harness() {
  let registry!: ReturnType<typeof useResourceMediaRegistry>;
  const wrapper = mount(
    defineComponent({
      setup() {
        registry = useResourceMediaRegistry({ surface: 'test', onError: mocks.error, onFailures: mocks.failures });
        return () => h('div');
      },
    }),
  );
  return { registry, wrapper };
}

describe('media collection ownership', () => {
  beforeEach(() => {
    mocks.error.mockReset();
    mocks.failures.mockReset();
    mocks.key.mockClear();
    mocks.ensure.mockReset().mockImplementation(async (session: string, resources: ResourceRef[]) => ({
      failedResources: [],
      uncachedDataUrls: new Map(resources.map((ref) => [JSON.stringify([session, ref.source, ref.relPath]), `data:${ref.relPath}`])),
    }));
  });

  it('registers 1000 rows in one linear batch and updates one row independently', async () => {
    const { registry, wrapper } = harness();
    const loading = registry.replaceCollections(
      'a',
      Array.from({ length: 1000 }, (_, id) => ({ id: `row:${id}`, resources: [resource(id)] })),
    );
    expect(mocks.key).toHaveBeenCalledTimes(1000);
    expect(mocks.ensure).toHaveBeenCalledOnce();
    await loading;
    mocks.key.mockClear();
    const replacing = registry.replaceCollection('a', 'row:500', [resource(1001)]);
    expect(mocks.key).toHaveBeenCalledOnce();
    await replacing;
    expect(registry.dataUrl('a', resource(500))).toBeUndefined();
    expect(registry.dataUrl('a', resource(499))).toBe('data:graphics/499.png');
    expect(registry.dataUrl('a', resource(1001))).toBe('data:graphics/1001.png');
    wrapper.unmount();
  });

  it('retains shared selected content while independent menus close', async () => {
    const { registry, wrapper } = harness();
    await registry.replaceCollection('a', 'selected', [resource(1)]);
    await registry.replaceCollection('a', 'menu:1', [resource(1), resource(2)]);
    await registry.replaceCollection('a', 'menu:2', [resource(2), resource(3)]);
    expect(mocks.ensure).toHaveBeenCalledTimes(3);
    await registry.releaseCollection('menu:1');
    expect(registry.dataUrl('a', resource(1))).toBe('data:graphics/1.png');
    expect(registry.dataUrl('a', resource(2))).toBe('data:graphics/2.png');
    await registry.releaseCollection('menu:2');
    expect(registry.dataUrl('a', resource(2))).toBeUndefined();
    expect(registry.dataUrl('a', resource(1))).toBe('data:graphics/1.png');
    wrapper.unmount();
    expect(registry.dataUrl('a', resource(1))).toBeUndefined();
  });

  it('suppresses late failures after the last reference is released', async () => {
    let reject!: (error: unknown) => void;
    mocks.ensure.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const { registry, wrapper } = harness();
    const loading = registry.replaceCollection('a', 'menu', [resource(1)]);
    await registry.releaseCollection('menu');
    await loading;
    reject(new Error('late'));
    await flushPromises();
    expect(mocks.error).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('replaces invalidated results and releases the closed session', async () => {
    const { registry, wrapper } = harness();
    await registry.replaceCollection('a', 'selected', [resource(1)]);
    mocks.ensure.mockResolvedValueOnce({
      failedResources: [],
      uncachedDataUrls: new Map([[JSON.stringify(['a', 'mod', 'graphics/1.png']), 'data:new']]),
    });
    mocks.invalidation!({ sessionId: 'a', scope: 'resources', resources: [resource(1)], invalidation: null });
    await flushPromises();
    expect(registry.dataUrl('a', resource(1))).toBe('data:new');
    mocks.invalidation!({ sessionId: 'a', scope: 'session', resources: [], invalidation: null });
    expect(registry.dataUrl('a', resource(1))).toBeUndefined();
    await registry.replaceCollection('b', 'selected', [resource(1)]);
    expect(registry.dataUrl('b', resource(1))).toBe('data:graphics/1.png');
    wrapper.unmount();
  });
});
