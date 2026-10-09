<template>
  <section class="game-overview">
    <div class="game-overview-summary">
      <div class="game-overview-title">
        <strong>{{ overview.starsectorRoot }}</strong>
        <span>{{ overview.coreAvailable ? '原版数据可用' : '原版数据不可用' }}</span>
      </div>
      <div class="game-overview-actions">
        <n-button size="small" type="primary" @click="$emit('create-mod')">创建新 Mod</n-button>
        <n-button size="small" @click="$emit('refresh-workspace')">刷新工作区</n-button>
        <n-button size="small" secondary type="error" @click="$emit('close-workspace')">关闭工作区</n-button>
      </div>
    </div>

    <ModOpeningFailureList :failures="openingFailures" @edit-failure-file="$emit('edit-failure-file', $event)" />

    <div v-if="overview.warnings.length > 0" class="game-warning-list">
      <div v-for="warning in overview.warnings" :key="warningKey(warning)" class="game-warning-item">
        <div class="game-warning-content">
          <strong>{{ warningMessage(warning) }}</strong>
          <span>{{ warning.path }}</span>
        </div>
        <n-button v-if="warning.editTarget" size="small" secondary type="warning" @click="$emit('edit-warning-file', warning)">
          打开文件
        </n-button>
      </div>
    </div>

    <div v-if="overview.mods.length === 0" class="game-overview-empty">
      <h2>没有发现可识别 Mod</h2>
      <p>已打开游戏目录，但 `mods` 目录下没有包含 `mod_info.json` 的 Mod。</p>
      <div class="game-overview-actions">
        <n-button size="small" type="primary" @click="$emit('create-mod')">创建新 Mod</n-button>
        <n-button size="small" @click="$emit('refresh-workspace')">刷新工作区</n-button>
        <n-button size="small" secondary type="error" @click="$emit('close-workspace')">关闭工作区</n-button>
      </div>
    </div>

    <div v-else class="overview-grid">
      <div
        v-for="mod in overview.mods"
        :key="mod.modRoot"
        class="overview-mod-card"
        :class="{ 'card-active': workspace.isModView && workspace.activeModRoot === mod.modRoot }"
      >
        <div class="mod-card-header">
          <strong>{{ mod.name }}</strong>
          <span class="mod-card-status" :class="modStatus(mod.modRoot)">{{ statusText(mod.modRoot) }}</span>
        </div>
        <div class="mod-card-version">{{ mod.version || '未声明版本' }}</div>
        <div class="mod-card-path">{{ mod.modRoot }}</div>
        <div v-if="mod.description" class="mod-card-description">{{ mod.description }}</div>
        <div class="mod-card-actions">
          <n-button v-if="workspace.isModImported(mod.modRoot)" size="small" @click="navigateToModOverview(mod.modRoot)">进入编辑</n-button>
          <n-button v-else size="small" type="primary" @click="$emit('load-mod', mod.modRoot)">打开</n-button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import ModOpeningFailureList from '@/app/components/ModOpeningFailureList.vue';
import type { GameOverviewData, GameScanWarning, ModOpeningFailure } from '@/shared/types';
import { modStatusLabel } from '@/domain/workspace/mod-status';
import { appendFileReferenceLocation, extractFileReferenceFromError, formatError } from '@/shared/lib/errors';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';

defineProps<{ openingFailures: ModOpeningFailure[]; overview: GameOverviewData }>();
defineEmits<{
  'create-mod': [];
  'refresh-workspace': [];
  'close-workspace': [];
  'edit-warning-file': [warning: GameScanWarning];
  'edit-failure-file': [failure: ModOpeningFailure];
  'load-mod': [modRoot: string];
}>();

const workspace = useWorkspaceStore();
const { navigateToModOverview } = useWorkspaceNavigationActions();

function modStatus(modRoot: string): string {
  return workspace.mods.get(modRoot)?.status ?? 'pending';
}

function statusText(modRoot: string): string {
  const status = workspace.mods.get(modRoot)?.status;
  return status ? modStatusLabel(status) : '未读取';
}

function warningKey(warning: GameScanWarning): string {
  return JSON.stringify([warning.path, warning.message]);
}

function warningMessage(warning: GameScanWarning): string {
  return appendFileReferenceLocation(formatError(warning), extractFileReferenceFromError(warning));
}
</script>
