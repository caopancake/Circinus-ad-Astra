<template>
  <main class="file-editor-page" :data-theme="settings.theme">
    <header class="file-editor-header">
      <div class="file-editor-heading">
        <div class="file-editor-title-row">
          <div class="file-editor-title" :title="fileName">{{ fileName }}</div>
          <div class="file-editor-status" :class="{ dirty, saving, loading }">{{ fileStatusText }}</div>
        </div>
        <div class="file-editor-path" :title="filePathText">{{ displayPath }}</div>
        <div class="file-editor-meta" aria-label="文件信息">
          <span>{{ fileTypeText }}</span>
          <span>{{ lineCount }} 行</span>
          <span>{{ modRootName }}</span>
        </div>
      </div>
      <div class="file-editor-actions">
        <n-button v-if="hasPendingExternalText" secondary type="warning" @click="loadExternalText">载入外部文本</n-button>
        <n-button :disabled="!dirty || saving" @click="cancelFileChanges">取消</n-button>
        <n-button type="primary" :loading="saving" :disabled="!canSave" @click="saveFile">保存</n-button>
      </div>
    </header>

    <section v-if="externalTextNotice" class="file-editor-message warning">
      <span>外部更新</span>
      <p>{{ externalTextNotice }}</p>
    </section>

    <section v-if="showContextMessage" :class="['file-editor-message', { danger: isErrorContext, warning: isWarningContext }]">
      <span>{{ contextLabel }}</span>
      <p>{{ contextMessage }}</p>
    </section>

    <section class="file-editor-body" :aria-busy="loading">
      <div ref="lineGutterRef" class="file-editor-gutter" aria-hidden="true">
        <div v-for="lineNumber in lineCount" :key="lineNumber" :class="['file-editor-line-number', { active: lineNumber === targetLine }]">
          {{ lineNumber }}
        </div>
      </div>
      <textarea
        ref="textareaRef"
        :value="text"
        class="file-editor-textarea"
        spellcheck="false"
        :disabled="loading"
        @input="handleTextInput"
        @scroll="syncScroll"
      />
      <div v-if="targetLine" class="file-editor-line-highlight" :style="{ top: `${(targetLine - 1) * lineHeight - scrollTop}px` }" />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useFileEditorViewModel } from '@/app/composables/editors/use-file-editor-view-model';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useSettingsStore } from '@/stores/settings.store';
import { closeCurrentWindow } from '@/windows/current.window';
import { pathBasename, pathBelongsToRoot, relativePathFromRoot } from '@/shared/lib/paths';

const params = new window.URLSearchParams(window.location.search);
const settings = useSettingsStore();
const initialFilePath = params.get('file');
const modRoot = params.get('modRoot');
const sessionId = params.get('sessionId');
const filePathText = computed(() => filePath.value ?? '缺少文件路径');
const fileName = computed(() => (filePath.value ? pathBasename(filePath.value) : '缺少文件路径'));
const displayPath = computed(() => {
  if (!filePath.value) return '缺少文件路径';
  if (modRoot && pathBelongsToRoot(filePath.value, modRoot)) return relativePathFromRoot(modRoot, filePath.value);
  return filePath.value;
});
const fileTypeText = computed(() => {
  const name = fileName.value;
  const extension = name.includes('.') ? name.split('.').pop()?.toUpperCase() : '';
  return extension ? `${extension} 文本` : '文本文件';
});
const modRootName = computed(() => (modRoot ? pathBasename(modRoot) : '未知 Mod'));
const scrollTop = ref(0);
const lineHeight = 20;
const textareaRef = useTemplateRef<HTMLTextAreaElement>('textareaRef');
const lineGutterRef = useTemplateRef<HTMLElement>('lineGutterRef');
const {
  filePath,
  contextLabel,
  contextMessage,
  targetLine,
  targetColumn,
  text,
  loading,
  saving,
  dirty,
  canSave,
  hasPendingExternalText,
  externalTextNotice,
  lineCount,
  isErrorContext,
  isWarningContext,
  initialize,
  dispose,
  saveFile,
  cancelChanges,
  loadPendingExternalText,
  updateText,
  undoEdit,
  redoEdit,
} = useFileEditorViewModel({
  filePath: initialFilePath,
  mode: params.get('mode') === 'recovery' ? 'recovery' : 'session',
  modRoot,
  sessionId,
  title: params.get('title') ?? '文件编辑器',
  contextLabel: params.get('contextLabel') ?? '信息',
  contextSeverity: params.get('contextSeverity') ?? 'info',
  contextMessage: params.get('message') ?? '',
  line: params.get('line'),
  column: params.get('column'),
});
const showContextMessage = computed(() => Boolean(contextMessage.value && (isErrorContext.value || targetLine.value)));
const closeGuard = useDirtyWindowCloseGuard({
  content: '当前文件有未保存修改，关闭后这些修改将丢失。',
  dirty,
  title: '放弃未保存文件修改？',
});
const fileStatusText = computed(() => {
  if (loading.value) return '读取中';
  if (saving.value) return '保存中';
  if (hasPendingExternalText.value) return '外部文本已更新';
  return dirty.value ? '未保存' : '已保存';
});

