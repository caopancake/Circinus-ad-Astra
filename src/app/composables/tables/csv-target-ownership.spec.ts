import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCsvTableViewModel } from './use-csv-table-view-model';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { navigateToModTable } from '@/orchestrators/workspace-navigation.orchestrator';
import { sessionUpdateFixture } from '@/test/write-result';
import { initializeSettingsStore } from '@/stores/settings.store';
import type { CsvTableTarget, CsvTableWindow } from '@/shared/types';

const mocks = vi.hoisted(() => ({ query: vi.fn(), error: vi.fn() }));
vi.mock('@/services/csv-table.service', () => ({
  queryTableWindow: mocks.query,
  querySourceOptionCatalog: async () => [],
  queryTableRowPreviewDataUrl: async () => '',
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
vi.mock('@/services/source-options.service', () => ({ querySourceOptionCatalog: async () => [] }));
let wrapper: VueWrapper;
const a: CsvTableTarget = { sessionId: 'sA', modRoot: 'M:/A', table: 'ships' };
const b: CsvTableTarget = { sessionId: 'sB', modRoot: 'M:/B', table: 'ships' };
function windowRecord(): CsvTableWindow {
  return {
    table: 'ships',
    baseVersions: [],
    start: 0,
    header: ['id', 'name'],
    totalRows: 1,
    filteredRows: 1,
    rows: [{ rowKey: 'row', isComment: false, data: { id: 'demo', name: 'Name' }, sourceRowIndex: 0, factionId: null }],
  };
}
function harness() {
  let vm!: ReturnType<typeof useCsvTableViewModel>;
  wrapper = mount({
    setup() {
      vm = useCsvTableViewModel();
      return () => null;
    },
  });
  return vm;
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  initializeSettingsStore({
    theme: 'light',
    accent: 'blue',
    customAccent: '#3388cc',
    historyLimit: 20,
    editMode: 'plain',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  });
  for (const target of [a, b]) {
    const update = sessionUpdateFixture(target.sessionId, target.modRoot);
    if (update.status !== 'ready') throw new Error('fixture projection is ready');
    update.projection.manifest.tableSummaries.ships.header = ['id', 'name'];
    update.projection.manifest.tableSummaries.ships.totalRows = 1;
    useWorkspaceStore().registerMod({ modRoot: target.modRoot, displayName: target.sessionId, version: '', status: 'ready' });
    useProjectStore().registerProjectManifest(update.projection.manifest);
    useTablesStore().initializeModTables({
      sessionId: update.projection.manifest.sessionId,
      modRoot: target.modRoot,
      manifest: update.projection.manifest,
    });
  }
  useWorkspaceStore().setColumnWidths(a.modRoot, 'ships', { name: 120 });
  useWorkspaceStore().setColumnWidths(b.modRoot, 'ships', { name: 260 });
  mocks.query.mockResolvedValue(windowRecord());
  navigateToModTable(a.modRoot, 'ships');
});
afterEach(() => wrapper?.unmount());

describe('CSV explicit targets and column ownership', () => {
  it('measures and persists prototype-named columns as ordinary header keys', async () => {
    const record = windowRecord();
    record.header = ['id', '__proto__', 'constructor'];
    record.rows[0]!.data = JSON.parse('{"id":"demo","__proto__":"value","constructor":"other"}');
    const manifest = useProjectStore().getManifest(a.modRoot)!;
    manifest.tableSummaries.ships.header = record.header;
    useTablesStore().initializeModTables({ sessionId: a.sessionId, modRoot: a.modRoot, manifest });
    mocks.query.mockResolvedValue(record);
    const vm = harness();
    await flushPromises();
    expect(vm.effectiveColumns.value.every((column) => Number.isFinite(column.widthPx))).toBe(true);
    vm.setColumnWidth('__proto__', 190);
    expect(vm.effectiveColumns.value.find((column) => column.key === '__proto__')?.widthPx).toBe(190);
    expect(useWorkspaceStore().getColumnWidths(a.modRoot, a.table)?.['__proto__']).toBe(190);
    expect(Number.isFinite(vm.effectiveTotalWidthPx.value)).toBe(true);
  });
  it.each([false, true])('loads the destination widths before handling its dirty=%s state', async (dirty) => {
    const vm = harness();
    await flushPromises();
    const tables = useTablesStore();
    tables.applyTableWindow(b, windowRecord());
    if (dirty) tables.updateCellValue({ ...b, rowKey: 'row', column: 'name' }, 'B draft');
    expect(vm.effectiveColumns.value.find((column) => column.key === 'name')?.widthPx).toBe(120);
    navigateToModTable(b.modRoot, 'ships');
    await flushPromises();
    expect(vm.effectiveColumns.value.find((column) => column.key === 'name')?.widthPx).toBe(260);
    vm.setColumnWidth('name', 300);
    expect(useWorkspaceStore().getColumnWidths(a.modRoot, 'ships')?.name).toBe(120);
    expect(useWorkspaceStore().getColumnWidths(b.modRoot, 'ships')?.name).toBe(300);
    if (dirty) expect(tables.rows[0]?.data.name).toBe('B draft');
  });

  it('applies captured table state to its owner across workspace navigation', async () => {
    const tables = useTablesStore();
    tables.setSearchText(a, 'A search');
    tables.selectRowByKey(a, 'A row');
    navigateToModTable(b.modRoot, 'ships');
    tables.applyTableWindow(a, windowRecord());
    tables.markTableExternalUpdate(a);
    expect(tables.searchText).toBe('');
    expect(tables.selectedRowKey).toBeNull();
    navigateToModTable(a.modRoot, 'ships');
    expect(tables.searchText).toBe('A search');
    expect(tables.hasCurrentTableExternalUpdate).toBe(true);
  });

  it.each(['resolve', 'reject'] as const)('releases the prior Mod window %s after switching to a same-name table', async (completion) => {
    let resolve!: (window: CsvTableWindow) => void;
    let reject!: (error: Error) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    harness();
    navigateToModTable(b.modRoot, 'ships');
    await flushPromises();
    if (completion === 'resolve') resolve({ ...windowRecord(), rows: [{ ...windowRecord().rows[0]!, data: { id: 'old' } }] });
    else reject(new Error('Old Mod query'));
    await flushPromises();
    expect(useTablesStore().rows[0]?.data.id).toBe('demo');
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
