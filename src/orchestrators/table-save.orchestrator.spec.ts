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
import { saveActiveTableChanges } from '@/orchestrators/table-save.orchestrator';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { ref } from 'vue';
import type { AssociatedSpecCandidate } from '@/domain/tables/associated-spec-candidates';
import type { AssociatedSpecChange } from '@/shared/types';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';

const MOD_ROOT = 'M:\\test-mod';
const SESSION_ID = 'sess-1';

function buildManifest(overrides: Partial<ProjectManifest> = {}): ProjectManifest {
  return {
    baseVersions: [],
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
    baseVersions: [],
    commitId: 1,
    history: { revision: 1, undoStack: [], redoStack: [] },
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

  it('commits pending input before taking the CSV and history snapshot', async () => {
    const project = useProjectStore();
    const manifest = buildManifest();
    project.manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable();
    state.originalTables.ships = [{ ...state.tables.ships[0] }];
    const tables = useTablesStore();
    const pendingDirty = ref(true);
    tables.getTableInputs(MOD_ROOT, 'ships').register({
      key: 'ships:r1/hullName',
      label: '舰名',
      dirty: pendingDirty,
      commit: () => {
        tables.updateCellValue(
          { sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' },
          'typed',
        );
        pendingDirty.value = false;
        return null;
      },
      focus: vi.fn(),
      cancel: vi.fn(),
    });
    expect(useDraftSessionsStore().hasUnsavedWorkForMod(MOD_ROOT)).toBe(true);
    expect(state.dirty.ships).toEqual({});
    writeCsvPatch.mockResolvedValueOnce(writeResult());
    await saveActiveTableChanges({ manifest, selectAssociatedSpecs: async () => [] });
    expect(writeCsvPatch.mock.calls.at(-1)?.[3]).toEqual([
      { rowKey: 'ships:r1', action: 'upsert', row: { id: 'npc1', hullName: 'typed' } },
    ]);
    expect(useDraftSessionsStore().hasUnsavedWorkForMod(MOD_ROOT)).toBe(false);
  });

  it('keeps CSV, associated specs, credentials and history fixed while selection is pending', async () => {
    const project = useProjectStore();
    const manifest = buildManifest({ associatedSpecTables: ['ships'] });
    project.manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable();
    state.originalTables.ships = [{ ...state.tables.ships[0] }];
    state.baseVersions.ships = [{ path: 'ships.csv', fingerprint: 'base' }];
    const tables = useTablesStore();
    const cellTarget = { sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships' as const, rowKey: 'ships:r1', column: 'id' };
    tables.updateCellValue(cellTarget, 'submitted');
    let release!: (selection: AssociatedSpecChange[]) => void;
    let candidates!: AssociatedSpecCandidate[];
    const saving = saveActiveTableChanges({
      manifest,
      selectAssociatedSpecs: (choices) => {
        candidates = choices;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    expect(tables.saving).toBe(true);
    tables.updateCellValue(cellTarget, 'later');
    state.baseVersions.ships[0]!.fingerprint = 'later-version';
    expect(candidates[0]?.row.id).toBe('submitted');
    expect(saveActiveTableChanges({ manifest, selectAssociatedSpecs: async () => [] })).toBe(saving);
    writeCsvPatch.mockResolvedValueOnce(writeResult());
    release(candidates.map(({ action, id, previousId, row }) => ({ action, id, previousId, row })));
    await saving;
    const call = writeCsvPatch.mock.calls.at(-1)!;
    expect(call[3][0].row.id).toBe('submitted');
    expect(call[4][0].row.id).toBe('submitted');
    expect(call[6]).toEqual([{ path: 'ships.csv', fingerprint: 'base' }]);
    expect(state.tables.ships[0]?.id).toBe('later');
    expect(tables.undoCurrentTableEdit()).toBeTruthy();
    expect(state.tables.ships[0]?.id).toBe('submitted');
    expect(tables.saving).toBe(false);
  });

  it('retains the input and ends preparation after a rejected commit', async () => {
    const project = useProjectStore();
    const manifest = buildManifest();
    project.manifests.set(MOD_ROOT, manifest);
    hydrateActiveTable();
    const tables = useTablesStore();
    const focus = vi.fn();
    tables.getTableInputs(MOD_ROOT, 'ships').register({
      key: 'ships:r1/id',
      label: 'ID',
      dirty: ref(true),
      commit: () => '未完成',
      focus,
      cancel: vi.fn(),
    });
    await expect(saveActiveTableChanges({ manifest, selectAssociatedSpecs: async () => [] })).rejects.toMatchObject({
      action: 'commit-field-inputs',
    });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(writeCsvPatch).not.toHaveBeenCalled();
    expect(tables.saving).toBe(false);
    expect(tables.hasCurrentTableChanges).toBe(true);
  });

  it('is a noop when nothing is dirty', async () => {
    const tables = useTablesStore();
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    tables.hydrate(MOD_ROOT, buildManifest());

    const manifest = project.getManifest(MOD_ROOT);
    expect(await saveActiveTableChanges({ manifest, selectAssociatedSpecs: async () => [] })).toBe('noop');
    expect(writeCsvPatch).not.toHaveBeenCalled();
    expect(completeSavedWrite).not.toHaveBeenCalled();
  });

  it('keeps the persisted baseline and receipt when post-save synchronization fails', async () => {
    const project = useProjectStore();
    const manifest = buildManifest();
    project.manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable();
    state.originalTables.ships = [{ ...state.tables.ships[0] }];
    const tables = useTablesStore();
    const generation = tables.tableReadGeneration(MOD_ROOT, 'ships');
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'Written');
    const result = writeResult({ baseVersions: [{ path: 'ships.csv', fingerprint: 'v2' }] });
    writeCsvPatch.mockResolvedValueOnce(result);
    completeSavedWrite.mockRejectedValueOnce(new Error('sync failed'));
    await expect(saveActiveTableChanges({ manifest, selectAssociatedSpecs: async () => [] })).rejects.toThrow('sync failed');
    expect(state.originalTables.ships[0]?.hullName).toBe('Written');
    expect(state.baseVersions.ships).toEqual(result.baseVersions);
    expect(state.dirty.ships).toEqual({});
    expect(tables.tableReadGeneration(MOD_ROOT, 'ships')).toBeGreaterThan(generation);
    expect(tables.saving).toBe(false);
    expect(result.keyMap).toEqual([]);
  });

  it('submits upsert patches without the internal row key and clears dirty after recording history', async () => {
    const tables = useTablesStore();
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();

    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'B');
    expect(Object.keys(state.dirty.ships).length).toBe(1);

    writeCsvPatch.mockResolvedValue(writeResult());
    const manifest = project.getManifest(MOD_ROOT);
    completeSavedWrite.mockImplementationOnce(async () => {
      expect(Object.keys(state.dirty.ships).length).toBe(0);
      expect(state.originalTables.ships[0]?.hullName).toBe('B');
    });

    expect(await saveActiveTableChanges({ manifest, selectAssociatedSpecs: async () => [] })).toBe('saved');
    expect(writeCsvPatch).toHaveBeenCalledWith(
      'sess-1',
      MOD_ROOT,
      'ships',
      [{ rowKey: 'ships:r1', action: 'upsert', row: { id: 'npc1', hullName: 'B' } }],
      [],
      { preserveOriginalJson: false, confirmedSources: [] },
      [],
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
    const manifest = project.getManifest(MOD_ROOT);

    expect(await saveActiveTableChanges({ manifest, selectAssociatedSpecs: async () => [] })).toBe('saved');
    expect(writeCsvPatch).toHaveBeenCalledWith(
      'sess-1',
      MOD_ROOT,
      'ships',
      [{ rowKey: 'ships:r1', action: 'delete', row: {} }],
      [],
      {
        preserveOriginalJson: false,
        confirmedSources: [],
      },
      [],
    );
  });

  it('is a noop when the session changed since capture', async () => {
    const tables = useTablesStore();
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();

    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'B');
    const manifest = project.getManifest(MOD_ROOT);
    project.manifests.set(MOD_ROOT, { ...buildManifest(), sessionId: 'sess-2' });

    expect(await saveActiveTableChanges({ manifest, selectAssociatedSpecs: async () => [] })).toBe('noop');
    expect(writeCsvPatch).not.toHaveBeenCalled();
    expect(state.dirty.ships['ships:r1']).toBeDefined();
  });

  it('keeps edits made during writing dirty against the persisted snapshot', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    state.originalTables.ships = [{ ...state.tables.ships[0] }];
    const tables = useTablesStore();
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'B');
    let resolveWrite!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(() => new Promise<WriteResult>((resolve) => (resolveWrite = resolve)));
    const pending = saveActiveTableChanges({ manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'C');
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
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'B');
    completeSavedWrite.mockImplementationOnce(async () =>
      tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'A'),
    );
    writeCsvPatch.mockResolvedValueOnce(writeResult());
    await saveActiveTableChanges({ manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
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
    const pending = saveActiveTableChanges({ manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
    tables.deleteSelected();
    resolveWrite(
      writeResult({
        keyMap: [
          {
            rowIndex: 0,
            previousKey: created.rowKey,
            nextKey: 'ships:row:2',
          },
        ],
      }),
    );
    await pending;
    expect(state.dirty.ships['ships:row:2']).toEqual({ action: 'delete' });
    expect(useTablesEditHistoryStore().canUndoCsvEdit(MOD_ROOT, 'ships')).toBe(true);
    tables.undoCurrentTableEdit();
    expect(state.tables.ships.some((row) => row?._rowKey === 'ships:row:2')).toBe(true);
    expect(state.dirty.ships['ships:row:2']).toBeUndefined();
  });

  it('accepts the persisted baseline when the backend reports an unchanged file', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    const tables = useTablesStore();
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'B');
    writeCsvPatch.mockResolvedValueOnce(writeResult({ changes: [] }));
    await saveActiveTableChanges({ manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
    expect(state.dirty.ships['ships:r1']).toBeUndefined();
    expect(state.originalTables.ships[0]?.hullName).toBe('B');
    expect(useTablesEditHistoryStore().canUndoCsvEdit(MOD_ROOT, 'ships')).toBe(false);
  });

  it('rebases a deletion undone during saving into an insert at the original position', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    state.tables.ships = [
      { _rowKey: 'ships:r1', _sourceRowIndex: 0, id: 'first' },
      { _rowKey: 'ships:r2', _sourceRowIndex: 1, id: 'second' },
    ];
    state.originalTables.ships = state.tables.ships.map((row) => ({ ...row }));
    const tables = useTablesStore();
    tables.selectRowByKey('ships:r1');
    tables.deleteSelected();
    let release!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const saving = saveActiveTableChanges({ manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
    tables.undoCurrentTableEdit();
    release(writeResult());
    await saving;
    const restoredKey = state.tables.ships[0]!._rowKey as string;
    expect(restoredKey).toMatch(/^ships:new:/);
    expect(state.tables.ships[0]?._insertAt).toBe(0);
    expect(state.dirty.ships[restoredKey]?.action).toBe('upsert');
    writeCsvPatch.mockResolvedValueOnce(writeResult({ keyMap: [{ previousKey: restoredKey, nextKey: 'ships:row:3', rowIndex: 0 }] }));
    await saveActiveTableChanges({ manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
    expect(writeCsvPatch.mock.calls.at(-1)?.[3]).toEqual([{ rowKey: restoredKey, action: 'upsert', insertAt: 0, row: { id: 'first' } }]);
    expect(state.tables.ships.map((row) => row?.id)).toEqual(['first', 'second']);
    expect(state.tables.ships.map((row) => row?._sourceRowIndex)).toEqual([0, 1]);
    expect(state.dirty.ships).toEqual({});
  });
});
