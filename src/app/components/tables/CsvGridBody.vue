<template>
  <tbody>
    <tr v-if="beforeHeight > 0" class="csv-grid-spacer-row" :style="{ height: `${beforeHeight}px` }">
      <td :colspan="columns.length"></td>
    </tr>
    <template v-for="row in visibleRows" :key="row.kind === 'row' ? rowRenderKey(row) : row.slotKey">
      <CsvGridRow
        v-if="row.kind === 'row'"
        :active-cell="activeCell"
        :columns="columns"
        :is-dirty="isDirty"
        :row="row"
        :selected="row.rowKey === selectedRowKey"
        :source-index="sourceIndex"
        @activate-cell="forwardActivateCell"
        @close-active-cell="$emit('close-active-cell')"
        @select-row="selectRow"
      />
      <tr v-else class="csv-grid-placeholder-row">
        <td :colspan="columns.length"></td>
      </tr>
    </template>
    <tr v-if="afterHeight > 0" class="csv-grid-spacer-row" :style="{ height: `${afterHeight}px` }">
      <td :colspan="columns.length"></td>
    </tr>
  </tbody>
</template>
<script setup lang="ts">
import type { CsvGridRowSlot, CsvWindowRow } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import CsvGridRow from '@/app/components/tables/CsvGridRow.vue';
import type { RowData } from '@/shared/types';

const renderKeys = new WeakMap<RowData, string>();
function rowRenderKey(row: CsvWindowRow) {
  let key = renderKeys.get(row.row);
  if (key === undefined) {
    key = row.rowKey;
    renderKeys.set(row.row, key);
  }
  return key;
}

defineProps<{
  activeCell: { columnKey: string; rowKey: string } | null;
  afterHeight: number;
  beforeHeight: number;
  columns: CsvGridColumn[];
  isDirty: (rowKey: string, column: string) => boolean;
  selectedRowKey: string | null;
  sourceIndex: CsvSourceIndex;
  visibleRows: CsvGridRowSlot[];
}>();

const emit = defineEmits<{
  'activate-cell': [row: CsvWindowRow, column: CsvGridColumn, event: MouseEvent];
  'close-active-cell': [];
  'select-row': [rowKey: string, event: MouseEvent];
}>();

function selectRow(rowKey: string, event: MouseEvent) {
  emit('select-row', rowKey, event);
}

function forwardActivateCell(row: CsvWindowRow, column: CsvGridColumn, event: MouseEvent) {
  emit('activate-cell', row, column, event);
}
</script>
