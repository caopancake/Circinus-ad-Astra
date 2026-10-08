import defaults from '../../../schemas/spec-defaults.json';
import type { RowData, WeaponSpecClass, ProjectileSpecClass } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';

export const WEAPON_SPEC_CLASSES: readonly WeaponSpecClass[] = ['projectile', 'beam'];
export const WEAPON_SPEC_CLASS_NOTE = 'pulse 在原版中无法正常处理，武器类型只允许 projectile 和 beam。';

export function createShipSpec(id: string, hullName = id): RowData {
  return { ...deepClone(defaults.ship), hullId: id, hullName };
}

export function createWeaponSpec(id: string, specClass: WeaponSpecClass): RowData {
  return { ...deepClone(defaults.weapon[specClass]), id };
}

export function createProjectileSpec(id: string, specClass: ProjectileSpecClass = 'projectile'): RowData {
  return { ...deepClone(defaults.projectile[specClass]), id };
}

export function createSystemSpec(id: string): RowData {
  return { ...deepClone(defaults.system), id };
}

export function createSkillSpec(id: string): RowData {
  return { ...deepClone(defaults.skill), id };
}

const WEAPON_REQUIRED_FIELDS: Record<WeaponSpecClass, readonly string[]> = {
  projectile: [
    'type',
    'size',
    'turretSprite',
    'hardpointSprite',
    'turretOffsets',
    'hardpointOffsets',
    'turretAngleOffsets',
    'hardpointAngleOffsets',
    'barrelMode',
    'animationType',
    'projectileSpecId',
  ],
  beam: [
    'type',
    'size',
    'turretSprite',
    'hardpointSprite',
    'turretOffsets',
    'hardpointOffsets',
    'turretAngleOffsets',
    'hardpointAngleOffsets',
    'textureType',
  ],
};
const PROJECTILE_REQUIRED_FIELDS: Record<ProjectileSpecClass, readonly string[]> = {
  projectile: ['spawnType', 'collisionClass', 'collisionClassByFighter', 'width', 'fadeTime'],
  missile: ['missileType', 'sprite', 'size', 'center', 'collisionRadius', 'collisionClass', 'engineSpec'],
};

function fillRequiredFields(content: RowData, template: RowData, required: readonly string[]): RowData {
  const next = deepClone(content);
  for (const key of required) if (!(key in next)) next[key] = deepClone(template[key]!);
  return next;
}

export function changeWeaponSpecClass(content: RowData, specClass: WeaponSpecClass): RowData {
  return { ...fillRequiredFields(content, defaults.weapon[specClass], WEAPON_REQUIRED_FIELDS[specClass]), specClass };
}

export function changeProjectileSpecClass(content: RowData, specClass: ProjectileSpecClass): RowData {
  const next = fillRequiredFields(content, defaults.projectile[specClass], PROJECTILE_REQUIRED_FIELDS[specClass]);
  if (specClass === 'missile') {
    const engine = next.engineSpec as RowData;
    next.engineSpec = fillRequiredFields(engine, defaults.projectile.missile.engineSpec, ['turnAcc', 'turnRate', 'acc', 'dec']);
  }
  next.specClass = specClass;
  return next;
}
