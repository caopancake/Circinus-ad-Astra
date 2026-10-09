<template>
  <div class="app-frame editor-window-app" :data-theme="settings.theme">
    <div v-if="loading" class="editor-window-status">
      <strong>正在加载</strong>
      <span>{{ target?.id ?? '缺少目标 id' }}</span>
    </div>
    <div v-else-if="errorText" class="editor-window-status editor-window-error">
      <strong>加载失败</strong>
      <span>{{ errorText }}</span>
    </div>
    <ShipEditor
      v-else-if="shipEditorData && target"
      :mod-root="target.modRoot"
      :session-id="target.sessionId"
      :hull-id="target.id"
      :ship="shipEditorData.ship"
      :sprite-data="shipSpriteForEditor"
      :edit-context="editContext"
      :dirty="draftDirty"
      :can-save="canSaveSpec"
      :saving="draftSaving"
      :external-update-notice="externalUpdateNotice"
      @close="closeWindow"
      @save-requested="saveEditorData('ship')"
      @draft-changed="updateEditorDraft('ship', $event)"
      @load-external="loadPendingExternalSpec"
    />
    <WeaponEditor
      v-else-if="weaponEditorData && target"
      :mod-root="target.modRoot"
      :session-id="target.sessionId"
      :weapon-id="target.id"
      :weapon="weaponForEditor"
      :sprite-data="weaponEditorData.weaponSpriteData"
      :projectile-options="weaponEditorData.projectileOptions"
      :edit-context="editContext"
      :dirty="draftDirty"
      :can-save="canSaveSpec"
      :saving="draftSaving"
      :external-update-notice="externalUpdateNotice"
      @close="closeWindow"
      @save-requested="saveEditorData('weapon')"
      @draft-changed="updateEditorDraft('weapon', $event)"
      @load-external="loadPendingExternalSpec"
      @edit-projectile="openProjectile"
      @preview="openPreview"
    />
    <ProjectileEditor
      v-else-if="projectileEditorData && target"
      :mod-root="target.modRoot"
      :session-id="target.sessionId"
      :projectile-id="target.id"
      :projectile="projectileEditorData.projectile"
      :edit-context="editContext"
      :dirty="draftDirty"
      :can-save="canSaveSpec"
      :saving="draftSaving"
      :external-update-notice="externalUpdateNotice"
      @close="closeWindow"
      @save-requested="saveEditorData('projectile')"
      @draft-changed="updateEditorDraft('projectile', $event)"
      @load-external="loadPendingExternalSpec"
    />
    <SystemEditor
      v-else-if="systemEditorData && target"
      :system-id="target.id"
      :system="systemEditorData.system"
      :edit-context="editContext"
      :dirty="draftDirty"
      :can-save="canSaveSpec"
      :saving="draftSaving"
      :external-update-notice="externalUpdateNotice"
      @close="closeWindow"
      @save-requested="saveEditorData('system')"
      @draft-changed="updateEditorDraft('system', $event)"
      @load-external="loadPendingExternalSpec"
    />
    <WeaponFirePreview
      v-else-if="weaponPreviewData && target"
      :weapon-id="target.id"
      :weapon-csv-row="weaponPreviewData.weaponCsvRow"
      :weapon-spec="weaponForEditor"
      :projectile-specs="weaponPreviewData.projectileSpecs"
      :sprite-data="weaponPreviewData.weaponSpriteData"
      @close="closeWindow"
    />
    <div v-else class="editor-window-status editor-window-error">
      <strong>无法打开编辑器</strong>
      <span>{{ missingEditorText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import ShipEditor from '@/app/components/editors/ShipEditor.vue';
import WeaponEditor from '@/app/components/editors/WeaponEditor.vue';
import ProjectileEditor from '@/app/components/editors/ProjectileEditor.vue';
import WeaponFirePreview from '@/app/components/editors/WeaponFirePreview.vue';
import SystemEditor from '@/app/components/editors/SystemEditor.vue';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { openProjectileEditorWindow, openWeaponPreviewWindow } from '@/windows/editor.window';
import { useSettingsStore } from '@/stores/settings.store';
import { closeCurrentWindow } from '@/windows/current.window';
import { useEditorWindowViewModel } from '@/app/composables/editors/use-editor-window-view-model';
import type { AppLogEntry, EditorSpecKind, EditorWindowKind, RowData } from '@/shared/types';
import { isEditorWindowKind } from '@/domain/editors/editor-definitions';
import { useAppLog } from '@/app/composables/use-app-log';
import { errorMessageOf } from '@/shared/lib/errors';

const params = new window.URLSearchParams(window.location.search);
const kind = ref<EditorWindowKind>(parseKind(params.get('kind')));
const sessionId = params.get('sessionId');
const modRoot = params.get('modRoot');
const id = params.get('id');
const starsectorRoot = params.get('starsectorRoot');
const appLog = useAppLog();
const draftSnapshot = ref<RowData | null>(parseDraftSnapshot(params.get('draftSnapshot'), appLog.record));
const settings = useSettingsStore();
const feedback = useAppFeedback();

const {
  currentTarget: target,
  shipEditorData,
  weaponEditorData,
  projectileEditorData,
  weaponPreviewData,
  systemEditorData,
  loading,
  errorText,
  weaponForEditor,
  draftValue,
  shipSpriteForEditor,
  draftDirty,
  editContext,
  draftSaving,
  canSaveSpec,
  externalUpdateNotice,
  missingEditorText,
  initializeEditorWindow,
  disposeEditorWindow,
  saveEditorData,
  updateEditorDraft,
  loadPendingExternalSpec,
} = useEditorWindowViewModel({ sessionId, modRoot, id, kind: kind.value, draftSnapshot: draftSnapshot.value });
const closeGuard = useDirtyWindowCloseGuard({
  content: '当前 spec 有未保存修改，关闭后这些修改将丢失。',
  dirty: draftDirty,
  title: '放弃未保存编辑？',
});

function parseKind(value: string | null): EditorWindowKind {
  return isEditorWindowKind(value) ? value : 'ship';
}

function parseDraftSnapshot(value: string | null, recordLog: (entry: AppLogEntry) => void): RowData | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as RowData) : null;
  } catch (error) {
    recordLog({
      level: 'warning',
      code: 'editor.draft_snapshot_invalid',
      message: errorMessageOf(error) ?? 'draft snapshot ignored: unparseable URL payload',
      path: null,
      line: null,
      fields: null,
    });
    return null;
  }
}

