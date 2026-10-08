<template>
  <div class="faction-editor-page">
    <header class="faction-editor-header">
      <h2>{{ displayName }}</h2>
      <div class="config-editor-actions">
        <n-button v-if="hasPendingExternalData" size="small" secondary type="warning" @click="loadPendingExternalData">
          载入外部版本
        </n-button>
        <n-button size="small" secondary type="error" @click="confirmDeleteFaction">删除</n-button>
        <n-button type="primary" size="small" :loading="saving" @click="save">保存</n-button>
      </div>
    </header>
    <div v-if="externalUpdateNotice" class="config-external-update-note">{{ externalUpdateNotice }}</div>

    <!-- Logo/Crest preview -->
    <div v-if="logoSrc || crestSrc" class="faction-previews">
      <div v-if="logoSrc" class="faction-preview-item faction-preview-logo">
        <span>Logo</span>
        <img :src="logoSrc" class="faction-full-preview" />
      </div>
      <div v-if="crestSrc" class="faction-preview-item faction-preview-crest">
        <span>Crest</span>
        <img :src="crestSrc" class="faction-full-preview" />
      </div>
    </div>

    <!-- Schema-driven form -->
    <SchemaFormRenderer v-if="schema" :schema="schema" v-model="draftData" :runtime-context="props.schemaRuntimeContext" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, toRef } from 'vue';
import type { RowData } from '@/shared/types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { FileSchema } from '@/domain/schema/schema.types';
import SchemaFormRenderer from '@/app/components/schema/SchemaFormRenderer.vue';
import { useCoreSchema } from '@/app/composables/use-core-assets';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useConfigFactionEditorViewModel } from '@/app/composables/config/use-config-faction-editor-view-model';
import { useSaveCommandStore } from '@/stores/save-command.store';

const props = defineProps<{
  factionId: string;
  dataRevision: number;
  previewRevision: number;
  factions: Record<string, RowData>;
  factionVersions: Record<string, import('@/shared/types').FileVersion[]>;
  modRoot: string | null;
  sessionId: string | null;
  queryPreviewImages: (sessionId: string, factionId: string) => Promise<{ logoSrc: string; crestSrc: string }>;
  schemaRuntimeContext: SchemaRuntimeContext | null;
  saveFaction: (
    sessionId: string,
    modRoot: string,
    previousId: string,
    local: RowData,
    schema: FileSchema,
    baseVersions: import('@/shared/types').FileVersion[],
  ) => Promise<import('@/shared/types').ConfigSaveIdentity | null>;
  deleteFaction: (sessionId: string, modRoot: string, id: string, deleteFile: boolean) => Promise<boolean>;
}>();
const emit = defineEmits<{ saved: [factionId: string | null] }>();

const { getMergedSchema, loadCoreFields } = useCoreSchema();
loadCoreFields();

const schema = computed(() => getMergedSchema('faction'));
const feedback = useAppFeedback();
const { crestSrc, displayName, draftData, externalUpdateNotice, hasPendingExternalData, loadPendingExternalData, logoSrc, save, saving } =
  useConfigFactionEditorViewModel({
    dataRevision: toRef(props, 'dataRevision'),
    factionId: toRef(props, 'factionId'),
    factions: toRef(props, 'factions'),
    factionVersions: toRef(props, 'factionVersions'),
    modRoot: toRef(props, 'modRoot'),
    onSaved: (factionId) => emit('saved', factionId),
    previewRevision: toRef(props, 'previewRevision'),
    queryPreviewImages: props.queryPreviewImages,
    saveFaction: props.saveFaction,
    schema,
    sessionId: toRef(props, 'sessionId'),
  });

function confirmDeleteFaction() {
  const deleteModRoot = props.modRoot;
  const deleteSessionId = props.sessionId;
  const deleteId = props.factionId;
  if (!deleteModRoot || !deleteSessionId || !deleteId) return;
  feedback.confirmDanger({
    title: '删除势力',
    content: `确定要删除势力 "${deleteId}" 吗？`,
    actionText: '删除',
    onConfirm: async () => {
      await deleteFactionTarget(deleteSessionId, deleteModRoot, deleteId);
    },
  });
}

async function deleteFactionTarget(deleteSessionId: string, deleteModRoot: string, deleteId: string) {
  try {
    await props.deleteFaction(deleteSessionId, deleteModRoot, deleteId, true);
    if (props.modRoot === deleteModRoot && props.sessionId === deleteSessionId) emit('saved', null);
  } catch (error) {
    feedback.error(error, '删除势力失败');
    return false;
  }
  return true;
}

const saveCommand = useSaveCommandStore();
onMounted(() => saveCommand.registerActiveSaveHandler(save));
onUnmounted(() => saveCommand.unregisterActiveSaveHandler(save));
</script>
