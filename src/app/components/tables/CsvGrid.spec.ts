import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import CsvGrid from './CsvGrid.vue';
import type { CsvGridModel } from '@/domain/tables/csv-grid-model';

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
    rows: [{ kind: 'row', row: { id: 's0' }, rowIndex: 0, rowKey: 'key-0' }],
    sourceIndex: { optionsBySource: new Map(), valueIndexBySource: new Map(), valueSetsBySource: new Map() },
    totalWidthPx: 200,
  };
}

function mountGrid() {
  wrapper = mount(CsvGrid, {
    props: {
      editing: null,
      isDirty: () => false,
      model: reactive(modelFixture()),
      selectedRowKey: null,
    },
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
          emits: ['activate-cell', 'close-active-cell', 'select-row', 'update-cell'],
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
  });
  return wrapper!;
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

  it('clears the active cell when the model is replaced', async () => {
    const grid = mountGrid();
    await grid.vm.$nextTick();
    await grid.find('.row-slot').trigger('click');
    expect(grid.findComponent({ name: 'CsvGridBody' }).props('activeCell')).not.toBeNull();

    await grid.setProps({ model: reactive(modelFixture()) });
    expect(grid.findComponent({ name: 'CsvGridBody' }).props('activeCell')).toBeNull();
  });

  it('forwards select and update events from the body', async () => {
    const grid = mountGrid();
    const body = grid.findComponent({ name: 'CsvGridBody' });
    body.vm.$emit('select-row', 'key-1');
    body.vm.$emit('update-cell', 'key-1', 'name', 'new');
    await grid.vm.$nextTick();
    expect(grid.emitted('select-row')?.at(-1)).toEqual(['key-1']);
    expect(grid.emitted('update-cell')?.at(-1)).toEqual(['key-1', 'name', 'new']);
  });
});
