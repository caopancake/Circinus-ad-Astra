<template>
  <aside class="faction-list config-entity-list">
    <header class="faction-list-header config-entity-list-header">
      <h3>势力列表</h3>
    </header>

    <ul :ref="setMediaRoot" class="faction-list-items config-entity-list-items">
      <li
        v-for="faction in factions"
        :key="faction.id"
        :ref="mediaRef(faction.id, props.factionCrestRefs[faction.id])"
        class="faction-list-item config-entity-list-item"
        :class="{ active: faction.id === selectedId }"
        @click="selectFaction(faction.id)"
      >
        <span class="faction-list-preview config-entity-thumb">
          <img v-if="factionCrest(faction.id)" :src="factionCrest(faction.id)" alt="" />
          <span v-else class="color-swatch" :style="{ backgroundColor: faction.colorCss }" />
        </span>
        <span class="faction-name config-entity-name">{{ faction.displayName || faction.id }}</span>
        <n-button
          size="tiny"
          quaternary
          class="faction-delete-btn config-entity-delete compact-icon-button"
          title="删除势力"
          @click.stop="confirmDelete(faction.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </n-button>
      </li>
    </ul>

    <footer class="faction-list-footer config-entity-list-footer">
      <n-button size="small" block :loading="actionRunning" @click="openCreateDialog">新建势力</n-button>
    </footer>

    <!-- Create dialog -->
    <n-modal
      v-model:show="showCreateDialog"
      preset="dialog"
      title="新建势力"
      positive-text="创建"
      negative-text="取消"
      :positive-button-props="{ loading: actionRunning, disabled: actionRunning }"
      @positive-click="doCreate"
    >
      <n-input v-model:value="newFactionId" placeholder="输入势力 ID（英文标识）" autofocus />
    </n-modal>
  </aside>
</template>

<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { NCheckbox } from 'naive-ui/es/checkbox';
import type { ResourceRef, RowData } from '@/shared/types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { configFactionListItems } from '@/domain/config/config-entities';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';

const props = defineProps<{
  selectedId: string | null;
  actionRunning: boolean;
  factions: Record<string, RowData>;
  factionCrestRefs: Record<string, ResourceRef | null>;
  modRoot: string | null;
  sessionId: string | null;
  listLoadStartedAt: number;
  createFaction: (sessionId: string, modRoot: string, id: string) => Promise<boolean>;
  deleteFaction: (sessionId: string, modRoot: string, id: string, deleteFile: boolean) => Promise<boolean>;
}>();
const emit = defineEmits<{ select: [factionId: string | null] }>();

const feedback = useAppFeedback();
const { mediaRef, mediaSrc, recordListFirstFrame, setMediaRoot } = useVisibleResourceMedia({
  sessionId: () => props.sessionId,
  surface: 'config-faction-list',
  failureLabel: '读取势力徽标失败',
});

const showCreateDialog = ref(false);
const newFactionId = ref('');
const createModRoot = ref<string | null>(null);
const createSessionId = ref<string | null>(null);

const factions = computed(() => configFactionListItems(props.factions));
watch(factions, (items) => void recordListFirstFrame(props.listLoadStartedAt, items.length));

function factionCrest(id: string): string {
  return mediaSrc(props.factionCrestRefs[id]);
}

function selectFaction(id: string) {
  emit('select', id);
}

function openCreateDialog() {
  createModRoot.value = props.modRoot;
  createSessionId.value = props.sessionId;
  if (!createModRoot.value || !createSessionId.value) return;
  newFactionId.value = '';
  showCreateDialog.value = true;
}

async function doCreate() {
  const targetModRoot = createModRoot.value;
  const targetSessionId = createSessionId.value;
  if (!targetModRoot || !targetSessionId) return false;
  const trimmedId = newFactionId.value.trim();
  if (!(await props.createFaction(targetSessionId, targetModRoot, trimmedId))) return false;
  showCreateDialog.value = false;
  return true;
}

function confirmDelete(id: string) {
  const deleteModRoot = props.modRoot;
  const deleteSessionId = props.sessionId;
  if (!deleteModRoot || !deleteSessionId) return;
  let deleteFactionDataFile = false;
  feedback.confirmDanger({
    title: '删除势力',
    content: () =>
      h('div', { class: 'associated-save-dialog' }, [
        h('p', `确定要从 factions.csv 中删除 "${id}" 吗？`),
        h(
          NCheckbox,
          {
            checked: deleteFactionDataFile,
            'onUpdate:checked': (checked: boolean) => {
              deleteFactionDataFile = checked;
            },
          },
          { default: () => '同时删除势力文件' },
        ),
      ]),
    actionText: '删除',
    onConfirm: async () => {
      await doDelete(deleteSessionId, deleteModRoot, id, deleteFactionDataFile);
    },
  });
}

async function doDelete(deleteSessionId: string, deleteModRoot: string, id: string, deleteFile: boolean) {
  try {
    if (!(await props.deleteFaction(deleteSessionId, deleteModRoot, id, deleteFile))) return;
  } catch (error) {
    feedback.error(error, '删除势力失败');
  }
}
</script>
