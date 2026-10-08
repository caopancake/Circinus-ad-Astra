<template>
  <div class="csv-cell-text-editor" :style="editorStyle" tabindex="-1" @mousedown.stop>
    <textarea
      ref="textRef"
      :value="value"
      @input="updateText"
      class="csv-cell-text-input"
      spellcheck="false"
      @keydown.enter.ctrl.prevent="commit"
      @keydown.esc.prevent="cancel"
    ></textarea>
    <div class="csv-cell-text-actions">
      <span class="csv-cell-text-hint">Ctrl+Enter 提交，Esc 取消</span>
      <button type="button" class="csv-cell-text-commit" @click="commit">保存</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { useCsvFloatingPanel } from '@/app/composables/tables/use-csv-floating-panel';

const props = defineProps<{
  anchor: { height: number; left: number; top: number; width: number };
  value: string;
}>();

const emit = defineEmits<{
  update: [value: string];
  cancel: [];
  commit: [value: string];
}>();

// Mirrors the .csv-cell-text-editor height in tables.css.
const EDITOR_HEIGHT = 260;

const textRef = useTemplateRef<HTMLTextAreaElement>('textRef');

const panelStyle = useCsvFloatingPanel(() => props.anchor, EDITOR_HEIGHT);
const editorStyle = computed(() => ({ ...panelStyle.value, height: `${EDITOR_HEIGHT}px` }));

let settled = false;

function commit() {
  if (settled) return;
  settled = true;
  emit('commit', props.value);
}

function cancel() {
  if (settled) return;
  settled = true;
  emit('cancel');
}

function updateText(event: Event) {
  emit('update', (event.target as HTMLTextAreaElement).value);
}

function handleDocumentMouseDown(event: MouseEvent) {
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (target?.closest?.('.csv-cell-text-editor')) return;
  commit();
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown, true);
  nextTick(() => {
    const area = textRef.value;
    if (!area) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  });
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown, true);
});
</script>
