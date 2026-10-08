import type { RowData } from '@/shared/types/json.types';

export interface ConfigSaveIdentity {
  id: string;
  baseVersions: import('@/shared/types/write.types').FileVersion[];
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
  deletePreviousTarget: boolean;
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
  indexRows: RowData[];
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

export interface VariantFile {
  baseVersions: import('@/shared/types/write.types').FileVersion[];
  variantId: string;
  hullId: string;
  path: string;
  relPath: string;
  data: RowData;
  weaponGroupCount: number;
  hullModCount: number;
  permaModCount: number;
  wingCount: number;
}

export interface SkinFile {
  baseVersions: import('@/shared/types/write.types').FileVersion[];
  skinHullId: string;
  baseHullId: string;
  path: string;
  relPath: string;
  data: RowData;
  builtInModCount: number;
  builtInWeaponCount: number;
  builtInWingCount: number;
  weaponSlotChangeCount: number;
  engineSlotChangeCount: number;
}
