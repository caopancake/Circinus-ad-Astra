<template>
  <aside class="detail-pane">
    <div class="pane-title">上下文</div>
    <template v-if="tables.selectedRow">
      <section class="panel-card detail-card record-card">
        <div class="detail-thumbnail">
          <img v-if="previewState.src" :src="previewState.src" :alt="previewState.alt" />
          <div v-else class="thumbnail-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <strong>{{ previewState.title }}</strong>
            <span>{{ previewState.detail }}</span>
          </div>
        </div>
        <div class="detail-id">{{ selectedDisplayId }}</div>
        <div class="detail-name">{{ displayName }}</div>
      </section>
      <section class="panel-card detail-card">
        <div class="panel-section-title">操作</div>
        <div class="detail-actions">
          <n-button v-for="action in detailActions" :key="detailActionKey(action)" block secondary @click="$emit('detail-action', action)">
            {{ detailActionLabel(action) }}
          </n-button>
        </div>
        <div v-if="isCommentRow" class="muted">注释行只允许编辑 CSV 内容。</div>
        <div v-else-if="!hasActions" class="muted">当前模块没有专用编辑器。</div>
      </section>
      <section class="panel-card detail-card">
        <div class="panel-section-title">字段速览</div>
        <div class="schema-preview-list">
          <div v-for="item in summaryItems" :key="item.key" class="schema-preview-row">
            <span class="schema-preview-label" :title="item.key">{{ item.label }}</span>
            <div class="schema-preview-value">
              <template v-if="item.kind === 'tags' || item.kind === 'multi'">
                <span v-for="tag in item.values" :key="tag" class="schema-preview-tag" :title="previewTagTitle(item, tag)">
                  {{ tag }}
                </span>
                <span v-if="item.values.length === 0" class="schema-preview-empty">-</span>
              </template>
              <template v-else-if="item.kind === 'color'">
                <span class="schema-preview-swatch" :style="{ background: item.value }"></span>
                <strong :title="previewValueTitle(item)">{{ item.value || '-' }}</strong>
              </template>
              <template v-else>
                <img v-if="showReferenceDecorations && item.sprite" class="schema-preview-sprite" :src="item.sprite" :alt="item.display" />
                <strong :title="previewValueTitle(item)">{{ item.display || '-' }}</strong>
                <small v-if="showReferenceDecorations && item.meta">{{ item.meta }}</small>
              </template>
            </div>
          </div>
        </div>
      </section>
    </template>
    <div v-else class="panel-empty detail-empty">
      <strong>未选择记录</strong>
      <span>点击一行查看上下文操作，双击单元格编辑 CSV。</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useCsvRowPreview } from '@/app/composables/tables/use-csv-row-preview';
import { useTablesStore } from '@/stores/tables.store';
import { useProjectStore } from '@/stores/project.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useSchemaSelectMedia } from '@/app/composables/tables/use-schema-select-media';
import { cell, MODULE_LABELS, rowDisplayId } from '@/shared/lib/starsector';
import { detailActionKey, detailActionLabel, detailActionsForRow, type TableDetailAction } from '@/domain/tables/table-detail-actions';
import { isCsvCommentRow } from '@/domain/tables/csv-comment-row';
import {
  csvBooleanDisplayValue,
  csvColumnControlLabel,
  csvListValues,
  csvColumnSchemasForTable,
  isCsvListControl,
  isCsvReferenceControl,
} from '@/domain/tables/csv-column-schema';
import type { CsvColumnSchema } from '@/domain/schema/schema.types';
import { sourceValue, type CsvSourceIndex } from '@/domain/tables/csv-source-options';
import type { SelectOption } from '@/domain/schema/schema-options';
import type { CsvRowPreviewTarget, RowData, TableKey } from '@/shared/types';

const props = defineProps<{
  queryRowPreview: (target: CsvRowPreviewTarget, signal?: AbortSignal) => Promise<string>;
  sourceIndex: CsvSourceIndex;
}>();

defineEmits<{
  'detail-action': [request: TableDetailAction];
}>();

const tables = useTablesStore();
const project = useProjectStore();
const { schemaSelectSprite, replaceSchemaSelectSprites } = useSchemaSelectMedia();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const showReferenceDecorations = computed(() => settings.editMode === 'smart');

const displayName = computed(() => {
  if (!tables.selectedRow) return '';
  return cell(tables.selectedRow.name) || cell(tables.selectedRow.designation) || '未命名记录';
});

