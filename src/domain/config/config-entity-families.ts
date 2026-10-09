import { trimmedConfigStringField } from '@/domain/config/config-entities';
import type { ConfigFamilyFile } from '@/shared/types';

/**
 * Parameterized definition of the config entity families: the Skin/Variant families
 * share one component set and view models, and family differences (copy, field names,
 * icons, sorting, hydration needs) exist only inside this definition.
 */
export interface ConfigEntityFamilyDefinition {
  id: 'variant' | 'skin';
  displayName: string;
  schemaId: 'variant' | 'skin';
  entityKind: 'variant' | 'skin';
  idField: string;
  companionField: string;
  companionLabel: string;
  directoryHint: string;
  selectConfirmTitle: string;
  selectConfirmContent: string;
  createLabel: string;
  deleteConfirmTitle: string;
  listIconPaths: string[];
  mediaSurface: string;
  usesHullNames: boolean;
}

export type { ConfigFamilyFile } from '@/shared/types';

export function familyFileId(file: ConfigFamilyFile): string {
  return file.id;
}

export function familyFileCompanion(family: ConfigEntityFamilyDefinition, file: ConfigFamilyFile): string {
  return trimmedConfigStringField(file.data, family.companionField);
}

export function familyFileTitle(family: ConfigEntityFamilyDefinition, file: ConfigFamilyFile, hullNames: Record<string, string>): string {
  if (!family.usesHullNames) return file.id;
  const hullId = familyFileCompanion(family, file);
  const hullName = hullNames[hullId]?.trim() || hullId;
  const displayName = trimmedConfigStringField(file.data, 'displayName');
  return displayName ? `${hullName} · ${displayName}` : hullName;
}

export function compareFamilyFiles(family: ConfigEntityFamilyDefinition, left: ConfigFamilyFile, right: ConfigFamilyFile): number {
  return familyFileCompanion(family, left).localeCompare(familyFileCompanion(family, right)) || left.id.localeCompare(right.id);
}

export const variantFamily: ConfigEntityFamilyDefinition = {
  id: 'variant',
  displayName: '装配',
  schemaId: 'variant',
  entityKind: 'variant',
  idField: 'variantId',
  companionField: 'hullId',
  companionLabel: 'hullId',
  directoryHint: '未找到 data/variants 下的 .variant 文件。',
  selectConfirmTitle: '切换装配？',
  selectConfirmContent: '当前装配有未保存修改，切换后这些修改将丢失。确认继续？',
  createLabel: '新建装配',
  deleteConfirmTitle: '删除装配',
  listIconPaths: ['M12 3 5 18l7 3 7-3-7-15z', 'M12 3v18M7 15l5 2 5-2'],
  mediaSurface: 'config-variant-list',
  usesHullNames: true,
};

export const skinFamily: ConfigEntityFamilyDefinition = {
  id: 'skin',
  displayName: '舰船皮肤',
  schemaId: 'skin',
  entityKind: 'skin',
  idField: 'skinHullId',
  companionField: 'baseHullId',
  companionLabel: 'baseHullId',
  directoryHint: '未找到 data/hulls/skins 下的 .skin 文件。',
  selectConfirmTitle: '切换舰船皮肤？',
  selectConfirmContent: '当前舰船皮肤有未保存修改，切换后这些修改将丢失。确认继续？',
  createLabel: '新建舰船皮肤',
  deleteConfirmTitle: '删除舰船皮肤',
  listIconPaths: ['M12 3 5 18l7 3 7-3-7-15z', 'M8 16h8M9 12h6'],
  mediaSurface: 'config-skin-list',
  usesHullNames: false,
};
