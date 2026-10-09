import type { AppFeedback, AssociatedSpecChange, CsvRowPatch, ModTableState, ProjectManifest, TableKey } from '@/shared/types';
import { getAssociatedSpecCandidates } from '@/domain/tables/associated-spec-candidates';
import { isCsvDeletedRow } from '@/domain/tables/csv-dirty';
import { writeCsvPatch } from '@/services/write.service';
import { useTablesStore } from '@/stores/tables.store';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { useProjectStore } from '@/stores/project.store';
import { isLoadedCsvTableRow } from '@/domain/tables/csv-table-rows';
import type { AssociatedSpecCandidate } from '@/domain/tables/associated-spec-candidates';
import { completeSavedWrite } from '@/orchestrators/file-history-write.orchestrator';
import { retryPendingWritesForMod } from '@/orchestrators/project-session-refresh.orchestrator';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { commitCsvTableSaveDraft } from '@/domain/tables/csv-table-draft';
import { deepClone } from '@/shared/lib/starsector';
import { isAbsoluteFsPath, joinRootRelativePath, normalizeFsPath } from '@/shared/lib/paths';
import { captureAssociatedSpecTarget } from '@/services/csv-table.service';
import { reserveNativeWindowTargets, releaseNativeWindowTargets } from '@/services/window.service';
import type { WindowIdentity } from '@/shared/types';

export type TableSaveResult = { status: 'saved'; receipt: import('@/shared/types').WriteResult } | { status: 'noop' | 'cancelled' };

interface CapturedTableSaveTarget {
  manifest: ProjectManifest;
  modRoot: string;
  state: ModTableState;
  table: TableKey;
}

interface TableSaveOptions {
  table: TableKey;
  manifest: ProjectManifest | null;
  selectAssociatedSpecs: (candidates: AssociatedSpecCandidate[]) => Promise<AssociatedSpecChange[] | null>;
  feedback?: AppFeedback;
}

const pendingSaves = new WeakMap<
  ReturnType<typeof useTablesStore>,
  { target: CapturedTableSaveTarget; promise: Promise<TableSaveResult> }
>();

export function pendingTableSave() {
  return pendingSaves.get(useTablesStore()) ?? null;
}

export function saveTableChanges(options: TableSaveOptions): Promise<TableSaveResult> {
  const tables = useTablesStore();
  const pending = pendingSaves.get(tables);
  if (pending) {
    if (pending.target.modRoot === options.manifest?.modRoot && pending.target.table === options.table) return pending.promise;
    return pending.promise.then(() => saveTableChanges(options));
  }
  const target = captureTableSaveTarget(options);
  if (!target) return Promise.resolve({ status: 'noop' });
  tables.revokeTableReads(target.modRoot, target.table);
  tables.setSaving(true);
  const saving = saveTarget(target, options).finally(async () => {
    try {
      await releaseNativeWindowTargets();
    } finally {
      tables.setSaving(false);
      pendingSaves.delete(tables);
    }
  });
  pendingSaves.set(tables, { target, promise: saving });
  return saving;
}

function captureTableSaveTarget({ manifest, table }: TableSaveOptions): CapturedTableSaveTarget | null {
  const tables = useTablesStore();
  if (!manifest) return null;
  const modRoot = manifest.modRoot;
  const state = tables.getModTableState(modRoot);
  if (!state) return null;
  return { manifest, modRoot, state, table };
}

