import { invoke } from '@tauri-apps/api/core';
import type {
  CsvTableWindow,
  CsvRowPreview,
  EntityData,
  EntityKind,
  HullReferencesResult,
  ProjectSessionId,
  ResourceDataUrlBatchResult,
  ResourceRef,
  SourceOptionGroup,
  CsvFactionFilter,
  TableKey,
  RowData,
} from '@/shared/types';

export function queryCsvTableWindow(
  sessionId: ProjectSessionId,
  table: TableKey,
  start: number,
  count: number,
  search: string | null,
  faction: CsvFactionFilter,
): Promise<CsvTableWindow> {
  return invoke('query_csv_table_window', { payload: { sessionId, table, start, count, search, faction } });
}

export function queryCsvSourceOptions(sessionId: ProjectSessionId, source: string): Promise<SourceOptionGroup[]> {
  return invoke('query_csv_source_options', { payload: { sessionId, source } });
}

export function queryCsvRowPreview(sessionId: ProjectSessionId, table: TableKey, rowKey: string): Promise<CsvRowPreview> {
  return invoke('query_csv_row_preview', { payload: { sessionId, table, rowKey } });
}

export function queryHullReferences(sessionId: ProjectSessionId, referenceIds: string[]): Promise<HullReferencesResult> {
  return invoke('query_hull_references', { payload: { sessionId, referenceIds } });
}

export function queryEntity(sessionId: ProjectSessionId, kind: EntityKind, id: string): Promise<EntityData | null> {
  return invoke('query_entity', { payload: { sessionId, kind, id } });
}

export function queryEntityList(sessionId: ProjectSessionId, kind: EntityKind): Promise<EntityData[]> {
  return invoke('query_entity_list', { payload: { sessionId, kind } });
}

export function queryWeaponDraftResources(sessionId: ProjectSessionId, id: string, draft: RowData): Promise<Record<string, ResourceRef>> {
  return invoke('query_weapon_draft_resources', { payload: { sessionId, id, draft } });
}

export function queryResourceDataUrlBatch(sessionId: ProjectSessionId, resources: ResourceRef[]): Promise<ResourceDataUrlBatchResult> {
  return invoke('query_resource_data_urls', { payload: { sessionId, resources } });
}

export function resolveModRelativePath(sessionId: ProjectSessionId, modRoot: string, absolutePath: string): Promise<string> {
  return invoke('resolve_mod_relative_path', { payload: { sessionId, modRoot, absolutePath } });
}
