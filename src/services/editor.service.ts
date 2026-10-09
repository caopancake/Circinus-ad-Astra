import {
  querySessionEntity,
  querySessionEntityList,
  querySessionEditorDraftResources,
  querySessionEntityEditTarget,
  querySessionEntityIdentityIntent,
} from '@/services/entity-query.service';
import { AppError, withCause } from '@/shared/lib/errors';
import { queryResourceDataUrls } from '@/services/resource-cache.service';
import { writeEditorSpec } from '@/services/write.service';
import { loadImportedEditorSpecFile } from '@/services/files.service';
import { WEAPON_SPRITE_FIELDS } from '@/domain/editors/lib/weapon-sprite-fields';
import { createShipSpec, createProjectileSpec, createSystemSpec, createWeaponSpec } from '@/domain/editors/spec-construction';
import { inferWeaponSpecClass } from '@/domain/tables/associated-spec-creation';
import { entityContentId } from '@/domain/editors/entity-identity';
import { requireRowData } from '@/shared/lib/row-data';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import type { DeepReadonly } from '@/shared/types';
import type {
  EntityEditInfo,
  EntityEditTarget,
  EditorSpecKind,
  EditorWindowKind,
  EntityData,
  ProjectSessionId,
  ResourceRef,
  RowData,
  WriteResult,
} from '@/shared/types';

type EditorSelectOption = { label: string; value: string };

export type EditorEntityBundle =
  ShipEditorEntityBundle | WeaponEditorEntityBundle | ProjectileEditorEntityBundle | SystemEditorEntityBundle | WeaponPreviewEntityBundle;

export interface ShipEditorEntityBundle extends EntityEditInfo {
  kind: 'ship';
  ship: RowData;
  resourceRefs: ResourceRef[];
  shipSpriteData: string;
  isNew: boolean;
}

export interface WeaponEditorEntityBundle extends EntityEditInfo {
  kind: 'weapon';
  weapon: RowData;
  weaponCsvRow: RowData;
  projectileSpecs: Record<string, RowData>;
  projectileOptions: EditorSelectOption[];
  resourceRefs: ResourceRef[];
  weaponSpriteData: Record<string, string>;
  isNew: boolean;
}

export interface WeaponPreviewEntityBundle extends EntityEditInfo {
  kind: 'weapon-preview';
  weapon: RowData;
  weaponCsvRow: RowData;
  projectileSpecs: Record<string, RowData>;
  resourceRefs: ResourceRef[];
  weaponSpriteData: Record<string, string>;
  isNew: boolean;
}

export interface ProjectileEditorEntityBundle extends EntityEditInfo {
  kind: 'projectile';
  projectile: RowData;
  projectileSpecs: Record<string, RowData>;
  isNew: boolean;
}

export interface SystemEditorEntityBundle extends EntityEditInfo {
  kind: 'system';
  system: RowData;
  isNew: boolean;
}

export async function queryEditorEntityBundle(
  sessionId: ProjectSessionId,
  kind: EditorWindowKind,
  id: string,
  draftSnapshot?: RowData,
  signal?: AbortSignal,
): Promise<EditorEntityBundle> {
  return BUNDLE_LOADERS[kind](sessionId, id, { draftSnapshot, signal });
}

export async function refreshBundleResources(
  sessionId: ProjectSessionId,
  bundle: EditorEntityBundle,
  signal?: AbortSignal,
): Promise<EditorEntityBundle> {
  if (bundle.kind === 'ship') {
    return {
      ...bundle,
      shipSpriteData: await querySpriteData(sessionId, bundle.resourceRefs.find((resource) => resource.key === 'sprite') ?? null, signal),
    };
  }
  if (bundle.kind === 'weapon' || bundle.kind === 'weapon-preview') {
    return { ...bundle, weaponSpriteData: await queryWeaponSprites(sessionId, resourceRefsByKey(bundle.resourceRefs), signal) };
  }
  return bundle;
}

export async function queryDraftEditorImages(
  sessionId: ProjectSessionId,
  kind: 'ship' | 'weapon',
  id: string,
  draft: RowData,
  signal?: AbortSignal,
) {
  const refs = await querySessionEditorDraftResources(sessionId, kind, id, draft, signal);
  return {
    resourceRefs: Object.values(refs),
    shipSpriteData: kind === 'ship' ? await querySpriteData(sessionId, refs.sprite ?? null, signal) : '',
    weaponSpriteData: kind === 'weapon' ? await queryWeaponSprites(sessionId, refs, signal) : {},
  };
}

