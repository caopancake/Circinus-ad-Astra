<template>
  <template v-if="mode === 'plain'">
    <span class="csv-cell-value">{{ rawValue }}</span>
  </template>
  <template v-else-if="isListControl">
    <span v-for="value in listValues" :key="value" class="csv-cell-tag" :title="listValueDescription(value)">{{ value }}</span>
  </template>
  <template v-else-if="isReferenceControl">
    <img v-if="sprite" class="csv-cell-thumb" :src="sprite" :alt="displayValue" />
    <span class="csv-cell-value">{{ displayValue }}</span>
    <span class="csv-cell-caret">⌄</span>
  </template>
  <template v-else-if="showsPickerCaret">
    <span class="csv-cell-value">{{ displayValue }}</span>
    <span class="csv-cell-caret">⌄</span>
  </template>
  <template v-else>
    <span class="csv-cell-value">{{ rawValue }}</span>
  </template>
</template>

<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { cell } from '@/shared/lib/starsector';
import type { CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import { sourceValue } from '@/domain/tables/csv-source-options';
import {
  csvColumnControl,
  csvControlUsesPicker,
  csvListValues,
  isCsvListControl,
  isCsvReferenceControl,
} from '@/domain/tables/csv-column-schema';
import { useCsvTableInputs } from '@/app/composables/tables/use-csv-table-inputs';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { useSchemaSelectMedia } from '@/app/composables/tables/use-schema-select-media';

const props = defineProps<{
  column: CsvGridColumn;
  row: CsvRowRecord;
  sourceIndex: CsvSourceIndex;
}>();

const rawValue = computed(() => cell(props.row.data[props.column.key]));
const mode = useInputEditMode();
const context = useCsvTableInputs();
const { schemaSelectSprite, ensureSchemaSelectSprites } = useSchemaSelectMedia();
const control = computed(() => csvColumnControl(props.column.schema));
const isListControl = computed(() => isCsvListControl(control.value));
const isReferenceControl = computed(() => isCsvReferenceControl(control.value));
const listValues = computed(() => csvListValues(rawValue.value));
const referenceMatch = computed(() => sourceValue(props.sourceIndex, props.column.schema?.source, rawValue.value));
const showsPickerCaret = computed(() => csvControlUsesPicker(control.value) && !isListControl.value && !isReferenceControl.value);
const displayValue = computed(() => referenceMatch.value?.option.label ?? rawValue.value);

const sprite = computed(() => {
  const match = referenceMatch.value;
  if (!match?.option.resourceRef) return undefined;
  return schemaSelectSprite(context.target.sessionId, match.option.resourceRef);
});

watchEffect(() => {
  const match = referenceMatch.value;
  const sessionId = context.target.sessionId;
  if (!sessionId || !match?.option.resourceRef) return;
  void ensureSchemaSelectSprites(sessionId, [match.option.resourceRef]);
});

function listValueDescription(value: string): string | undefined {
  return sourceValue(props.sourceIndex, props.column.schema?.source, value)?.option.description ?? undefined;
}
</script>
