import type { RowData } from '@/shared/types/json.types';

export interface SavedConfig<T> {
  entity: T;
  receipt: import('@/shared/types/write.types').WriteResult;
}

export interface ConfigSaveIdentity {
  id: string;
  data: RowData;
  receipt: import('@/shared/types/write.types').WriteResult;
  baseVersions: import('@/shared/types/write.types').FileVersion[];
}

export interface ConfigIdentityHandoff<T> {
  sourceId: string;
  record: T;
  preserveDraft: boolean;
  commitId: number;
}

export interface ConfigEditTarget {
  sessionId: string;
  modRoot: string;
  kind: 'variant' | 'skin' | 'faction' | 'mission';
  id: string;
  relPath: string | null;
}

export interface ConfigFileEntityWrite {
  baseVersions: import('@/shared/types/write.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  previousId: string | null;
  nextId: string;
  data: RowData;
  relPath: string | null;
}

export type IndexedConfigKind = 'faction' | 'mission';

export interface IndexedConfigEntityWrite {
  baseVersions: import('@/shared/types/write.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  kind: IndexedConfigKind;
  previousId: string | null;
  nextId: string;
  indexRow: RowData;
  entityData: RowData;
}

export interface DeleteIndexedConfigEntityWrite {
  baseVersions: import('@/shared/types/write.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  kind: IndexedConfigKind;
  id: string;
  deleteTarget: boolean;
}

export interface IndexedConfigEntityData {
  baseVersions: import('@/shared/types/write.types').FileVersion[];
  entityId: string;
  indexPath: string;
  indexHeader: string[];
  indexRows: import('@/shared/types/tables.types').CsvRow[];
  entityData: RowData | null;
}

export type VariantEntityWrite = ConfigFileEntityWrite;

export interface DeleteVariantEntityWrite {
  baseVersions: import('@/shared/types/write.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  entityId: string;
  relPath: string;
}

export type SkinEntityWrite = ConfigFileEntityWrite;

export interface DeleteSkinEntityWrite {
  baseVersions: import('@/shared/types/write.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  entityId: string;
  relPath: string;
}

export interface ConfigMissionEditorData {
  baseVersions: import('@/shared/types/write.types').FileVersion[];
  list: RowData;
  descriptor: RowData;
  text: string;
  iconSrc: string;
}

export interface ConfigFamilyFile {
  target: import('@/shared/types/entity-target.types').EntityEditTarget;
  id: string;
  baseVersions: import('@/shared/types/write.types').FileVersion[];
  path: string;
  relPath: string;
  data: RowData;
}
