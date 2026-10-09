import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, h, nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CsvGrid from './CsvGrid.vue';
import { createCsvGridModel } from '@/domain/tables/csv-grid-model';
import { provideCsvTableInputs } from '@/app/composables/tables/use-csv-table-inputs';
import { initializeSettingsStore } from '@/stores/settings.store';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { TABLE_KEYS, type ProjectManifest } from '@/shared/types';
import { editorUiStubs } from '@/test/ui-stubs';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ choose: vi.fn(), error: vi.fn() }) }));

beforeEach(() => {
  setActivePinia(createPinia());
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
});

function mountTable() {
  const root = 'M:/A';
  const target = { sessionId: 'sA', modRoot: root, table: 'ships' as const };
  const tables = useTablesStore();
  const workspace = useWorkspaceStore();
  workspace.registerMod({ modRoot: root, displayName: 'A', version: '', status: 'ready' });
  workspace.activateModTable(root);
  tables.hydrate(root, {
    sessionId: 'sA',
    tableSummaries: Object.fromEntries(TABLE_KEYS.map((table) => [table, { header: ['width'], totalRows: 1 }])),
  } as ProjectManifest);
  tables.applyTableWindow(target, {
    table: 'ships',
    baseVersions: [],
    header: ['width'],
    start: 0,
    filteredRows: 1,
    totalRows: 1,
    rows: [{ rowKey: 'ships:new:0', sourceRowIndex: 0, factionId: null, data: { width: '1' } }],
  });
  const inputs = tables.getTableInputs(root, 'ships');
  const grid = computed(() => {
    const model = createCsvGridModel('ships', ['width'], tables.rows, 1);
    model.columns[0]!.schema = { key: 'width', control: 'number' };
    return model;
  });
  const wrapper = mount(
    {
      setup() {
        provideCsvTableInputs({ target, inputs, activate: (cell) => tables.setActiveCell(cell, root), update: tables.updateCellValue });
        return () =>
          h(CsvGrid, {
            model: grid.value,
            editing: tables.editing,
            selectedRowKey: tables.selectedRowKey,
            isDirty: tables.isDirty,
            onSelectRow: (rowKey: string | null) => tables.selectRowByKey(target, rowKey),
          });
      },
    },
    { global: { stubs: editorUiStubs }, attachTo: document.body },
  );
  return { root, tables, inputs, wrapper };
}

describe('CSV input, target and row lifecycle', () => {
  it('keeps the same raw control across rowKey mapping and commits to the saved identity', async () => {
    const { root, tables, inputs, wrapper } = mountTable();
    await nextTick();
    await wrapper.get('td[data-column-key="width"]').trigger('click');
    const input = wrapper.get('input.csv-cell-input');
    await input.setValue('0012');
    expect(useDraftSessionsStore().hasUnsavedWorkForMod(root)).toBe(true);
    expect(tables.rows[0]?.data.width).toBe('1');
    tables.applySavedRowKeyMapForMod(root, 'ships', [{ previousKey: 'ships:new:0', nextKey: 'ships:row:9', rowIndex: 9 }]);
    await nextTick();
    expect(wrapper.get('input.csv-cell-input').element).toBe(input.element);
    expect((input.element as HTMLInputElement).value).toBe('0012');
    await inputs.commit();
    expect(tables.rows[0]?.rowKey).toBe('ships:row:9');
    expect(tables.rows[0]?.data.width).toBe('0012');
    expect(tables.undoCurrentTableEdit()).toBeTruthy();
    expect(tables.rows[0]?.data.width).toBe('1');
    expect(useTablesEditHistoryStore().canUndoCsvEdit(root, 'ships')).toBe(false);
    wrapper.unmount();
  });

  it('commits before scroll releases the active editor and preserves external updates while raw input is dirty', async () => {
    const { tables, inputs, wrapper } = mountTable();
    await nextTick();
    await wrapper.get('td[data-column-key="width"]').trigger('click');
    await wrapper.get('input.csv-cell-input').setValue('later');
    tables.applyTableWindow(
      { sessionId: 'sA', modRoot: 'M:/A', table: 'ships' },
      {
        table: 'ships',
        baseVersions: [],
        header: ['width'],
        start: 0,
        filteredRows: 1,
        totalRows: 1,
        rows: [{ rowKey: 'ships:new:0', sourceRowIndex: 0, factionId: null, data: { width: 'external' } }],
      },
    );
    expect(tables.rows[0]?.data.width).toBe('1');
    expect(tables.hasCurrentTableExternalUpdate).toBe(true);
    await wrapper.get('.table-panel').trigger('scroll');
    await nextTick();
    expect(tables.rows[0]?.data.width).toBe('later');
    expect(tables.editing).toBeNull();
    expect(inputs.dirty.value).toBe(false);
    expect(wrapper.find('input.csv-cell-input').exists()).toBe(false);
    wrapper.unmount();
  });
});
