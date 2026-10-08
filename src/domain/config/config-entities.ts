import { cell } from '@/shared/lib/starsector';
import { AppError } from '@/shared/lib/errors';
import type { IndexedConfigKind, JsonValue, RowData, VariantFile } from '@/shared/types';
import type { FileSchema } from '@/domain/schema/schema.types';
import { aggregateSchemaSources, splitSchemaSources } from '@/domain/schema/schema-sources';

type IndexedConfigLabelAction = 'save' | 'create' | 'delete';

const INDEXED_CONFIG_LABELS: Record<IndexedConfigKind, Record<IndexedConfigLabelAction, (id: string) => string>> = {
  faction: {
    save: (id) => `保存 ${id}.faction`,
    create: (id) => `创建势力 ${id}`,
    delete: (id) => `删除势力 ${id}`,
  },
  mission: {
    save: (id) => `保存战役 ${id}`,
    create: (id) => `创建战役 ${id}`,
    delete: (id) => `删除战役 ${id}`,
  },
};

export function indexedConfigHistoryLabel(kind: IndexedConfigKind, action: IndexedConfigLabelAction, id: string): string {
  return INDEXED_CONFIG_LABELS[kind][action](id);
}

export function createDefaultVariant(hullId: string, variantId: string): RowData {
  return {
    variantId,
    hullId,
    displayName: variantId,
    goalVariant: false,
    fluxVents: 0,
    fluxCapacitors: 0,
    hullMods: [],
    permaMods: [],
    sMods: [],
    weaponGroups: [],
    wings: [],
  };
}

export function configVariantListTitle(variant: VariantFile, hullNames: Record<string, string>): string {
  const hullName = hullNames[variant.hullId]?.trim() || variant.hullId;
  const displayName = trimmedConfigStringField(variant.data, 'displayName');
  return displayName ? `${hullName} · ${displayName}` : hullName;
}

export function createDefaultSkin(baseHullId: string, skinHullId: string): RowData {
  return {
    skinHullId,
    baseHullId,
    hullName: skinHullId,
    descriptionId: '',
    descriptionPrefix: '',
    tags: [],
    removeHints: [],
    addHints: [],
    removeBuiltInMods: [],
    builtInMods: [],
    removeBuiltInWeapons: [],
    removeWeaponSlots: [],
    removeEngineSlots: [],
    builtInWeapons: {},
    builtInWings: [],
    weaponSlotChanges: {},
    engineSlotChanges: {},
  };
}

export function createDefaultFaction(id: string): RowData {
  return {
    id,
    displayName: id,
    displayNameWithArticle: id,
    displayNameLong: id,
    logo: 'graphics/factions/neutral_traders.png',
    color: [128, 128, 128, 255],
    baseUIColor: [128, 128, 128, 255],
    darkUIColor: [64, 64, 64, 255],
    names: { modern: 1 },
    portraits: {},
    shipNamePrefix: '',
    knownShips: { tags: [] },
    knownWeapons: { tags: [] },
    knownFighters: { tags: [] },
  };
}

export function buildFactionIndexRow(id: string): RowData {
  return {
    faction: `data/world/factions/${id}.faction`,
  };
}

export function buildMissionIndexRow(rows: RowData[], header: string[], mission: string): RowData {
  const row = rows.find((item) => missionIdFromRow(item) === mission) ?? {};
  const result: RowData = {};
  for (const col of header.length ? header : ['mission']) {
    result[col] = row[col] ?? '';
  }
  for (const [key, value] of Object.entries(row)) {
    if (!(key in result)) result[key] = value;
  }
  result.mission = mission;
  return result;
}

export interface ConfigMissionListItem {
  id: string;
}

export interface ConfigMissionEditorModel {
  indexHeader: string[];
  localMission: RowData;
  iconSrc: string;
}

export interface ConfigMissionSaveDraft {
  nextId: string;
  list: RowData;
  descriptor: RowData;
  text: string;
}

export interface ConfigFactionListItem {
  id: string;
  displayName: string;
  colorCss: string;
}

export interface ConfigFactionSaveDraft {
  nextId: string;
  file: RowData;
}

export function configModInfoEditorModel(modInfo: RowData): RowData {
  return aggregateSchemaSources({ file: modInfo });
}

export function configModInfoSaveData(local: RowData, schema: FileSchema): RowData {
  const split = splitSchemaSources(local, schema);
  return requireConfigObjectSource(split.file, 'mod_info.json 数据无效');
}

