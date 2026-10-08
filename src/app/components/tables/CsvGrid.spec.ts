import { csvDraftRow } from '@/test/csv-row';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import CsvGrid from './CsvGrid.vue';
import type { CsvGridModel } from '@/domain/tables/csv-grid-model';
import { mountCsvInputHost } from '@/test/csv-input-host';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
let fixture: ReturnType<typeof mountCsvInputHost>;

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function modelFixture(): CsvGridModel {
  return {
    columns: [
      { className: 'schema-col-text', enumOptions: [], key: 'id', schema: null, widthPx: 100 },
      { className: 'schema-col-text', enumOptions: [], key: 'name', schema: null, widthPx: 100 },
    ],
    performanceSample: { columns: 2, ms: 0, rows: 1, sourceMs: 0, table: 'ships', widthMs: 0 },
    rows: [{ ...csvDraftRow({ id: 's0' }, 'key-0', 0), kind: 'row', rowIndex: 0 }],
    sourceIndex: { optionsBySource: new Map(), valueIndexBySource: new Map(), valueSetsBySource: new Map() },
    totalWidthPx: 200,
  };
}

function mountGrid() {
  fixture = mountCsvInputHost(
    CsvGrid,
    {
      global: {
        stubs: {
          CsvGridHeader: {
            props: ['columns'],
            emits: ['resize-column'],
            template: '<thead class="header-stub" />',
          },
          CsvGridBody: {
            name: 'CsvGridBody',
            props: ['visibleRows', 'columns', 'activeCell'],
            emits: ['activate-cell', 'close-active-cell', 'select-row'],
            template: `<tbody class="body-stub">
            <div
              v-for="row in visibleRows"
              :key="row.rowKey ?? row.slotKey"
              class="row-slot"
              @click="$emit('activate-cell', row, columns[0], $event)"
            >{{ row.rowKey ?? row.slotKey }}</div>
          </tbody>`,
          },
        },
      },
      attachTo: document.body,
    },
    { isDirty: () => false, model: reactive(modelFixture()), selectedRowKey: null },
  );
  wrapper = fixture.host;
  return fixture.surface;
}

describe('CsvGrid', () => {
  it('emits the visible window size on mount so the store can load data', async () => {
    const grid = mountGrid();
    await grid.vm.$nextTick();
    const events = grid.emitted('request-window');
    expect(events?.length).toBeGreaterThan(0);
    expect(events?.at(-1)).toEqual([0, expect.any(Number)]);
  });

  it('activates a cell: selects the row and exposes the active cell key', async () => {
    const grid = mountGrid();
    await grid.vm.$nextTick();
    await grid.find('.row-slot').trigger('click');
    expect(grid.emitted('select-row')?.at(-1)).toEqual(['key-0']);
    expect(grid.findComponent({ name: 'CsvGridBody' }).props('activeCell')).toEqual({ columnKey: 'id', rowKey: 'key-0' });
  });

  it('keeps the active cell when the same target model is replaced', async () => {
    const grid = mountGrid();
    await grid.vm.$nextTick();
    await grid.find('.row-slot').trigger('click');
    expect(grid.findComponent({ name: 'CsvGridBody' }).props('activeCell')).not.toBeNull();

    fixture.props.value = { ...fixture.props.value, model: reactive(modelFixture()) };
    await grid.vm.$nextTick();
    expect(grid.findComponent({ name: 'CsvGridBody' }).props('activeCell')).toEqual({ rowKey: 'key-0', columnKey: 'id' });
  });

  it('forwards selection from the body', async () => {
    const grid = mountGrid();
    const body = grid.findComponent({ name: 'CsvGridBody' });
    body.vm.$emit('select-row', 'key-1');
    await grid.vm.$nextTick();
    expect(grid.emitted('select-row')?.at(-1)).toEqual(['key-1']);
  });
});
