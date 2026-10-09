<template>
  <div class="app-frame" :data-theme="settings.theme">
    <TitleBar />
    <ModTabsBar @remove-mod="actions.confirmRemoveMod" />
    <div class="app-shell">
      <ModNavigation />

      <OverviewPage
        v-if="workspace.currentView === 'overview'"
        @import-mod="actions.openDirectory"
        @refresh-workspace="actions.refreshWorkspace"
        @close-workspace="actions.confirmCloseWorkspace"
        @edit-warning-file="actions.openGameWarningFile"
        @edit-failure-file="actions.openModOpeningFailureFile"
        @load-mod="actions.loadOverviewMod"
      />
      <SettingsPage v-else-if="workspace.currentView === 'settings'" />
      <AboutPage v-else-if="workspace.currentView === 'about'" />
      <TableWorkspace v-else-if="workspace.currentView === 'table' && project.activeManifest" />
      <ConfigWorkspace v-else-if="workspace.currentView === 'config' && project.activeManifest" />
      <main v-else class="workspace workspace-loading">
        <section class="workspace-loading-state">
          <n-spin size="large" />
          <h1>正在加载 Mod</h1>
          <p>{{ loadingModLabel }}</p>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, watch } from 'vue';
import TitleBar from '@/app/TitleBar.vue';
import ModNavigation from '@/app/components/ModNavigation.vue';
import ModTabsBar from '@/app/components/ModTabsBar.vue';
import { useSettingsStore } from '@/stores/settings.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useWorkspaceShellActions } from '@/app/composables/use-workspace-shell-actions';
import { useWorkspaceShellLifecycle } from '@/app/composables/use-workspace-shell-lifecycle';
import { useMainWindowShortcuts } from '@/app/composables/use-main-window-shortcuts';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';

const OverviewPage = defineAsyncComponent(() => import('@/app/components/OverviewPage.vue'));
const SettingsPage = defineAsyncComponent(() => import('@/app/components/SettingsPage.vue'));
const AboutPage = defineAsyncComponent(() => import('@/app/components/AboutPage.vue'));
const TableWorkspace = defineAsyncComponent(() => import('@/app/components/TableWorkspace.vue'));
const ConfigWorkspace = defineAsyncComponent(() => import('@/app/components/config/ConfigWorkspace.vue'));

const project = useProjectStore();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const draftSessions = useDraftSessionsStore();
const feedback = useAppFeedback();
const actions = useWorkspaceShellActions(feedback);
useWorkspaceShellLifecycle(feedback, actions.selectAssociatedSpecs);
const saveCommand = useSaveCommandStore();
useMainWindowShortcuts(feedback);
const hasUnsavedMainWindowChanges = computed(() => workspace.loadedModList.some((mod) => draftSessions.hasUnsavedWorkForMod(mod.modRoot)));
const closeGuard = useDirtyWindowCloseGuard({
  beforeClose: actions.closeWorkspaceWindows,
  content: '主窗口中仍有未保存修改，关闭后这些修改将丢失。',
  dirty: hasUnsavedMainWindowChanges,
  title: '放弃未保存修改并关闭？',
});

const isTableView = computed(() => workspace.currentView === 'table' && Boolean(project.activeManifest));
const loadingModLabel = computed(() => {
  const activeModRoot = workspace.activeModRoot;
  if (!activeModRoot) return '';
  return workspace.loadedModList.find((mod) => mod.modRoot === activeModRoot)?.displayName || activeModRoot;
});

// Registration follows the same onMounted/onUnmounted pattern as the config
// editors; the table-view condition is watched so the handler is swapped the
// moment the view changes.
watch(
  isTableView,
  (active) => {
    if (active) {
      saveCommand.registerActiveSaveHandler(actions.saveChanges);
    } else {
      saveCommand.unregisterActiveSaveHandler(actions.saveChanges);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  closeGuard.dispose();
  saveCommand.unregisterActiveSaveHandler(actions.saveChanges);
});

onMounted(() => {
  void closeGuard.install();
});
</script>