export function missionIdFromRow(row: RowData): string {
  return trimmedConfigStringField(row, 'mission');
}

export function missionItemsFromRows(rows: RowData[]): ConfigMissionListItem[] {
  return rows
    .map((row) => missionIdFromRow(row))
    .filter(Boolean)
    .map((id) => ({ id }));
}

export function configMissionEditorModel(data: {
  list: RowData;
  descriptor: RowData;
  text: string;
  iconSrc: string;
}): ConfigMissionEditorModel {
  const list = data.list;
  return {
    indexHeader: Object.keys(list).length ? Object.keys(list) : ['mission'],
    localMission: aggregateSchemaSources({
      list,
      descriptor: data.descriptor,
      text: data.text,
    }),
    iconSrc: data.iconSrc,
  };
}

export function configMissionEditingId(localMission: RowData): string {
  const list = localMission.list;
  return list && typeof list === 'object' && !Array.isArray(list) ? missionIdFromRow(list as RowData) : '';
}

export function configMissionSaveDraft(localMission: RowData, schema: FileSchema): ConfigMissionSaveDraft {
  const split = splitSchemaSources(localMission, schema);
  const list = requireConfigObjectSource(split.list, '战役列表项数据无效');
  const descriptor = requireConfigObjectSource(split.descriptor, 'descriptor.json 数据无效');
  const text = requireConfigTextSource(split.text, 'mission_text.txt 数据无效');
  return {
    nextId: missionIdFromRow(list),
    list,
    descriptor,
    text,
  };
}

export function configFactionListItems(files: Record<string, RowData>): ConfigFactionListItem[] {
  return Object.keys(files)
    .sort()
    .map((id) => ({
      id,
      displayName: cell(files[id]?.displayName) || id,
      colorCss: configColorCss(files[id]?.color ?? null),
    }));
}

export function configFactionEditorModel(file: RowData): RowData {
  return aggregateSchemaSources({ file });
}

export function configFactionSaveDraft(local: RowData, schema: FileSchema): ConfigFactionSaveDraft {
  const split = splitSchemaSources(local, schema);
  const file = requireConfigObjectSource(split.file, '势力文件数据无效');
  const nextId = trimmedConfigStringField(file, 'id');
  if (!nextId) {
    throw new AppError('势力 id 不能为空', { action: 'config-faction-save-draft' });
  }
  return {
    nextId,
    file,
  };
}

const CONFIG_ENTITY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

const CONFIG_ENTITY_ID_HINT = '仅允许以 ASCII 字母或数字开头，只能包含 ASCII 字母、数字、下划线（_）、点（.）、连字符（-）';

export function isConfigEntityId(value: string): boolean {
  return CONFIG_ENTITY_ID_RE.test(value.trim());
}

export function configEntityIdInvalidMessage(label: string, value?: string): string {
  const subject = value ? `${label} "${value}"` : label;
  return `${subject} ${CONFIG_ENTITY_ID_HINT}`;
}

export function hasConfigEntityIdConflict<T>(
  entities: T[],
  nextId: string,
  currentId: string | null,
  entityId: (entity: T) => string,
): boolean {
  return entities.some((entity) => {
    const id = entityId(entity);
    return id === nextId && id !== currentId;
  });
}

export function configEntityRenameContext(currentId: string, nextId: string): { previousId: string | null } {
  const renamed = nextId !== currentId;
  return {
    previousId: renamed ? currentId : null,
  };
}

export function trimmedConfigStringField(data: RowData, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value.trim() : '';
}

function configColorCss(color: JsonValue): string {
  if (Array.isArray(color) && color.length >= 3) {
    const r = Math.round(Number(color[0]) || 0);
    const g = Math.round(Number(color[1]) || 0);
    const b = Math.round(Number(color[2]) || 0);
    const a = Math.max(0, Math.min(255, Math.round(Number(color[3] ?? 255) || 0))) / 255;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return 'rgba(128, 128, 128, 1)';
}

function requireConfigObjectSource(value: unknown, errorMessage: string): RowData {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as RowData;
  throw new AppError(errorMessage, { action: 'config-entity-source' });
}

function requireConfigTextSource(value: unknown, errorMessage: string): string {
  if (typeof value === 'string') return value;
  throw new AppError(errorMessage, { action: 'config-entity-source' });
}
