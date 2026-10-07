import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const writeCsvPatch = vi.hoisted(() => vi.fn());
const completeSavedWrite = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/services/write.service', () => ({ writeCsvPatch }));
vi.mock('@/orchestrators/file-history-write.orchestrator', () => ({ completeSavedWrite }));

import type { ProjectInvalidation, ProjectManifest, WriteResult } from '@/shared/types';
import { TABLE_KEYS } from '@/shared/types';
import { useProjectStore } from '@/stores/project.store';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { captureActiveTableSaveTarget, saveCapturedTableChanges } from '@/orchestrators/table-save.orchestrator';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';

const MOD_ROOT = 'M:\\test-mod';
const SESSION_ID = 'sess-1';

function buildManifest(overrides: Partial<ProjectManifest> = {}): ProjectManifest {
  return {
    sessionId: SESSION_ID,
    modRoot: MOD_ROOT,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: {},
    tableSummaries: Object.fromEntries(
      TABLE_KEYS.map((key) => [key, { path: `${key}.csv`, header: ['id', 'hullName'], available: key === 'ships', totalRows: 1 }]),
    ) as ProjectManifest['tableSummaries'],
    tableEntitySummaries: Object.fromEntries(TABLE_KEYS.map((key) => [key, 0])) as ProjectManifest['tableEntitySummaries'],
    entitySummaries: {
      factions: 0,
      missions: 0,
      ships: 0,
      weapons: 0,
      projectiles: 0,
      variants: 0,
      skins: 0,
      systems: 0,
      skills: 0,
    },
    warnings: [],
    ...overrides,
  };
}

function writeResult(overrides: Partial<WriteResult> = {}): WriteResult {
  const invalidation: ProjectInvalidation = { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false };
  return {
    changes: [
      {
        path: `${MOD_ROOT}\\ships.csv`,
        kind: 'file',
        beforeExists: true,
        beforeText: '',
        beforeDataBase64: null,
        beforeFiles: [],
        afterExists: true,
        afterText: '',
        afterDataBase64: null,
        afterFiles: [],
      },
    ],
    invalidation,
    keyMap: [],
    refreshedEntity: null,
    ...overrides,
  };
}

function hydrateActiveTable() {
  const tables = useTablesStore();
  const workspace = useWorkspaceStore();
  workspace.registerMod({ modRoot: MOD_ROOT, displayName: MOD_ROOT, version: '', status: 'ready' });
  workspace.activateModTable(MOD_ROOT);
  tables.hydrate(MOD_ROOT, buildManifest());
  const state = tables.getModTableState(MOD_ROOT);
  if (!state) throw new Error('table state missing after hydrate');
  state.tables.ships = [{ _rowKey: 'ships:r1', id: 'npc1', hullName: 'A' }];
  return state;
}

