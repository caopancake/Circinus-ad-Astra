import type { AppFeedback, AssociatedSpecChange, CsvRowPatch, ModTableState, ProjectManifest, TableKey } from '@/shared/types';
import { getAssociatedSpecCandidates } from '@/domain/tables/associated-spec-candidates';
import { isCsvDeletedRow } from '@/domain/tables/csv-dirty';
import { writeCsvPatch } from '@/services/write.service';
import { useTablesStore } from '@/stores/tables.store';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { useProjectStore } from '@/stores/project.store';
import { resolveTableRowKey, TABLE_ROW_KEY_FIELD } from '@/domain/tables/table-row-key';
import { isLoadedCsvTableRow } from '@/domain/tables/csv-table-rows';
import type { AssociatedSpecCandidate } from '@/domain/tables/associated-spec-candidates';
import { completeSavedWrite } from '@/orchestrators/file-history-write.orchestrator';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';

export type TableSaveResult = 'saved' | 'noop' | 'cancelled';

export interface CapturedTableSaveTarget {
  associatedSpecCandidates: AssociatedSpecCandidate[];
  manifest: ProjectManifest;
  modRoot: string;
  state: ModTableState;
  table: TableKey;
}

export function captureActiveTableSaveTarget(manifest: ProjectManifest | null): CapturedTableSaveTarget | null {
  const tables = useTablesStore();
  const modRoot = tables.activeModRoot;
  const state = tables.getActiveModTableState();
  if (!manifest || !modRoot || !state || manifest.modRoot !== modRoot) return null;

  tables.finishCellEdit();
  const table = state.currentTab;
  const associatedSpecCandidates = getAssociatedSpecCandidates(state, table, manifest.associatedSpecTables, resolveTableRowKey);
  return { associatedSpecCandidates, manifest, modRoot, state, table };
}

export async function saveCapturedTableChanges(
  target: CapturedTableSaveTarget | null,
  associatedSpecs: AssociatedSpecChange[],
  feedback?: AppFeedback,
): Promise<TableSaveResult> {
  const tables = useTablesStore();
  if (!target || tables.saving) return 'noop';
  if (!isTableSaveTargetCurrent(target)) return 'noop';
  const state = target.state;

  tables.setSaving(true);
  try {
    const { manifest, modRoot, table } = target;
    if (Object.keys(state.dirty[table]).length === 0) return 'noop';

    const csvEditHistory = useTablesEditHistoryStore();
    const patches = buildCurrentTablePatches(state, table);
    const result = await runConfirmedJsonWrite(feedback, (options) =>
      writeCsvPatch(manifest.sessionId, modRoot, table, patches, associatedSpecs, options),
    );
    if (!result) return 'cancelled';
    recordLogBestEffort({
      level: 'info',
      code: 'tables.csv_saved',
      message: 'csv saved',
      path: null,
      line: null,
      fields: {
        modRoot,
        sessionId: manifest.sessionId,
        table,
        patches: String(patches.length),
        changes: String(result.changes.length),
        associatedSpecs: String(associatedSpecs.length),
      },
    });
    if (!isTableSaveTargetCurrent(target)) return 'saved';
    if (result.changes.length > 0) {
      await completeSavedWrite({ modRoot, result, label: `保存 ${table} CSV`, sessionId: manifest.sessionId }, useProjectStore());
      if (!isTableSaveTargetCurrent(target)) return 'saved';
      tables.applySavedRowKeyMapForMod(modRoot, table, result.keyMap);
      tables.markTableSavedForMod(modRoot, table);
      csvEditHistory.clearCsvEditHistory(modRoot, table);
    } else {
      tables.applySavedRowKeyMapForMod(modRoot, table, result.keyMap);
      tables.markTableSavedForMod(modRoot, table);
    }
    return 'saved';
  } finally {
    tables.setSaving(false);
  }
}

function isTableSaveTargetCurrent(target: CapturedTableSaveTarget): boolean {
  const tables = useTablesStore();
  const project = useProjectStore();
  const currentManifest = project.getManifest(target.modRoot);
  return currentManifest?.sessionId === target.manifest.sessionId && tables.getModTableState(target.modRoot) === target.state;
}

function buildCurrentTablePatches(state: ModTableState, table: TableKey): CsvRowPatch[] {
  const dirty = state.dirty[table] ?? {};
  return Object.entries(dirty).map(([rowKey, changes]) => {
    if (isCsvDeletedRow(changes)) return { rowKey, action: 'delete', row: {} };
    const row = state.tables[table].find(
      (candidate, index) => isLoadedCsvTableRow(candidate) && resolveTableRowKey(table, candidate, index) === rowKey,
    );
    const cleanRow = { ...(row ?? {}) };
    delete cleanRow[TABLE_ROW_KEY_FIELD];
    return { rowKey, action: 'upsert', row: cleanRow };
  });
}
