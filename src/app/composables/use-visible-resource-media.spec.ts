import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceCacheInvalidationEvent } from '@/services/resource-cache.service';
import type { ResourceRef } from '@/shared/types';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  error: vi.fn(),
  invalidationListener: null as ((event: ResourceCacheInvalidationEvent) => void) | null,
  stopInvalidation: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({ error: mocks.error, warning: mocks.warning }),
}));

vi.mock('@/services/resource-media.service', () => ({
  ensureResourceMedia: mocks.ensure,
  resourceMediaDataUrl: () => undefined,
  subscribeResourceMediaInvalidations: (listener: (event: ResourceCacheInvalidationEvent) => void) => {
    mocks.invalidationListener = listener;
    return mocks.stopInvalidation;
  },
}));

vi.mock('@/services/resource-cache.service', () => ({
  resourceCacheKey: (sessionId: string, resource: ResourceRef) => JSON.stringify([sessionId, resource.source, resource.relPath]),
}));

vi.mock('@/shared/runtime/performance', () => ({ recordPerformance: vi.fn() }));

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    TestIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.add(element);
  }

  unobserve(element: Element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }

  trigger(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe('useVisibleResourceMedia', () => {
  beforeEach(() => {
    TestIntersectionObserver.instances = [];
    TestResizeObserver.instances = [];
    mocks.ensure.mockReset().mockResolvedValue({
      observed: 0,
      requested: 0,
      cacheHits: 0,
      resolved: 0,
      failed: 0,
      failedResources: [],
      uncachedDataUrls: new Map(),
    });
    mocks.error.mockReset();
    mocks.warning.mockReset();
    mocks.stopInvalidation.mockReset();
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240);
  });

  it('uses the scroll container and makes zero requests for offscreen rows', () => {
    const wrapper = mountHarness();
    const observer = activeObserver();

    expect(observer.options?.root).toBe(wrapper.get('[data-root]').element);
    expect(observer.options?.rootMargin).toBe('240px 0px 240px 0px');
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('merges rows from one observer callback into one visible ensure', async () => {
    const wrapper = mountHarness();
    const rows = wrapper.findAll('[data-row]');
    activeObserver().trigger(rows.map((row) => ({ target: row.element, isIntersecting: true })));
    await Promise.resolve();

    expect(mocks.ensure).toHaveBeenCalledTimes(1);
    expect(mocks.ensure.mock.calls[0]![0]).toBe('session-a');
    expect(mocks.ensure.mock.calls[0]![1]).toEqual([resource(1), resource(2)]);
  });

  it('handles rapid visibility changes and repeated visibility without losing resources', async () => {
    const wrapper = mountHarness();
    const rows = wrapper.findAll('[data-row]');
    const observer = activeObserver();
    observer.trigger([{ target: rows[0]!.element, isIntersecting: true }]);
    observer.trigger([{ target: rows[0]!.element, isIntersecting: false }]);
    observer.trigger([{ target: rows[1]!.element, isIntersecting: true }]);
    observer.trigger([{ target: rows[1]!.element, isIntersecting: true }]);
    await Promise.resolve();

    expect(mocks.ensure.mock.calls.map((call) => call[1])).toEqual([[resource(1)], [resource(2)]]);
  });

  it('rebuilds the observer when the scroll container height changes', () => {
    mountHarness();
    const first = activeObserver();
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
    TestResizeObserver.instances[TestResizeObserver.instances.length - 1]!.trigger();
    const second = activeObserver();

    expect(first.disconnected).toBe(true);
    expect(second.options?.rootMargin).toBe('480px 0px 480px 0px');
  });

  it('re-ensures visible resources after invalidation and uses the new session', async () => {
    const wrapper = mountHarness();
    const row = wrapper.findAll('[data-row]')[0]!.element;
    activeObserver().trigger([{ target: row, isIntersecting: true }]);
    await Promise.resolve();
    mocks.invalidationListener?.({ invalidation: null, resources: [resource(1)], sessionId: 'session-a', scope: 'resources' });
    await Promise.resolve();
    await wrapper.setProps({ session: 'session-b' });
    activeObserver().trigger([{ target: row, isIntersecting: true }]);
    await Promise.resolve();

    expect(mocks.ensure.mock.calls.map((call) => call[0])).toEqual(['session-a', 'session-a', 'session-b']);
  });

  it('reports each failed resource once and releases observers and subscriptions', async () => {
    mocks.ensure.mockResolvedValue({
      observed: 1,
      requested: 1,
      cacheHits: 0,
      resolved: 0,
      failed: 1,
      failedResources: [resource(1)],
      uncachedDataUrls: new Map(),
    });
    const wrapper = mountHarness();
    const row = wrapper.findAll('[data-row]')[0]!.element;
    activeObserver().trigger([{ target: row, isIntersecting: true }]);
    await Promise.resolve();
    activeObserver().trigger([{ target: row, isIntersecting: true }]);
    await Promise.resolve();

    await flushPromises();
    expect(mocks.warning).toHaveBeenCalledTimes(1);
    const observer = activeObserver();
    const resizeObserver = TestResizeObserver.instances[TestResizeObserver.instances.length - 1]!;
    wrapper.unmount();
    expect(observer.disconnected).toBe(true);
    expect(resizeObserver.disconnected).toBe(true);
    expect(mocks.stopInvalidation).toHaveBeenCalledTimes(1);
  });

  it('holds uncached content only while its resource remains visible', async () => {
    mocks.ensure.mockResolvedValue({
      observed: 1,
      requested: 1,
      cacheHits: 0,
      resolved: 1,
      failed: 0,
      failedResources: [],
      uncachedDataUrls: new Map([[JSON.stringify(['session-a', 'mod', 'graphics/test/1.png']), 'data:temporary']]),
    });
    const wrapper = mountHarness();
    const row = wrapper.findAll('[data-row]')[0]!.element;
    activeObserver().trigger([{ target: row, isIntersecting: true }]);
    await flushPromises();
    expect(wrapper.get('[data-src]').attributes('data-src')).toBe('data:temporary');
    activeObserver().trigger([{ target: row, isIntersecting: false }]);
    await flushPromises();
    expect(wrapper.get('[data-src]').attributes('data-src')).toBe('');
    wrapper.unmount();
  });

  it('ends a session cleanup without initiating a replacement read', async () => {
    const wrapper = mountHarness();
    const row = wrapper.findAll('[data-row]')[0]!.element;
    activeObserver().trigger([{ target: row, isIntersecting: true }]);
    await flushPromises();
    mocks.invalidationListener?.({ invalidation: null, resources: [], sessionId: 'session-a', scope: 'session' });
    await flushPromises();
    expect(mocks.ensure).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it('releases a hidden consumer and suppresses its late diagnostics', async () => {
    let fail!: (error: unknown) => void;
    mocks.ensure.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const wrapper = mountHarness();
    const row = wrapper.findAll('[data-row]')[0]!.element;
    activeObserver().trigger([{ target: row, isIntersecting: true }]);
    activeObserver().trigger([{ target: row, isIntersecting: false }]);
    fail(new Error('late failure'));
    await flushPromises();
    expect(mocks.error).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

function mountHarness() {
  return mount(
    defineComponent({
      props: { session: { type: String, default: 'session-a' } },
      setup(props) {
        const media = useVisibleResourceMedia({ sessionId: () => props.session, surface: 'test-list', failureLabel: '读取失败' });
        return () =>
          h('div', { ref: media.setMediaRoot, 'data-root': '' }, [
            h('div', { ref: media.mediaRef('row-1', resource(1)), 'data-row': '1' }),
            h('div', { ref: media.mediaRef('row-2', resource(2)), 'data-row': '2' }),
            h('span', { 'data-src': media.mediaSrc(resource(1)) }),
          ]);
      },
    }),
  );
}

function activeObserver(): TestIntersectionObserver {
  return TestIntersectionObserver.instances[TestIntersectionObserver.instances.length - 1]!;
}

function resource(index: number): ResourceRef {
  return JSON.parse(
    `{"source":"mod","relPath":"graphics/test/${index}.png","ownerKind":"ship","ownerId":"ship-${index}","key":"sprite"}`,
  ) as ResourceRef;
}
