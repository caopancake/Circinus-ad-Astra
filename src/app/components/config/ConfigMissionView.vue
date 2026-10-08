<template>
  <div class="mission-view">
    <ConfigMissionList
      :selected-id="selectedMission"
      :refresh-token="refreshToken"
      :missions="missionItems"
      :mission-icon-refs="missionIconRefs"
      :mod-root="modRoot"
      :session-id="sessionId"
      :list-load-started-at="listLoadStartedAt"
      :refresh-mission-list="refreshMissionList"
      :create-mission="createMission"
      :delete-mission="deleteMission"
      :mission-exists="missionExists"
      :is-valid-mission-id="isValidMissionId"
      @select="selectMission"
    />
    <ConfigMissionEditor
      v-if="selectedMission"
      :key="JSON.stringify([sessionId, modRoot])"
      :mission-id="selectedMission"
      :mod-root="modRoot"
      :session-id="sessionId"
      :editor-reload-token="missionEditorReloadToken"
      :icon-refresh-token="missionIconRefreshToken"
      :query-mission-editor-data="queryMissionEditorData"
      :save-mission="saveMission"
      :delete-mission="deleteMission"
      @saved="handleSaved"
    />
    <div v-else class="config-placeholder">
      <p>选择一个战役以编辑</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import ConfigMissionList from '@/app/components/config/ConfigMissionList.vue';
import ConfigMissionEditor from '@/app/components/config/ConfigMissionEditor.vue';
import { useDraftTransitionConfirmation } from '@/app/composables/use-draft-transition-confirmation';
import { useConfigMissionViewModel } from '@/app/composables/config/use-config-mission-view-model';

const {
  selectedMission,
  refreshToken,
  missionEditorReloadToken,
  missionIconRefreshToken,
  listLoadStartedAt,
  missionItems,
  missionIconRefs,
  modRoot,
  sessionId,
  handleSaved,
  createMission,
  deleteMission,
  refreshMissionList,
  queryMissionEditorData,
  missionExists,
  isValidMissionId,
  saveMission,
} = useConfigMissionViewModel();
const { confirmDraftTransition } = useDraftTransitionConfirmation();

function selectMission(missionId: string | null): void {
  const nextMissionId = missionId ?? '';
  if (nextMissionId === selectedMission.value) return;
  confirmDraftTransition(modRoot.value, {
    title: '切换战役？',
    content: '当前战役有未保存修改，切换后这些修改将丢失。确认继续？',
    action: () => {
      selectedMission.value = nextMissionId;
    },
  });
}
</script>
