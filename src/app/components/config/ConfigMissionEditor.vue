<template>
  <main v-if="schema" class="mission-editor">
    <header class="mission-editor-header">
      <h3>{{ editingMissionId || missionId }}</h3>
      <div class="config-editor-actions">
        <n-button v-if="hasPendingExternalData" size="small" secondary type="warning" @click="loadPendingExternalData">
          载入外部版本
        </n-button>
        <n-button size="small" secondary type="error" @click="confirmDeleteMission">删除</n-button>
        <n-button type="primary" size="small" :loading="saving" @click="save">保存</n-button>
      </div>
    </header>
    <div v-if="externalUpdateNotice" class="config-external-update-note">{{ externalUpdateNotice }}</div>
    <div class="mission-editor-body">
      <div v-if="iconSrc" class="mission-icon-preview">
        <img :src="iconSrc" alt="" />
      </div>
      <SchemaFormRenderer :schema="schema" v-model="draftData" :runtime-context="schemaRuntimeContext" />
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, toRef } from 'vue';
import type { ConfigMissionEditorData, RowData } from '@/shared/types';
import SchemaFormRenderer from '@/app/components/schema/SchemaFormRenderer.vue';
import { getSchema } from '@/domain/schema/schema-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { createSchemaRuntimeContext } from '@/app/composables/use-schema-runtime-context';
import type { FileSchema } from '@/domain/schema/schema.types';
import { useConfigMissionEditorViewModel } from '@/app/composables/config/use-config-mission-editor-view-model';
import { useSaveCommandStore } from '@/stores/save-command.store';

const props = defineProps<{
  missionId: string;
  modRoot: string | null;
  sessionId: string | null;
  editorReloadToken: number;
  iconRefreshToken: number;
  queryMissionEditorData: (sessionId: string, id: string) => Promise<ConfigMissionEditorData | null>;
  saveMission: (
    sessionId: string,
    modRoot: string,
    previousId: string,
    localMission: RowData,
    schema: FileSchema,
    baseVersions: import('@/shared/types').FileVersion[],
  ) => Promise<import('@/shared/types').ConfigSaveIdentity | null>;
  deleteMission: (sessionId: string, modRoot: string, id: string, deleteDirectory: boolean) => Promise<boolean>;
}>();
const emit = defineEmits<{ saved: [missionId: string | null] }>();

const feedback = useAppFeedback();

const modRoot = computed(() => props.modRoot);
const sessionId = computed(() => props.sessionId);
const schema = computed(() => getSchema('mission'));
const schemaRuntimeContext = computed(() =>
  props.modRoot && props.sessionId ? { ...createSchemaRuntimeContext(props.modRoot, props.sessionId), missionId: props.missionId } : null,
);
const {
  clearMissionTarget,
  draftData,
  editingMissionId,
  externalUpdateNotice,
  hasPendingExternalData,
  iconSrc,
  loadPendingExternalData,
  loadedMissionId,
  save,
  saving,
} = useConfigMissionEditorViewModel({
  editorReloadToken: toRef(props, 'editorReloadToken'),
  iconRefreshToken: toRef(props, 'iconRefreshToken'),
  missionId: toRef(props, 'missionId'),
  modRoot,
  onSaved: (missionId) => emit('saved', missionId),
  queryMissionEditorData: props.queryMissionEditorData,
  saveMission: props.saveMission,
  schema,
  sessionId,
});

function confirmDeleteMission() {
  const id = loadedMissionId.value ?? props.missionId;
  const deleteModRoot = modRoot.value;
  const deleteSessionId = sessionId.value;
  if (!deleteModRoot || !deleteSessionId || !id) return;
  feedback.confirmDanger({
    title: '删除战役',
    content: `确定要删除战役 "${id}" 吗？`,
    actionText: '删除',
    onConfirm: async () => {
      await deleteMissionTarget(deleteSessionId, deleteModRoot, id);
    },
  });
}

async function deleteMissionTarget(deleteSessionId: string, deleteModRoot: string, id: string) {
  try {
    await props.deleteMission(deleteSessionId, deleteModRoot, id, true);
    if (modRoot.value !== deleteModRoot || sessionId.value !== deleteSessionId) return true;
    clearMissionTarget();
    emit('saved', null);
  } catch (error) {
    feedback.error(error, '删除战役失败');
    return false;
  }
  return true;
}

const saveCommand = useSaveCommandStore();
onMounted(() => saveCommand.registerActiveSaveHandler(save));
onUnmounted(() => saveCommand.unregisterActiveSaveHandler(save));
</script>
