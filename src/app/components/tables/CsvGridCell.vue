<template>
  <td
    :class="[column.className, { dirty, 'csv-cell-active': active }]"
    :data-column-key="column.key"
    @click.stop="$emit('activate-cell', row, column, $event)"
  >
    <CsvCellFrame ref="frameRef" :active="active" :control="column.schema?.control ?? 'text'">
      <CsvGridCellEditor
        v-if="active"
        :anchor-element="frameElement"
        :column="column"
        :row="row"
        :source-index="sourceIndex"
        @close="$emit('close-active-cell')"
      />
      <CsvGridStaticCell v-else :column="column" :row="row" :source-index="sourceIndex" />
    </CsvCellFrame>
  </td>
</template>
<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import type { CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import CsvCellFrame from '@/app/components/tables/CsvCellFrame.vue';
import CsvGridCellEditor from '@/app/components/tables/CsvGridCellEditor.vue';
import CsvGridStaticCell from '@/app/components/tables/CsvGridStaticCell.vue';

defineProps<{
  active: boolean;
  column: CsvGridColumn;
  dirty: boolean;
  row: CsvRowRecord;
  sourceIndex: CsvSourceIndex;
}>();

const frameRef = useTemplateRef('frameRef');
const frameElement = computed(() => frameRef.value?.frameRef ?? null);

defineEmits<{
  'activate-cell': [row: CsvRowRecord, column: CsvGridColumn, event: MouseEvent];
  'close-active-cell': [];
}>();
</script>
