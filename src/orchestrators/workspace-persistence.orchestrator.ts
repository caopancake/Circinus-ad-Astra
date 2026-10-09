import { watch } from 'vue';
import { errorContextOf, errorDiagnosticOf } from '@/shared/lib/errors';
import { logFields } from '@/shared/lib/log-fields';
import { cell, formatModVersion } from '@/shared/lib/starsector';
import type { PersistedMod, ProjectManifest, FeedbackNotice } from '@/shared/types';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { formatLoadWarnings } from '@/domain/project/load-warnings';
import { hydrateOpenedModRuntime, openModProjectManifest } from '@/orchestrators/directory-opening.orchestrator';
import { measurePerformance } from '@/shared/runtime/performance';
import { recordLogBestEffort } from '@/services/app-log.service';
import { scanDirectoryGameOverview } from '@/services/directory.service';
import { loadPersistedWorkspace, savePersistedWorkspace } from '@/services/workspace-state.service';

interface RestoreWorkspaceOptions {
  isCurrent?: () => boolean;
  knownStarsectorRoot: string | null;
  loadCoreFields?: () => void | Promise<void>;
  onModRestoreError: (modRoot: string, displayName: string, error: unknown) => void | Promise<void>;
  onModRestoreWarnings?: (displayName: string, warnings: FeedbackNotice[]) => void;
}

export function watchWorkspacePersistence() {
  const workspace = useWorkspaceStore();
  let saveTimer: number | null = null;
  let restoring = false;

  const stop = watch(
    () => workspace.toPersistedState(),
    (state) => {
      if (restoring) return;
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        savePersistedWorkspace(state).catch((error) => {
          const diagnostic = errorDiagnosticOf(error);
          recordLogBestEffort({
            level: 'error',
            code: diagnostic.code,
            message: diagnostic.message,
            path: diagnostic.location?.path ?? null,
            line: diagnostic.location?.line ?? null,
            fields: logFields({ ...errorContextOf(error), action: 'workspace-save', column: diagnostic.location?.column }),
          });
        });
      }, 500);
    },
    { deep: true },
  );

  return {
    beginRestore() {
      restoring = true;
    },
    async finishRestore(persist = true) {
      restoring = false;
      if (persist) await savePersistedWorkspace(workspace.toPersistedState());
    },
    stop() {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      stop();
    },
  };
}

export async function restorePersistedWorkspace(options: RestoreWorkspaceOptions) {
  const workspace = useWorkspaceStore();
  const generation = workspace.getWorkspaceGeneration();
  const current = () => workspace.getWorkspaceGeneration() === generation && (options.isCurrent?.() ?? true);
  const persisted = await loadPersistedWorkspace();
  if (!current()) return;
  if (persisted.mods.length === 0 && !persisted.starsectorRoot) return;

  workspace.applyPersistedWorkspaceSnapshot(persisted);
  const restoreTargets = persisted.mods.map((mod) => ({ mod, generation: workspace.getModGeneration(mod.modRoot)! }));
  if (persisted.starsectorRoot) {
    const overview = await scanDirectoryGameOverview(persisted.starsectorRoot);
    if (!current()) return;
    if (workspace.gameOverview?.starsectorRoot === persisted.starsectorRoot) workspace.setGameOverview(overview);
  }

  for (const { mod, generation } of restoreTargets) {
    if (!current()) return;
    try {
      const loaded = await restorePersistedModProject(mod, persisted.starsectorRoot ?? options.knownStarsectorRoot, generation, current);
      if (!current()) return;
      if (!loaded || workspace.getModGeneration(mod.modRoot) !== generation) continue;
      const name = cell(loaded.modInfo?.name) || mod.displayName;
      const version = formatModVersion(loaded.modInfo?.version) || mod.version;
      workspace.updateModInfo(mod.modRoot, name, version);
      workspace.updateModStatus(mod.modRoot, 'ready');
      const warnings = formatLoadWarnings(loaded);
      if (warnings.length > 0) {
        options.onModRestoreWarnings?.(name, warnings);
      }
    } catch (error) {
      if (current()) await options.onModRestoreError(mod.modRoot, mod.displayName || mod.modRoot, error);
    }
  }

  if (!current()) return;
  workspace.showOverview();
  await options.loadCoreFields?.();
}

export type WorkspacePersistenceWatcher = ReturnType<typeof watchWorkspacePersistence>;

async function restorePersistedModProject(
  mod: PersistedMod,
  starsectorRoot: string | null,
  generation: number,
  current: () => boolean,
): Promise<ProjectManifest | null> {
  const loaded = await openModProjectManifest(mod.modRoot, starsectorRoot, generation, current);
  if (!current()) return null;
  if (!loaded || useWorkspaceStore().getModGeneration(mod.modRoot) !== generation) return null;
  measurePerformance('frontend.hydrateDirectoryOpenedModRuntime', { modRoot: mod.modRoot, activate: false }, () =>
    hydrateOpenedModRuntime(mod.modRoot, loaded, false),
  );
  return loaded;
}
