import {
  querySessionEntity,
  querySessionEntityList,
  querySessionEditorDraftResources,
  querySessionEntityBaseVersions,
} from '@/services/query.service';
import { AppError, withCause } from '@/shared/lib/errors';
import { queryResourceDataUrls } from '@/services/resource-cache.service';
import { writeEditorSpec } from '@/services/write.service';
import { loadImportedEditorSpecFile } from '@/services/files.service';
import { WEAPON_SPRITE_FIELDS } from '@/domain/editors/lib/weapon-sprite-fields';
import { defaultEditorSpec } from '@/domain/editors/editor-definitions';
import { requireRowData } from '@/shared/lib/row-data';
import type { EditorSpecKind, EditorWindowKind, EntityData, ProjectSessionId, ResourceRef, RowData, WriteResult } from '@/shared/types';

type EditorSelectOption = { label: string; value: string };

export type EditorEntityBundle =
  ShipEditorEntityBundle | WeaponEditorEntityBundle | ProjectileEditorEntityBundle | SystemEditorEntityBundle | WeaponPreviewEntityBundle;

export interface ShipEditorEntityBundle {
  baseVersions: import('@/shared/types').FileVersion[];
  kind: 'ship';
  ship: RowData;
  resourceRefs: ResourceRef[];
  shipSpriteData: string;
  isNew: boolean;
}

export interface WeaponEditorEntityBundle {
  baseVersions: import('@/shared/types').FileVersion[];
  kind: 'weapon';
  weapon: RowData;
  weaponCsvRow: RowData;
  projectileSpecs: Record<string, RowData>;
  projectileOptions: EditorSelectOption[];
  resourceRefs: ResourceRef[];
  weaponSpriteData: Record<string, string>;
  isNew: boolean;
}

export interface WeaponPreviewEntityBundle {
  baseVersions: import('@/shared/types').FileVersion[];
  kind: 'weapon-preview';
  weapon: RowData;
  weaponCsvRow: RowData;
  projectileSpecs: Record<string, RowData>;
  resourceRefs: ResourceRef[];
  weaponSpriteData: Record<string, string>;
  isNew: boolean;
}

export interface ProjectileEditorEntityBundle {
  baseVersions: import('@/shared/types').FileVersion[];
  kind: 'projectile';
  projectile: RowData;
  projectileSpecs: Record<string, RowData>;
  isNew: boolean;
}

export interface SystemEditorEntityBundle {
  baseVersions: import('@/shared/types').FileVersion[];
  kind: 'system';
  system: RowData;
  isNew: boolean;
}

export async function queryEditorEntityBundle(
  sessionId: ProjectSessionId,
  kind: EditorWindowKind,
  id: string,
  draftSnapshot?: RowData,
): Promise<EditorEntityBundle> {
  return BUNDLE_LOADERS[kind](sessionId, id, draftSnapshot);
}

export async function refreshBundleResources(sessionId: ProjectSessionId, bundle: EditorEntityBundle): Promise<EditorEntityBundle> {
  if (bundle.kind === 'ship') {
    return {
      ...bundle,
      shipSpriteData: await querySpriteData(sessionId, bundle.resourceRefs.find((resource) => resource.key === 'sprite') ?? null),
    };
  }
  if (bundle.kind === 'weapon' || bundle.kind === 'weapon-preview') {
    return { ...bundle, weaponSpriteData: await queryWeaponSprites(sessionId, resourceRefsByKey(bundle.resourceRefs)) };
  }
  return bundle;
}

export async function queryDraftEditorImages(sessionId: ProjectSessionId, kind: 'ship' | 'weapon', id: string, draft: RowData) {
  const refs = await querySessionEditorDraftResources(sessionId, kind, id, draft);
  return {
    resourceRefs: Object.values(refs),
    shipSpriteData: kind === 'ship' ? await querySpriteData(sessionId, refs.sprite ?? null) : '',
    weaponSpriteData: kind === 'weapon' ? await queryWeaponSprites(sessionId, refs) : {},
  };
}

