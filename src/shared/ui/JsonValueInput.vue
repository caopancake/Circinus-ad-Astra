<template>
  <div class="json-value-input">
    <label v-if="showLabel">{{ label }}</label>
    <n-input
      ref="input"
      :value="raw"
      type="textarea"
      :autosize="{ minRows: 1, maxRows: 10 }"
      size="small"
      :status="invalid ? 'error' : undefined"
      @update:value="updateRaw"
      @change="commitOnBlur"
      @blur="commitOnBlur"
      @keydown.ctrl.enter.prevent="commitOnBlur"
    />
  </div>
</template>

<script setup lang="ts" generic="T extends JsonInputShape">
import { ref } from 'vue';
import { useRawFieldInput, type InputConversion } from '@/shared/runtime/raw-field-input';
import { focusFieldInput } from '@/shared/runtime/focus-field-input';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { formatJsonInput, parseJsonInput } from '@/shared/lib/json-input';
import type { JsonInputShape, JsonInputValue } from '@/shared/types';

const props = defineProps<{
  value: unknown;
  label: string;
  inputKey?: string;
  showLabel?: boolean;
  shape: T;
  normalize?: (value: JsonInputValue<T>) => JsonInputValue<T>;
}>();
const emit = defineEmits<{ update: [value: JsonInputValue<T>] }>();
const input = ref<{ textareaElRef: HTMLTextAreaElement | null; focus: () => void } | null>(null);
const {
  raw,
  invalid,
  update: updateRaw,
  commit,
} = useRawFieldInput<JsonInputValue<T>>({
  key: props.inputKey ?? props.label,
  label: props.label,
  text: () => formatJsonInput(props.value, props.shape),
  convert,
  apply: (converted) => {
    if (converted.kind === 'value' && !stableDeepEqual(converted.value, props.value)) emit('update', converted.value);
  },
  focus: async () => {
    await focusFieldInput(input.value?.textareaElRef ?? null);
    input.value?.focus();
  },
});

function convert(text: string): InputConversion<JsonInputValue<T>> {
  const parsed = parseJsonInput(text, props.shape);
  if (parsed.kind === 'error') return parsed;
  const value = props.normalize ? props.normalize(parsed.value) : parsed.value;
  return { kind: 'value', value };
}

function commitOnBlur() {
  commit();
}
</script>
