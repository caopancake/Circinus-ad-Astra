import { querySessionHullReferences } from '@/services/query.service';
import { queryResourceDataUrls } from '@/services/resource-cache.service';
import { measurePerformanceAsync } from '@/shared/runtime/performance';
import { isResourceRef } from '@/shared/lib/resource-ref';
import type { ProjectSessionId, ResourceRef, SourceOptionGroup } from '@/shared/types';
import type { SelectOption } from '@/domain/schema/schema-options';

export async function hydrateFactionPreviewImages(
  sessionId: ProjectSessionId,
  resources: Record<string, ResourceRef>,
): Promise<{ logoSrc: string; crestSrc: string }> {
  const entries = [
    { key: 'logoSrc' as const, resource: resources.logo ?? null },
    { key: 'crestSrc' as const, resource: resources.crest ?? null },
  ].filter((entry): entry is { key: 'logoSrc' | 'crestSrc'; resource: ResourceRef } => isResourceRef(entry.resource));
  if (entries.length === 0) return { logoSrc: '', crestSrc: '' };
  const dataUrls = await queryResourceDataUrls(
    sessionId,
    entries.map((entry) => entry.resource),
  );
  const result = { logoSrc: '', crestSrc: '' };
  entries.forEach((entry, index) => {
    result[entry.key] = dataUrls[index] ?? '';
  });
  return result;
}

export async function hydrateMissionIcon(sessionId: ProjectSessionId, resource: ResourceRef | null): Promise<string> {
  return resource ? ((await queryResourceDataUrls(sessionId, [resource]))[0] ?? '') : '';
}

export async function queryHullReferenceOptions(sessionId: ProjectSessionId, referenceIds: string[]): Promise<SelectOption[]> {
  return measurePerformanceAsync('frontend.config.hullReferenceCatalog', { references: referenceIds.length }, async () => {
    const result = await querySessionHullReferences(sessionId, referenceIds);
    return result.groups.flatMap((group) =>
      group.options.map((option) => {
        const resource = isResourceRef(option.resourceRef) ? option.resourceRef : null;
        return {
          label: option.label,
          value: option.value,
          resourceRef: resource,
        };
      }),
    );
  });
}

export async function queryHullPreviewMetadata(sessionId: ProjectSessionId, hullIds: string[]): Promise<Record<string, string>> {
  const result = await querySessionHullReferences(sessionId, hullIds);
  return result.hullNames;
}

export async function queryBuiltInWeaponSlotOptions(sessionId: ProjectSessionId, hullId: string): Promise<SourceOptionGroup[]> {
  const result = await querySessionHullReferences(sessionId, [hullId]);
  return (['mod', 'core'] as const)
    .map((origin) => ({
      origin,
      options: (result.builtInWeaponSlots[hullId] ?? [])
        .filter((slot) => slot.origin === origin)
        .map((slot) => ({
          value: slot.id,
          label: slot.id,
          origin: slot.origin,
          description: null,
          resourceRef: null,
        })),
    }))
    .filter((group) => group.options.length > 0);
}
