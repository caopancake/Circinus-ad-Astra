import {
  queryCsvRowPreview,
  queryCsvSourceOptions,
  queryCsvTableWindow,
  queryEntity,
  queryEntityList,
  queryHullReferences,
  queryWeaponDraftResources,
} from '@/shared/api/query-api';
import { queryCached } from '@/services/query-cache.service';
import type {
  CsvFactionFilter,
  CsvRowPreview,
  CsvTableWindow,
  EntityData,
  EntityKind,
  HullReferencesResult,
  ProjectSessionId,
  SourceOptionGroup,
  TableKey,
  RowData,
  ResourceRef,
} from '@/shared/types';

export function querySessionTableWindow(
  sessionId: ProjectSessionId,
  table: TableKey,
  start: number,
  count: number,
  search: string | null,
  faction: CsvFactionFilter,
): Promise<CsvTableWindow> {
  return queryCached(sessionId, 'csv-table-window', { table, start, count, search, faction }, () =>
    queryCsvTableWindow(sessionId, table, start, count, search, faction),
  );
}

export function querySessionSourceOptions(sessionId: ProjectSessionId, source: string): Promise<SourceOptionGroup[]> {
  return queryCached(sessionId, 'csv-source-options', { source }, () => queryCsvSourceOptions(sessionId, source));
}

export function querySessionCsvRowPreview(sessionId: ProjectSessionId, table: TableKey, rowKey: string): Promise<CsvRowPreview> {
  return queryCached(sessionId, 'csv-row-preview', { table, rowKey }, () => queryCsvRowPreview(sessionId, table, rowKey));
}

export function querySessionHullReferences(sessionId: ProjectSessionId, referenceIds: string[]): Promise<HullReferencesResult> {
  return queryCached(sessionId, 'hull-references', { referenceIds }, () => queryHullReferences(sessionId, referenceIds));
}

export function querySessionEntity(sessionId: ProjectSessionId, kind: EntityKind, id: string): Promise<EntityData | null> {
  return queryCached(sessionId, 'entity-detail', { kind, id }, () => queryEntity(sessionId, kind, id));
}

export function querySessionEntityList(sessionId: ProjectSessionId, kind: EntityKind): Promise<EntityData[]> {
  return queryCached(sessionId, 'entity-list', { kind }, () => queryEntityList(sessionId, kind));
}

export function querySessionWeaponDraftResources(
  sessionId: ProjectSessionId,
  id: string,
  draft: RowData,
): Promise<Record<string, ResourceRef>> {
  return queryWeaponDraftResources(sessionId, id, draft);
}
