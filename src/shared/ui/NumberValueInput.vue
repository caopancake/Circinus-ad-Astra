<template>
  <n-input-number
    ref="input"
    :key="controlGeneration"
    :value="numericValue"
    :format="format"
    :parse="parse"
    :input-props="{ onInput: captureRaw }"
    :min="min"
    :max="max"
    :step="step"
    :show-button="showButton"
    :disabled="disabled"
    :size="size"
    :status="invalid ? 'error' : undefined"
    @update:value="controlUpdated"
    @blur="commit"
    @keydown.enter="commit"
  />
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, ref } from 'vue';
import { useRawFieldInput, type InputConversion } from '@/shared/runtime/raw-field-input';
import { parseInputNumber } from '@/shared/lib/input-number';
import { focusFieldInput } from '@/shared/runtime/focus-field-input';
import { cell } from '@/shared/lib/starsector';

const props = withDefaults(
  defineProps<{
    value: unknown;
    integer?: boolean;
    inputKey?: string;
    label?: string;
    clearAction?: 'null' | 'remove' | 'required';
    min?: number;
    max?: number;
    step?: number;
    showButton?: boolean;
    disabled?: boolean;
    size?: 'small' | 'medium' | 'large';
  }>(),
  {
    integer: false,
    inputKey: undefined,
    label: '数值',
    clearAction: 'null',
    min: undefined,
    max: undefined,
    step: undefined,
    showButton: true,
    disabled: false,
    size: 'medium',
  },
);
const emit = defineEmits<{ 'update:value': [value: number | null]; remove: [] }>();
const input = ref<{ $el: HTMLElement; focus: () => void } | null>(null);
const controlGeneration = ref(0);
const { raw, invalid, update, commit } = useRawFieldInput<number | null>({
  key: props.inputKey ?? 'number/' + getCurrentInstance()!.uid,
  label: props.label,
  text: () => cell(props.value),
  convert,
  apply: (converted) => {
    if (converted.kind === 'remove') emit('remove');
    else emit('update:value', converted.value);
  },
  focus: async () => {
    await focusFieldInput(input.value?.$el.querySelector('input') ?? null);
    input.value?.focus();
  },
  canonicalize: true,
  onCancel: () => {
    controlGeneration.value++;
  },
});
const numericValue = computed(() => (typeof props.value === 'number' ? props.value : null));
function format() {
  return raw.value;
}
function convert(text: string): InputConversion<number | null> {
  if (text.trim() === '') {
    if (props.clearAction === 'required') return { kind: 'error', message: '必填字段不能为空' };
    return props.clearAction === 'remove' ? { kind: 'remove' } : { kind: 'value', value: null };
  }
  const value = parseInputNumber(text, props.integer);
  if (typeof value === 'string') return { kind: 'error', message: '请输入完整有效数字' };
  if ((props.min !== undefined && value < props.min) || (props.max !== undefined && value > props.max))
    return { kind: 'error', message: '数值超出允许范围' };
  return { kind: 'value', value };
}
function parse(text: string) {
  const converted = convert(text);
  return converted.kind === 'error' ? Number.NaN : converted.kind === 'remove' ? null : converted.value;
}
function captureRaw(event: Event) {
  const text = (event.target as HTMLInputElement).value;
  update(text);
  const converted = convert(text);
  if (converted.kind === 'value' && converted.value !== null) emit('update:value', converted.value);
}
function controlUpdated(value: number | null) {
  const converted = convert(raw.value);
  if (converted.kind === 'value' && converted.value === value) return;
  update(value === null ? '' : String(value));
  commit();
}
</script>
