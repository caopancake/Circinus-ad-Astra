import { csvDraftRow } from '@/test/csv-row';
import { mount } from '@vue/test-utils';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CsvTableWindow, CsvTableRows, TableKey } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  queryTableWindow: vi.fn(),
  querySourceOptionCatalog: vi.fn(async () => []),
  queryTableRowPreviewDataUrl: vi.fn(async () => ''),
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  },
  subscribeQueryInvalidations: vi.fn((handler: unknown) => {
    void handler;
    return () => {};
  }),
  subscribeResourceInvalidations: vi.fn(() => () => {}),
  hasTableInvalidation: vi.fn(() => false),
}));

vi.mock('@/services/csv-table.service', () => ({
  queryTableWindow: mocks.queryTableWindow,
  querySourceOptionCatalog: mocks.querySourceOptionCatalog,
  queryTableRowPreviewDataUrl: mocks.queryTableRowPreviewDataUrl,
}));
vi.mock('@/services/source-options.service', () => ({ querySourceOptionCatalog: mocks.querySourceOptionCatalog }));

vi.mock('@/services/query-cache.service', () => ({
  hasSourceInvalidation: vi.fn(() => false),
  hasTableInvalidation: mocks.hasTableInvalidation,
  subscribeQueryInvalidations: mocks.subscribeQueryInvalidations,
}));

vi.mock('@/services/resource-cache.service', () => ({
  hasResourceInvalidation: vi.fn(() => false),
  subscribeResourceInvalidations: mocks.subscribeResourceInvalidations,
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

vi.mock('@/stores/project.store', () => ({
  useProjectStore: () => ({ activeSessionId: 'sess-1' }),
}));

vi.mock('@/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    activeModRoot: 'M:/mod',
    getColumnWidths: vi.fn(() => undefined),
    setColumnWidths: vi.fn(),
  }),
}));

const tablesState = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock('@/stores/tables.store', () => ({
  useTablesStore: () => ({
    get currentTab() {
      return (tablesState.currentTab ?? 'ships') as TableKey;
    },
    get visibleColumns() {
      return (tablesState.visibleColumns ?? ['id', 'name']) as string[];
    },
    get filteredRows() {
      return (tablesState.filteredRows ?? []) as CsvTableRows;
    },
    get filteredRowCount() {
      return (tablesState.filteredRowCount ?? 0) as number;
    },
    get searchText() {
      return (tablesState.searchText ?? '') as string;
    },
    get currentFactionOptionValue() {
      return (tablesState.factionOption ?? 'all') as string;
    },
    get currentFaction() {
      return { kind: 'all' } as never;
    },
    get activeModRoot() {
      return (tablesState.activeModRoot ?? 'M:/mod') as string | null;
    },
    get saving() {
      return Boolean(tablesState.saving);
    },
    tableReadGeneration: () => tablesState.readGeneration ?? 0,
    getModTableState: () => tablesState,
    hasTableDirtyChanges: vi.fn(() => false),
    getTableInputs: vi.fn(() => ({ dirty: { value: false }, cancel: vi.fn() })),
    get hasCurrentTableExternalUpdate() {
      return Boolean(tablesState.externalUpdate);
    },
    markTableExternalUpdate: vi.fn(),
    discardTableDraftForReload: vi.fn(),
    applyTableWindow: vi.fn((_target: unknown, window: CsvTableWindow) => {
      tablesState.appliedWindow = window;
      tablesState.filteredRows = window.rows.map((entry) => ({ ...entry, insertAt: null }));
    }),
  }),
}));

import { useCsvTableViewModel } from './use-csv-table-view-model';

function windowFixture(totalRows: number): CsvTableWindow {
  return {
    baseVersions: [],
    table: 'ships',
    start: 0,
    header: ['id', 'name'],
    totalRows,
    filteredRows: totalRows,
    rows: Array.from({ length: Math.min(2, totalRows) }, (_, index) => ({
      rowKey: `key-${index}`,
      sourceRowIndex: index,
      factionId: null,
      data: { id: `s${index}`, name: `Ship ${index}` },
    })),
  };
}

