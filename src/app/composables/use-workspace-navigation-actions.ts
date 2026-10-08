import * as workspaceNavigation from '@/orchestrators/workspace-navigation.orchestrator';
import { useDraftTransitionConfirmation } from '@/app/composables/use-draft-transition-confirmation';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useTablesStore } from '@/stores/tables.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSaveCommandStore } from '@/stores/save-command.store';
import type { ConfigView, TableKey } from '@/shared/types';

export function useWorkspaceNavigationActions() {
  const workspace = useWorkspaceStore();
  const tables = useTablesStore();
  const feedback = useAppFeedback();
  const { confirmDraftTransition } = useDraftTransitionConfirmation();

  function navigateToModOverview(modRoot: string): void {
    confirmNavigation(() => workspaceNavigation.navigateToModOverview(modRoot));
  }

  function navigateToModTable(modRoot: string, table: TableKey): void {
    confirmNavigation(() => workspaceNavigation.navigateToModTable(modRoot, table));
  }

  function navigateToModConfig(modRoot: string, configView: ConfigView): void {
    if (workspace.activeModRoot === modRoot && workspace.currentView === 'config' && workspace.configView === configView) return;
    confirmNavigation(() => workspaceNavigation.navigateToModConfig(modRoot, configView));
  }

  function activateModTab(modRoot: string): void {
    if (workspace.activeModRoot === modRoot && workspace.isModView) return;
    confirmNavigation(() => workspaceNavigation.activateModTab(modRoot));
  }

  function showOverview(): void {
    confirmNavigation(() => workspace.showOverview());
  }

  function showSettings(): void {
    confirmNavigation(() => workspace.showSettings());
  }

  function showAbout(): void {
    confirmNavigation(() => workspace.showAbout());
  }

  function confirmNavigation(action: () => void) {
    const commands = useSaveCommandStore();
    const sequence = commands.beginTransition();
    const waiting = commands.waitForSaves();
    if (waiting) {
      void waiting.then((saved) => {
        if (saved && commands.isTransitionCurrent(sequence)) confirmIdleNavigation(action, sequence);
      });
      return;
    }
    confirmIdleNavigation(action, sequence);
  }

  function confirmIdleNavigation(action: () => void, sequence: number) {
    const modRoot = workspace.activeModRoot;
    if (modRoot && workspace.currentView === 'table') {
      const inputs = tables.getTableInputs(modRoot, tables.currentTab);
      const pending = inputs.commit();
      if (pending) {
        void pending
          .then((accepted) => {
            if (accepted && workspace.activeModRoot === modRoot && useSaveCommandStore().isTransitionCurrent(sequence))
              confirmConfigNavigation(action);
          })
          .catch((error: unknown) => feedback.error(error));
        return;
      }
    }
    confirmConfigNavigation(action);
  }

  function confirmConfigNavigation(action: () => void) {
    confirmDraftTransition(workspace.activeModRoot, {
      title: '放弃未保存配置修改？',
      content: '当前配置有未保存修改，切换后这些修改将丢失。确认继续？',
      action,
    });
  }

  return {
    activateModTab,
    navigateToModConfig,
    navigateToModOverview,
    navigateToModTable,
    showAbout,
    showOverview,
    showSettings,
  };
}