const selectedDisplayId = computed(() => (tables.selectedRow ? rowDisplayId(tables.selectedRow) : ''));
const isCommentRow = computed(() => isCsvCommentRow(tables.selectedRowRecord));
const hasActions = computed(() => detailActions.value.length > 0);
const schemaColumns = computed(() => csvColumnSchemasForTable(tables.currentTab));
const previewSrc = useCsvRowPreview({
  target: () =>
    project.activeSessionId && tables.selectedRowKey && tables.selectedRow && !isCommentRow.value
      ? { sessionId: project.activeSessionId, table: tables.currentTab, rowKey: tables.selectedRowKey }
      : null,
  query: (target, signal) => props.queryRowPreview(target, signal),
});
const summaryItems = computed<SchemaPreviewItem[]>(() => {
  const row = tables.selectedRow;
  if (!row) return [];
  return tables.visibleColumns.slice(0, 8).map((column) => {
    const schema = schemaColumns.value.find((item) => item.key === column);
    return schema ? schemaPreviewItem(schema, row) : plainPreviewItem(column, row);
  });
});
const detailActions = computed<TableDetailAction[]>(() => {
  const row = tables.selectedRowRecord;
  const data = project.activeManifest;
  return data
    ? detailActionsForRow(
        {
          modRoot: data.modRoot,
          sessionId: data.sessionId,
          starsectorRoot: data.starsectorRoot ?? workspace.gameOverview?.starsectorRoot ?? settings.starsectorRoot ?? null,
        },
        tables.currentTab,
        row,
      )
    : [];
});

interface SchemaPreviewItem {
  display: string;
  key: string;
  kind: CsvColumnSchema['control'];
  label: string;
  meta: string;
  sprite: string;
  source: string | undefined;
  value: string;
  values: string[];
}

interface PreviewState {
  alt: string;
  detail: string;
  src: string;
  title: string;
}

const previewState = computed<PreviewState>(() => {
  const row = tables.selectedRow;
  if (!row) return noPreview(tables.currentTab);
  if (isCommentRow.value) return commentPreview();
  if (previewSrc.value) {
    return {
      alt: selectedDisplayId.value || MODULE_LABELS[tables.currentTab],
      detail: '',
      src: previewSrc.value,
      title: '',
    };
  }
  return noPreview(tables.currentTab);
});

const summaryResources = computed(() => {
  const row = tables.selectedRow;
  return row && showReferenceDecorations.value
    ? tables.visibleColumns.slice(0, 8).flatMap((column) => {
        const schema = schemaColumns.value.find((entry) => entry.key === column);
        const resource =
          schema && isCsvReferenceControl(schema.control) ? findSourceOption(schema.source, cell(row[column])).option?.resourceRef : null;
        return resource ? [resource] : [];
      })
    : [];
});
watch(
  () => [project.activeSessionId, summaryResources.value] as const,
  ([sessionId, resources]) => {
    void replaceSchemaSelectSprites(sessionId, 'summary', resources);
  },
  { immediate: true },
);

function noPreview(tab: TableKey): PreviewState {
  return {
    alt: MODULE_LABELS[tab],
    detail: `${MODULE_LABELS[tab]}当前没有可用缩略图。`,
    src: '',
    title: '无预览',
  };
}

function commentPreview(): PreviewState {
  return {
    alt: '注释行',
    detail: '该行不参与引用、预览或专用编辑器。',
    src: '',
    title: '注释行',
  };
}

function schemaPreviewItem(schema: CsvColumnSchema, row: RowData): SchemaPreviewItem {
  const value = cell(row[schema.key]);
  const base: SchemaPreviewItem = {
    display: value,
    key: schema.key,
    kind: schema.control,
    label: schema.label ?? schema.key,
    meta: csvColumnControlLabel(schema.control),
    sprite: '',
    source: schema.source,
    value,
    values: [],
  };

  if (isCsvReferenceControl(schema.control)) {
    const match = findSourceOption(schema.source, value);
    if (match.option) {
      base.display = match.option.label;
      base.meta = match.group ? `${csvColumnControlLabel(schema.control)} · ${match.group}` : csvColumnControlLabel(schema.control);
      const sid = project.activeSessionId ?? undefined;
      if (match.option.resourceRef && sid) {
        base.sprite = schemaSelectSprite(sid, match.option.resourceRef) ?? '';
      }
    }
    return base;
  }

  if (isCsvListControl(schema.control)) {
    base.values = csvListValues(value);
    return base;
  }

  if (schema.control === 'enum') {
    base.meta = '枚举';
    return base;
  }

  if (schema.control === 'path-image') {
    base.meta = '图片路径';
    return base;
  }

  if (schema.control === 'boolean') {
    base.display = csvBooleanDisplayValue(value);
    return base;
  }

  return base;
}

function plainPreviewItem(column: string, row: RowData): SchemaPreviewItem {
  const value = cell(row[column]);
  return {
    display: value,
    key: column,
    kind: 'text',
    label: column,
    meta: '',
    sprite: '',
    source: undefined,
    value,
    values: [],
  };
}

function findSourceOption(source: string | undefined, value: string): { group: string; option: SelectOption | null } {
  if (!value) return { group: '', option: null };
  if (!source) return { group: '', option: null };
  return sourceValue(props.sourceIndex, source, value) ?? { group: '', option: null };
}

function previewTagTitle(item: SchemaPreviewItem, value: string): string | undefined {
  const match = findSourceOption(item.source, value);
  if (!match.option) return value || undefined;
  return [match.option.value, match.option.label !== match.option.value ? match.option.label : '', match.option.description ?? '']
    .filter(Boolean)
    .join('\n');
}

function previewValueTitle(item: SchemaPreviewItem): string | undefined {
  return item.value || undefined;
}
</script>
