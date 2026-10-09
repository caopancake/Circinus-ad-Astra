import { querySessionEntityEditTarget, querySessionEntityIdentityIntent } from '@/services/entity-query.service';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import { queryCached } from '@/services/query-cache.service';
import { queryResourceDataUrls } from '@/services/resource-cache.service';
import type { AssociatedSpecChange, CsvFactionFilter, TableKey } from '@/shared/types';
import type { QueryValue } from '@/shared/types';
import { associatedSpecKind } from '@/domain/tables/associated-specs';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';

export async function captureAssociatedSpecTarget(sessionId: string, table: TableKey, change: AssociatedSpecChange) {
  const kind = associatedSpecKind(table)!;
  const sourceId = change.action === 'rename' ? change.previousId : change.action === 'delete' ? change.id : change.create.id;
  const nextId = change.action === 'delete' ? change.id : change.create.id;
  const info = cloneQuerySnapshot<import('@/shared/types').EntityEditInfo>(await querySessionEntityEditTarget(sessionId, kind, sourceId));
  const intent =
    change.action === 'delete'
      ? null
      : cloneQuerySnapshot<import('@/shared/types').EntityIdentityIntent>(
          await querySessionEntityIdentityIntent(sessionId, info.target, nextId),
        );
  return {
    target: info.target,
    nextWrite: intent?.nextWrite ?? info.target.write,
    versions: [...info.baseVersions, ...(intent ? [intent.destinationVersion] : [])],
  };
}

export function queryTableWindow(
  sessionId: string,
  table: TableKey,
  start: number,
  count: number,
  search: string | null,
  faction: CsvFactionFilter,
  signal?: AbortSignal,
): Promise<QueryValue<'csv-table-window'>> {
  const parameters = { table, start, count, search, faction };
  return queryCached(
    { sessionId, queryKind: 'csv-table-window', parameters },
    () => invokeCommand('query_csv_table_window', { payload: { sessionId, ...parameters } }),
    signal,
  );
}

export function querySessionCsvRowPreview(
  sessionId: string,
  table: TableKey,
  rowKey: string,
  signal?: AbortSignal,
): Promise<QueryValue<'csv-row-preview'>> {
  return queryCached(
    { sessionId, queryKind: 'csv-row-preview', parameters: { table, rowKey } },
    () => invokeCommand('query_csv_row_preview', { payload: { sessionId, table, rowKey } }),
    signal,
  );
}

export async function queryTableRowPreviewDataUrl(
  sessionId: string,
  table: TableKey,
  rowKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const resource = (await querySessionCsvRowPreview(sessionId, table, rowKey, signal)).resourceRef;
  if (!resource) return '';
  return (await queryResourceDataUrls(sessionId, [resource], signal))[0] ?? '';
}
