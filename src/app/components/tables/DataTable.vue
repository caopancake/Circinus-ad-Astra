<template>
  <div v-if="csvTable.tables.hasCurrentTableExternalUpdate" class="table-external-update-note">
    <span>当前 CSV 文件已在外部更新，未保存修改已保留。</span>
    <n-button size="tiny" secondary type="warning" @click="csvTable.loadExternalTableUpdate">载入外部版本</n-button>
  </div>
  <CsvGrid
    :editing="csvTable.tables.editing"
    :is-dirty="csvTable.tables.isDirty"
    :model="effectiveGridModel"
    :selected-row-key="csvTable.tables.selectedRowKey"
    @request-window="csvTable.loadTableWindow"
    @resize-column="csvTable.setColumnWidth"
    @select-row="csvTable.tables.selectRowByKey"
  />
  <div v-if="csvTable.tables.filteredRowCount > 0 && csvTable.tables.visibleColumns.length === 0" class="table-empty-note">
    当前表有 {{ csvTable.tables.filteredRowCount }} 行，但没有可显示列。请检查 CSV 表头。
  </div>
  <div v-else-if="csvTable.tables.rows.length > 0 && csvTable.tables.filteredRowCount === 0" class="table-empty-note">
    当前表有 {{ csvTable.tables.rows.length }} 行，但被搜索或势力过滤隐藏。
  </div>
</template>

<script setup lang="ts">
import { computed, onScopeDispose } from 'vue';
import CsvGrid from '@/app/components/tables/CsvGrid.vue';
import type { CsvTableViewModel } from '@/app/composables/tables/use-csv-table-view-model';
import { provideCsvTableInputs } from '@/app/composables/tables/use-csv-table-inputs';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';

const props = defineProps<{ csvTable: CsvTableViewModel }>();
const target = props.csvTable.target.value!;
const inputs = props.csvTable.tables.getTableInputs(target.modRoot, target.table);
provideCsvTableInputs({
  target,
  inputs,
  activate: (cell) => props.csvTable.tables.setActiveCell(cell, target.modRoot),
  update: props.csvTable.tables.updateCellValue,
});
useInputEditMode(inputs);
onScopeDispose(() => props.csvTable.tables.setActiveCell(null, target.modRoot));
const effectiveGridModel = computed(() => ({
  ...props.csvTable.gridModel.value,
  columns: props.csvTable.effectiveColumns.value,
  totalWidthPx: props.csvTable.effectiveTotalWidthPx.value,
}));
</script>