async function saveTarget(target: CapturedTableSaveTarget, options: TableSaveOptions): Promise<TableSaveResult> {
  const synchronization = retryPendingWritesForMod(target.modRoot);
  if (synchronization) await synchronization;
  const tables = useTablesStore();
  const state = target.state;
  const pending = tables.getTableInputs(target.modRoot, target.table).commit();
  if (pending && !(await pending)) return { status: 'cancelled' };
  if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
  const { manifest, modRoot, table } = target;
  if (Object.keys(state.dirty[table]).length === 0) return { status: 'noop' };

  const csvEditHistory = useTablesEditHistoryStore();
  const submittedHistory = csvEditHistory.captureSaveHistory(modRoot, table);
  const patches = buildCurrentTablePatches(state, table);
  const baseVersions = deepClone(state.baseVersions[table]);
  const candidates = deepClone(getAssociatedSpecCandidates(state, table, manifest.associatedSpecTables));
  const sourceTargets = new Map(
    candidates.length > 0
      ? await Promise.all(
          candidates.map(
            async (candidate) => [candidate.key, await captureAssociatedSpecTarget(manifest.sessionId, table, candidate.change)] as const,
          ),
        )
      : [],
  );
  const associatedSpecs = candidates.length > 0 ? await options.selectAssociatedSpecs(candidates) : [];
  if (associatedSpecs === null) return { status: 'cancelled' };
  if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
  const writes = associatedSpecs.map((change) => {
    const candidate = candidates.find(
      (candidate) =>
        candidate.change.action === change.action &&
        (change.action === 'delete'
          ? candidate.change.action === 'delete' && candidate.change.id === change.id
          : candidate.change.action !== 'delete' && candidate.change.create.id === change.create.id),
    )!;
    const source = sourceTargets.get(candidate.key)!;
    for (const version of source.versions) if (!baseVersions.some((existing) => existing.path === version.path)) baseVersions.push(version);
    return { change, target: source.target };
  });
  const reservations = writes.flatMap<WindowIdentity>((write) => {
    if (write.change.action === 'delete') return [];
    const nextId = write.change.create.id;
    const candidate = candidates.find((candidate) => candidate.change.action !== 'delete' && candidate.change.create.id === nextId)!;
    const next = sourceTargets.get(candidate.key)!.nextWrite;
    const identities: WindowIdentity[] = [{ type: 'file', sessionId: manifest.sessionId, modRoot, path: next.path }];
    if (write.target.kind === 'ship' || write.target.kind === 'weapon' || write.target.kind === 'system')
      identities.push({ type: 'spec', sessionId: manifest.sessionId, modRoot, kind: write.target.kind, id: write.change.create.id });
    return identities;
  });
  if (reservations.length > 0) await reserveNativeWindowTargets(reservations);
  const result = await runConfirmedJsonWrite(options.feedback, (writeOptions) =>
    writeCsvPatch(manifest.sessionId, modRoot, table, patches, writes, writeOptions, baseVersions),
  );
  if (!result) return { status: 'cancelled' };
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
  if (!isTableSaveTargetCurrent(target)) return { status: 'saved', receipt: result };
  tables.revokeTableReads(modRoot, table);
  const keyMap = deepClone(result.keyMap);
  commitCsvTableSaveDraft(state, table, patches, keyMap);
  const tablePath = normalizeFsPath(joinRootRelativePath(modRoot, manifest.tableSummaries[table].path));
  state.baseVersions[table] = result.baseVersions.filter(
    (version) => normalizeFsPath(isAbsoluteFsPath(version.path) ? version.path : joinRootRelativePath(modRoot, version.path)) === tablePath,
  );
  csvEditHistory.applySavedRowKeyMap(modRoot, table, keyMap);
  csvEditHistory.commitSaveHistory(modRoot, table, submittedHistory);
  if (Object.keys(state.dirty[table]).length === 0) csvEditHistory.clearCsvEditHistory(modRoot, table);
  await releaseNativeWindowTargets();
  await completeSavedWrite({ modRoot, result, label: `保存 ${table} CSV`, sessionId: manifest.sessionId });
  return { status: 'saved', receipt: result };
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
    const row = state.tables[table].find((candidate) => isLoadedCsvTableRow(candidate) && candidate.rowKey === rowKey)!;
    const cleanRow = deepClone(row.data);
    return { rowKey, action: 'upsert', row: cleanRow, ...(row.insertAt !== null ? { insertAt: row.insertAt } : {}) };
  });
}