function syncScroll() {
  scrollTop.value = textareaRef.value?.scrollTop ?? 0;
  if (lineGutterRef.value) lineGutterRef.value.scrollTop = scrollTop.value;
}

function scrollToTargetLine() {
  if (!targetLine.value || !textareaRef.value) return;
  textareaRef.value.scrollTop = Math.max(0, (targetLine.value - 4) * lineHeight);
  const offset = textOffsetAt(text.value, targetLine.value, targetColumn.value ?? 1);
  textareaRef.value.focus({ preventScroll: true });
  textareaRef.value.setSelectionRange(offset, offset);
  syncScroll();
}

function handleTextInput(event: Event) {
  const nextText = (event.target as HTMLTextAreaElement).value;
  updateText(nextText);
}

function restoreEditorFocus() {
  textareaRef.value?.focus({ preventScroll: true });
}

function undoTextEdit() {
  undoEdit();
  void nextTick(restoreEditorFocus);
}

function redoTextEdit() {
  redoEdit();
  void nextTick(restoreEditorFocus);
}

function cancelFileChanges() {
  cancelChanges();
  void nextTick(scrollToTargetLine);
}

function loadExternalText() {
  loadPendingExternalText();
  void nextTick(scrollToTargetLine);
}

async function closeEditorWindow() {
  await closeCurrentWindow();
}

// Text surface: undo/redo must work inside the textarea, so this surface opts in.
useShortcutDispatch({
  undoRedoInEditable: true,
  commands: {
    close: () => void closeEditorWindow(),
    save: () => void saveFile(),
    undo: undoTextEdit,
    redo: redoTextEdit,
  },
});

onMounted(() => {
  void closeGuard.install();
  void initialize().then(async () => {
    await nextTick();
    scrollToTargetLine();
  });
});

watch([targetLine, targetColumn], () => void nextTick(scrollToTargetLine));

onUnmounted(() => {
  closeGuard.dispose();
  dispose();
});

function textOffsetAt(value: string, line: number, column: number): number {
  const lines = value.split(/\r\n|\r|\n/);
  const targetLineIndex = Math.min(Math.max(line - 1, 0), Math.max(lines.length - 1, 0));
  let offset = 0;
  let currentLine = 0;
  const lineBreakPattern = /\r\n|\r|\n/g;
  while (currentLine < targetLineIndex) {
    const match = lineBreakPattern.exec(value);
    if (!match) return value.length;
    offset = match.index + match[0].length;
    currentLine += 1;
  }
  return offset + Math.min(Math.max(column - 1, 0), lines[targetLineIndex]?.length ?? 0);
}
</script>
