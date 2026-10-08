import { requireRowData } from '@/shared/lib/row-data';
import { AppError } from '@/shared/lib/errors';
import type {
  ConfigMissionEditorData,
  EntityData,
  IndexedConfigEntityData,
  ResourceRef,
  RowData,
  SkinFile,
  VariantFile,
  WriteResult,
} from '@/shared/types';

export interface ConfigFactionRecord {
  baseVersions: import('@/shared/types').FileVersion[];
  crestRef: ResourceRef | null;
  id: string;
  data: RowData;
}

export interface ConfigFactionPreviewImages {
  logoSrc: string;
  crestSrc: string;
}

export interface ConfigMissionRecord {
  baseVersions: import('@/shared/types').FileVersion[];
  iconRef: ResourceRef | null;
  id: string;
  list: RowData;
}

export interface ConfigVariantRecord {
  variant: VariantFile;
  spriteRef: ResourceRef | null;
}

export interface ConfigSkinRecord {
  skin: SkinFile;
  spriteRef: ResourceRef | null;
}

export function toConfigFactionRecord(entity: EntityData): ConfigFactionRecord {
  return {
    baseVersions: entity.baseVersions,
    crestRef: entity.resourceRefs.crest ?? null,
    id: entity.id,
    data: requireRowData(entity.data, `势力 ${entity.id} 数据无效`),
  };
}

export function toConfigMissionRecord(entity: EntityData): ConfigMissionRecord {
  const data = requireRowData(entity.data, `战役 ${entity.id} 数据无效`);
  return {
    baseVersions: entity.baseVersions,
    iconRef: entity.resourceRefs.icon ?? null,
    id: entity.id,
    list: { ...requireRowData(data.list, `战役 ${entity.id} 列表数据无效`), id: entity.id },
  };
}

export function toConfigVariantRecord(entity: EntityData): ConfigVariantRecord {
  return {
    variant: variantFileFromEntityData(entity.data, entity.baseVersions),
    spriteRef: entity.resourceRefs.sprite ?? null,
  };
}

export function toConfigSkinRecord(entity: EntityData): ConfigSkinRecord {
  return {
    skin: skinFileFromEntityData(entity.data, entity.baseVersions),
    spriteRef: entity.resourceRefs.sprite ?? null,
  };
}

export function missionEditorDataFromEntity(entity: EntityData, iconSrc: string): ConfigMissionEditorData {
  const data = requireRowData(entity.data, `战役 ${entity.id} 数据无效`);
  return {
    baseVersions: entity.baseVersions,
    list: requireRowData(data.list, `战役 ${entity.id} 列表数据无效`),
    descriptor: requireRowData(data.descriptor, `战役 ${entity.id} descriptor 数据无效`),
    text: stringField(data, 'text', `战役 ${entity.id} 文本数据无效`),
    iconSrc,
  };
}

export function indexedConfigEntityData(result: WriteResult): IndexedConfigEntityData {
  const row = requireRowData(result.refreshedEntity, '配置保存返回数据无效');
  return {
    baseVersions: result.baseVersions,
    entityId: stringField(row, 'entityId', '配置保存返回 entityId 无效'),
    indexPath: stringField(row, 'indexPath', '配置保存返回 indexPath 无效'),
    indexHeader: stringArrayField(row, 'indexHeader', '配置保存返回 indexHeader 无效'),
    indexRows: rowDataArrayField(row, 'indexRows', '配置保存返回 indexRows 无效'),
    entityData: row.entityData === null ? null : requireRowData(row.entityData, '配置保存返回 entityData 无效'),
  };
}

export function variantEntityData(result: WriteResult): VariantFile {
  return variantFileFromEntityData(result.refreshedEntity, result.baseVersions);
}

export function skinEntityData(result: WriteResult): SkinFile {
  return skinFileFromEntityData(result.refreshedEntity, result.baseVersions);
}

function variantFileFromEntityData(value: unknown, baseVersions: import('@/shared/types').FileVersion[]): VariantFile {
  const row = requireRowData(value, '装配数据无效');
  return {
    baseVersions,
    variantId: stringField(row, 'variantId', '装配 variantId 无效'),
    hullId: stringField(row, 'hullId', '装配 hullId 无效'),
    path: stringField(row, 'path', '装配 path 无效'),
    relPath: stringField(row, 'relPath', '装配 relPath 无效'),
    data: requireRowData(row.data, '装配文件内容无效'),
    weaponGroupCount: numberField(row, 'weaponGroupCount', '装配 weaponGroupCount 无效'),
    hullModCount: numberField(row, 'hullModCount', '装配 hullModCount 无效'),
    permaModCount: numberField(row, 'permaModCount', '装配 permaModCount 无效'),
    wingCount: numberField(row, 'wingCount', '装配 wingCount 无效'),
  };
}

function skinFileFromEntityData(value: unknown, baseVersions: import('@/shared/types').FileVersion[]): SkinFile {
  const row = requireRowData(value, '舰船皮肤数据无效');
  return {
    baseVersions,
    skinHullId: stringField(row, 'skinHullId', '舰船皮肤 skinHullId 无效'),
    baseHullId: stringField(row, 'baseHullId', '舰船皮肤 baseHullId 无效'),
    path: stringField(row, 'path', '舰船皮肤 path 无效'),
    relPath: stringField(row, 'relPath', '舰船皮肤 relPath 无效'),
    data: requireRowData(row.data, '舰船皮肤文件内容无效'),
    builtInModCount: numberField(row, 'builtInModCount', '舰船皮肤 builtInModCount 无效'),
    builtInWeaponCount: numberField(row, 'builtInWeaponCount', '舰船皮肤 builtInWeaponCount 无效'),
    builtInWingCount: numberField(row, 'builtInWingCount', '舰船皮肤 builtInWingCount 无效'),
    weaponSlotChangeCount: numberField(row, 'weaponSlotChangeCount', '舰船皮肤 weaponSlotChangeCount 无效'),
    engineSlotChangeCount: numberField(row, 'engineSlotChangeCount', '舰船皮肤 engineSlotChangeCount 无效'),
  };
}

function stringField(row: RowData, key: string, message: string): string {
  const value = row[key];
  if (typeof value === 'string') return value;
  throw new AppError(message, { action: 'read-config-entity' });
}

function numberField(row: RowData, key: string, message: string): number {
  const value = row[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new AppError(message, { action: 'read-config-entity' });
}

function stringArrayField(row: RowData, key: string, message: string): string[] {
  const value = row[key];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  throw new AppError(message, { action: 'read-config-entity' });
}

function rowDataArrayField(row: RowData, key: string, message: string): RowData[] {
  const value = row[key];
  if (Array.isArray(value)) return value.map((item) => requireRowData(item, message));
  throw new AppError(message, { action: 'read-config-entity' });
}
