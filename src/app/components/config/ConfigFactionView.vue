<template>
  <div class="config-factions-layout">
    <ConfigFactionList
      :selected-id="selectedFaction"
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
      v-if="selectedFaction && factions[selectedFaction]"
      :key="JSON.stringify([sessionId, modRoot])"
      :faction-id="selectedFaction"
      :faction-versions="factionVersions"
      :data-revision="factionDataRevision"
      :preview-revision="factionPreviewRevision"
      :factions="factions"
      :mod-root="modRoot"
      :session-id="sessionId"
      :query-preview-images="queryFactionPreviewImages"
      :schema-runtime-context="schemaRuntimeContext"
      :save-faction="saveFaction"
      :delete-faction="deleteFaction"
      @saved="onSaved"
    />
    <div v-else class="config-placeholder"><p>选择一个势力以编辑</p></div>
  </div>
</template>

<script setup lang="ts">
import ConfigFactionList from '@/app/components/config/ConfigFactionList.vue';
import ConfigFactionEditor from '@/app/components/config/ConfigFactionEditor.vue';
import { useDraftTransitionConfirmation } from '@/app/composables/use-draft-transition-confirmation';
import { useConfigFactionViewModel } from '@/app/composables/config/use-config-faction-view-model';

const {
  selectedFaction,
  factionDataRevision,
  factionPreviewRevision,
  listLoadStartedAt,
  factions,
  factionVersions,
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
const { confirmDraftTransition } = useDraftTransitionConfirmation();

function selectFaction(factionId: string | null): void {
  const nextFactionId = factionId ?? '';
  if (nextFactionId === selectedFaction.value) return;
  confirmDraftTransition(modRoot.value, {
    title: '切换势力？',
    content: '当前势力有未保存修改，切换后这些修改将丢失。确认继续？',
    action: () => {
      selectedFaction.value = nextFactionId;
    },
  });
}
</script>
