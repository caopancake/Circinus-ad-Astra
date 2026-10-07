import { computed, onUnmounted, ref, watch } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useProjectStore } from '@/stores/project.store';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { createCsvGridModel } from '@/domain/tables/csv-grid-model';
import { csvColumnSchemaFor } from '@/domain/tables/csv-column-schema';
import { sourceGroupLabel } from '@/domain/tables/csv-source-options';
import { recordPerformance } from '@/shared/runtime/performance';
import { stableStringify } from '@/shared/lib/stable-compare';
import { querySourceOptionCatalog, queryTableRowPreviewDataUrl, queryTableWindow } from '@/services/csv-table.service';
import type { SelectOption } from '@/domain/schema/schema-options';
import { hasSourceInvalidation, hasTableInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { hasResourceInvalidation, subscribeResourceInvalidations } from '@/services/resource-cache.service';
import type { CsvRowPreviewTarget, ResourceRef } from '@/shared/types';

export function useCsvTableViewModel() {
  const tables = useTablesStore();
  const project = useProjectStore();
  const workspace = useWorkspaceStore();
  const feedback = useAppFeedback();
  const loadedWindowKeys = ref(new Set<string>());
  const loadedSourceOptions = ref(new Map<string, SelectOption[]>());
  const columnWidthOverrides = ref<Record<string, number>>({});
  let windowRequestId = 0;
  let sourceOptionsRequestId = 0;
  let lastWidthTable = '';

  const gridModel = computed(() =>
    createCsvGridModel(
      tables.currentTab,
      tables.visibleColumns,
      tables.filteredRows,
      tables.filteredRowCount,
      tables.tableRowKey,
      loadedSourceOptions.value,
    ),
  );
  const sourceIndex = computed(() => gridModel.value.sourceIndex);

  const lockedColumnWidths = ref<Record<string, number>>({});

  const effectiveColumns = computed(() =>
    gridModel.value.columns.map((col) => ({
      ...col,
      widthPx: columnWidthOverrides.value[col.key] ?? lockedColumnWidths.value[col.key] ?? col.widthPx,
    })),
  );
  const effectiveTotalWidthPx = computed(() => effectiveColumns.value.reduce((sum, col) => sum + col.widthPx, 0));

  watch(
    () => [project.activeSessionId, tables.currentTab, tables.searchText, tables.currentFactionOptionValue] as const,
    async ([sessionId, table]) => {
      windowRequestId += 1;
      clearLocalQueryState();
      if (!sessionId) {
        lockedColumnWidths.value = {};
        columnWidthOverrides.value = {};
        lastWidthTable = '';
        return;
      }
      if (tables.saving || tables.hasTableDirtyChanges(table)) {
        tables.markTableExternalUpdate(table);
        return;
      }
      tables.discardTableDraftForReload(table);
      if (table !== lastWidthTable) {
        lockedColumnWidths.value = {};
        const modRoot = tables.activeModRoot;
        columnWidthOverrides.value = modRoot ? (workspace.getColumnWidths(modRoot, table) ?? {}) : {};
        lastWidthTable = table;
      }
      await loadTableWindow(0, 240);
      await reloadVisibleSourceOptions();
      lockColumnWidthsForLoadedModel();
    },
    { immediate: true },
  );

  watch(
    () => stableStringify(gridModel.value.columns.map((column) => column.key)),
    () => {
      lockColumnWidthsForLoadedModel();
    },
    { immediate: true },
  );

  function setColumnWidth(key: string, width: number) {
    columnWidthOverrides.value = { ...columnWidthOverrides.value, [key]: Math.max(40, width) };
    const modRoot = tables.activeModRoot;
    if (modRoot) {
      workspace.setColumnWidths(modRoot, tables.currentTab, columnWidthOverrides.value);
    }
  }

  const stopQueryInvalidation = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== project.activeSessionId) return;
    const tableWindowChanged = hasTableInvalidation(event, 'csv-table-window', tables.currentTab);
    if (tableWindowChanged) {
      if (tables.saving || tables.hasTableDirtyChanges(tables.currentTab)) {
        tables.markTableExternalUpdate(tables.currentTab);
      } else {
        void reloadCurrentTableWindow();
      }
    }
    const sources = visibleSourceIds();
    const optionsChanged = [...sources].some((source) => hasSourceInvalidation(event, source));
    if (!optionsChanged) return;
    void reloadVisibleSourceOptions();
  });
  const stopResourceInvalidation = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== project.activeSessionId) return;
    if (!hasResourceInvalidation(event, loadedSourceResourceRefs())) return;
    void reloadVisibleSourceOptions();
  });
  onUnmounted(() => {
    stopQueryInvalidation();
    stopResourceInvalidation();
  });

  function clearLocalQueryState() {
    loadedWindowKeys.value = new Set();
    loadedSourceOptions.value = new Map();
  }

  async function reloadCurrentTableWindow() {
    const table = tables.currentTab;
    windowRequestId += 1;
    clearLocalQueryState();
    tables.discardTableDraftForReload(table);
    await loadTableWindow(0, 240);
    await reloadVisibleSourceOptions();
    lockColumnWidthsForLoadedModel();
  }

  async function loadExternalTableUpdate() {
    tables.discardTableDraftForReload(tables.currentTab);
    await reloadCurrentTableWindow();
  }

  function lockColumnWidthsForLoadedModel() {
    const model = gridModel.value;
    const hasLoadedRows = model.rows.some((row) => row.kind === 'row');
    if (!hasLoadedRows && tables.filteredRowCount > 0) return;
    const hasLocked = Object.keys(lockedColumnWidths.value).length > 0;
    if (!hasLocked) {
      const widths: Record<string, number> = {};
      for (const col of model.columns) widths[col.key] = col.widthPx;
      lockedColumnWidths.value = widths;
      return;
    }
    lockedColumnWidths.value = {
      ...lockedColumnWidths.value,
      ...Object.fromEntries(model.columns.filter((col) => !(col.key in lockedColumnWidths.value)).map((col) => [col.key, col.widthPx])),
    };
  }

  async function loadTableWindow(start: number, count: number) {
    const sessionId = project.activeSessionId;
    if (!sessionId || count <= 0) return;
    const table = tables.currentTab;
    const searchText = tables.searchText;
    const faction = tables.currentFaction;
    const factionOptionValue = tables.currentFactionOptionValue;
    const requestId = windowRequestId;
    const alignedStart = Math.max(0, Math.floor(start / 80) * 80);
    const windowCount = Math.max(160, Math.ceil(count / 80) * 80);
    const key = stableStringify([sessionId, table, searchText, factionOptionValue, alignedStart, windowCount]);
    if (loadedWindowKeys.value.has(key)) return;
    loadedWindowKeys.value.add(key);
    try {
      const window = await queryTableWindow(sessionId, table, alignedStart, windowCount, searchText, faction);
      if (tables.saving) {
        loadedWindowKeys.value.delete(key);
        return;
      }
      if (
        requestId !== windowRequestId ||
        sessionId !== project.activeSessionId ||
        table !== tables.currentTab ||
        searchText !== tables.searchText ||
        factionOptionValue !== tables.currentFactionOptionValue
      ) {
        return;
      }
      tables.applyTableWindow(window);
    } catch (error) {
      // Release the window key so a retry can re-query the failed window.
      loadedWindowKeys.value.delete(key);
      if (requestId !== windowRequestId || sessionId !== project.activeSessionId) return;
      feedback.error(error, '加载表格数据失败');
    }
  }

  async function reloadVisibleSourceOptions() {
    const sessionId = project.activeSessionId;
    if (!sessionId) return;
    const requestId = ++sourceOptionsRequestId;
    const table = tables.currentTab;
    const sources = [...visibleSourceIds()];
    try {
      const entries = await Promise.all(
        sources.map(async (source) => {
          const groups = await querySourceOptionCatalog(sessionId, source);
          const options = groups.map((group) => ({
            type: 'group' as const,
            label: sourceGroupLabel(group.origin),
            value: sourceGroupLabel(group.origin),
            children: group.options.map((option) => ({
              label: option.label,
              value: option.value,
              description: option.description,
              resourceRef: option.resourceRef ?? null,
            })),
          }));
          return [source, options] as const;
        }),
      );
      if (requestId !== sourceOptionsRequestId || sessionId !== project.activeSessionId || table !== tables.currentTab) return;
      loadedSourceOptions.value = new Map(entries);
    } catch (error) {
      if (requestId !== sourceOptionsRequestId || sessionId !== project.activeSessionId || table !== tables.currentTab) return;
      feedback.error(error, '加载来源选项失败');
    }
  }

  function visibleSourceIds(): Set<string> {
    return new Set(tables.visibleColumns.map((column) => csvColumnSchemaFor(tables.currentTab, column)?.source).filter(isSourceId));
  }

  function loadedSourceResourceRefs(): ResourceRef[] {
    return [...loadedSourceOptions.value.values()].flatMap((options) =>
      options.flatMap((option) => [
        ...(option.resourceRef ? [option.resourceRef] : []),
        ...(option.children ?? []).flatMap((child) => (child.resourceRef ? [child.resourceRef] : [])),
      ]),
    );
  }

  function querySelectedRowPreview(target: CsvRowPreviewTarget): Promise<string> {
    return queryTableRowPreviewDataUrl(target.sessionId, target.table, target.rowKey);
  }

  watch(
    () => gridModel.value.performanceSample,
    (sample) =>
      recordPerformance('frontend.csvGridModel', sample.ms, {
        columns: sample.columns,
        rows: sample.rows,
        sourceMs: sample.sourceMs,
        table: sample.table,
        widthMs: sample.widthMs,
      }),
    { immediate: true },
  );

  return {
    tables,
    gridModel,
    effectiveColumns,
    effectiveTotalWidthPx,
    sourceIndex,
    loadExternalTableUpdate,
    loadTableWindow,
    querySelectedRowPreview,
    setColumnWidth,
  };
}

export type CsvTableViewModel = ReturnType<typeof useCsvTableViewModel>;

function isSourceId(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
