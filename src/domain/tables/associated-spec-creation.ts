import type { AssociatedSpecCreateParams, RowData, TableKey, WeaponSpecClass } from '@/shared/types';
import { cell } from '@/shared/lib/starsector';

const PROJECTILE_SCORE_FIELDS = [
  'damage/shot',
  'energy/shot',
  'min spread',
  'max spread',
  'spread/shot',
  'spread decay/sec',
  'proj speed',
  'launch speed',
  'flight time',
  'proj hitpoints',
];
const BEAM_SCORE_FIELDS = ['damage/second', 'energy/second', 'beam speed'];

export function inferWeaponSpecClass(row: RowData): WeaponSpecClass {
  const score = (fields: readonly string[]) => fields.filter((key) => cell(row[key]).trim() !== '').length;
  return score(BEAM_SCORE_FIELDS) > score(PROJECTILE_SCORE_FIELDS) ? 'beam' : 'projectile';
}

export function associatedSpecCreateParams(table: TableKey, id: string, row: RowData): AssociatedSpecCreateParams {
  switch (table) {
    case 'ships': {
      const name = cell(row.name);
      return { kind: 'ship', id, hullName: name.trim() ? name : id };
    }
    case 'weapons':
      return { kind: 'weapon', id, specClass: inferWeaponSpecClass(row) };
    case 'shipSystems':
      return { kind: 'system', id };
    case 'skills':
      return { kind: 'skill', id };
    default:
      throw new Error(`CSV table has no associated spec: ${table}`);
  }
}