function closeWindow() {
  void closeCurrentWindow();
}

function openProjectile(projectileId: string) {
  if (!projectileId || !target.value) return;
  openProjectileEditorWindow({
    modRoot: target.value.modRoot,
    id: projectileId,
    sessionId: target.value.sessionId,
    settings: settings.settingsSnapshot(),
    starsectorRoot,
  }).catch((error) => feedback.error(error, '打开弹体编辑器失败'));
}

function openPreview(weaponId: string) {
  if (!weaponId || !target.value) return;
  openWeaponPreviewWindow({
    modRoot: target.value.modRoot,
    id: weaponId,
    sessionId: target.value.sessionId,
    settings: settings.settingsSnapshot(),
    starsectorRoot,
    draftSnapshot: kind.value === 'weapon' ? draftValue.value : undefined,
  }).catch((error) => feedback.error(error, '打开发射预览失败'));
}

function resolveEditableKind(): EditorSpecKind | null {
  if (kind.value === 'weapon-preview') return null;
  return kind.value as EditorSpecKind;
}

useShortcutDispatch({
  commands: {
    save: () => {
      const editableKind = resolveEditableKind();
      if (editableKind) void saveEditorData(editableKind);
    },
  },
});

onMounted(() => {
  void closeGuard.install();
  void initializeEditorWindow();
});

onUnmounted(() => {
  closeGuard.dispose();
  disposeEditorWindow();
});
</script>
