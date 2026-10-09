import type { CreatedMod, ModEntry, ProjectManifest, FeedbackNotice, GameScanWarning } from '@/shared/types';
import { cell, formatModVersion } from '@/shared/lib/starsector';
import { pathBasename } from '@/shared/lib/paths';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { closeProject, openProject } from '@/services/project-session.service';
import { detectDirectoryTarget, scanDirectoryGameOverview } from '@/services/directory.service';
import { formatLoadWarnings, scanWarningNotice } from '@/domain/project/load-warnings';
import { measurePerformance } from '@/shared/runtime/performance';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields } from '@/shared/lib/log-fields';
import { navigateToModOverview } from '@/orchestrators/workspace-navigation.orchestrator';
import { removeLoadedModRuntime } from '@/orchestrators/workspace-lifecycle.orchestrator';
import { buildModOpeningFailure } from '@/shared/lib/errors';

export type DirectoryOpeningOutcome =
  | { type: 'game-overview'; root: string; availableModCount: number }
  | { type: 'mod-loaded'; modRoot: string; modName: string; warnings: FeedbackNotice[] }
  | { type: 'already-loaded'; modRoot: string; modName: string }
  | { type: 'cancelled'; modRoot: string }
  | { type: 'unknown'; message: string };

type OpenModResult =
  { alreadyLoaded: true; displayName: string } | { alreadyLoaded: false; displayName: string; warnings: FeedbackNotice[] } | null;
type AfterOpenView = 'overview' | 'mod';

export async function openDirectoryTarget(path: string, knownStarsectorRoot: string | null): Promise<DirectoryOpeningOutcome> {
  const workspace = useWorkspaceStore();
  const workspaceGeneration = workspace.getWorkspaceGeneration();
  const detected = await detectDirectoryTarget(path, knownStarsectorRoot);
  if (workspace.getWorkspaceGeneration() !== workspaceGeneration) return { type: 'cancelled', modRoot: detected.modRoot ?? path };

  if (detected.kind === 'game-root' && detected.overview) {
    workspace.clearModOpeningFailures();
    workspace.setGameOverview(detected.overview);
    return { type: 'game-overview', root: detected.overview.starsectorRoot, availableModCount: detected.overview.mods.length };
  }

  if (detected.kind === 'mod-in-game' && detected.modRoot) {
    if (detected.overview) {
      workspace.setGameOverview(detected.overview);
    }
    const loaded = await openModProject(detected.modRoot, detected.starsectorRoot ?? null, 'overview');
    if (!loaded) return { type: 'cancelled', modRoot: detected.modRoot };
    return loaded.alreadyLoaded
      ? { type: 'already-loaded', modRoot: detected.modRoot, modName: loaded.displayName }
      : {
          type: 'mod-loaded',
          modRoot: detected.modRoot,
          modName: loaded.displayName,
          warnings: mergeOpeningWarnings(detected.warnings, loaded.warnings),
        };
  }

  if (detected.kind === 'external-mod' && detected.modRoot) {
    const loaded = await openModProject(detected.modRoot, detected.starsectorRoot ?? null, 'mod');
    if (!loaded) return { type: 'cancelled', modRoot: detected.modRoot };
    return loaded.alreadyLoaded
      ? { type: 'already-loaded', modRoot: detected.modRoot, modName: loaded.displayName }
      : {
          type: 'mod-loaded',
          modRoot: detected.modRoot,
          modName: loaded.displayName,
          warnings: mergeOpeningWarnings(detected.warnings, loaded.warnings),
        };
  }

  return { type: 'unknown', message: detected.warnings[0]?.message ?? '未识别该目录' };
}

export async function openModFromOverview(modRoot: string): Promise<DirectoryOpeningOutcome> {
  const workspace = useWorkspaceStore();
  const starsectorRoot = workspace.gameOverview?.starsectorRoot ?? null;
  const loaded = await openModProject(modRoot, starsectorRoot, 'mod');
  if (!loaded) return { type: 'cancelled', modRoot };
  return loaded.alreadyLoaded
    ? { type: 'already-loaded', modRoot, modName: loaded.displayName }
    : { type: 'mod-loaded', modRoot, modName: loaded.displayName, warnings: loaded.warnings };
}

export async function openCreatedModTarget(created: CreatedMod): Promise<DirectoryOpeningOutcome> {
  const workspace = useWorkspaceStore();
  const workspaceGeneration = workspace.getWorkspaceGeneration();
  const afterOpenView: AfterOpenView = created.starsectorRoot ? 'overview' : 'mod';

  if (created.starsectorRoot) {
    const overview = await scanDirectoryGameOverview(created.starsectorRoot);
    if (workspace.getWorkspaceGeneration() !== workspaceGeneration) return { type: 'cancelled', modRoot: created.modRoot };
    workspace.setGameOverview(overview);
  }

  const loaded = await openModProject(created.modRoot, created.starsectorRoot, afterOpenView);
  if (!loaded) return { type: 'cancelled', modRoot: created.modRoot };
  return loaded.alreadyLoaded
    ? { type: 'already-loaded', modRoot: created.modRoot, modName: loaded.displayName }
    : { type: 'mod-loaded', modRoot: created.modRoot, modName: loaded.displayName, warnings: loaded.warnings };
}

