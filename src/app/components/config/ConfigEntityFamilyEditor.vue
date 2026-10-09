<template>
  <main v-if="selectedFile && schema" class="config-family-editor">
    <header class="config-family-editor-header">
      <div>
        <h3>{{ selectedId }}</h3>
        <p>{{ selectedFile.relPath }}</p>
      </div>
      <div class="config-family-editor-actions">
        <n-button v-if="hasPendingExternalData" size="small" secondary type="warning" @click="loadPendingExternalData">
          载入外部版本
        </n-button>
        <n-button size="small" secondary type="error" @click="confirmDelete">删除</n-button>
        <n-button type="primary" size="small" :loading="saving" @click="save">保存</n-button>
      </div>
    </header>
    <div v-if="externalUpdateNotice" class="config-external-update-note">{{ externalUpdateNotice }}</div>
    <div class="config-family-editor-body">
      <SchemaFormRenderer :schema="schema" v-model="draftData" :runtime-context="schemaRuntimeContext" />
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, toRef } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { RowData, SavedConfig, ConfigIdentityHandoff } from '@/shared/types';
import SchemaFormRenderer from '@/app/components/schema/SchemaFormRenderer.vue';
import { getSchema } from '@/domain/schema/schema-registry';
import { useConfigFamilyEditorViewModel } from '@/app/composables/config/use-config-family-editor-view-model';
import { useSaveCommandStore } from '@/stores/save-command.store';
import type { ConfigEntityFamilyDefinition, ConfigFamilyFile } from '@/domain/config/config-entity-families';
import { familyFileId } from '@/domain/config/config-entity-families';

const props = defineProps<{
  family: ConfigEntityFamilyDefinition;
  selectedId: string;
  files: ConfigFamilyFile[];
  modRoot: string | null;
  sessionId: string | null;
  dataRevision: number;
  identityHandoff: ConfigIdentityHandoff<ConfigFamilyFile> | null;
  saveFile: (sessionId: string, modRoot: string, current: ConfigFamilyFile, data: RowData) => Promise<SavedConfig<ConfigFamilyFile> | null>;
  deleteEntity: (sessionId: string, modRoot: string, id: string, relPath: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ saved: [id: string | null] }>();

const feedback = useAppFeedback();

const schema = computed(() => getSchema(props.family.schemaId));
const files = computed(() => [...props.files]);
const {
  draftData,
  externalUpdateNotice,
  hasPendingExternalData,
  loadPendingExternalData,
  save,
  saving,
  selectedFile,
  schemaRuntimeContext,
} = useConfigFamilyEditorViewModel({
  family: props.family,
  dataRevision: toRef(props, 'dataRevision'),
  modRoot: toRef(props, 'modRoot'),
  onSaved: (id) => emit('saved', id),
  saveFile: props.saveFile,
  sessionId: toRef(props, 'sessionId'),
  selectedId: toRef(props, 'selectedId'),
  files,
  identityHandoff: toRef(props, 'identityHandoff'),
});

function fileId(file: ConfigFamilyFile): string {
  return familyFileId(file);
}

function confirmDelete() {
  const current = selectedFile.value;
  const deleteModRoot = props.modRoot;
  const deleteSessionId = props.sessionId;
  if (!current || !deleteModRoot || !deleteSessionId) return;
  const currentId = fileId(current);
  feedback.confirmDanger({
    title: `删除${props.family.displayName}`,
    content: `确定要删除${props.family.displayName} "${currentId}" 吗？`,
    actionText: '删除',
    onConfirm: async () => {
      await deleteEntityTarget(deleteSessionId, deleteModRoot, currentId, String(current.relPath ?? ''));
    },
  });
}

async function deleteEntityTarget(deleteSessionId: string, deleteModRoot: string, currentId: string, relPath: string) {
  try {
    if (!(await props.deleteEntity(deleteSessionId, deleteModRoot, currentId, relPath))) return false;
    if (props.modRoot !== deleteModRoot || props.sessionId !== deleteSessionId) return true;
    const nextFile = files.value.find((file) => fileId(file) !== currentId) ?? null;
    emit('saved', nextFile ? fileId(nextFile) : null);
  } catch (error) {
    feedback.error(error, `删除${props.family.displayName}失败`);
    return false;
  }
  return true;
}

const saveCommand = useSaveCommandStore();
onMounted(() => saveCommand.registerActiveSaveHandler(save));
onUnmounted(() => saveCommand.unregisterActiveSaveHandler(save));
</script>