describe('table-save orchestrator', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('is a noop when nothing is dirty', async () => {
    const tables = useTablesStore();
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    tables.hydrate(MOD_ROOT, buildManifest());

    const target = captureActiveTableSaveTarget(project.getManifest(MOD_ROOT));
    expect(await saveCapturedTableChanges(target, [])).toBe('noop');
    expect(writeCsvPatch).not.toHaveBeenCalled();
    expect(completeSavedWrite).not.toHaveBeenCalled();
  });

  it('submits upsert patches without the internal row key and clears dirty after recording history', async () => {
    const tables = useTablesStore();
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();

    tables.updateCellValueByKey('ships:r1', 'hullName', 'B');
    expect(Object.keys(state.dirty.ships).length).toBe(1);

    writeCsvPatch.mockResolvedValue(writeResult());
    const target = captureActiveTableSaveTarget(project.getManifest(MOD_ROOT));
    completeSavedWrite.mockImplementationOnce(async () => {
      // Invalidation and history recording must happen before the draft cleanup.
      expect(Object.keys(state.dirty.ships).length).toBe(1);
    });

    expect(await saveCapturedTableChanges(target, [])).toBe('saved');
    expect(writeCsvPatch).toHaveBeenCalledWith(
      'sess-1',
      MOD_ROOT,
      'ships',
      [{ rowKey: 'ships:r1', action: 'upsert', row: { id: 'npc1', hullName: 'B' } }],
      [],
      { preserveOriginalJson: false, confirmedSources: [] },
    );
    expect(completeSavedWrite).toHaveBeenCalledWith(
      {
        modRoot: MOD_ROOT,
        sessionId: SESSION_ID,
        label: '保存 ships CSV',
        result: expect.objectContaining({ changes: expect.any(Array) }),
      },
      project,
    );
    expect(Object.keys(state.dirty.ships).length).toBe(0);
  });

  it('submits a delete patch for dirty deletion rows', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();

    state.tables.ships = [{ _rowKey: 'ships:r1', id: 'npc1', hullName: 'A' }];
    state.dirty.ships['ships:r1'] = { action: 'delete' };

    writeCsvPatch.mockResolvedValue(writeResult());
    completeSavedWrite.mockResolvedValue(undefined);
    const target = captureActiveTableSaveTarget(project.getManifest(MOD_ROOT));

    expect(await saveCapturedTableChanges(target, [])).toBe('saved');
    expect(writeCsvPatch).toHaveBeenCalledWith('sess-1', MOD_ROOT, 'ships', [{ rowKey: 'ships:r1', action: 'delete', row: {} }], [], {
      preserveOriginalJson: false,
      confirmedSources: [],
    });
  });

  it('is a noop when the session changed since capture', async () => {
    const tables = useTablesStore();
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();

    tables.updateCellValueByKey('ships:r1', 'hullName', 'B');
    const target = captureActiveTableSaveTarget(project.getManifest(MOD_ROOT));
    project.manifests.set(MOD_ROOT, { ...buildManifest(), sessionId: 'sess-2' });

    expect(await saveCapturedTableChanges(target, [])).toBe('noop');
    expect(writeCsvPatch).not.toHaveBeenCalled();
    expect(state.dirty.ships['ships:r1']).toBeDefined();
  });

  it('keeps edits made during writing dirty against the persisted snapshot', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    state.originalTables.ships = [{ ...state.tables.ships[0] }];
    const tables = useTablesStore();
    tables.updateCellValueByKey('ships:r1', 'hullName', 'B');
    let resolveWrite!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(() => new Promise<WriteResult>((resolve) => (resolveWrite = resolve)));
    const pending = saveCapturedTableChanges(captureActiveTableSaveTarget(project.getManifest(MOD_ROOT)), []);
    tables.updateCellValueByKey('ships:r1', 'hullName', 'C');
    resolveWrite(writeResult());
    await pending;
    expect(state.originalTables.ships[0]?.hullName).toBe('B');
    expect(state.tables.ships[0]?.hullName).toBe('C');
    expect(state.dirty.ships['ships:r1']).toEqual({ action: 'upsert', cells: { hullName: 'C' } });
    expect(tables.undoCurrentTableEdit()).toBeTruthy();
    expect(state.tables.ships[0]?.hullName).toBe('B');
    expect(state.dirty.ships['ships:r1']).toBeUndefined();
    expect(useTablesEditHistoryStore().canUndoCsvEdit(MOD_ROOT, 'ships')).toBe(false);
  });

  it('keeps a return to the old baseline dirty when the submitted version was written', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    state.originalTables.ships = [{ ...state.tables.ships[0] }];
    const tables = useTablesStore();
    tables.updateCellValueByKey('ships:r1', 'hullName', 'B');
    completeSavedWrite.mockImplementationOnce(async () => tables.updateCellValueByKey('ships:r1', 'hullName', 'A'));
    writeCsvPatch.mockResolvedValueOnce(writeResult());
    await saveCapturedTableChanges(captureActiveTableSaveTarget(project.getManifest(MOD_ROOT)), []);
    expect(state.originalTables.ships[0]?.hullName).toBe('B');
    expect(state.dirty.ships['ships:r1']).toEqual({ action: 'upsert', cells: { hullName: 'A' } });
  });

  it('maps a newly saved row and keeps its later deletion replayable', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    state.headers.ships = ['id', 'hullName'];
    const tables = useTablesStore();
    const created = tables.addNewRow()!;
    let resolveWrite!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(() => new Promise<WriteResult>((resolve) => (resolveWrite = resolve)));
    const pending = saveCapturedTableChanges(captureActiveTableSaveTarget(project.getManifest(MOD_ROOT)), []);
    tables.deleteSelected();
    resolveWrite(writeResult({ keyMap: [{ previousKey: created.rowKey, nextKey: 'ships:row:2' }] }));
    await pending;
    expect(state.dirty.ships['ships:row:2']).toEqual({ action: 'delete' });
    expect(useTablesEditHistoryStore().canUndoCsvEdit(MOD_ROOT, 'ships')).toBe(true);
    tables.undoCurrentTableEdit();
    expect(state.tables.ships.some((row) => row?._rowKey === 'ships:row:2')).toBe(true);
    expect(state.dirty.ships['ships:row:2']).toBeUndefined();
  });

  it('preserves drafts and history when the backend returns no file changes', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    const tables = useTablesStore();
    tables.updateCellValueByKey('ships:r1', 'hullName', 'B');
    writeCsvPatch.mockResolvedValueOnce(writeResult({ changes: [] }));
    await saveCapturedTableChanges(captureActiveTableSaveTarget(project.getManifest(MOD_ROOT)), []);
    expect(state.dirty.ships['ships:r1']).toBeDefined();
    expect(useTablesEditHistoryStore().canUndoCsvEdit(MOD_ROOT, 'ships')).toBe(true);
  });
});
