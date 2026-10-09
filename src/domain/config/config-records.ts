import { requireRowData } from '@/shared/lib/row-data';
import { AppError } from '@/shared/lib/errors';
import type {
  ConfigMissionEditorData,
  EntityData,
  IndexedConfigEntityData,
  ResourceRef,
  RowData,
  ConfigFamilyFile,
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

export interface ConfigFamilyRecord {
  file: ConfigFamilyFile;
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
    list: requireRowData(data.list, `战役 ${entity.id} 列表数据无效`),
  };
}

export function toConfigFamilyRecord(entity: EntityData): ConfigFamilyRecord {
  return {
    file: familyFile(entity.target, entity.baseVersions, requireRowData(entity.data, '实体族文件内容无效')),
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

export function configFamilyEntityData(result: WriteResult): ConfigFamilyFile {
  const record = requireRowData(result.refreshedEntity, '实体族保存数据无效');
  return familyFile(result.identityChanges[0]!.after, result.baseVersions, requireRowData(record.data, '实体族文件内容无效'));
}

function familyFile(
  target: import('@/shared/types').EntityEditTarget,
  baseVersions: import('@/shared/types').FileVersion[],
  data: RowData,
): ConfigFamilyFile {
  return { target, baseVersions, id: target.id, path: target.write.path, relPath: target.write.relPath, data };
}

function stringField(row: RowData, key: string, message: string): string {
  const value = row[key];
  if (typeof value === 'string') return value;
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