async function openModProject(modRoot: string, starsectorRoot: string | null, afterOpenView: AfterOpenView): Promise<OpenModResult> {
  const workspace = useWorkspaceStore();
  if (workspace.isModImported(modRoot)) {
    if (afterOpenView === 'overview') {
      workspace.showOverview();
    } else {
      navigateToModOverview(modRoot);
    }
    const entry = workspace.mods.get(modRoot);
    return { alreadyLoaded: true, displayName: entry?.displayName ?? modFolderDisplayName(modRoot) };
  }

  const generation = workspace.registerMod(createLoadingEntry(modRoot));
  workspace.activateModOverview(modRoot);

  try {
    const loaded = await openModProjectManifest(modRoot, starsectorRoot, generation);
    if (!loaded || workspace.getModGeneration(modRoot) !== generation) return null;
    const displayName = updateLoadedEntry(modRoot, loaded);
    const stillActive = workspace.activeModRoot === modRoot;
    measurePerformance('frontend.hydrateDirectoryOpenedModRuntime', { modRoot, activate: stillActive }, () =>
      hydrateOpenedModRuntime(modRoot, loaded, stillActive),
    );
    if (afterOpenView === 'overview') workspace.showOverview();
    return { alreadyLoaded: false, displayName, warnings: formatLoadWarnings(loaded) };
  } catch (error) {
    if (workspace.getModGeneration(modRoot) === generation) {
      workspace.setModOpeningFailure(buildModOpeningFailure(modRoot, error));
      await rollbackFailedModOpening(modRoot);
    }
    throw error;
  }
}

export async function openModProjectManifest(
  modRoot: string,
  starsectorRoot: string | null,
  generation: number,
  accepts: () => boolean = () => true,
): Promise<ProjectManifest | null> {
  const workspace = useWorkspaceStore();
  const project = useProjectStore();
  if (!accepts() || workspace.getModGeneration(modRoot) !== generation) return null;
  let loaded: ProjectManifest;
  try {
    loaded = await openProject(modRoot, starsectorRoot);
  } catch (error) {
    if (!accepts() || workspace.getModGeneration(modRoot) !== generation) return null;
    throw error;
  }
  if (!accepts() || workspace.getModGeneration(modRoot) !== generation) {
    await closeProject(loaded.sessionId);
    return null;
  }
  measurePerformance('frontend.project.registerProjectManifest', { modRoot }, () => project.registerProjectManifest(loaded));
  recordLogBestEffort({
    level: 'info',
    code: 'mod.session_opened',
    message: 'mod session opened',
    path: null,
    line: null,
    fields: logFields({
      modRoot,
      sessionId: loaded.sessionId,
      starsectorRoot: loaded.starsectorRoot,
      name: cell(loaded.modInfo?.name),
      version: formatModVersion(loaded.modInfo?.version),
      warnings: formatLoadWarnings(loaded).length,
    }),
  });
  return loaded;
}

export function hydrateOpenedModRuntime(modRoot: string, loaded: ProjectManifest, activate: boolean) {
  const tables = useTablesStore();
  const fileHistory = useFileHistoryStore();
  if (activate) {
    tables.hydrate(modRoot, loaded);
    fileHistory.activateFor(modRoot);
  } else {
    tables.hydrateWithoutActivate(modRoot, loaded);
  }
}

function updateLoadedEntry(modRoot: string, loaded: ProjectManifest): string {
  const workspace = useWorkspaceStore();
  const displayName = cell(loaded.modInfo?.name) || modFolderDisplayName(modRoot);
  const version = formatModVersion(loaded.modInfo?.version) || '';
  workspace.updateModInfo(modRoot, displayName, version);
  workspace.updateModStatus(modRoot, 'ready');
  workspace.clearModOpeningFailure(modRoot);
  return displayName;
}

async function rollbackFailedModOpening(modRoot: string) {
  const workspace = useWorkspaceStore();
  workspace.showOverview();
  await removeLoadedModRuntime(modRoot);
}

function mergeOpeningWarnings(detectedWarnings: GameScanWarning[], manifestWarnings: FeedbackNotice[]): FeedbackNotice[] {
  return [...detectedWarnings.map(scanWarningNotice), ...manifestWarnings];
}

function createLoadingEntry(modRoot: string): ModEntry {
  return {
    modRoot,
    displayName: modFolderDisplayName(modRoot),
    version: '',
    status: 'loading',
  };
}

function modFolderDisplayName(modRoot: string): string {
  return pathBasename(modRoot) || 'Mod';
}
