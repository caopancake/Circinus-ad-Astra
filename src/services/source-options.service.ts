import { invokeCommand } from '@/shared/runtime/command.runtime';
import { queryCached } from '@/services/query-cache.service';
import { recordPerformance } from '@/shared/runtime/performance';
import type { QueryValue } from '@/shared/types';

export async function querySourceOptionCatalog(
  sessionId: string,
  source: string,
  signal?: AbortSignal,
): Promise<QueryValue<'csv-source-options'>> {
  const startedAt = performance.now();
  const groups = await queryCached(
    { sessionId, queryKind: 'csv-source-options', parameters: { source } },
    () => invokeCommand('query_csv_source_options', { payload: { sessionId, source } }),
    signal,
  );
  recordPerformance('frontend.query.sourceCatalog', performance.now() - startedAt, {
    source,
    groups: groups.length,
    options: groups.reduce((sum, group) => sum + group.options.length, 0),
  });
  return groups;
}