describe('useCsvTableViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    Object.keys(tablesState).forEach((key) => delete tablesState[key]);
  });

  function mountViewModel() {
    let vm!: ReturnType<typeof useCsvTableViewModel>;
    mount(
      {
        setup() {
          vm = useCsvTableViewModel();
          return () => null;
        },
      },
      { global: { plugins: [getActivePinia()!] } },
    );
    return vm;
  }

  it('builds the grid model from the tables store projection', () => {
    tablesState.filteredRows = [csvDraftRow({ id: 's0', name: 'Ship 0' }, 'key-s0', 0)];
    tablesState.filteredRowCount = 1;
    const vm = mountViewModel();
    expect(vm.gridModel.value.columns.map((column) => column.key)).toEqual(['id', 'name']);
    expect(vm.gridModel.value.rows[0]).toMatchObject({ kind: 'row', rowKey: 'key-s0' });
    expect(vm.effectiveColumns.value).toHaveLength(2);
    expect(vm.effectiveTotalWidthPx.value).toBeGreaterThan(0);
  });

  it('applies the first table window on mount and locks the loaded column widths', async () => {
    tablesState.filteredRowCount = 40;
    mocks.queryTableWindow.mockResolvedValue(windowFixture(40));
    const vm = mountViewModel();
    await vi.waitFor(() => expect(mocks.queryTableWindow).toHaveBeenCalledTimes(1));
    expect(mocks.queryTableWindow).toHaveBeenCalledWith('sess-1', 'ships', 0, 240, '', { kind: 'all' }, expect.any(AbortSignal));
    expect(mocks.queryTableWindow.mock.calls[0]![3]).toBe(240);

    await vi.waitFor(() => expect(vm.gridModel.value.rows.some((row) => row.kind === 'row')).toBe(true));
    const locked = vm.effectiveColumns.value.map((column) => column.widthPx);
    expect(locked).toHaveLength(2);
    // Without overrides the effective widths match the model widths.
    expect(locked).toEqual(vm.gridModel.value.columns.map((column) => column.widthPx));
  });

  it('releases the window key after a failed query so a retry can re-query', async () => {
    tablesState.filteredRowCount = 40;
    mocks.queryTableWindow.mockRejectedValueOnce(new Error('backend down'));
    mocks.queryTableWindow.mockResolvedValue(windowFixture(40));
    const vm = mountViewModel();
    await vi.waitFor(() => expect(mocks.feedback.error).toHaveBeenCalledWith(expect.anything(), '加载表格数据失败'));

    await vm.loadTableWindow(0, 240);
    await vi.waitFor(() => expect(mocks.queryTableWindow).toHaveBeenCalledTimes(2));
  });

  it.each(['resolve', 'reject'] as const)('revokes an older window %s after local baseline acceptance', async (completion) => {
    let release!: (window: CsvTableWindow) => void;
    let reject!: (error: Error) => void;
    mocks.queryTableWindow.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          release = yes;
          reject = no;
        }),
    );
    mountViewModel();
    await vi.waitFor(() => expect(mocks.queryTableWindow).toHaveBeenCalled());
    tablesState.readGeneration = 1;
    if (completion === 'resolve') release(windowFixture(2));
    else reject(new Error('old read'));
    await Promise.resolve();
    await Promise.resolve();
    expect(tablesState.appliedWindow).toBeUndefined();
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });

  it('persists column width overrides per mod and table', () => {
    const vm = mountViewModel();
    vm.setColumnWidth('name', 180);
    expect(vm.effectiveColumns.value.find((column) => column.key === 'name')?.widthPx).toBe(180);
    expect(vm.effectiveColumns.value.find((column) => column.key === 'id')?.widthPx).not.toBe(180);
  });

  it('delegates row preview queries', async () => {
    mocks.queryTableRowPreviewDataUrl.mockResolvedValue('data:image/png;base64,x');
    const vm = mountViewModel();
    await expect(vm.querySelectedRowPreview({ sessionId: 'sess-1', table: 'ships', rowKey: 'key-0' })).resolves.toBe(
      'data:image/png;base64,x',
    );
  });

  it('preserves the draft on its save invalidation even after returning to the old baseline', async () => {
    mocks.queryTableWindow.mockResolvedValue(windowFixture(2));
    const vm = mountViewModel();
    await vi.waitFor(() => expect(mocks.queryTableWindow).toHaveBeenCalled());
    const queryCount = mocks.queryTableWindow.mock.calls.length;
    tablesState.saving = true;
    mocks.hasTableInvalidation.mockReturnValueOnce(true);
    const onInvalidation = mocks.subscribeQueryInvalidations.mock.calls[0]![0] as (event: { sessionId: string }) => void;
    onInvalidation({ sessionId: 'sess-1' });
    expect(mocks.queryTableWindow).toHaveBeenCalledTimes(queryCount);
    expect(vm.tables.markTableExternalUpdate).not.toHaveBeenCalled();
  });
});
