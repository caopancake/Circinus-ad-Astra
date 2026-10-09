import type { CsvFactionFilter, CsvTableWindow, CsvRowPreview, TableKey } from '@/shared/types/tables.types';
import type { EntityData, EntityKind, HullReferencesResult, SourceOptionGroup, ResourceRef } from '@/shared/types/query.types';
import type { EntityEditInfo, EntityEditTarget, EntityIdentityIntent } from '@/shared/types/entity-target.types';
import type { EditorResourceKind } from '@/shared/types/editor.types';
import type { RowData, JsonValue } from '@/shared/types/json.types';

export type ReadonlyJsonValue = null | boolean | number | string | ReadonlyJsonArray | ReadonlyJsonObject;
export type ReadonlyJsonArray = readonly ReadonlyJsonValue[];
export interface ReadonlyJsonObject {
  readonly [key: string]: ReadonlyJsonValue;
}
export type DeepReadonly<T> = [JsonValue] extends [T]
  ? ReadonlyJsonValue
  : T extends object
    ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
    : T;

export interface QueryParameters {
  'csv-table-window': { table: TableKey; start: number; count: number; search: string | null; faction: CsvFactionFilter };
  'csv-source-options': { source: string };
  'csv-row-preview': { table: TableKey; rowKey: string };
  'hull-references': { referenceIds: string[] };
  'entity-detail': { kind: EntityKind; id: string };
  'entity-list': { kind: EntityKind };
  'entity-edit-target': { kind: EntityKind; id: string };
  'entity-identity-intent': { source: EntityEditTarget; nextId: string };
  'editor-draft-resources': { kind: EditorResourceKind; id: string; draft: RowData };
  'resource-reference': { modRoot: string; absolutePath: string };
}

export interface QueryResults {
  'csv-table-window': CsvTableWindow;
  'csv-source-options': SourceOptionGroup[];
  'csv-row-preview': CsvRowPreview;
  'hull-references': HullReferencesResult;
  'entity-detail': EntityData | null;
  'entity-list': EntityData[];
  'entity-edit-target': EntityEditInfo;
  'entity-identity-intent': EntityIdentityIntent;
  'editor-draft-resources': Record<string, ResourceRef>;
  'resource-reference': string;
}

export type QueryKind = keyof QueryParameters;
export type QueryCacheKind = Exclude<
  QueryKind,
  'entity-edit-target' | 'entity-identity-intent' | 'editor-draft-resources' | 'resource-reference'
>;
export type QueryIdentity<K extends QueryKind = QueryKind> = K extends QueryKind
  ? { sessionId: string; queryKind: K; parameters: QueryParameters[K] }
  : never;
export type QueryValue<K extends QueryKind> = DeepReadonly<QueryResults[K]>;
