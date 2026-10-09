import { queryResourceDataUrls } from '@/services/resource-cache.service';
import { isResourceRef } from '@/shared/lib/resource-ref';
import type { ProjectSessionId, ResourceRef } from '@/shared/types';

export async function hydrateFactionPreviewImages(
  sessionId: ProjectSessionId,
  resources: Record<string, ResourceRef>,
  signal?: AbortSignal,
): Promise<{ logoSrc: string; crestSrc: string }> {
  const entries = [
    { key: 'logoSrc' as const, resource: resources.logo ?? null },
    { key: 'crestSrc' as const, resource: resources.crest ?? null },
  ].filter((entry): entry is { key: 'logoSrc' | 'crestSrc'; resource: ResourceRef } => isResourceRef(entry.resource));
  if (entries.length === 0) return { logoSrc: '', crestSrc: '' };
  const dataUrls = await queryResourceDataUrls(
    sessionId,
    entries.map((entry) => entry.resource),
    signal,
  );
  const result = { logoSrc: '', crestSrc: '' };
  entries.forEach((entry, index) => {
    result[entry.key] = dataUrls[index] ?? '';
  });
  return result;
}
export async function hydrateMissionIcon(sessionId: ProjectSessionId, resource: ResourceRef | null, signal?: AbortSignal): Promise<string> {
  return resource ? ((await queryResourceDataUrls(sessionId, [resource], signal))[0] ?? '') : '';
}
