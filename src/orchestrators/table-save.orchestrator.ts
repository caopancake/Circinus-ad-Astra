import type { AppFeedback, AssociatedSpecChange, CsvRowPatch, ModTableState, ProjectManifest, TableKey } from '@/shared/types';
import { getAssociatedSpecCandidates } from '@/domain/tables/associated-spec-candidates';
import { isCsvDeletedRow } from '@/domain/tables/csv-dirty';
import { writeCsvPatch } from '@/services/write.service';
import { useTablesStore } from '@/stores/tables.store';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { useProjectStore } from '@/stores/project.store';
import { resolveTableRowKey } from '@/domain/tables/table-row-key';
import { isInternalJsonFieldKey } from '@/shared/lib/json-fields';
import { isLoadedCsvTableRow } from '@/domain/tables/csv-table-rows';
import type { AssociatedSpecCandidate } from '@/domain/tables/associated-spec-candidates';
import { completeSavedWrite } from '@/orchestrators/file-history-write.orchestrator';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { commitCsvTableSaveDraft } from '@/domain/tables/csv-table-draft';
import { deepClone } from '@/shared/lib/starsector';

export type TableSaveResult = 'saved' | 'noop' | 'cancelled';

interface CapturedTableSaveTarget {
  manifest: ProjectManifest;
  modRoot: string;
  state: ModTableState;
  table: TableKey;
}

interface TableSaveOptions {
  manifest: ProjectManifest | null;
  selectAssociatedSpecs: (candidates: AssociatedSpecCandidate[]) => Promise<AssociatedSpecChange[] | null>;
  feedback?: AppFeedback;
}

const pendingSaves = new WeakMap<ReturnType<typeof useTablesStore>, Promise<TableSaveResult>>();

export function saveActiveTableChanges(options: TableSaveOptions): Promise<TableSaveResult> {
  const tables = useTablesStore();
  const pending = pendingSaves.get(tables);
  if (pending) return pending;
  const target = captureActiveTableSaveTarget(options.manifest);
  if (!target) return Promise.resolve('noop');
  tables.setSaving(true);
  const saving = saveTarget(target, options).finally(() => {
    tables.setSaving(false);
    pendingSaves.delete(tables);
  });
  pendingSaves.set(tables, saving);
  return saving;
}

function captureActiveTableSaveTarget(manifest: ProjectManifest | null): CapturedTableSaveTarget | null {
  const tables = useTablesStore();
  const modRoot = tables.activeModRoot;
  const state = tables.getActiveModTableState();
  if (!manifest || !modRoot || !state || manifest.modRoot !== modRoot) return null;

  const table = state.currentTab;
  return { manifest, modRoot, state, table };
}

async function saveTarget(target: CapturedTableSaveTarget, options: TableSaveOptions): Promise<TableSaveResult> {
  const tables = useTablesStore();
  const state = target.state;
  const pending = tables.getTableInputs(target.modRoot, target.table).commit();
  if (pending && !(await pending)) return 'cancelled';
  if (!isTableSaveTargetCurrent(target)) return 'noop';
  const { manifest, modRoot, table } = target;
  if (Object.keys(state.dirty[table]).length === 0) return 'noop';

  const csvEditHistory = useTablesEditHistoryStore();
  const submittedHistory = csvEditHistory.captureSaveHistory(modRoot, table);
  const patches = buildCurrentTablePatches(state, table);
  const baseVersions = deepClone(state.baseVersions[table]);
  const candidates = deepClone(getAssociatedSpecCandidates(state, table, manifest.associatedSpecTables, resolveTableRowKey));
  const associatedSpecs = candidates.length > 0 ? await options.selectAssociatedSpecs(candidates) : [];
  if (associatedSpecs === null) return 'cancelled';
  if (!isTableSaveTargetCurrent(target)) return 'noop';
  const result = await runConfirmedJsonWrite(options.feedback, (writeOptions) =>
    writeCsvPatch(manifest.sessionId, modRoot, table, patches, associatedSpecs, writeOptions, baseVersions),
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
    commitCsvTableSaveDraft(state, table, patches, result.keyMap);
    state.baseVersions[table] = result.baseVersions;
    csvEditHistory.applySavedRowKeyMap(modRoot, table, result.keyMap);
    csvEditHistory.commitSaveHistory(modRoot, table, submittedHistory);
    if (Object.keys(state.dirty[table]).length === 0) csvEditHistory.clearCsvEditHistory(modRoot, table);
  }
  return 'saved';
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
    const cleanRow = deepClone(Object.fromEntries(Object.entries(row ?? {}).filter(([key]) => !isInternalJsonFieldKey(key))));
    return { rowKey, action: 'upsert', row: cleanRow, ...(typeof row?._insertAt === 'number' ? { insertAt: row._insertAt } : {}) };
  });
}
