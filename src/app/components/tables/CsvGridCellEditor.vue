<template>
  <div class="csv-cell-editor" @mousedown.stop @click.stop @keydown.esc.stop.prevent="cancelAndClose">
    <input
      v-if="usesNativeInput"
      ref="inputRef"
      class="csv-cell-input"
      :value="raw"
      @blur="commitAndClose"
      @input="handleNativeInput"
      @keydown.enter.prevent="commitAndClose"
    />
    <template v-else-if="isTextControl">
      <span class="csv-cell-value">{{ displayValue }}</span>
      <CsvCellTextEditor
        v-if="pickerAnchor"
        :anchor="pickerAnchor"
        :value="raw"
        @update="update"
        @cancel="cancelAndClose"
        @commit="commitAndClose"
      />
    </template>
    <template v-else>
      <template v-if="isListControl">
        <span v-for="value in listValue" :key="value" class="csv-cell-tag" :title="listValueDescription(value)">{{ value }}</span>
      </template>
      <template v-else-if="isReferenceControl">
        <img v-if="sprite" class="csv-cell-thumb" :src="sprite" :alt="displayValue" />
        <span class="csv-cell-value">{{ displayValue }}</span>
      </template>
      <template v-else>
        <span class="csv-cell-value">{{ displayValue }}</span>
      </template>
      <span class="csv-cell-caret">⌄</span>
      <CsvCellPicker
        ref="pickerRef"
        v-if="pickerAnchor"
        :anchor="pickerAnchor"
        :multiple="isListControl"
        :options="pickerOptions"
        :session-id="context.target.sessionId"
        :values="pickerValues"
        @cancel="cancelAndClose"
        @commit="handlePickerCommit"
        @pending-custom="customDirty = $event"
        @update="handlePickerUpdate"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue';
import { cell } from '@/shared/lib/starsector';
import type { CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import { includeCurrentValue, includeCurrentValues, sourceOptions, sourceValue, sourceValueSet } from '@/domain/tables/csv-source-options';
import {
  csvBooleanOptions,
  csvColumnControl,
  csvControlUsesNativeInput,
  csvListValues,
  formatCsvListValue,
  isCsvListControl,
  isCsvReferenceControl,
} from '@/domain/tables/csv-column-schema';
import { useSchemaSelectMedia } from '@/app/composables/tables/use-schema-select-media';
import { useCsvTableInputs } from '@/app/composables/tables/use-csv-table-inputs';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { registerFieldInput } from '@/shared/runtime/field-inputs';
import { focusFieldInput } from '@/shared/runtime/focus-field-input';
import CsvCellPicker from '@/app/components/tables/CsvCellPicker.vue';
import CsvCellTextEditor from '@/app/components/tables/CsvCellTextEditor.vue';

const props = defineProps<{
  anchorElement: HTMLElement | null;
  column: CsvGridColumn;
  row: CsvRowRecord;
  sourceIndex: CsvSourceIndex;
}>();

const emit = defineEmits<{
  close: [];
}>();

const mode = useInputEditMode();
const context = useCsvTableInputs();
const { schemaSelectSprite, replaceSchemaSelectSprites } = useSchemaSelectMedia();
const inputRef = useTemplateRef<HTMLInputElement>('inputRef');
const pickerAnchor = ref<{ height: number; left: number; top: number; width: number } | null>(null);

const raw = ref(cell(props.row.data[props.column.key]));
const baseline = ref(raw.value);
const customDirty = ref(false);
const pickerRef = ref<InstanceType<typeof CsvCellPicker> | null>(null);
const dirty = computed(() => raw.value !== baseline.value || customDirty.value);

const rawValue = computed(() => cell(props.row.data[props.column.key]));
const control = computed(() => csvColumnControl(props.column.schema));
const isTextControl = computed(() => control.value === 'text');
const usesNativeInput = computed(() => {
  if (isTextControl.value) return false;
  if (mode.value === 'plain') return true;
  return csvControlUsesNativeInput(control.value);
});
const isListControl = computed(() => isCsvListControl(control.value));
const isReferenceControl = computed(() => isCsvReferenceControl(control.value));
const listValue = computed(() => csvListValues(raw.value));
const pickerOptions = computed(() => {
  if (control.value === 'boolean') return csvBooleanOptions();
  if (control.value === 'enum') return props.column.enumOptions;
  const options = sourceOptions(props.sourceIndex, props.column.schema?.source);
  const valueSet = sourceValueSet(props.sourceIndex, props.column.schema?.source);
  if (isListControl.value) return includeCurrentValues(options, valueSet, listValue.value);
  return includeCurrentValue(options, valueSet, rawValue.value);
});
const pickerValues = computed(() => (isListControl.value ? listValue.value : raw.value ? [raw.value] : []));
const referenceMatch = computed(() => sourceValue(props.sourceIndex, props.column.schema?.source, rawValue.value));
const displayValue = computed(() => referenceMatch.value?.option.label ?? rawValue.value);

const sprite = computed(() => {
  const match = referenceMatch.value;
  if (!match?.option.resourceRef) return undefined;
  return schemaSelectSprite(context.target.sessionId, match.option.resourceRef);
});

watch(
  () => [context.target.sessionId, referenceMatch.value?.option.resourceRef, mode.value] as const,
  ([sessionId, resource, editMode]) => {
    void replaceSchemaSelectSprites(sessionId, 'selected', editMode === 'smart' && resource ? [resource] : []);
  },
  { immediate: true },
);

onMounted(() => {
  nextTick(() => {
    if (usesNativeInput.value) {
      inputRef.value?.focus();
      inputRef.value?.select();
      return;
    }
    const rect = props.anchorElement?.getBoundingClientRect();
    if (!rect) return;
    pickerAnchor.value = { height: rect.height, left: rect.left, top: rect.top, width: rect.width };
  });
});

function handleNativeInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  update(target?.value ?? '');
}

function update(value: string) {
  raw.value = value;
}

function commit(): string | null {
  if (pickerRef.value) handlePickerUpdate(pickerRef.value.captureValues());
  commitValue();
  return null;
}

function commitValue() {
  if (raw.value !== baseline.value) {
    context.update({ ...context.target, rowKey: props.row.rowKey, column: props.column.key }, raw.value);
    baseline.value = raw.value;
  }
}

function commitAndClose() {
  commit();
  emit('close');
}

function cancelAndClose() {
  cancel();
  emit('close');
}

function handlePickerUpdate(values: string[]) {
  raw.value = isListControl.value ? formatCsvListValue(values) : (values[0] ?? '');
}

function handlePickerCommit(values: string[]) {
  handlePickerUpdate(values);
  commitValue();
  emit('close');
}

function cancel() {
  raw.value = rawValue.value;
  baseline.value = raw.value;
  customDirty.value = false;
  pickerRef.value?.cancelCustom();
}

registerFieldInput({
  get key() {
    return JSON.stringify([props.row.rowKey, props.column.key]);
  },
  get label() {
    return `${context.target.table} / ${props.row.rowKey} / ${props.column.key}`;
  },
  dirty,
  commit,
  focus: () => focusFieldInput(inputRef.value),
  cancel,
});

function listValueDescription(value: string): string | undefined {
  return sourceValue(props.sourceIndex, props.column.schema?.source, value)?.option.description ?? undefined;
}
</script>
