import type { ConfigView, TableKey } from '@/shared/types';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

function syncActiveModRuntime(modRoot: string) {
  const project = useProjectStore();
  const tables = useTablesStore();
  const fileHistory = useFileHistoryStore();
  // workspace owns the active identity (set by activateMod* below); here we
  // only project per-Mod derived state onto the other stores.
  const manifest = project.getManifest(modRoot);

  tables.activateFor(modRoot, manifest);
  fileHistory.activateFor(modRoot);
}

export function navigateToModOverview(modRoot: string) {
  const workspace = useWorkspaceStore();
  if (!workspace.mods.has(modRoot)) return;
  syncActiveModRuntime(modRoot);
  workspace.activateModOverview(modRoot);
}

export function navigateToModTable(modRoot: string, tab: TableKey) {
  const workspace = useWorkspaceStore();
  const tables = useTablesStore();
  if (!workspace.mods.has(modRoot)) return;
  if (isActiveTableTarget(modRoot, tab)) return;
  syncActiveModRuntime(modRoot);
  tables.switchTab(modRoot, tab);
  workspace.activateModTable(modRoot);
}

export function navigateToModConfig(modRoot: string, view: ConfigView) {
  const workspace = useWorkspaceStore();
  if (!workspace.mods.has(modRoot)) return;
  syncActiveModRuntime(modRoot);
  workspace.activateModConfig(modRoot, view);
}

export function activateModTab(modRoot: string) {
  const workspace = useWorkspaceStore();
  if (!workspace.mods.has(modRoot)) return;
  syncActiveModRuntime(modRoot);
  workspace.activateModTab(modRoot);
}

function isActiveTableTarget(modRoot: string, tab: TableKey): boolean {
  const workspace = useWorkspaceStore();
  const tables = useTablesStore();
  return (
    workspace.activeModRoot === modRoot &&
    workspace.currentView === 'table' &&
    tables.activeModRoot === modRoot &&
    tables.currentTab === tab
  );
}
