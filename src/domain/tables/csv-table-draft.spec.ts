import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTablesStore } from '@/stores/tables.store';
import { TABLE_KEYS, type CsvTableWindow, type ProjectManifest, type TableSummary } from '@/shared/types';
import { applyCsvDraftOperation, applyCsvTableWindowDraft, commitCsvTableSaveDraft, setCsvCellValueDraft } from './csv-table-draft';
import { getAssociatedSpecCandidates } from './associated-spec-candidates';

beforeEach(() => setActivePinia(createPinia()));

function fixture() {
  const tables = useTablesStore();
  const manifest: ProjectManifest = {
    sessionId: 'session',
    modRoot: 'M:/mod',
    baseVersions: [],
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: {},
    warnings: [],
    tableSummaries: Object.fromEntries(
      TABLE_KEYS.map<[string, TableSummary]>((key) => [key, { path: `${key}.csv`, header: [], available: true, totalRows: 0 }]),
    ) as ProjectManifest['tableSummaries'],
    tableEntitySummaries: Object.fromEntries(TABLE_KEYS.map((key) => [key, 0])) as ProjectManifest['tableEntitySummaries'],
    entitySummaries: { ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0, factions: 0, missions: 0 },
  };
  tables.initializeModTables({ sessionId: manifest.sessionId, modRoot: 'M:/mod', manifest });
  const state = tables.getModTableState('M:/mod')!;
  const window: CsvTableWindow = {
    table: 'ships',
    baseVersions: [{ path: 'ship_data.csv', fingerprint: 'base' }],
    header: ['id', '_rowKey', '_faction', '_insertAt', '_sourceRowIndex'],
    totalRows: 1,
    filteredRows: 1,
    start: 0,
    rows: [
      {
        rowKey: 'ships:row:0',
        isComment: false,
        sourceRowIndex: 0,

        data: { id: 'ship', _rowKey: 'business-key', _faction: 'business-faction', _insertAt: '001', _sourceRowIndex: '02' },
      },
    ],
  };
  applyCsvTableWindowDraft(state, window);
  return { state, window };
}

describe('CSV business content and metadata acceptance', () => {
  it('edits prototype-named business columns and records their dirty cells as own keys', () => {
    const { state, window } = fixture();
    window.header = ['id', '__proto__', 'constructor'];
    window.rows[0]!.data = JSON.parse('{"id":"ship","__proto__":"original"}');
    applyCsvTableWindowDraft(state, window);
    expect(state.tables.ships[0]!.data.constructor).toBeUndefined();
    const edit = setCsvCellValueDraft(state, 'ships', 'ships:row:0', '__proto__', 'edited');
    expect(Object.hasOwn(state.tables.ships[0]!.data, '__proto__')).toBe(true);
    expect(state.tables.ships[0]!.data.__proto__).toBe('edited');
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: JSON.parse('{"__proto__":"edited"}') });
    applyCsvDraftOperation(state, edit.historyOperation!, 'undo');
    expect(state.tables.ships[0]!.data.__proto__).toBe('original');
    expect(state.dirty.ships).toEqual({});
  });
  it('retains quoted hash data during other edits and restores its exact flag through history', () => {
    const { state, window } = fixture();
    window.rows[0]!.data.id = '#quoted';
    applyCsvTableWindowDraft(state, window);
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', '_rowKey', '#other-column');
    expect(state.tables.ships[0]?.isComment).toBe(false);
    const edit = setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', '#disabled');
    expect(state.tables.ships[0]?.isComment).toBe(true);
    applyCsvDraftOperation(state, edit.historyOperation!, 'undo');
    expect(state.tables.ships[0]).toMatchObject({ data: { id: '#quoted' }, isComment: false });
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: { _rowKey: '#other-column' } });
    applyCsvDraftOperation(state, edit.historyOperation!, 'redo');
    expect(state.tables.ships[0]?.isComment).toBe(true);
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', '#quoted');
    expect(state.tables.ships[0]?.isComment).toBe(false);
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', ' #space');
    expect(state.tables.ships[0]?.isComment).toBe(false);
  });

  it('retains a later comment edit against the captured saved baseline', () => {
    const { state, window } = fixture();
    window.rows[0]!.data.id = '#quoted';
    applyCsvTableWindowDraft(state, window);
    const edit = setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', '#comment');
    commitCsvTableSaveDraft(
      state,
      'ships',
      [{ rowKey: 'ships:row:0', action: 'upsert', row: { ...window.rows[0]!.data }, isComment: false }],
      [],
    );
    expect(state.originalTables.ships[0]).toMatchObject({ data: { id: '#quoted' }, isComment: false });
    expect(state.tables.ships[0]).toMatchObject({ data: { id: '#comment' }, isComment: true });
    applyCsvDraftOperation(state, edit.historyOperation!, 'undo');
    expect(state.tables.ships[0]?.isComment).toBe(false);
    expect(state.dirty.ships).toEqual({});
    applyCsvDraftOperation(state, edit.historyOperation!, 'redo');
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: { id: '#comment' } });
  });

  it('compares comment semantics in external baselines and associated spec candidates', () => {
    const { state, window } = fixture();
    window.header = ['name', 'id'];
    window.rows[0]!.data = { name: '#note', id: 'ship' };
    window.rows[0]!.isComment = true;
    applyCsvTableWindowDraft(state, window);
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', 'renamed');
    expect(getAssociatedSpecCandidates(state, 'ships', ['ships'])).toEqual([]);
    state.dirty.ships['ships:row:0'] = { action: 'delete' };
    expect(getAssociatedSpecCandidates(state, 'ships', ['ships'])).toEqual([]);
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'name', 'active');
    expect(getAssociatedSpecCandidates(state, 'ships', ['ships'])[0]?.change).toMatchObject({
      action: 'create',
      create: { id: 'renamed' },
    });
    const refreshed = { ...window, rows: [{ ...window.rows[0]!, isComment: false }] };
    applyCsvTableWindowDraft(state, refreshed, true);
    expect(state.pendingExternalTableUpdates.ships).toBe(true);
    expect(state.tables.ships[0]?.data.name).toBe('active');
  });

  it('keeps colliding business columns editable under their formal row identity', () => {
    const { state } = fixture();
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', '_rowKey', 'changed-business');
    expect(state.tables.ships[0]).toMatchObject({
      rowKey: 'ships:row:0',

      sourceRowIndex: 0,
      insertAt: null,
      data: { _rowKey: 'changed-business', _faction: 'business-faction', _insertAt: '001', _sourceRowIndex: '02' },
    });
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: { _rowKey: 'changed-business' } });
  });

  it('accepts same-version metadata while keeping committed edits and pending input', () => {
    const { state, window } = fixture();
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', 'draft');
    const refreshed = { ...window, rows: window.rows.map((row) => ({ ...row, sourceRowIndex: 3 })) };
    applyCsvTableWindowDraft(state, refreshed, true);
    expect(state.tables.ships[0]?.data.id).toBe('draft');
    expect(state.tables.ships[0]?.sourceRowIndex).toBe(3);
    expect(state.originalTables.ships[0]?.sourceRowIndex).toBe(3);
    expect(state.originalTables.ships[0]?.data.id).toBe('ship');
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: { id: 'draft' } });
    expect(state.pendingExternalTableUpdates.ships).toBe(false);
    applyCsvTableWindowDraft(state, { ...refreshed, baseVersions: [{ path: 'ship_data.csv', fingerprint: 'external' }] }, true);
    expect(state.pendingExternalTableUpdates.ships).toBe(true);
    expect(state.tables.ships[0]?.data.id).toBe('draft');
  });
});
