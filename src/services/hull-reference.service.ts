import { invokeCommand } from '@/shared/runtime/command.runtime';
import { queryCached } from '@/services/query-cache.service';
import { measurePerformanceAsync } from '@/shared/runtime/performance';
import { hullReferenceOptions, builtInWeaponSlotOptions } from '@/domain/config/hull-references';
import type { QueryValue } from '@/shared/types';

export function querySessionHullReferences(
  sessionId: string,
  referenceIds: readonly string[],
  signal?: AbortSignal,
): Promise<QueryValue<'hull-references'>> {
  const parameters = { referenceIds: [...new Set(referenceIds)].sort() };
  return queryCached(
    { sessionId, queryKind: 'hull-references', parameters },
    () => invokeCommand('query_hull_references', { payload: { sessionId, ...parameters } }),
    signal,
  );
}

export async function queryHullReferenceOptions(sessionId: string, referenceIds: readonly string[], signal?: AbortSignal) {
  return measurePerformanceAsync('frontend.config.hullReferenceCatalog', { references: referenceIds.length }, async () =>
    hullReferenceOptions(await querySessionHullReferences(sessionId, referenceIds, signal)),
  );
}

export async function queryHullPreviewMetadata(sessionId: string, hullIds: readonly string[], signal?: AbortSignal) {
  return (await querySessionHullReferences(sessionId, hullIds, signal)).hullNames;
}

export async function queryBuiltInWeaponSlotOptions(sessionId: string, hullId: string, signal?: AbortSignal) {
  return builtInWeaponSlotOptions(await querySessionHullReferences(sessionId, [hullId], signal), hullId);
}
