<template>
  <n-input
    ref="input"
    :value="raw"
    type="textarea"
    :autosize="{ minRows: 1, maxRows: 10 }"
    size="small"
    :status="invalid ? 'error' : undefined"
    @update:value="updateRaw"
    @change="commitOnBlur"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { registerFieldInput } from '@/shared/runtime/field-inputs';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import type { JsonValue } from '@/shared/types';

const props = defineProps<{ value: unknown; label: string; shape: 'object' | 'array' | 'json' }>();
const emit = defineEmits<{ update: [value: JsonValue] }>();
const input = ref<{ focus: () => void } | null>(null);
const raw = ref('');
const dirty = ref(false);
const invalid = ref(false);
const serialized = computed(() => JSON.stringify(props.value ?? (props.shape === 'array' ? [] : {}), null, 2));
watch(
  serialized,
  (text) => {
    raw.value = text;
    dirty.value = false;
    invalid.value = false;
  },
  { immediate: true },
);

function updateRaw(text: string) {
  raw.value = text;
  dirty.value = text !== serialized.value;
  invalid.value = false;
}

function commit() {
  if (!dirty.value) return true;
  try {
    const parsed = JSON.parse(raw.value) as JsonValue;
    if (props.shape === 'array' && !Array.isArray(parsed)) throw new Error('array required');
    if (props.shape === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('object required');
    if (!stableDeepEqual(parsed, props.value)) emit('update', parsed);
    dirty.value = false;
    invalid.value = false;
    return true;
  } catch {
    invalid.value = true;
    return false;
  }
}

function commitOnBlur() {
  commit();
}

registerFieldInput({
  dirty,
  label: props.label,
  commit,
  focus: () => input.value?.focus(),
  reset: () => {
    raw.value = serialized.value;
    dirty.value = false;
    invalid.value = false;
  },
});
</script>
