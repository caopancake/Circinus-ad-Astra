import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTablesStore } from '@/stores/tables.store';
import { TABLE_KEYS, type CsvTableWindow, type ProjectManifest, type TableSummary } from '@/shared/types';
import { applyCsvTableWindowDraft, setCsvCellValueDraft } from './csv-table-draft';

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
  tables.hydrate('M:/mod', manifest);
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
        sourceRowIndex: 0,
        factionId: 'derived',
        data: { id: 'ship', _rowKey: 'business-key', _faction: 'business-faction', _insertAt: '001', _sourceRowIndex: '02' },
      },
    ],
  };
  applyCsvTableWindowDraft(state, window);
  return { state, window };
}

describe('CSV business content and metadata acceptance', () => {
  it('keeps colliding business columns editable under their formal row identity', () => {
    const { state } = fixture();
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', '_rowKey', 'changed-business');
    expect(state.tables.ships[0]).toMatchObject({
      rowKey: 'ships:row:0',
      factionId: 'derived',
      sourceRowIndex: 0,
      insertAt: null,
      data: { _rowKey: 'changed-business', _faction: 'business-faction', _insertAt: '001', _sourceRowIndex: '02' },
    });
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: { _rowKey: 'changed-business' } });
  });

  it('accepts same-version metadata while keeping committed edits and pending input', () => {
    const { state, window } = fixture();
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', 'draft');
    const refreshed = { ...window, rows: window.rows.map((row) => ({ ...row, factionId: 'updated' })) };
    applyCsvTableWindowDraft(state, refreshed, true);
    expect(state.tables.ships[0]?.data.id).toBe('draft');
    expect(state.tables.ships[0]?.factionId).toBe('updated');
    expect(state.originalTables.ships[0]?.factionId).toBe('updated');
    expect(state.originalTables.ships[0]?.data.id).toBe('ship');
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: { id: 'draft' } });
    expect(state.pendingExternalTableUpdates.ships).toBe(false);
    applyCsvTableWindowDraft(state, { ...refreshed, baseVersions: [{ path: 'ship_data.csv', fingerprint: 'external' }] }, true);
    expect(state.pendingExternalTableUpdates.ships).toBe(true);
    expect(state.tables.ships[0]?.data.id).toBe('draft');
  });
});
