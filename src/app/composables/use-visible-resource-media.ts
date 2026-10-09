import { nextTick, onUnmounted, shallowReactive, watch, type ComponentPublicInstance } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { ensureResourceMedia, resourceMediaDataUrl, subscribeResourceMediaInvalidations } from '@/services/resource-media.service';
import { resourceCacheKey } from '@/services/resource-cache.service';
import { sameResourceRef } from '@/shared/lib/resource-ref';
import type { ResourceRef } from '@/shared/types';
import { recordPerformance } from '@/shared/runtime/performance';
import { warningNotice } from '@/shared/lib/errors';
import { isReadInvalidated } from '@/shared/runtime/read-request';

interface RegisteredMedia {
  element: Element | null;
  resource: ResourceRef | null;
  visible: boolean;
}

export function useVisibleResourceMedia(args: { sessionId: () => string | null | undefined; surface: string; failureLabel: string }) {
  const feedback = useAppFeedback();
  const registered = new Map<string, RegisteredMedia>();
  const elementEntries = new Map<Element, RegisteredMedia>();
  const callbacks = new Map<string, (element: Element | ComponentPublicInstance | null) => void>();
  const reportedFailures = new Set<string>();
  const uncached = shallowReactive(new Map<string, string>());
  const reads = new Map<AbortController, string[]>();
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
    const current = registered.get(id) ?? { element: null, resource: null, visible: false };
    const previousResource = current.resource;
    const resourceChanged =
      current.resource === null
        ? resource !== null && resource !== undefined
        : resource === null || resource === undefined || !sameResourceRef(current.resource, resource);
    current.resource = resource ?? null;
    registered.set(id, current);
    if (resourceChanged && current.visible && previousResource) releaseResourceIfHidden(previousResource);
    if (resourceChanged && current.visible && current.resource) void ensureVisible([current.resource]);
    let callback = callbacks.get(id);
    if (!callback) {
      callback = (element) => registerElement(id, element);
      callbacks.set(id, callback);
    }
    return callback;
  }

  function mediaSrc(resource: ResourceRef | null | undefined): string {
    const sessionId = args.sessionId();
    return (
      (sessionId && resource ? uncached.get(resourceCacheKey(sessionId, resource)) : undefined) ??
      resourceMediaDataUrl(sessionId, resource) ??
      ''
    );
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
    const wasVisible = entry.visible;
    entry.element = nextElement;
    entry.visible = false;
    if (wasVisible && entry.resource) releaseResourceIfHidden(entry.resource);
    if (entry.element) {
      elementEntries.set(entry.element, entry);
      observer?.observe(entry.element);
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
    releaseResourcesIfHidden([...registered.values()].flatMap((entry) => (!entry.visible && entry.resource ? [entry.resource] : [])));
  }

  function handleIntersections(entries: IntersectionObserverEntry[]): void {
    const newlyVisible: ResourceRef[] = [];
    for (const observed of entries) {
      const entry = elementEntries.get(observed.target);
      if (!entry) continue;
      entry.visible = observed.isIntersecting;
      if (entry.visible && entry.resource) newlyVisible.push(entry.resource);
    }
    const hiddenResources: ResourceRef[] = [];
    for (const observed of entries) {
      const entry = elementEntries.get(observed.target);
      if (entry && !entry.visible && entry.resource) hiddenResources.push(entry.resource);
    }
    releaseResourcesIfHidden(hiddenResources);
    if (newlyVisible.length > 0) void ensureVisible(newlyVisible);
  }

  async function ensureVisible(resources: ResourceRef[]): Promise<void> {
    const sessionId = args.sessionId();
    if (!sessionId || disposed) return;
    const controller = new AbortController();
    reads.set(
      controller,
      resources.map((resource) => resourceCacheKey(sessionId, resource)),
    );
    try {
      const result = await ensureResourceMedia(sessionId, resources, args.surface, controller.signal);
      if (disposed || controller.signal.aborted || sessionId !== args.sessionId()) return;
      for (const [key, value] of result.uncachedDataUrls) if (visibleKeys().has(key)) uncached.set(key, value);
      const newFailures = result.failedResources.filter((resource) => {
        const key = resourceCacheKey(sessionId, resource);
        if (reportedFailures.has(key)) return false;
        reportedFailures.add(key);
        return true;
      });
      if (newFailures.length > 0)
        feedback.warning(
          warningNotice(
            `${args.failureLabel}：${newFailures.length} 个资源读取失败`,
            'resource.read_failed',
            `Resource read failed: count=${newFailures.length}; surface=${args.surface}`,
          ),
        );
    } catch (error) {
      if (disposed || controller.signal.aborted || sessionId !== args.sessionId() || isReadInvalidated(error)) return;
      const firstUnreported = resources.find((resource) => {
        const key = resourceCacheKey(sessionId, resource);
        if (reportedFailures.has(key)) return false;
        reportedFailures.add(key);
        return true;
      });
      if (firstUnreported) feedback.error(error, args.failureLabel);
    } finally {
      reads.delete(controller);
    }
  }

  function visibleKeys(): Set<string> {
    const sessionId = args.sessionId();
    return new Set(
      [...registered.values()].flatMap((entry) =>
        sessionId && entry.visible && entry.resource ? [resourceCacheKey(sessionId, entry.resource)] : [],
      ),
    );
  }

  function releaseResourceIfHidden(resource: ResourceRef) {
    releaseResourcesIfHidden([resource]);
  }

  function releaseResourcesIfHidden(resources: readonly ResourceRef[]) {
    const sessionId = args.sessionId();
    if (!sessionId) return;
    const visible = visibleKeys();
    const keys = new Set(resources.map((resource) => resourceCacheKey(sessionId, resource)));
    for (const key of keys) {
      if (visible.has(key)) continue;
      uncached.delete(key);
      for (const [controller, readKeys] of reads)
        if (readKeys.includes(key) && !readKeys.some((readKey) => visible.has(readKey))) {
          controller.abort();
          reads.delete(controller);
        }
    }
  }

  const stopInvalidation = subscribeResourceMediaInvalidations((event) => {
    if (event.sessionId !== args.sessionId()) return;
    if (event.scope === 'session') {
      for (const controller of reads.keys()) controller.abort();
      reads.clear();
      uncached.clear();
      return;
    }
    for (const key of uncached.keys())
      if (
        event.invalidation?.session ||
        [...event.resources, ...(event.invalidation?.resources ?? [])].some(
          (resource) => resourceCacheKey(event.sessionId, resource) === key,
        )
      )
        uncached.delete(key);
    const affected = [...registered.values()].flatMap((entry) => {
      if (!entry.visible || !entry.resource) return [];
      if (
        !event.invalidation?.session &&
        ![...event.resources, ...(event.invalidation?.resources ?? [])].some(
          (resource) => resourceCacheKey(event.sessionId, resource) === resourceCacheKey(event.sessionId, entry.resource!),
        )
      )
        return [];
      reportedFailures.delete(resourceCacheKey(event.sessionId, entry.resource));
      return [entry.resource];
    });
    if (affected.length > 0) void ensureVisible(affected);
  });

  watch(
    () => args.sessionId(),
    () => {
      reportedFailures.clear();
      for (const controller of reads.keys()) controller.abort();
      reads.clear();
      uncached.clear();
      rebuildObserver();
    },
  );

  onUnmounted(() => {
    disposed = true;
    for (const controller of reads.keys()) controller.abort();
    reads.clear();
    uncached.clear();
    observer?.disconnect();
    resizeObserver?.disconnect();
    stopInvalidation();
    registered.clear();
    elementEntries.clear();
    callbacks.clear();
    reportedFailures.clear();
  });

  return { mediaRef, mediaSrc, recordListFirstFrame, setMediaRoot };
}