export async function refreshBundleProjectiles(
  sessionId: ProjectSessionId,
  bundle: EditorEntityBundle,
  options: { projectileSpecs: boolean; projectileOptions: boolean },
): Promise<EditorEntityBundle> {
  if (bundle.kind !== 'weapon' && bundle.kind !== 'weapon-preview') return bundle;
  const nextProjectileSpecs = options.projectileSpecs ? await queryProjectileSpecs(sessionId, bundle.projectileSpecs) : null;
  if (bundle.kind === 'weapon-preview' && nextProjectileSpecs) requirePreviewProjectile(bundle.weapon, nextProjectileSpecs);
  if (bundle.kind === 'weapon') {
    return {
      ...bundle,
      projectileSpecs: nextProjectileSpecs ?? bundle.projectileSpecs,
      projectileOptions: options.projectileOptions ? await queryProjectileOptions(sessionId) : bundle.projectileOptions,
    };
  }
  return {
    ...bundle,
    projectileSpecs: nextProjectileSpecs ?? bundle.projectileSpecs,
  };
}

const BUNDLE_LOADERS: Record<
  EditorWindowKind,
  (sessionId: ProjectSessionId, id: string, draftSnapshot?: RowData) => Promise<EditorEntityBundle>
> = {
  ship: queryShipEditorBundle,
  weapon: (sessionId, id) => queryWeaponEditorBundle(sessionId, id),
  projectile: queryProjectileEditorBundle,
  system: querySystemEditorBundle,
  'weapon-preview': queryWeaponPreviewBundle,
};

async function queryShipEditorBundle(sessionId: ProjectSessionId, id: string): Promise<ShipEditorEntityBundle> {
  const ship = await querySessionEntity(sessionId, 'ship', id);
  const shipSpec = ship ? requireRowData(ship.data, `舰船 ${id} 数据无效`) : defaultEditorSpec('ship', id);
  return {
    kind: 'ship',
    baseVersions: ship ? ship.baseVersions : await querySessionEntityBaseVersions(sessionId, 'ship', id),
    ship: shipSpec,
    resourceRefs: ship ? Object.values(ship.resourceRefs) : [],
    shipSpriteData: ship ? await querySpriteData(sessionId, ship.resourceRefs.sprite ?? null) : '',
    isNew: !ship,
  };
}

async function queryWeaponEditorBundle(sessionId: ProjectSessionId, id: string): Promise<WeaponEditorEntityBundle> {
  const bundle = await queryWeaponLikeBundle(sessionId, id);
  return {
    kind: 'weapon',
    ...bundle,
    projectileOptions: await queryProjectileOptions(sessionId),
  };
}

async function queryWeaponPreviewBundle(
  sessionId: ProjectSessionId,
  id: string,
  draftSnapshot?: RowData,
): Promise<WeaponPreviewEntityBundle> {
  const bundle = await queryWeaponLikeBundle(sessionId, id, draftSnapshot);
  requirePreviewProjectile(bundle.weapon, bundle.projectileSpecs);
  return {
    kind: 'weapon-preview',
    ...bundle,
  };
}

function requirePreviewProjectile(weapon: RowData, projectiles: Record<string, RowData>): void {
  if (weapon.specClass === 'beam') return;
  const id = typeof weapon.projectileSpecId === 'string' ? weapon.projectileSpecId : '';
  if (!id || !projectiles[id]) throw new AppError(`找不到预览弹体 ${id}。`, { action: 'query-editor-entity' });
}

async function queryWeaponLikeBundle(
  sessionId: ProjectSessionId,
  id: string,
  weaponOverride?: RowData,
): Promise<Omit<WeaponEditorEntityBundle, 'kind' | 'projectileOptions'>> {
  const weapon = requireEditorEntity(await querySessionEntity(sessionId, 'weapon', id), 'weapon', id);
  const weaponEntity = requireRowData(weapon.data, `武器 ${id} 数据无效`);
  const savedWeaponSpec = requireRowData(weaponEntity.spec, `武器 ${id} spec 数据无效`);
  const weaponSpec = weaponOverride ?? savedWeaponSpec;
  const weaponCsvRow = requireRowData(weaponEntity.csvRow, `武器 ${id} CSV 数据无效`);
  const isNew = Object.keys(weaponSpec).length === 0;
  const resourceRefs = weaponOverride
    ? await querySessionEditorDraftResources(sessionId, 'weapon', id, weaponOverride)
    : weapon.resourceRefs;
  const projectileId = typeof weaponSpec.projectileSpecId === 'string' ? weaponSpec.projectileSpecId : '';
  const weaponProjectile = projectileId ? await querySessionEntity(sessionId, 'projectile', projectileId) : null;
  return {
    weapon: weaponSpec,
    baseVersions: weapon.baseVersions,
    weaponCsvRow,
    isNew,
    projectileSpecs: weaponProjectile ? { [projectileId]: requireRowData(weaponProjectile.data, `弹体 ${projectileId} 数据无效`) } : {},
    resourceRefs: Object.values(resourceRefs),
    weaponSpriteData: await queryWeaponSprites(sessionId, resourceRefs),
  };
}

