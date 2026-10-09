import { ensureResourceMedia, resourceMediaDataUrl } from '@/services/resource-media.service';
import { onUnmounted, shallowReactive } from 'vue';
import { resourceCacheKey, subscribeResourceInvalidations } from '@/services/resource-cache.service';
import { isReadInvalidated } from '@/shared/runtime/read-request';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { ResourceRef } from '@/shared/types';

export function useSchemaSelectMedia() {
  const temporary = shallowReactive(new Map<string, string>());
  const feedback = useAppFeedback();
  let controller: AbortController | null = null;
  let currentSession: string | null = null;
  let currentResources: ResourceRef[] = [];
  let disposed = false;
  const stopInvalidation = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== currentSession) return;
    if (event.scope === 'session') {
      controller?.abort();
      temporary.clear();
      currentResources = [];
      return;
    }
    const scopes = [...event.resources, ...(event.invalidation?.resources ?? [])];
    for (const key of temporary.keys())
      if (event.invalidation?.session || scopes.some((ref) => resourceCacheKey(event.sessionId, ref) === key)) temporary.delete(key);
    if (
      event.invalidation?.session ||
      currentResources.some((resource) =>
        scopes.some((scope) => resourceCacheKey(event.sessionId, scope) === resourceCacheKey(event.sessionId, resource)),
      )
    )
      void ensureSchemaSelectSprites(event.sessionId, currentResources);
  });
  onUnmounted(() => {
    disposed = true;
    controller?.abort();
    temporary.clear();
    stopInvalidation();
  });

  function releaseSchemaSelectSprites(sessionId: string | null | undefined, resources: ResourceRef[]) {
    currentSession = sessionId ?? null;
    currentResources = resources;
    const keys = new Set(sessionId ? resources.map((resource) => resourceCacheKey(sessionId, resource)) : []);
    for (const key of temporary.keys()) if (!keys.has(key)) temporary.delete(key);
    controller?.abort();
    controller = null;
  }

  async function ensureSchemaSelectSprites(sessionId: string, resources: ResourceRef[]): Promise<void> {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    currentSession = sessionId;
    currentResources = resources;
    const keys = new Set(resources.map((resource) => resourceCacheKey(sessionId, resource)));
    try {
      const result = await ensureResourceMedia(sessionId, resources, 'schema-select', request.signal);
      if (disposed || controller !== request || request.signal.aborted) return;
      for (const key of temporary.keys()) if (!keys.has(key)) temporary.delete(key);
      for (const [key, value] of result.uncachedDataUrls) temporary.set(key, value);
    } catch (error) {
      if (!disposed && controller === request && !isReadInvalidated(error)) feedback.error(error, '读取选项贴图失败');
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
