<template>
  <div class="config-factions-layout">
    <ConfigFactionList
      :selected-id="selectedFaction"
      :action-running="actionRunning"
      :factions="factions"
      :faction-crest-refs="factionCrestRefs"
      :mod-root="modRoot"
      :session-id="sessionId"
      :list-load-started-at="listLoadStartedAt"
      :create-faction="createFaction"
      :delete-faction="deleteFaction"
      @select="selectFaction"
    />
    <ConfigFactionEditor
      v-if="selectedFaction && editorFactions[selectedFaction]"
      :key="JSON.stringify([sessionId, modRoot])"
      :faction-id="selectedFaction"
      :faction-versions="editorFactionVersions"
      :identity-handoff="identityHandoff"
      :data-revision="factionDataRevision"
      :preview-revision="factionPreviewRevision"
      :factions="editorFactions"
      :mod-root="modRoot"
      :session-id="sessionId"
      :query-preview-images="queryFactionPreviewImages"
      :schema-runtime-context="schemaRuntimeContext"
      :save-faction="saveFaction"
      :delete-faction="deleteFaction"
      :actions-locked="actionsLocked"
      :deleted-target="deletedTarget"
      :discard-deleted-target="discardDeletedTarget"
      @saved="onSaved"
    />
    <div v-else class="config-placeholder"><p>选择一个势力以编辑</p></div>
  </div>
</template>

<script setup lang="ts">
import ConfigFactionList from '@/app/components/config/ConfigFactionList.vue';
import ConfigFactionEditor from '@/app/components/config/ConfigFactionEditor.vue';
import { useConfigFactionViewModel } from '@/app/composables/config/use-config-faction-view-model';

const {
  selectedFaction,
  selectFaction,
  actionsLocked,
  actionRunning,
  deletedTarget,
  discardDeletedTarget,
  editorFactions,
  editorFactionVersions,
  identityHandoff,
  factionDataRevision,
  factionPreviewRevision,
  listLoadStartedAt,
  factions,
  factionCrestRefs,
  modRoot,
  sessionId,
  schemaRuntimeContext,
  createFaction,
  deleteFaction,
  onSaved,
  queryFactionPreviewImages,
  saveFaction,
} = useConfigFactionViewModel();
</script>
