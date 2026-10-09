import { ensureResourceMedia, resourceMediaDataUrl } from '@/services/resource-media.service';
import { onUnmounted, shallowReactive } from 'vue';
import { resourceCacheKey, subscribeResourceInvalidations } from '@/services/resource-cache.service';
import { isReadInvalidated } from '@/shared/runtime/read-request';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { ResourceRef } from '@/shared/types';

export function useSchemaSelectMedia() {
  const temporary = shallowReactive(new Map<string, string>());
  const feedback = useAppFeedback();
  let currentSession: string | null = null;
  const activeResources = new Map<string, ResourceRef>();
  const requests = new Map<AbortController, Set<string>>();
  let disposed = false;
  const stopInvalidation = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== currentSession) return;
    if (event.scope === 'session') {
      for (const request of requests.keys()) request.abort();
      requests.clear();
      temporary.clear();
      activeResources.clear();
      return;
    }
    const scopes = [...event.resources, ...(event.invalidation?.resources ?? [])];
    for (const key of temporary.keys())
      if (event.invalidation?.session || scopes.some((ref) => resourceCacheKey(event.sessionId, ref) === key)) temporary.delete(key);
    if (
      event.invalidation?.session ||
      [...activeResources.values()].some((resource) =>
        scopes.some((scope) => resourceCacheKey(event.sessionId, scope) === resourceCacheKey(event.sessionId, resource)),
      )
    )
      void ensureSchemaSelectSprites(event.sessionId, [...activeResources.values()]);
  });
  onUnmounted(() => {
    disposed = true;
    for (const request of requests.keys()) request.abort();
    requests.clear();
    activeResources.clear();
    temporary.clear();
    stopInvalidation();
  });

  function releaseSchemaSelectSprites(sessionId: string | null | undefined, resources: ResourceRef[]) {
    currentSession = sessionId ?? null;
    const keys = new Set(sessionId ? resources.map((resource) => resourceCacheKey(sessionId, resource)) : []);
    for (const key of activeResources.keys()) if (!keys.has(key)) activeResources.delete(key);
    for (const key of temporary.keys()) if (!keys.has(key)) temporary.delete(key);
    for (const [request, requestKeys] of requests)
      if (![...requestKeys].some((key) => activeResources.has(key))) {
        request.abort();
        requests.delete(request);
      }
  }

  async function ensureSchemaSelectSprites(sessionId: string, resources: ResourceRef[]): Promise<void> {
    const request = new AbortController();
    currentSession = sessionId;
    const keys = new Set(resources.map((resource) => resourceCacheKey(sessionId, resource)));
    for (const resource of resources) activeResources.set(resourceCacheKey(sessionId, resource), resource);
    requests.set(request, keys);
    try {
      const result = await ensureResourceMedia(sessionId, resources, 'schema-select', request.signal);
      if (disposed || request.signal.aborted) return;
      for (const key of temporary.keys()) if (!activeResources.has(key)) temporary.delete(key);
      for (const [key, value] of result.uncachedDataUrls) temporary.set(key, value);
    } catch (error) {
      if (!disposed && !request.signal.aborted && !isReadInvalidated(error)) feedback.error(error, '读取选项贴图失败');
    } finally {
      requests.delete(request);
    }
  }

  return {
    schemaSelectSprite: (sessionId: string | null | undefined, resource: ResourceRef | null | undefined) =>
      (sessionId && resource ? temporary.get(resourceCacheKey(sessionId, resource)) : undefined) ??
      resourceMediaDataUrl(sessionId, resource),
    ensureSchemaSelectSprites,
    releaseSchemaSelectSprites,
  };
}