export async function refreshBundleProjectiles(
  sessionId: ProjectSessionId,
  bundle: EditorEntityBundle,
  options: { projectileSpecs: boolean; projectileOptions: boolean },
  signal?: AbortSignal,
): Promise<EditorEntityBundle> {
  if (bundle.kind !== 'weapon' && bundle.kind !== 'weapon-preview') return bundle;
  const nextProjectileSpecs = options.projectileSpecs ? await queryProjectileSpecs(sessionId, bundle.weapon, signal) : null;
  if (bundle.kind === 'weapon-preview' && nextProjectileSpecs) requirePreviewProjectile(bundle.weapon, nextProjectileSpecs);
  if (bundle.kind === 'weapon') {
    return {
      ...bundle,
      projectileSpecs: nextProjectileSpecs ?? bundle.projectileSpecs,
      projectileOptions: options.projectileOptions ? await queryProjectileOptions(sessionId, signal) : bundle.projectileOptions,
    };
  }
  return {
    ...bundle,
    projectileSpecs: nextProjectileSpecs ?? bundle.projectileSpecs,
  };
}

const BUNDLE_LOADERS: Record<
  EditorWindowKind,
  (sessionId: ProjectSessionId, id: string, options: { draftSnapshot?: RowData; signal?: AbortSignal }) => Promise<EditorEntityBundle>
> = {
  ship: (sessionId, id, { signal }) => queryShipEditorBundle(sessionId, id, signal),
  weapon: (sessionId, id, { signal }) => queryWeaponEditorBundle(sessionId, id, signal),
  projectile: (sessionId, id, { signal }) => queryProjectileEditorBundle(sessionId, id, signal),
  system: (sessionId, id, { signal }) => querySystemEditorBundle(sessionId, id, signal),
  'weapon-preview': (sessionId, id, { draftSnapshot, signal }) => queryWeaponPreviewBundle(sessionId, id, draftSnapshot, signal),
};

async function queryShipEditorBundle(sessionId: ProjectSessionId, id: string, signal?: AbortSignal): Promise<ShipEditorEntityBundle> {
  const record = await querySessionEntity(sessionId, 'ship', id, signal);
  const ship = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = ship ?? (await queryEditorEditInfo(sessionId, 'ship', id, signal));
  const shipSpec = ship ? requireRowData(ship.data, `舰船 ${id} 数据无效`) : createShipSpec(id);
  return {
    kind: 'ship',
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types').FileVersion[]>(info.baseVersions),
    ship: shipSpec,
    resourceRefs: ship ? Object.values(ship.resourceRefs) : [],
    shipSpriteData: ship ? await querySpriteData(sessionId, ship.resourceRefs.sprite ?? null, signal) : '',
    isNew: info.target.state === 'create',
  };
}

async function queryWeaponEditorBundle(sessionId: ProjectSessionId, id: string, signal?: AbortSignal): Promise<WeaponEditorEntityBundle> {
  const bundle = await queryWeaponLikeBundle(sessionId, id, undefined, signal);
  return {
    kind: 'weapon',
    ...bundle,
    projectileOptions: await queryProjectileOptions(sessionId, signal),
  };
}

async function queryWeaponPreviewBundle(
  sessionId: ProjectSessionId,
  id: string,
  draftSnapshot?: RowData,
  signal?: AbortSignal,
): Promise<WeaponPreviewEntityBundle> {
  const bundle = await queryWeaponLikeBundle(sessionId, id, draftSnapshot, signal);
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
  signal?: AbortSignal,
): Promise<Omit<WeaponEditorEntityBundle, 'kind' | 'projectileOptions'>> {
  const weapon = requireEditorEntity(await querySessionEntity(sessionId, 'weapon', id, signal), 'weapon', id);
  const weaponEntity = requireRowData(weapon.data, `武器 ${id} 数据无效`);
  const savedWeaponSpec = requireRowData(weaponEntity.spec, `武器 ${id} spec 数据无效`);
  const weaponCsvRow = requireRowData(weaponEntity.csvRow, `武器 ${id} CSV 数据无效`);
  const isNew = Object.keys(savedWeaponSpec).length === 0;
  const weaponSpec = weaponOverride ?? (isNew ? createWeaponSpec(id, inferWeaponSpecClass(weaponCsvRow)) : savedWeaponSpec);
  const resourceRefs = weaponOverride
    ? await querySessionEditorDraftResources(sessionId, 'weapon', id, weaponOverride, signal)
    : weapon.resourceRefs;
  const projectileSpecs = await queryProjectileSpecs(sessionId, weaponSpec, signal);
  return {
    weapon: weaponSpec,
    target: weapon.target,
    baseVersions: weapon.baseVersions,
    weaponCsvRow,
    isNew,
    projectileSpecs,
    resourceRefs: Object.values(resourceRefs),
    weaponSpriteData: await queryWeaponSprites(sessionId, resourceRefs, signal),
  };
}

