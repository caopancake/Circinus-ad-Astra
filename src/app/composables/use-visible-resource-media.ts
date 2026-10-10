import { nextTick, onUnmounted, watch, type ComponentPublicInstance } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useResourceMediaRegistry, type MediaCollectionChange } from '@/app/composables/use-resource-media-registry';
import { sameResourceRef } from '@/shared/lib/resource-ref';
import type { ResourceRef } from '@/shared/types';
import { recordPerformance } from '@/shared/runtime/performance';
import { warningNotice } from '@/shared/lib/errors';

interface RegisteredMedia {
  id: string;
  element: Element | null;
  resource: ResourceRef | null;
  visible: boolean;
}

export function useVisibleResourceMedia(args: { sessionId: () => string | null | undefined; surface: string; failureLabel: string }) {
  const feedback = useAppFeedback();
  const registry = useResourceMediaRegistry({
    surface: args.surface,
    onError: (error) => feedback.error(error, args.failureLabel),
    onFailures: (resources) =>
      feedback.warning(
        warningNotice(
          `${args.failureLabel}：${resources.length} 个资源读取失败`,
          'resource.read_failed',
          `Resource read failed: count=${resources.length}; surface=${args.surface}`,
        ),
      ),
  });
  const registered = new Map<string, RegisteredMedia>();
  const elementEntries = new Map<Element, RegisteredMedia>();
  const callbacks = new Map<string, (element: Element | ComponentPublicInstance | null) => void>();
  let root: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let rootHeight = -1;
  let disposed = false;
  let firstFrameRequestId = 0;

  function setMediaRoot(element: Element | ComponentPublicInstance | null): void {
    const nextRoot = element instanceof HTMLElement ? element : null;
    if (root === nextRoot) return;
    resizeObserver?.disconnect();
    root = nextRoot;
    rootHeight = -1;
    if (root) {
      resizeObserver = new ResizeObserver(() => rebuildObserverWhenHeightChanges());
      resizeObserver.observe(root);
    }
    rebuildObserver();
  }

  function mediaRef(id: string, resource: ResourceRef | null | undefined) {
    const current = registered.get(id) ?? { id, element: null, resource: null, visible: false };
    const changed = current.resource ? !resource || !sameResourceRef(current.resource, resource) : Boolean(resource);
    current.resource = resource ?? null;
    registered.set(id, current);
    if (changed && current.visible) void registry.replaceCollection(args.sessionId(), id, current.resource ? [current.resource] : []);
    let callback = callbacks.get(id);
    if (!callback) {
      callback = (element) => registerElement(id, element);
      callbacks.set(id, callback);
    }
    return callback;
  }

  function mediaSrc(resource: ResourceRef | null | undefined): string {
    return registry.dataUrl(args.sessionId(), resource) ?? '';
  }

  async function recordListFirstFrame(startedAt: number, entities: number): Promise<void> {
    if (startedAt <= 0) return;
    const requestId = ++firstFrameRequestId;
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (disposed || requestId !== firstFrameRequestId) return;
    const observedImages = [...registered.values()].filter((entry) => entry.visible && entry.resource).length;
    recordPerformance('frontend.config.listFirstFrame', performance.now() - startedAt, {
      surface: args.surface,
      entities,
      observedImages,
    });
  }

  function registerElement(id: string, element: Element | ComponentPublicInstance | null): void {
    const entry = registered.get(id);
    if (!entry) return;
    const nextElement = element instanceof Element ? element : null;
    if (entry.element === nextElement) return;
    if (entry.element) {
      observer?.unobserve(entry.element);
      elementEntries.delete(entry.element);
    }
    if (entry.visible) void registry.releaseCollection(id);
    entry.element = nextElement;
    entry.visible = false;
    if (nextElement) {
      elementEntries.set(nextElement, entry);
      observer?.observe(nextElement);
    } else {
      registered.delete(id);
      callbacks.delete(id);
    }
  }

  function rebuildObserverWhenHeightChanges(): void {
    const nextHeight = root?.clientHeight ?? 0;
    if (nextHeight === rootHeight) return;
    rebuildObserver();
  }

  function rebuildObserver(): void {
    observer?.disconnect();
    observer = null;
    registry.clear();
    rootHeight = root?.clientHeight ?? 0;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver(handleIntersections, {
      root,
      rootMargin: `${rootHeight}px 0px ${rootHeight}px 0px`,
      threshold: 0,
    });
    for (const entry of registered.values()) {
      entry.visible = false;
      if (entry.element) observer.observe(entry.element);
    }
  }

  function handleIntersections(entries: IntersectionObserverEntry[]): void {
    const changes: MediaCollectionChange[] = [];
    for (const observed of entries) {
      const entry = elementEntries.get(observed.target);
      if (!entry || entry.visible === observed.isIntersecting) continue;
      entry.visible = observed.isIntersecting;
      changes.push({ id: entry.id, resources: entry.visible && entry.resource ? [entry.resource] : [] });
    }
    if (changes.length) void registry.replaceCollections(args.sessionId(), changes);
  }

  watch(() => args.sessionId(), rebuildObserver);

  onUnmounted(() => {
    disposed = true;
    observer?.disconnect();
    resizeObserver?.disconnect();
    registered.clear();
    elementEntries.clear();
    callbacks.clear();
  });

  return { mediaRef, mediaSrc, recordListFirstFrame, setMediaRoot };
}
