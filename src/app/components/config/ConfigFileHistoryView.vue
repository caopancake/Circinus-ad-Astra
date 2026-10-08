<template>
  <section class="file-history-page">
    <header class="file-history-header">
      <div>
        <h1>文件历史</h1>
        <p>{{ modTitle }}</p>
      </div>
      <n-button type="error" ghost :disabled="historyCount === 0" @click="confirmClear">清空文件历史</n-button>
    </header>

    <div class="file-history-summary">
      <div>
        <span>可撤销</span>
        <strong>{{ undoStack.length }}</strong>
      </div>
      <div>
        <span>可重做</span>
        <strong>{{ redoStack.length }}</strong>
      </div>
      <div>
        <span>总计</span>
        <strong>{{ historyCount }}</strong>
      </div>
    </div>

    <div class="file-history-stacks">
      <section class="file-history-panel">
        <header>
          <h2>可撤销</h2>
          <n-button size="small" :disabled="!canUndo" @click="undoOne">撤销</n-button>
        </header>
        <p v-if="undoStack.length === 0" class="file-history-empty">没有可撤销的文件保存历史。</p>
        <div v-else class="file-history-entry-list">
          <article v-for="(item, index) in undoDisplayItems" :key="item.id" class="file-history-entry">
            <div class="file-history-entry-main">
              <span class="file-history-entry-index">#{{ index + 1 }}</span>
              <div>
                <strong>{{ item.label }}</strong>
                <span>{{ formatTimestamp(item.timestamp) }}</span>
              </div>
              <em>{{ formatItemKind(item) }}</em>
            </div>
            <ul class="file-history-change-list">
              <li v-for="path in item.paths" :key="path">
                <code>{{ path }}</code>
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section class="file-history-panel">
        <header>
          <h2>可重做</h2>
          <n-button size="small" :disabled="!canRedo" @click="redoOne">重做</n-button>
        </header>
        <p v-if="redoStack.length === 0" class="file-history-empty">没有可重做的文件保存历史。</p>
        <div v-else class="file-history-entry-list">
          <article v-for="(item, index) in redoDisplayItems" :key="item.id" class="file-history-entry">
            <div class="file-history-entry-main">
              <span class="file-history-entry-index">#{{ index + 1 }}</span>
              <div>
                <strong>{{ item.label }}</strong>
                <span>{{ formatTimestamp(item.timestamp) }}</span>
              </div>
              <em>{{ formatItemKind(item) }}</em>
            </div>
            <ul class="file-history-change-list">
              <li v-for="path in item.paths" :key="path">
                <code>{{ path }}</code>
              </li>
            </ul>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useFileHistoryViewModel } from '@/app/composables/editors/use-file-history-view-model';
import type { FileHistoryItem } from '@/shared/types';

const {
  modTitle,
  undoStack,
  redoStack,
  undoDisplayItems,
  redoDisplayItems,
  historyCount,
  canUndo,
  canRedo,
  confirmClear,
  undoOne,
  redoOne,
} = useFileHistoryViewModel();

function formatItemKind(item: FileHistoryItem): string {
  return `${item.paths.length} 个文件变更`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
</script>
