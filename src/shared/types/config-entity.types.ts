import type { RowData } from '@/shared/types/json.types';

export interface ConfigFileEntityWrite {
  sessionId: string;
  modRoot: string;
  previousId: string | null;
  nextId: string;
  data: RowData;
  relPath: string | null;
}

export type IndexedConfigKind = 'faction' | 'mission';

export interface IndexedConfigEntityWrite {
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
  sessionId: string;
  modRoot: string;
  kind: IndexedConfigKind;
  id: string;
  deleteTarget: boolean;
}

export interface IndexedConfigEntityData {
  entityId: string;
  indexPath: string;
  indexHeader: string[];
  indexRows: RowData[];
  entityData: RowData | null;
}

export type VariantEntityWrite = ConfigFileEntityWrite;

export interface DeleteVariantEntityWrite {
  sessionId: string;
  modRoot: string;
  entityId: string;
  relPath: string;
}

export type SkinEntityWrite = ConfigFileEntityWrite;

export interface DeleteSkinEntityWrite {
  sessionId: string;
  modRoot: string;
  entityId: string;
  relPath: string;
}

export interface ConfigMissionEditorData {
  list: RowData;
  descriptor: RowData;
  text: string;
  iconSrc: string;
}

export interface VariantFile {
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
