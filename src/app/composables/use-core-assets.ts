import { computed, onScopeDispose } from 'vue';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { loadCoreFields, loadCoreGraphics, startCoreAssetsLoading } from '@/orchestrators/core-assets.orchestrator';
import { mergeSchemaWithCoreFields } from '@/domain/schema/schema-core-fields';
import { getSchema } from '@/domain/schema/schema-registry';

export function useCoreAssetsLifecycle() {
  onScopeDispose(startCoreAssetsLoading());
}

export function useCoreSchema() {
  const store = useCoreAssetsStore();
  return {
    coreFields: computed(() => store.fields.content),
    loaded: computed(() => store.fields.status === 'ready'),
    loading: computed(() => store.fields.status === 'loading'),
    starsectorRoot: computed(() => store.root),
    getMergedSchema: (id: string) => {
      const schema = getSchema(id);
      return schema ? mergeSchemaWithCoreFields(schema, store.fields.content[id] ?? []) : null;
    },
    loadCoreFields,
  };
}

export function useCoreGraphics() {
  const store = useCoreAssetsStore();
  return {
    graphicsPaths: computed(() => store.graphics.content),
    loaded: computed(() => store.graphics.status === 'ready'),
    loading: computed(() => store.graphics.status === 'loading'),
    starsectorRoot: computed(() => store.root),
    loadGraphics: loadCoreGraphics,
  };
}
