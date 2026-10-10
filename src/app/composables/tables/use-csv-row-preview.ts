import { computed, ref, watch } from 'vue';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { hasQueryInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { subscribeResourceInvalidations } from '@/services/resource-cache.service';
import { onScopeDispose } from 'vue';
import type { CsvRowPreviewTarget } from '@/shared/types';

export function useCsvRowPreview(options: {
  target: () => CsvRowPreviewTarget | null;
  query: (target: CsvRowPreviewTarget, signal?: AbortSignal) => Promise<string>;
}) {
  const src = ref('');
  const reads = useQueryReadOwner();
  const feedback = useAppFeedback();
  const key = computed(() => JSON.stringify(options.target()));
  async function load() {
    const target = options.target();
    if (!target) return;
    await reads.consume('preview', target, (signal) => options.query(target, signal), {
      ready: (value) => {
        src.value = value;
      },
      error: (error) => feedback.error(error, '加载行预览失败'),
    });
  }
  watch(
    key,
    () => {
      reads.revoke();
      src.value = '';
      void load();
    },
    { immediate: true },
  );
  const stopQuery = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== options.target()?.sessionId) return;
    if (event.scope === 'session') {
      reads.revoke();
      return;
    }
    if (hasQueryInvalidation(event, 'csv-row-preview'))
      reads.schedule('preview', () => {
        void load();
      });
  });
  const stopResource = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== options.target()?.sessionId) return;
    if (event.scope === 'session') {
      reads.revoke();
      return;
    }
    reads.schedule('preview', () => {
      void load();
    });
  });
  onScopeDispose(() => {
    stopQuery();
    stopResource();
  });
  return src;
}
