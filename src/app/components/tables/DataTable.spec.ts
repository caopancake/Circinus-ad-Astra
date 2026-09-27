import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import DataTable from './DataTable.vue';
import type { CsvTableViewModel } from '@/app/composables/tables/use-csv-table-view-model';

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function tableVmFixture(overrides: { tables?: Record<string, unknown>; loadExternalTableUpdate?: () => void } = {}): CsvTableViewModel {
  return {
    gridModel: ref({ columns: [], rows: [], totalWidthPx: 0, performanceSample: {}, sourceIndex: {} }),
    effectiveColumns: ref([]),
    effectiveTotalWidthPx: ref(0),
    loadExternalTableUpdate: overrides.loadExternalTableUpdate ?? vi.fn(),
    tables: {
      hasCurrentTableExternalUpdate: false,
      filteredRowCount: 0,
      rows: [],
      visibleColumns: ['id'],
      editing: null,
      isDirty: () => false,
      selectedRowKey: null,
      selectRowByKey: vi.fn(),
      updateCellValueByKey: vi.fn(),
      ...overrides.tables,
    },
  } as unknown as CsvTableViewModel;
}

function mountTable(vm: CsvTableViewModel) {
  wrapper = mount(DataTable, {
    props: { csvTable: vm },
    global: {
      stubs: {
        'n-button': { emits: ['click'], template: `<button @click="$emit('click', $event)"><slot /></button>` },
        CsvGrid: {
          props: ['model', 'selectedRowKey', 'editing', 'isDirty'],
          emits: ['request-window', 'resize-column', 'select-row', 'update-cell'],
          template: '<div class="csv-grid-stub" />',
        },
      },
    },
  });
  return wrapper!;
}

describe('DataTable', () => {
  it('renders the grid without notices for a clean table with columns', () => {
    const mounted = mountTable(tableVmFixture());
    expect(mounted.find('.table-external-update-note').exists()).toBe(false);
    expect(mounted.find('.table-empty-note').exists()).toBe(false);
    expect(mounted.find('.csv-grid-stub').exists()).toBe(true);
  });

  it('offers the external version entry when the table changed outside', async () => {
    const loadExternalTableUpdate = vi.fn();
    const mounted = mountTable(tableVmFixture({ tables: { hasCurrentTableExternalUpdate: true }, loadExternalTableUpdate }));
    const note = mounted.get('.table-external-update-note');
    expect(note.text()).toContain('外部更新');
    await note.get('button').trigger('click');
    expect(loadExternalTableUpdate).toHaveBeenCalledTimes(1);
  });

  it('explains tables whose rows are hidden by filters', () => {
    const mounted = mountTable(tableVmFixture({ tables: { rows: [{}], filteredRowCount: 0, visibleColumns: ['id'] } }));
    expect(mounted.get('.table-empty-note').text()).toContain('被搜索或势力过滤隐藏');
  });

  it('explains tables without any displayable columns', () => {
    const mounted = mountTable(tableVmFixture({ tables: { filteredRowCount: 5, visibleColumns: [] } }));
    expect(mounted.get('.table-empty-note').text()).toContain('没有可显示列');
  });
});
