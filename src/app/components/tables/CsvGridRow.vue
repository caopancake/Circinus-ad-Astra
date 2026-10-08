<template>
  <tr :data-row-key="row.rowKey" :class="{ selected }" @click="$emit('select-row', row.rowKey, $event)">
    <CsvGridCell
      v-for="column in columns"
      :key="column.key"
      :active="activeCell?.rowKey === row.rowKey && activeCell?.columnKey === column.key"
      :column="column"
      :dirty="isDirty(row.rowKey, column.key)"
      :row="row"
      :source-index="sourceIndex"
      @activate-cell="forwardActivateCell"
      @close-active-cell="$emit('close-active-cell')"
    />
  </tr>
</template>
<script setup lang="ts">
import type { CsvWindowRow } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import CsvGridCell from '@/app/components/tables/CsvGridCell.vue';

defineProps<{
  activeCell: { columnKey: string; rowKey: string } | null;
  columns: CsvGridColumn[];
  isDirty: (rowKey: string, column: string) => boolean;
  row: CsvWindowRow;
  selected: boolean;
  sourceIndex: CsvSourceIndex;
}>();

const emit = defineEmits<{
  'activate-cell': [row: CsvWindowRow, column: CsvGridColumn, event: MouseEvent];
  'close-active-cell': [];
  'select-row': [rowKey: string, event: MouseEvent];
}>();

function forwardActivateCell(row: CsvWindowRow, column: CsvGridColumn, event: MouseEvent) {
  emit('activate-cell', row, column, event);
}
</script>
