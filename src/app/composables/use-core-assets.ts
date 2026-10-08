import { defineStore, storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { queryCoreFields, queryCoreGraphics } from '@/services/assets.service';
import { useSettingsStore } from '@/stores/settings.store';
import { useProjectStore } from '@/stores/project.store';
import { mergeSchemaWithCoreFields } from '@/domain/schema/schema-core-fields';
import { getSchema } from '@/domain/schema/schema-registry';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { errorCodeOf, errorMessageOf } from '@/shared/lib/errors';
import type { FileSchema } from '@/domain/schema/schema.types';

type CoreFields = Awaited<ReturnType<typeof queryCoreFields>>;

/// Single loader for core (Starsector) assets shared by schema merging and
/// path-image options: one root watcher, per-asset state, identical
/// guard/retry semantics. Consumed through the useCoreSchema/useCoreGraphics
/// facades, which keep the original per-asset signatures.
export const useCoreAssetsStore = defineStore('core-assets', () => {
  const settings = useSettingsStore();
  const project = useProjectStore();

  const starsectorRoot = computed(() => settings.starsectorRoot ?? project.activeManifest?.starsectorRoot ?? null);

  const coreFields = ref<CoreFields>({});
  const coreFieldsLoaded = ref(false);
  const coreFieldsLoading = ref(false);
  const coreFieldsLoadedRoot = ref<string | null>(null);

  const graphicsPaths = ref<string[]>([]);
  const graphicsLoaded = ref(false);
  const graphicsLoading = ref(false);
  const graphicsLoadedRoot = ref<string | null>(null);

  function resetFields() {
    coreFields.value = {};
    coreFieldsLoadedRoot.value = null;
    coreFieldsLoaded.value = false;
  }

  function resetGraphics() {
    graphicsPaths.value = [];
    graphicsLoadedRoot.value = null;
    graphicsLoaded.value = false;
  }

  async function loadFieldsFor(root: string | null) {
    if (!root) {
      resetFields();
      return;
    }
    if (coreFieldsLoading.value || coreFieldsLoadedRoot.value === root) return;
    if (coreFieldsLoadedRoot.value !== root) resetFields();
    coreFieldsLoading.value = true;
    try {
      const fields = await queryCoreFields(root);
      if (starsectorRoot.value === root) {
        coreFields.value = fields;
        coreFieldsLoadedRoot.value = root;
        coreFieldsLoaded.value = true;
      }
    } catch (error) {
      if (starsectorRoot.value === root) {
        coreFields.value = {};
        coreFieldsLoadedRoot.value = null;
        coreFieldsLoaded.value = false;
        recordLogBestEffort({
          level: 'error',
          code: errorCodeOf(error),
          message: errorMessageOf(error) ?? 'core fields load failed',
          path: root,
          line: null,
          fields: null,
        });
      }
    } finally {
      coreFieldsLoading.value = false;
    }
    if (starsectorRoot.value && starsectorRoot.value !== root) void loadFieldsFor(starsectorRoot.value);
  }

  async function loadGraphicsFor(root: string | null) {
    if (!root) {
      resetGraphics();
      return;
    }
    if (graphicsLoading.value || graphicsLoadedRoot.value === root) return;
    if (graphicsLoadedRoot.value !== root) resetGraphics();
    graphicsLoading.value = true;
    try {
      const paths = await queryCoreGraphics(root);
      if (starsectorRoot.value === root) {
        graphicsPaths.value = paths;
        graphicsLoadedRoot.value = root;
        graphicsLoaded.value = true;
      }
    } catch (error) {
      if (starsectorRoot.value === root) {
        graphicsPaths.value = [];
        graphicsLoadedRoot.value = null;
        graphicsLoaded.value = false;
        recordLogBestEffort({
          level: 'error',
          code: errorCodeOf(error),
          message: errorMessageOf(error) ?? 'core graphics index load failed',
          path: root,
          line: null,
          fields: null,
        });
      }
    } finally {
      graphicsLoading.value = false;
    }
    if (starsectorRoot.value && starsectorRoot.value !== root) void loadGraphicsFor(starsectorRoot.value);
  }

  function getMergedSchema(id: string): FileSchema | null {
    const staticSchema = getSchema(id);
    if (!staticSchema) return null;
    const fields = coreFields.value[id] ?? [];
    return mergeSchemaWithCoreFields(staticSchema, fields);
  }

  watch(starsectorRoot, () => {
    void loadFieldsFor(starsectorRoot.value);
    void loadGraphicsFor(starsectorRoot.value);
  });

  return {
    starsectorRoot,
    coreFields,
    coreFieldsLoaded,
    coreFieldsLoading,
    graphicsPaths,
    graphicsLoaded,
    graphicsLoading,
    getMergedSchema,
    loadFieldsFor,
    loadGraphicsFor,
  };
});

export function useCoreSchema() {
  const store = useCoreAssetsStore();
  const state = storeToRefs(store);
  return {
    coreFields: state.coreFields,
    loaded: state.coreFieldsLoaded,
    loading: state.coreFieldsLoading,
    starsectorRoot: state.starsectorRoot,
    getMergedSchema: store.getMergedSchema,
    loadCoreFields: () => store.loadFieldsFor(store.starsectorRoot),
  };
}

export function useCoreGraphics() {
  const store = useCoreAssetsStore();
  const state = storeToRefs(store);
  return {
    graphicsPaths: state.graphicsPaths,
    loaded: state.graphicsLoaded,
    starsectorRoot: state.starsectorRoot,
    loadGraphics: () => store.loadGraphicsFor(store.starsectorRoot),
  };
}
