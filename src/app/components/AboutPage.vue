<template>
  <div class="settings-page">
    <header class="settings-header about-header">
      <h1>关于</h1>
      <p>Circinus ad Astra 的版本、作者和更新记录。</p>
    </header>

    <section class="settings-section">
      <h3>应用信息</h3>
      <div class="about-info-list">
        <div class="settings-row">
          <span>名称</span>
          <strong>Circinus ad Astra</strong>
        </div>
        <div class="settings-row">
          <span>当前版本</span>
          <strong>0.1.0</strong>
        </div>
        <div class="settings-row">
          <span>作者</span>
          <strong>cake、AnyIDElse</strong>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3>更新内容</h3>
      <!-- eslint-disable-next-line vue/no-v-html -- content from bundled static .md file, not user input -->
      <div class="about-content" v-html="changelogHtml" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import changelogRaw from '../../../CHANGELOG.md?raw';

const changelogHtml = computed(() => marked.parse(changelogRaw, { async: false }));
</script>

<style scoped>
.about-header p {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
}

.about-info-list {
  display: grid;
  gap: var(--space-1);
}

.about-info-list strong {
  min-width: 0;
  color: var(--color-text);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.about-content {
  padding-top: 4px;
  color: var(--color-text-soft);
  font-size: 13px;
  line-height: 1.55;
}

.about-content :deep(*) {
  max-width: 100%;
}

.about-content :deep(:first-child) {
  margin-top: 0;
}

.about-content :deep(:last-child) {
  margin-bottom: 0;
}

.about-content :deep(h1) {
  display: none;
}

.about-content :deep(h2),
.about-content :deep(h3) {
  color: var(--color-text);
}

.about-content :deep(h2) {
  margin: 14px 0 6px;
  font-size: 13px;
  font-weight: 650;
}

.about-content :deep(h3) {
  margin: 10px 0 4px;
  font-size: 13px;
  font-weight: 600;
}

.about-content :deep(h4) {
  margin: 8px 0 4px;
  color: var(--color-text-soft);
  font-size: 12px;
  font-weight: 650;
}

.about-content :deep(p) {
  margin: 5px 0;
}

.about-content :deep(ul) {
  padding-left: 16px;
  margin: 5px 0 8px;
}

.about-content :deep(li) {
  margin: 3px 0;
}

.about-content :deep(a) {
  color: var(--color-primary);
  text-decoration: none;
}

.about-content :deep(a:hover) {
  text-decoration: underline;
}

.about-content :deep(strong) {
  color: var(--color-text);
}

.about-content :deep(code) {
  padding: 1px 4px;
  color: var(--color-text);
  font-size: 0.9em;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.about-content :deep(hr) {
  height: 1px;
  margin: 12px 0;
  background: var(--color-border);
  border: 0;
}
</style>
