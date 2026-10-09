<template>
  <div class="mission-view">
    <ConfigMissionList
      :selected-id="selectedMission"
      :action-running="actionRunning"
      :missions="missionItems"
      :mission-icon-refs="missionIconRefs"
      :mod-root="modRoot"
      :session-id="sessionId"
      :list-load-started-at="listLoadStartedAt"
      :create-mission="createMission"
      :delete-mission="deleteMission"
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
      :query-mission-icon="queryMissionIcon"
      :save-mission="saveMission"
      :delete-mission="deleteMission"
      :actions-locked="actionsLocked"
      :deleted-target="deletedTarget"
      :discard-deleted-target="discardDeletedTarget"
      :identity-handoff="identityHandoff"
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
import { useConfigMissionViewModel } from '@/app/composables/config/use-config-mission-view-model';

const {
  selectedMission,
  identityHandoff,
  selectMission,
  actionsLocked,
  actionRunning,
  deletedTarget,
  discardDeletedTarget,
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
  queryMissionEditorData,
  queryMissionIcon,
  saveMission,
} = useConfigMissionViewModel();
</script>
