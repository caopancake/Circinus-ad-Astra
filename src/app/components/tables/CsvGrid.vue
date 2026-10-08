<template>
  <div ref="panelRef" class="table-panel" @scroll="handleScroll">
    <table class="data-table" :style="{ width: `${model.totalWidthPx}px`, minWidth: `${model.totalWidthPx}px` }">
      <CsvGridHeader :columns="model.columns" @resize-column="forwardResizeColumn" />
      <CsvGridBody
        :active-cell="activeCellKey"
        :after-height="afterHeight"
        :before-height="beforeHeight"
        :columns="model.columns"
        :is-dirty="isDirty"
        :selected-row-key="selectedRowKey"
        :source-index="model.sourceIndex"
        :visible-rows="visibleRows"
        @activate-cell="activateCell"
        @close-active-cell="clearActiveCell"
        @select-row="forwardSelectRow"
      />
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, useTemplateRef, watch } from 'vue';
import type { CsvGridRowSlot, CsvWindowRow, ModTableState } from '@/shared/types';
import type { CsvGridColumn, CsvGridModel } from '@/domain/tables/csv-grid-model';
import { useCsvGridViewport } from '@/app/composables/tables/use-csv-grid-viewport';
import CsvGridBody from '@/app/components/tables/CsvGridBody.vue';
import CsvGridHeader from '@/app/components/tables/CsvGridHeader.vue';
import { usePerformanceLogger } from '@/app/composables/use-performance-logger';
import { useCsvTableInputs } from '@/app/composables/tables/use-csv-table-inputs';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';

const props = defineProps<{
  editing: ModTableState['editing'];
  isDirty: (rowKey: string, column: string) => boolean;
  model: CsvGridModel;
  selectedRowKey: string | null;
}>();

const emit = defineEmits<{
  'request-window': [start: number, count: number];
  'resize-column': [key: string, width: number];
  'select-row': [rowKey: string];
}>();

const panelRef = useTemplateRef<HTMLDivElement>('panelRef');
const context = useCsvTableInputs();
const { commitBefore } = useFieldInputActions(context.inputs);
const performanceLogger = usePerformanceLogger();
const activeCellKey = computed(() => (props.editing ? { columnKey: props.editing.column, rowKey: props.editing.rowKey } : null));
const editingIndex = computed(() => {
  const rowKey = props.editing?.rowKey;
  if (!rowKey) return null;
  const index = props.model.rows.findIndex((row) => row.kind === 'row' && row.rowKey === rowKey);
  return index >= 0 ? index : null;
});
const rows = computed(() => props.model.rows);
const viewport = useCsvGridViewport(rows, { editingIndex });
const afterHeight = computed(() => viewport.afterHeight.value);
const beforeHeight = computed(() => viewport.beforeHeight.value);
const visibleRows = computed<CsvGridRowSlot[]>(() => viewport.visibleItems.value);

watch(
  () => props.model,
  () => {
    nextTick(syncViewportMetrics);
  },
);

onMounted(() => {
  nextTick(syncViewportMetrics);
});

function handleScroll(event: Event) {
  const panel = event.currentTarget as HTMLDivElement;
  const metrics = { clientHeight: panel.clientHeight, scrollTop: panel.scrollTop };
  void commitBefore(() => {
    viewport.setViewportMetrics(metrics);
    clearActiveCell();
    emit('request-window', viewport.startIndex.value, Math.max(0, viewport.endIndex.value - viewport.startIndex.value));
  });
}

function activateCell(row: CsvWindowRow, column: CsvGridColumn) {
  performanceLogger.measure('frontend.csvGrid.activateCell', { column: column.key, rowKey: row.rowKey }, () => {
    void commitBefore(() => {
      forwardSelectRow(row.rowKey);
      context.activate({ ...context.target, rowKey: row.rowKey, column: column.key });
    });
  });
}

function syncViewportMetrics() {
  const panel = panelRef.value;
  viewport.setViewportMetrics({ clientHeight: panel?.clientHeight ?? 0, scrollTop: panel?.scrollTop ?? 0 });
  emit('request-window', viewport.startIndex.value, Math.max(0, viewport.endIndex.value - viewport.startIndex.value));
}

function clearActiveCell() {
  context.activate(null);
}

function forwardSelectRow(rowKey: string) {
  void commitBefore(() => performanceLogger.measure('frontend.csvGrid.selectRow', { rowKey }, () => emit('select-row', rowKey)));
}

function forwardResizeColumn(key: string, width: number) {
  emit('resize-column', key, width);
}
</script>