async function queryProjectileEditorBundle(
  sessionId: ProjectSessionId,
  id: string,
  signal?: AbortSignal,
): Promise<ProjectileEditorEntityBundle> {
  const record = await querySessionEntity(sessionId, 'projectile', id, signal);
  const projectile = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = projectile ?? (await queryEditorEditInfo(sessionId, 'projectile', id, signal));
  const spec = projectile ? requireRowData(projectile.data, `弹体 ${id} 数据无效`) : createProjectileSpec(id);
  return {
    kind: 'projectile',
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types').FileVersion[]>(info.baseVersions),
    projectile: spec,
    projectileSpecs: { [id]: spec },
    isNew: info.target.state === 'create',
  };
}

async function querySystemEditorBundle(sessionId: ProjectSessionId, id: string, signal?: AbortSignal): Promise<SystemEditorEntityBundle> {
  const record = await querySessionEntity(sessionId, 'system', id, signal);
  const system = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = system ?? (await queryEditorEditInfo(sessionId, 'system', id, signal));
  return {
    kind: 'system',
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types').FileVersion[]>(info.baseVersions),
    system: system ? requireRowData(system.data, `战术系统 ${id} 数据无效`) : createSystemSpec(id),
    isNew: info.target.state === 'create',
  };
}

export async function saveEditorSpecByKind(
  sessionId: string,
  modRoot: string,
  target: EntityEditTarget,
  data: RowData,
  jsonWrite?: import('@/shared/types').JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  ensureSpecContext(modRoot, target.id);
  try {
    const result = await writeEditorSpec(sessionId, modRoot, target, data, jsonWrite, baseVersions);
    return { ...result, refreshedEntity: requireRowData(result.refreshedEntity, '规格保存返回内容无效') };
  } catch (error) {
    throw withCause(`保存 ${target.id} spec 失败`, error, `save-${target.kind}-spec`);
  }
}

export function queryEditorIdentityIntent(sessionId: string, source: EntityEditTarget, content: RowData, signal?: AbortSignal) {
  return querySessionEntityIdentityIntent(sessionId, source, entityContentId(source.kind, content), signal).then((intent) =>
    cloneQuerySnapshot<import('@/shared/types').EntityIdentityIntent>(intent),
  );
}
export function queryEditorEditInfo(sessionId: string, kind: EntityEditTarget['kind'], id: string, signal?: AbortSignal) {
  return querySessionEntityEditTarget(sessionId, kind, id, signal).then((info) => cloneQuerySnapshot<EntityEditInfo>(info));
}

export async function loadImportedSpecFile(kind: EditorSpecKind, path: string): Promise<RowData> {
  return loadImportedEditorSpecFile(kind, path);
}

async function queryWeaponSprites(
  sessionId: ProjectSessionId,
  refs: Record<string, ResourceRef>,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const resources: { field: string; resource: ResourceRef }[] = [];
  for (const field of WEAPON_SPRITE_FIELDS) {
    const resource = refs[field];
    if (resource) resources.push({ field, resource });
  }
  if (resources.length === 0) return {};
  const dataUrls = await queryResourceDataUrls(
    sessionId,
    resources.map((entry) => entry.resource),
    signal,
  );
  return Object.fromEntries(
    dataUrls.flatMap((dataUrl, index) => {
      const entry = resources[index];
      return dataUrl && entry ? [[entry.field, dataUrl] as const] : [];
    }),
  );
}

async function querySpriteData(sessionId: ProjectSessionId, resource: ResourceRef | null, signal?: AbortSignal): Promise<string> {
  if (!resource) return '';
  return (await queryResourceDataUrls(sessionId, [resource], signal))[0] ?? '';
}

function resourceRefsByKey(resources: ResourceRef[]): Record<string, ResourceRef> {
  return Object.fromEntries(resources.map((resource) => [resource.key, resource]));
}

async function queryProjectileOptions(sessionId: ProjectSessionId, signal?: AbortSignal): Promise<EditorSelectOption[]> {
  const projectiles = await querySessionEntityList(sessionId, 'projectile', signal);
  return projectiles.map((projectile) => ({ label: projectile.id, value: projectile.id }));
}

async function queryProjectileSpecs(sessionId: ProjectSessionId, weapon: RowData, signal?: AbortSignal): Promise<Record<string, RowData>> {
  const id = typeof weapon.projectileSpecId === 'string' ? weapon.projectileSpecId : '';
  if (!id) return {};
  const record = await querySessionEntity(sessionId, 'projectile', id, signal);
  if (!record) return {};
  const projectile = cloneQuerySnapshot<EntityData>(record);
  return { [id]: requireRowData(projectile.data, `弹体 ${id} 数据无效`) };
}

function requireEditorEntity(entity: DeepReadonly<EntityData> | null, kind: EditorSpecKind, id: string): EntityData {
  if (entity) return cloneQuerySnapshot<EntityData>(entity);
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
