import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { useSchemaSelectMedia } from './use-schema-select-media';
import type { ResourceRef } from '@/shared/types';
import type { ResourceCacheInvalidationEvent } from '@/services/resource-cache.service';

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  error: vi.fn(),
  stop: vi.fn(),
  invalidated: null as ((event: ResourceCacheInvalidationEvent) => void) | null,
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
vi.mock('@/services/resource-media.service', () => ({ ensureResourceMedia: mocks.ensure, resourceMediaDataUrl: () => undefined }));
vi.mock('@/services/resource-cache.service', () => ({
  resourceCacheKey: (session: string, resource: ResourceRef) => JSON.stringify([session, resource.source, resource.relPath]),
  subscribeResourceInvalidations: (listener: (event: ResourceCacheInvalidationEvent) => void) => {
    mocks.invalidated = listener;
    return mocks.stop;
  },
}));

describe('selected resource projection', () => {
  it('reloads visible temporary content after resource invalidation and releases it on close', async () => {
    const resource: ResourceRef = { source: 'mod', relPath: 'graphics/a.png', key: 'icon', ownerKind: 'weapon', ownerId: 'a' };
    const key = JSON.stringify(['a', 'mod', resource.relPath]);
    mocks.ensure.mockResolvedValue({ uncachedDataUrls: new Map([[key, 'data:old']]) });
    let media!: ReturnType<typeof useSchemaSelectMedia>;
    const wrapper = mount(
      defineComponent({
        setup() {
          media = useSchemaSelectMedia();
          return () => h('img', { src: media.schemaSelectSprite('a', resource) });
        },
      }),
    );
    await media.ensureSchemaSelectSprites('a', [resource]);
    await flushPromises();
    expect(wrapper.attributes('src')).toBe('data:old');
    mocks.ensure.mockResolvedValue({ uncachedDataUrls: new Map([[key, 'data:new']]) });
    mocks.invalidated!({ sessionId: 'a', scope: 'resources', resources: [resource], invalidation: null });
    await flushPromises();
    expect(wrapper.attributes('src')).toBe('data:new');
    expect(mocks.ensure).toHaveBeenCalledTimes(2);
    media.releaseSchemaSelectSprites('a', []);
    await flushPromises();
    expect(wrapper.attributes('src')).toBeUndefined();
    mocks.invalidated!({ sessionId: 'a', scope: 'session', resources: [], invalidation: null });
    await flushPromises();
    expect(mocks.ensure).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
});
