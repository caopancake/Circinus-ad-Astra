import type { AssociatedSpecChange, ModTableState, TableKey } from '@/shared/types';
import { rowSpecId } from '@/shared/lib/starsector';
import { isCsvDeletedRow } from '@/domain/tables/csv-dirty';
import { isLoadedCsvTableRow } from '@/domain/tables/csv-table-rows';
import { associatedSpecCreateParams } from '@/domain/tables/associated-spec-creation';

export interface AssociatedSpecCandidate {
  key: string;
  table: TableKey;
  label: string;
  change: AssociatedSpecChange;
}

export function getAssociatedSpecCandidates(
  state: ModTableState | undefined,
  table: TableKey,
  associatedSpecTables: readonly TableKey[],
): AssociatedSpecCandidate[] {
  if (!state || !associatedSpecTables.includes(table)) return [];
  const originalRows = new Map(state.originalTables[table].filter(isLoadedCsvTableRow).map((row) => [row.rowKey, row]));
  const currentRows = new Map(state.tables[table].filter(isLoadedCsvTableRow).map((row) => [row.rowKey, row]));
  const candidates: AssociatedSpecCandidate[] = [];
  for (const [rowKey, dirty] of Object.entries(state.dirty[table])) {
    const original = originalRows.get(rowKey);
    const previousId = original ? rowSpecId(original.data, table) : '';
    if (isCsvDeletedRow(dirty)) {
      if (previousId)
        candidates.push({
          key: JSON.stringify([table, 'delete', previousId]),
          table,
          label: `删除关联 spec ${previousId}`,
          change: { action: 'delete', id: previousId },
        });
      continue;
    }
    const current = currentRows.get(rowKey)!;
    const id = rowSpecId(current.data, table);
    if (!id || (original && (!previousId || previousId === id))) continue;
    const create = associatedSpecCreateParams(table, id, current.data);
    const change: AssociatedSpecChange = original ? { action: 'rename', previousId, create } : { action: 'create', create };
    candidates.push({
      key: JSON.stringify([table, change.action, previousId, id]),
      table,
      label: original ? `重命名关联 spec ${previousId} -> ${id}` : `创建关联 spec ${id}`,
      change,
    });
  }
  return candidates;
}
