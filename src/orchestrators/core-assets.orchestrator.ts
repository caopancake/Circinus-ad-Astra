import { computed, watch } from 'vue';
import { useCoreAssetsStore, type CoreAssetState } from '@/stores/core-assets.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useProjectStore } from '@/stores/project.store';
import { queryCoreFields, queryCoreGraphics } from '@/services/core-assets.service';
import { recordLogBestEffort } from '@/services/app-log.service';
import { errorContextOf, errorDiagnosticOf } from '@/shared/lib/errors';
import { logFields } from '@/shared/lib/log-fields';

interface CoreLoader {
  fields: () => Promise<void>;
  graphics: () => Promise<void>;
}

const loaders = new WeakMap<ReturnType<typeof useCoreAssetsStore>, CoreLoader>();

export function startCoreAssetsLoading(): () => void {
  const store = useCoreAssetsStore();
  const settings = useSettingsStore();
  const project = useProjectStore();
  const root = computed(() => settings.starsectorRoot ?? project.activeManifest?.starsectorRoot ?? null);
  let generation = 0;
  let disposed = false;

  function loader<T>(state: () => CoreAssetState<T>, query: (root: string) => Promise<T>) {
    let pending: { generation: number; promise: Promise<void> } | null = null;
    return function load(): Promise<void> {
      const capturedRoot = store.root;
      const capturedGeneration = generation;
      if (!capturedRoot || state().status === 'ready') return Promise.resolve();
      if (pending?.generation === capturedGeneration) return pending.promise;
      const capturedState = state();
      capturedState.status = 'loading';
      capturedState.error = null;
      const accepts = () => !disposed && generation === capturedGeneration;
      const promise = query(capturedRoot)
        .then((content) => {
          if (!accepts()) return;
          capturedState.content = content;
          capturedState.status = 'ready';
        })
        .catch((error: unknown) => {
          if (!accepts()) return;
          capturedState.status = 'error';
          const diagnostic = errorDiagnosticOf(error);
          capturedState.error = diagnostic;
          recordLogBestEffort({
            level: 'error',
            code: diagnostic.code,
            message: diagnostic.message,
            path: diagnostic.location?.path ?? null,
            line: diagnostic.location?.line ?? null,
            fields: logFields({ ...errorContextOf(error), root: capturedRoot, column: diagnostic.location?.column }),
          });
        })
        .finally(() => {
          if (pending?.generation === capturedGeneration) pending = null;
        });
      pending = { generation: capturedGeneration, promise };
      return promise;
    };
  }

  const runtime = {
    fields: loader(() => store.fields, queryCoreFields),
    graphics: loader(() => store.graphics, queryCoreGraphics),
  };
  loaders.set(store, runtime);
  store.reset(root.value);
  const stop = watch(
    root,
    (nextRoot) => {
      generation++;
      store.reset(nextRoot);
      void runtime.fields();
      void runtime.graphics();
    },
    { flush: 'sync' },
  );
  return () => {
    disposed = true;
    generation++;
    stop();
    loaders.delete(store);
    store.reset(null);
  };
}

export function loadCoreFields(): Promise<void> {
  return loaders.get(useCoreAssetsStore())!.fields();
}

export function loadCoreGraphics(): Promise<void> {
  return loaders.get(useCoreAssetsStore())!.graphics();
}
