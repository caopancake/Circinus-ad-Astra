<template>
  <header class="titlebar" @pointerdown="startDrag" @dblclick="toggleMaximize">
    <div class="titlebar-brand">
      <img class="titlebar-mark" :src="appIcon" alt="Circinus ad Astra" draggable="false" />
      <div class="titlebar-text">
        <strong>Circinus ad Astra</strong>
        <span :title="project.activeManifest?.modRoot ?? ''">{{ workspace.activeMod?.displayName || '尚未打开项目' }}</span>
      </div>
    </div>

    <div class="titlebar-controls" @pointerdown.stop @dblclick.stop>
      <n-popover v-model:show="workspaceMenuVisible" placement="bottom-end" trigger="click">
        <template #trigger>
          <button class="titlebar-button" type="button" title="工作区菜单" aria-label="工作区菜单">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M10.3 3.48 9.7 5.6a6.77 6.77 0 0 0-1.64.95l-2.1-.63-1.5 2.6 1.53 1.56a6.8 6.8 0 0 0 0 1.9L4.46 13.54l1.5 2.6 2.1-.63c.5.39 1.05.7 1.64.95l.6 2.12h3l.6-2.12c.59-.25 1.14-.56 1.64-.95l2.1.63 1.5-2.6-1.53-1.56a6.8 6.8 0 0 0 0-1.9l1.53-1.56-1.5-2.6-2.1.63a6.77 6.77 0 0 0-1.64-.95l-.6-2.12h-3Z"
              />
              <path d="M12 14.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            </svg>
          </button>
        </template>
        <div class="titlebar-workspace-menu">
          <button type="button" :class="{ active: workspace.currentView === 'overview' }" @click="showOverview">工作区总览</button>
          <button type="button" :class="{ active: workspace.currentView === 'settings' }" @click="showSettings">设置</button>
          <button type="button" :class="{ active: workspace.currentView === 'about' }" @click="showAbout">关于</button>
        </div>
      </n-popover>
      <button class="titlebar-button" type="button" :title="settings.isDark ? '切换到浅色' : '切换到暗色'" @click="settings.toggleTheme">
        <svg v-if="settings.isDark" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 4.75V3m0 18v-1.75M5.81 5.81 4.58 4.58m14.84 14.84-1.23-1.23M4.75 12H3m18 0h-1.75M5.81 18.19l-1.23 1.23M19.42 4.58l-1.23 1.23M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
          />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.25 14.3A7.78 7.78 0 0 1 9.7 3.75 8.5 8.5 0 1 0 20.25 14.3Z" />
        </svg>
      </button>
      <button class="titlebar-button" type="button" title="最小化" @click="minimizeWindow">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <button class="titlebar-button" type="button" :title="isMaximized ? '还原' : '最大化'" @click="toggleMaximize">
        <svg v-if="isMaximized" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h9v9H8zM6 15H5V5h10v1" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z" /></svg>
      </button>
      <button class="titlebar-button close" type="button" title="关闭" @click="closeWindow">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import appIcon from '@/assets/app-icon.svg';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useSettingsStore } from '@/stores/settings.store';
import {
  closeCurrentWindow,
  isCurrentWindowMaximized,
  minimizeCurrentWindow,
  startCurrentWindowDrag,
  toggleMaximizeCurrentWindow,
} from '@/windows/current.window';

const project = useProjectStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const isMaximized = ref(false);
const workspaceMenuVisible = ref(false);
const navigation = useWorkspaceNavigationActions();

async function refreshMaximized() {
  isMaximized.value = await isCurrentWindowMaximized();
}

async function startDrag(event: { button: number; detail: number }) {
  if (event.button !== 0 || event.detail > 1) return;
  await startCurrentWindowDrag();
}

async function minimizeWindow() {
  await minimizeCurrentWindow();
}

async function toggleMaximize() {
  await toggleMaximizeCurrentWindow();
  await refreshMaximized();
}

async function closeWindow() {
  await closeCurrentWindow();
}

function showOverview() {
  workspaceMenuVisible.value = false;
  navigation.showOverview();
}

function showSettings() {
  workspaceMenuVisible.value = false;
  navigation.showSettings();
}

function showAbout() {
  workspaceMenuVisible.value = false;
  navigation.showAbout();
}

onMounted(refreshMaximized);
</script>
