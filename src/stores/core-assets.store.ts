import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { DiscoveredField } from '@/shared/types';
import type { ErrorDiagnostic } from '@/shared/types';

export interface CoreAssetState<T> {
  content: T;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: ErrorDiagnostic | null;
}

export const useCoreAssetsStore = defineStore('core-assets', () => {
  const root = ref<string | null>(null);
  const fields = ref<CoreAssetState<Record<string, DiscoveredField[]>>>({ content: {}, status: 'idle', error: null });
  const graphics = ref<CoreAssetState<string[]>>({ content: [], status: 'idle', error: null });

  function reset(nextRoot: string | null) {
    root.value = nextRoot;
    fields.value = { content: {}, status: 'idle', error: null };
    graphics.value = { content: [], status: 'idle', error: null };
  }

  return { root, fields, graphics, reset };
});
