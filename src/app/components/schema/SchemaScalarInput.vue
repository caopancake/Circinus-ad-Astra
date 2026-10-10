<template>
  <n-input
    ref="input"
    :value="raw"
    :disabled="field.editable === false"
    :status="invalid ? 'error' : undefined"
    size="small"
    @update:value="update"
    @change="commit"
    @blur="commit"
    @keydown.enter.prevent="commit"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import { convertSchemaScalarInput, schemaPlainBooleanText } from '@/domain/schema/schema-values';
import { useRawFieldInput } from '@/shared/runtime/raw-field-input';
import { focusFieldInput } from '@/shared/runtime/focus-field-input';
import { cell } from '@/shared/lib/starsector';

const props = defineProps<{ field: FieldSchema; value: unknown; inputKey: string }>();
const emit = defineEmits<{ update: [update: SchemaFieldUpdate] }>();
const input = ref<{ inputElRef: HTMLInputElement | null; focus: () => void } | null>(null);
const { raw, invalid, update, commit } = useRawFieldInput<unknown>({
  key: props.inputKey,
  label: props.field.label,
  text: () => (props.field.type === 'boolean' ? schemaPlainBooleanText(props.value) : cell(props.value)),
  convert: (text) => {
    const converted = convertSchemaScalarInput(text, props.field);
    return converted.kind === 'set' ? { kind: 'value', value: converted.value } : converted;
  },
  apply: (converted) => emit('update', converted.kind === 'value' ? { kind: 'set', value: converted.value } : converted),
  focus: async () => {
    await focusFieldInput(input.value?.inputElRef ?? null);
    input.value?.focus();
  },
});
</script>
