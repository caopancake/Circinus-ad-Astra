import { str } from '@/shared/lib/starsector/value';
import type { RowData, TableKey } from '@/shared/types';

export function rowDisplayId(row: RowData): string {
  return str(row.id) || str(row.hullId) || str(row['variant id']) || str(row.name);
}

export function rowSpecId(row: RowData, tab?: TableKey): string {
  if (tab === 'ships') return str(row.id) || str(row.hullId);
  if (tab === 'weapons' || tab === 'shipSystems' || tab === 'skills') return str(row.id);
  return str(row.id) || str(row.hullId);
}
