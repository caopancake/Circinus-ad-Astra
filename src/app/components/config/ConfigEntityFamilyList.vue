<template>
  <aside class="config-entity-list config-family-list">
    <header class="config-entity-list-header">
      <h3>{{ family.displayName }}列表</h3>
    </header>
    <ul :ref="setMediaRoot" class="config-entity-list-items">
      <li v-if="sortedFiles.length === 0" class="config-entity-list-empty">{{ family.directoryHint }}</li>
      <li
        v-for="file in sortedFiles"
        :key="fileId(file)"
        :ref="mediaRef(fileId(file), props.spriteRefs[fileId(file)])"
        class="config-entity-list-item"
        :class="{ active: fileId(file) === selectedId }"
        @click="emit('select', fileId(file))"
      >
        <span class="config-entity-thumb">
          <img v-if="mediaSrc(props.spriteRefs[fileId(file)])" :src="mediaSrc(props.spriteRefs[fileId(file)])" alt="" />
          <svg v-else class="config-entity-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path v-for="path in family.listIconPaths" :key="path" :d="path" />
          </svg>
        </span>
        <span class="config-entity-text">
          <span class="config-entity-name">{{ fileTitle(file) }}</span>
          <small>{{ fileId(file) }}</small>
        </span>
        <n-button
          size="tiny"
          quaternary
          class="config-entity-delete compact-icon-button"
          :title="`删除${family.displayName}`"
          @click.stop="confirmDelete(file)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </n-button>
      </li>
    </ul>
    <footer class="config-entity-list-footer">
      <n-button size="small" block :loading="openingCreateDialog" @click="openCreateDialog">{{ family.createLabel }}</n-button>
    </footer>

    <n-modal
      v-model:show="showCreateDialog"
      preset="dialog"
      :title="family.createLabel"
      positive-text="创建"
      negative-text="取消"
      @positive-click="submitCreate"
    >
      <div class="variant-dialog-fields">
        <n-input v-if="settings.isPlainEditMode" v-model:value="newCompanionId" :placeholder="family.companionLabel" />
        <n-select v-else v-model:value="newCompanionId" :options="hullOptions" filterable tag :placeholder="family.companionLabel" />
        <n-input v-model:value="newId" :placeholder="family.idField" />
      </div>
    </n-modal>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import type { ResourceRef } from '@/shared/types';
import type { SelectOption } from '@/domain/schema/schema-options';
import type { ConfigEntityFamilyDefinition, ConfigFamilyFile } from '@/domain/config/config-entity-families';
import { compareFamilyFiles, familyFileId, familyFileTitle } from '@/domain/config/config-entity-families';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';

const props = defineProps<{
  family: ConfigEntityFamilyDefinition;
  selectedId: string | null;
  files: ConfigFamilyFile[];
  spriteRefs: Record<string, ResourceRef | null>;
  hullNames: Record<string, string>;
  hullOptions: SelectOption[];
  loadHullOptions: () => Promise<void>;
  modRoot: string | null;
  sessionId: string | null;
  listLoadStartedAt: number;
  createEntity: (sessionId: string, modRoot: string, companionId: string, id: string) => Promise<boolean>;
  deleteEntity: (sessionId: string, modRoot: string, id: string, relPath: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ select: [id: string | null] }>();

const settings = useSettingsStore();
const feedback = useAppFeedback();
const { mediaRef, mediaSrc, recordListFirstFrame, setMediaRoot } = useVisibleResourceMedia({
  sessionId: () => props.sessionId,
  surface: props.family.mediaSurface,
  failureLabel: `读取${props.family.displayName}缩略图失败`,
});

const showCreateDialog = ref(false);
const openingCreateDialog = ref(false);
const newCompanionId = ref('');
const newId = ref('');
const createModRoot = ref<string | null>(null);
const createSessionId = ref<string | null>(null);

function fileId(file: ConfigFamilyFile): string {
  return familyFileId(file);
}

function fileTitle(file: ConfigFamilyFile): string {
  return familyFileTitle(props.family, file, props.hullNames);
}

const sortedFiles = computed(() => [...props.files].sort((left, right) => compareFamilyFiles(props.family, left, right)));

async function openCreateDialog() {
  createModRoot.value = props.modRoot;
  createSessionId.value = props.sessionId;
  if (!createModRoot.value || !createSessionId.value) return;
  openingCreateDialog.value = true;
  try {
    await props.loadHullOptions();
    if (props.modRoot !== createModRoot.value || props.sessionId !== createSessionId.value) return;
    showCreateDialog.value = true;
  } finally {
    openingCreateDialog.value = false;
  }
}

async function submitCreate() {
  const targetModRoot = createModRoot.value;
  const targetSessionId = createSessionId.value;
  if (!targetModRoot || !targetSessionId) return false;
  const created = await props.createEntity(targetSessionId, targetModRoot, newCompanionId.value.trim(), newId.value.trim());
  if (!created) return false;
  const createdId = newId.value.trim();
  showCreateDialog.value = false;
  newCompanionId.value = '';
  newId.value = '';
  if (props.modRoot === targetModRoot && props.sessionId === targetSessionId) emit('select', createdId);
  return true;
}

function confirmDelete(file: ConfigFamilyFile) {
  const deleteModRoot = props.modRoot;
  const deleteSessionId = props.sessionId;
  if (!deleteModRoot || !deleteSessionId) return;
  const id = fileId(file);
  const relPath = String(file.relPath ?? '');
  feedback.confirmDanger({
    title: props.family.deleteConfirmTitle,
    content: `确定要删除${props.family.displayName} "${id}" 吗？`,
    actionText: '删除',
    onConfirm: async () => {
      await props.deleteEntity(deleteSessionId, deleteModRoot, id, relPath);
    },
  });
}

watch(
  () => props.files,
  (items) => void recordListFirstFrame(props.listLoadStartedAt, items.length),
);
</script>
