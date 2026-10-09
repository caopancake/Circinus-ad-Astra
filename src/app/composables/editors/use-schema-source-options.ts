import { onUnmounted, ref, watch } from 'vue';
import type { FieldSchema } from '@/domain/schema/schema.types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import { mapSourceGroupsToSelectOptions, type SelectOption } from '@/domain/schema/schema-options';
import { isCsvSource } from '@/domain/tables/csv-source-options';
import type { ResourceRef } from '@/shared/types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { isReadInvalidated } from '@/shared/runtime/read-request';

export function useSchemaSourceOptions(args: {
  field: () => FieldSchema;
  value: () => unknown;
  runtimeContext: () => SchemaRuntimeContext | null | undefined;
}) {
  const loadedOptions = ref<SelectOption[]>([]);
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  let disposed = false;
  let stopInvalidation: (() => void) | null = null;

  // Context identity tracks entity-dependent catalogs; selected values remain ghost options.
  watch(
    () => [args.runtimeContext()?.sessionId ?? null, args.runtimeContext()?.sourceContextKey ?? null, args.field().source ?? null] as const,
    () => {
      loadedOptions.value = [];
      void reloadSourceOptions();
    },
    { immediate: true },
  );

  watch(
    () => [args.runtimeContext()?.sessionId ?? null, args.runtimeContext()?.sourceContextKey ?? null, args.field().source ?? ''] as const,
    () => {
      stopInvalidation?.();
      const context = args.runtimeContext();
      const source = args.field().source ?? '';
      stopInvalidation =
        context?.subscribeSourceOptionInvalidation?.(source, loadedSourceResourceRefs, () => {
          reads.schedule('source', () => {
            void reloadSourceOptions();
          });
        }) ?? null;
    },
    { immediate: true },
  );

  onUnmounted(() => {
    disposed = true;
    stopInvalidation?.();
  });

  async function reloadSourceOptions() {
    const context = args.runtimeContext();
    const sessionId = context?.sessionId ?? null;
    const source = args.field().source ?? null;
    if (!sessionId || !source || (!isCsvSource(source) && source !== 'hull:builtInWeaponSlots')) {
      loadedOptions.value = [];
      return;
    }

    try {
      const groups = await reads.read('source', { sessionId, source }, async (signal) => context?.querySourceOptions?.(source, signal));
      if (disposed || sessionId !== args.runtimeContext()?.sessionId || source !== args.field().source) return;
      loadedOptions.value = groups ? mapSourceGroupsToSelectOptions(groups) : [];
    } catch (error) {
      if (isReadInvalidated(error)) return;
      if (disposed) return;
      loadedOptions.value = [];
      feedback.error(error, '加载字段来源失败');
    }
  }

  function loadedSourceResourceRefs(): ResourceRef[] {
    return loadedOptions.value.flatMap((option) => [
      ...(option.resourceRef ? [option.resourceRef] : []),
      ...(option.children ?? []).flatMap((child) => (child.resourceRef ? [child.resourceRef] : [])),
    ]);
  }

  return {
    reloadSourceOptions,
    sourceOptions: loadedOptions,
  };
}
