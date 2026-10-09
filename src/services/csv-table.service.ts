import {
  querySessionCsvRowPreview,
  querySessionSourceOptions,
  querySessionTableWindow,
  querySessionEntityEditTarget,
  querySessionEntityIdentityIntent,
} from '@/services/query.service';
import { queryResourceDataUrls } from '@/services/resource-cache.service';
import { recordPerformance } from '@/shared/runtime/performance';
import type { AssociatedSpecChange, CsvFactionFilter, CsvTableWindow, TableKey } from '@/shared/types';
import { associatedSpecKind } from '@/domain/tables/associated-specs';

export async function captureAssociatedSpecTarget(sessionId: string, table: TableKey, change: AssociatedSpecChange) {
  const kind = associatedSpecKind(table)!;
  const sourceId = change.action === 'rename' ? change.previousId : change.action === 'delete' ? change.id : change.create.id;
  const nextId = change.action === 'delete' ? change.id : change.create.id;
  const info = await querySessionEntityEditTarget(sessionId, kind, sourceId);
  const intent = change.action === 'delete' ? null : await querySessionEntityIdentityIntent(sessionId, info.target, nextId);
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
): Promise<CsvTableWindow> {
  return querySessionTableWindow(sessionId, table, start, count, search, faction);
}

export async function querySourceOptionCatalog(sessionId: string, source: string) {
  const startedAt = performance.now();
  const groups = await querySessionSourceOptions(sessionId, source);
  recordPerformance('frontend.query.sourceCatalog', performance.now() - startedAt, {
    source,
    groups: groups.length,
    options: groups.reduce((sum, group) => sum + group.options.length, 0),
  });
  return groups;
}

export async function queryTableRowPreviewDataUrl(sessionId: string, table: TableKey, rowKey: string): Promise<string> {
  const resource = (await querySessionCsvRowPreview(sessionId, table, rowKey)).resourceRef;
  if (!resource) return '';
  return (await queryResourceDataUrls(sessionId, [resource]))[0] ?? '';
}
