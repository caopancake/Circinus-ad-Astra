import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
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
import { queryTableRowPreviewDataUrl, queryTableWindow } from '@/services/csv-table.service';
import { querySourceOptionCatalog } from '@/services/source-options.service';
import type { SelectOption } from '@/domain/schema/schema-options';
import { hasSourceInvalidation, hasTableInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { hasResourceInvalidation, subscribeResourceInvalidations } from '@/services/resource-cache.service';
import type { CsvRowPreviewTarget, ResourceRef, CsvSearchField } from '@/shared/types';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';

export function useCsvTableViewModel() {
  const tables = useTablesStore();
  const project = useProjectStore();
  const workspace = useWorkspaceStore();
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  const loadedWindowKeys = ref(new Set<string>());
  const loadedSourceOptions = ref(new Map<string, SelectOption[]>());
  const columnWidthOverrides = ref<Record<string, number>>({});
  let lastWidthTarget = '';
  let disposed = false;
  let refreshAfterSave = false;
  const target = computed(() =>
    project.activeSessionId && tables.activeModRoot
      ? {
          sessionId: project.activeSessionId,
          modRoot: tables.activeModRoot,
          table: tables.currentTab,
        }
      : null,
  );
  const targetKey = computed(() => (target.value ? JSON.stringify(target.value) : ''));
  const { confirmDiscard } = useFieldInputActions(null);

  async function commitTableInput() {
    const current = target.value;
    if (!current) return;
    const pending = tables.getTableInputs(current.modRoot, current.table).commit();
    return pending ? await pending : true;
  }

  async function setSearchText(text: string) {
    const captured = target.value;
    const key = targetKey.value;
    try {
      if (captured && (await commitTableInput()) && key === targetKey.value) tables.setSearchText(captured, text);
    } catch (error) {
      feedback.error(error);
    }
  }

  async function setSearchField(value: CsvSearchField) {
    const captured = target.value;
    const key = targetKey.value;
    try {
      if (captured && (await commitTableInput()) && key === targetKey.value) tables.setSearchField(captured, value);
    } catch (error) {
      feedback.error(error);
    }
  }

  const gridModel = computed(() =>
    createCsvGridModel(tables.currentTab, tables.visibleColumns, tables.filteredRows, tables.filteredRowCount, loadedSourceOptions.value),
  );
  const sourceIndex = computed(() => gridModel.value.sourceIndex);

  const lockedColumnWidths = ref<Record<string, number>>({});

  const effectiveColumns = computed(() =>
    gridModel.value.columns.map((col) => ({
      ...col,
      widthPx: Object.hasOwn(columnWidthOverrides.value, col.key)
        ? columnWidthOverrides.value[col.key]!
        : Object.hasOwn(lockedColumnWidths.value, col.key)
          ? lockedColumnWidths.value[col.key]!
          : col.widthPx,
    })),
  );
  const effectiveTotalWidthPx = computed(() => effectiveColumns.value.reduce((sum, col) => sum + col.widthPx, 0));

  watch(
    () => [targetKey.value, tables.searchText, tables.searchField] as const,
    async () => {
      const captured = target.value;
      const identity = targetKey.value;
      clearLocalQueryState();
      if (!captured) {
        lockedColumnWidths.value = {};
        columnWidthOverrides.value = {};
        lastWidthTarget = '';
        return;
      }
      if (identity !== lastWidthTarget) {
        lockedColumnWidths.value = {};
        columnWidthOverrides.value = workspace.getColumnWidths(captured.modRoot, captured.table) ?? {};
        lastWidthTarget = identity;
      }
      if (tables.saving || tables.currentTableLocked || tables.hasTableDirtyChanges(captured.table)) {
        tables.markTableExternalUpdate(captured);
        return;
      }
      tables.discardTableDraftForReload(captured);
      await loadTableWindow(0, 240);
      if (identity !== targetKey.value || disposed) return;
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
    if (event.scope === 'session') {
      reads.revoke();
      return;
    }
    const tableWindowChanged = hasTableInvalidation(event, 'csv-table-window', tables.currentTab);
    if (tableWindowChanged) {
      if (tables.saving || tables.currentTableLocked) {
        refreshAfterSave = true;
      } else if (tables.hasTableDirtyChanges(tables.currentTab)) {
        tables.markTableExternalUpdate(target.value!);
      } else {
        reads.schedule('window', () => {
          void reloadCurrentTableWindow();
        });
      }
    }
    const sources = visibleSourceIds();
    const optionsChanged = [...sources].some((source) => hasSourceInvalidation(event, source));
    if (!optionsChanged) return;
    reads.schedule('source', () => {
      void reloadVisibleSourceOptions();
    });
  });
  watch(
    () => tables.saving || tables.currentTableLocked,
    (saving) => {
      loadedWindowKeys.value = new Set();
      if (saving) {
        refreshAfterSave = true;
        return;
      }
      if (!disposed && refreshAfterSave) {
        refreshAfterSave = false;
        void loadTableWindow(0, 240);
      }
    },
    { flush: 'sync' },
  );
  const stopResourceInvalidation = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== project.activeSessionId) return;
    if (!hasResourceInvalidation(event, loadedSourceResourceRefs())) return;
    reads.schedule('source', () => {
      void reloadVisibleSourceOptions();
    });
  });
  onUnmounted(() => {
    disposed = true;
    stopQueryInvalidation();
    stopResourceInvalidation();
  });

  function clearLocalQueryState() {
    reads.revoke();
    loadedWindowKeys.value = new Set();
    loadedSourceOptions.value = new Map();
  }

  async function reloadCurrentTableWindow() {
    const captured = target.value!;
    const identity = targetKey.value;
    clearLocalQueryState();
    tables.discardTableDraftForReload(captured);
    await loadTableWindow(0, 240);
    if (disposed || identity !== targetKey.value) return;
    await reloadVisibleSourceOptions();
    lockColumnWidthsForLoadedModel();
  }

  function loadExternalTableUpdate() {
    const captured = targetKey.value;
    confirmDiscard(
      () => {
        if (disposed || targetKey.value !== captured) return;
        void reloadCurrentTableWindow();
      },
      tables.hasTableDirtyChanges(tables.currentTab),
      () => targetKey.value,
    );
  }

  function lockColumnWidthsForLoadedModel() {
    const model = gridModel.value;
    const hasLoadedRows = model.rows.some((row) => row.kind === 'row');
    if (!hasLoadedRows && tables.filteredRowCount > 0) return;
    const hasLocked = Object.keys(lockedColumnWidths.value).length > 0;
    if (!hasLocked) {
      lockedColumnWidths.value = Object.fromEntries(model.columns.map((col) => [col.key, col.widthPx]));
      return;
    }
    lockedColumnWidths.value = {
      ...lockedColumnWidths.value,
      ...Object.fromEntries(
        model.columns.filter((col) => !Object.hasOwn(lockedColumnWidths.value, col.key)).map((col) => [col.key, col.widthPx]),
      ),
    };
  }

  async function loadTableWindow(start: number, count: number) {
    const sessionId = project.activeSessionId;
    if (!sessionId || count <= 0) return;
    const table = tables.currentTab;
    const modRoot = tables.activeModRoot!;
    const generation = tables.tableReadGeneration(modRoot, table);
    const tableState = tables.getModTableState(modRoot);
    const searchText = tables.searchText;
    const searchField = tables.searchField;
    const alignedStart = Math.max(0, Math.floor(start / 80) * 80);
    const windowCount = Math.max(160, Math.ceil(count / 80) * 80);
    const key = stableStringify([sessionId, table, searchText, searchField, alignedStart, windowCount, generation]);
    if (loadedWindowKeys.value.has(key)) return;
    loadedWindowKeys.value.add(key);
    await reads.consume(
      `window:${key}`,
      { sessionId, modRoot, table, key },
      (signal) => queryTableWindow(sessionId, table, alignedStart, windowCount, searchText, searchField, signal),
      {
        ready: (window) => {
          if (tables.saving || tables.currentTableLocked) {
            loadedWindowKeys.value.delete(key);
            return;
          }
          if (generation !== tables.tableReadGeneration(modRoot, table) || tableState !== tables.getModTableState(modRoot)) return;
          tables.applyTableWindow({ sessionId, modRoot, table }, window);
        },
        error: (error) => {
          loadedWindowKeys.value.delete(key);
          if (generation === tables.tableReadGeneration(modRoot, table) && tableState === tables.getModTableState(modRoot))
            feedback.error(error, '加载表格数据失败');
        },
      },
    );
  }

  async function reloadVisibleSourceOptions() {
    const sessionId = project.activeSessionId;
    if (!sessionId) return;
    const table = tables.currentTab;
    const sources = [...visibleSourceIds()];
    await reads.consume(
      'sources',
      { sessionId, table, sources },
      (signal) =>
        Promise.all(
          sources.map(async (source) => {
            const groups = await querySourceOptionCatalog(sessionId, source, signal);
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
        ),
      {
        ready: (entries) => {
          loadedSourceOptions.value = new Map(entries);
        },
        error: (error) => feedback.error(error, '加载来源选项失败'),
      },
    );
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

  function querySelectedRowPreview(target: CsvRowPreviewTarget, signal?: AbortSignal): Promise<string> {
    return queryTableRowPreviewDataUrl(target.sessionId, target.table, target.rowKey, signal);
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
    target,
    targetKey,
    setSearchText,
    setSearchField,
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
