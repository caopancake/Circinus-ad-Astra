<template>
  <div class="csv-cell-picker" :style="pickerStyle" tabindex="-1" @mousedown.stop @keydown.esc.stop.prevent="$emit('cancel')">
    <input ref="searchRef" v-model="query" class="csv-cell-picker-search" placeholder="搜索选项" />
    <button class="csv-cell-picker-action" type="button" @click="toggleCustomMode">自定义值</button>
    <input
      v-if="customMode"
      :value="customText"
      class="csv-cell-picker-custom"
      placeholder="输入自定义值"
      @input="updateCustom"
      @keydown.enter.prevent="submitCustom"
    />
    <button v-if="!multiple && selectedValues.size > 0" class="csv-cell-picker-clear" type="button" @click="clearValue">清除当前值</button>
    <div class="csv-cell-picker-list">
      <template v-for="group in filteredGroups" :key="group.key">
        <div v-if="group.label" class="csv-cell-picker-group">{{ group.label }}</div>
        <button
          v-for="option in group.options"
          :key="option.value"
          :class="['csv-cell-picker-option', { selected: selectedValues.has(option.value) }]"
          :title="option.description ?? undefined"
          type="button"
          @click="selectOption(option.value)"
        >
          <span v-if="multiple" class="csv-cell-picker-check">{{ selectedValues.has(option.value) ? '✓' : '' }}</span>
          <img v-if="optionSprite(option)" class="csv-cell-picker-thumb" :src="optionSprite(option)" :alt="option.label" />
          <span class="csv-cell-picker-label">{{ option.label }}</span>
          <span v-if="option.value !== option.label" class="csv-cell-picker-value">{{ option.value }}</span>
        </button>
      </template>
    </div>
    <button v-if="multiple" class="csv-cell-picker-action" type="button" @click="$emit('commit', captureValues())">确认选择</button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watchEffect } from 'vue';
import { groupSelectOptions, type SelectOption } from '@/domain/schema/schema-options';
import { useSchemaSelectMedia } from '@/app/composables/tables/use-schema-select-media';
import { useCsvFloatingPanel } from '@/app/composables/tables/use-csv-floating-panel';

const props = defineProps<{
  anchor: { height: number; left: number; top: number; width: number };
  multiple: boolean;
  sessionId: string;
  options: SelectOption[];
  values: string[];
}>();

const emit = defineEmits<{
  cancel: [];
  commit: [values: string[]];
  'pending-custom': [dirty: boolean];
  update: [values: string[]];
}>();

const { schemaSelectSprite, ensureSchemaSelectSprites } = useSchemaSelectMedia();

function optionSprite(option: SelectOption): string | undefined {
  return schemaSelectSprite(props.sessionId, option.resourceRef);
}

watchEffect(
  () => {
    const sid = props.sessionId;
    const resources = props.options.flatMap((option) => (option.resourceRef ? [option.resourceRef] : []));
    if (resources.length > 0) void ensureSchemaSelectSprites(sid, resources);
  },
  { flush: 'post' },
);

const query = ref('');
const customMode = ref(false);
const customText = ref('');
const searchRef = useTemplateRef<HTMLInputElement>('searchRef');
const selectedValues = computed(() => new Set(props.values));

// Mirrors the .csv-cell-picker max-height in tables.css.
const PICKER_MAX_HEIGHT = 320;

const pickerStyle = useCsvFloatingPanel(() => props.anchor, PICKER_MAX_HEIGHT);
const groups = computed(() => groupSelectOptions(props.options));
const filteredGroups = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return groups.value;
  return groups.value
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle)),
    }))
    .filter((group) => group.options.length > 0);
});

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown, true);
  nextTick(() => searchRef.value?.focus());
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown, true);
});

function clearValue() {
  emit('commit', ['']);
}

function selectOption(value: string) {
  if (!props.multiple) {
    emit('commit', [value]);
    return;
  }
  const next = new Set(props.values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  emit('update', [...next]);
}

function submitCustom() {
  const values = captureValues();
  if (props.multiple) emit('update', values);
  else emit('commit', values);
}

function captureValues(): string[] {
  const trimmed = customText.value.trim();
  cancelCustom();
  if (!trimmed) return props.values;
  if (props.multiple) {
    const next = new Set(props.values);
    next.add(trimmed);
    return [...next];
  }
  return [trimmed];
}

function updateCustom(event: Event) {
  customText.value = (event.target as HTMLInputElement).value;
  emit('pending-custom', customText.value.trim() !== '');
}

function toggleCustomMode() {
  if (customMode.value) cancelCustom();
  customMode.value = !customMode.value;
}

function cancelCustom() {
  customText.value = '';
  emit('pending-custom', false);
}

defineExpose({ captureValues, cancelCustom });

function handleDocumentMouseDown(event: MouseEvent) {
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (target?.closest?.('.csv-cell-picker')) return;
  emit('commit', captureValues());
}
</script>