async function queryProjectileEditorBundle(sessionId: ProjectSessionId, id: string): Promise<ProjectileEditorEntityBundle> {
  const projectile = await querySessionEntity(sessionId, 'projectile', id);
  const spec = projectile ? requireRowData(projectile.data, `弹体 ${id} 数据无效`) : defaultEditorSpec('projectile', id);
  return {
    kind: 'projectile',
    baseVersions: projectile ? projectile.baseVersions : await querySessionEntityBaseVersions(sessionId, 'projectile', id),
    projectile: spec,
    projectileSpecs: { [id]: spec },
    isNew: !projectile,
  };
}

async function querySystemEditorBundle(sessionId: ProjectSessionId, id: string): Promise<SystemEditorEntityBundle> {
  const system = await querySessionEntity(sessionId, 'system', id);
  return {
    kind: 'system',
    baseVersions: system ? system.baseVersions : await querySessionEntityBaseVersions(sessionId, 'system', id),
    system: system ? requireRowData(system.data, `战术系统 ${id} 数据无效`) : defaultEditorSpec('system', id),
    isNew: !system,
  };
}

export async function saveEditorSpecByKind(
  sessionId: string,
  modRoot: string,
  kind: EditorSpecKind,
  id: string,
  data: RowData,
  jsonWrite?: import('@/shared/types').JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  ensureSpecContext(modRoot, id);
  try {
    return await writeEditorSpec(sessionId, modRoot, kind, id, data, jsonWrite, baseVersions);
  } catch (error) {
    throw withCause(`保存 ${id} spec 失败`, error, `save-${kind}-spec`);
  }
}

export async function loadImportedSpecFile(kind: EditorSpecKind, path: string): Promise<RowData> {
  return loadImportedEditorSpecFile(kind, path);
}

async function queryWeaponSprites(sessionId: ProjectSessionId, refs: Record<string, ResourceRef>): Promise<Record<string, string>> {
  const resources: { field: string; resource: ResourceRef }[] = [];
  for (const field of WEAPON_SPRITE_FIELDS) {
    const resource = refs[field];
    if (resource) resources.push({ field, resource });
  }
  if (resources.length === 0) return {};
  const dataUrls = await queryResourceDataUrls(
    sessionId,
    resources.map((entry) => entry.resource),
  );
  return Object.fromEntries(
    dataUrls.flatMap((dataUrl, index) => {
      const entry = resources[index];
      return dataUrl && entry ? [[entry.field, dataUrl] as const] : [];
    }),
  );
}

async function querySpriteData(sessionId: ProjectSessionId, resource: ResourceRef | null): Promise<string> {
  if (!resource) return '';
  return (await queryResourceDataUrls(sessionId, [resource]))[0] ?? '';
}

function resourceRefsByKey(resources: ResourceRef[]): Record<string, ResourceRef> {
  return Object.fromEntries(resources.map((resource) => [resource.key, resource]));
}

async function queryProjectileOptions(sessionId: ProjectSessionId): Promise<EditorSelectOption[]> {
  const projectiles = await querySessionEntityList(sessionId, 'projectile');
  return projectiles.map((projectile) => ({ label: projectile.id, value: projectile.id }));
}

async function queryProjectileSpecs(sessionId: ProjectSessionId, currentSpecs: Record<string, RowData>): Promise<Record<string, RowData>> {
  const entries = await Promise.all(
    Object.keys(currentSpecs).map(async (id) => {
      const projectile = await querySessionEntity(sessionId, 'projectile', id);
      return projectile ? ([id, requireRowData(projectile.data, `弹体 ${id} 数据无效`)] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter((entry): entry is [string, RowData] => entry !== null));
}

function requireEditorEntity(entity: EntityData | null, kind: EditorSpecKind, id: string): EntityData {
  if (entity) return entity;
  throw new AppError(`找不到 ${id} 的 ${kind} 数据。`, { action: 'query-editor-entity' });
}

function ensureSpecContext(modRoot: string, id: string) {
  if (!modRoot) {
    throw new AppError('缺少 spec 保存的 mod 根目录', { action: 'save-spec' });
  }
  if (!id) {
    throw new AppError('缺少 spec 保存 id', { action: 'save-spec' });
  }
}
