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
import type { JsonValue, JsonInputShape, JsonInputValue } from '@/shared/types';

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
  text: () => JSON.stringify(props.value ?? (props.shape === 'array' ? [] : {}), null, 2),
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
  try {
    const parsed = JSON.parse(text) as JsonValue;
    if (props.shape === 'array' && !Array.isArray(parsed)) return { kind: 'error', message: '请输入 JSON 数组' };
    if (props.shape === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)))
      return { kind: 'error', message: '请输入 JSON 对象' };
    const value = parsed as JsonInputValue<T>;
    return { kind: 'value', value: props.normalize ? props.normalize(value) : value };
  } catch {
    return { kind: 'error', message: 'JSON 输入未完成，请修正后提交' };
  }
}

function commitOnBlur() {
  commit();
}
</script>
