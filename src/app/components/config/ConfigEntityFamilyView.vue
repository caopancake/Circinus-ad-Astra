<template>
  <div class="config-family-view">
    <ConfigEntityFamilyList
      :family="family"
      :selected-id="selectedId"
      :files="files"
      :sprite-refs="spriteRefs"
      :hull-names="hullNames"
      :hull-options="hullOptions"
      :load-hull-options="loadHullOptions"
      :mod-root="modRoot"
      :session-id="sessionId"
      :list-load-started-at="listLoadStartedAt"
      :create-entity="createFamilyEntity"
      :delete-entity="deleteFamilyEntity"
      @select="selectFile"
    />
    <ConfigEntityFamilyEditor
      v-if="selectedId && files.some((file) => idOf(file) === selectedId)"
      :key="JSON.stringify([sessionId, modRoot, family.id])"
      :family="family"
      :selected-id="selectedId"
      :files="files"
      :mod-root="modRoot"
      :session-id="sessionId"
      :data-revision="dataRevision"
      :save-file="saveFamilyEntity"
      :delete-entity="deleteFamilyEntity"
      @saved="onSaved"
    />
    <div v-else class="config-placeholder">
      <p>选择一个{{ family.displayName }}以编辑</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ConfigEntityFamilyEditor from '@/app/components/config/ConfigEntityFamilyEditor.vue';
import ConfigEntityFamilyList from '@/app/components/config/ConfigEntityFamilyList.vue';
import { useDraftTransitionConfirmation } from '@/app/composables/use-draft-transition-confirmation';
import { useConfigFamilyViewModel } from '@/app/composables/config/use-config-family-view-model';
import { skinFamily, variantFamily } from '@/domain/config/config-entity-families';

const props = defineProps<{ familyId: 'variant' | 'skin' }>();

const family = computed(() => (props.familyId === 'variant' ? variantFamily : skinFamily));
const familyViewModel = useConfigFamilyViewModel(family.value);
const { confirmDraftTransition } = useDraftTransitionConfirmation();
const {
  selectedId,
  modRoot,
  sessionId,
  files,
  spriteRefs,
  hullNames,
  hullOptions,
  loadHullOptions,
  dataRevision,
  listLoadStartedAt,
  createFamilyEntity,
  deleteFamilyEntity,
  onSaved,
  saveFamilyEntity,
  idOf,
} = familyViewModel;

function selectFile(id: string | null): void {
  const nextId = id ?? '';
  if (nextId === selectedId.value) return;
  confirmDraftTransition(modRoot.value, {
    title: family.value.selectConfirmTitle,
    content: family.value.selectConfirmContent,
    action: () => {
      selectedId.value = nextId;
    },
  });
}
</script>
