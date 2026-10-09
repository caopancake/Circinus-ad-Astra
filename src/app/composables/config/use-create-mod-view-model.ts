import { computed, reactive, ref } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { createModProject, openCreatedModProject } from '@/orchestrators/mod-creation.orchestrator';
import { pickDirectoryDialog } from '@/shared/runtime/dialog.runtime';
import { createDefaultNewModTemplate, validateNewModTemplate } from '@/domain/mod-creation/new-mod-template';
import type { NewModDestination, NewModTemplate } from '@/shared/types';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { warningNotice } from '@/shared/lib/errors';

export function useCreateModViewModel() {
  const workspace = useWorkspaceStore();
  const feedback = useAppFeedback();
  const visible = ref(false);
  const saving = ref(false);
  const destination = ref<NewModDestination | null>(null);
  const template = reactive<NewModTemplate>(createDefaultNewModTemplate());
  const destinationText = computed(() => {
    if (!destination.value) return '';
    if (destination.value.kind === 'game-mods') return `${destination.value.starsectorRoot}\\mods`;
    return destination.value.parentDirectory;
  });

  async function beginCreateMod() {
    if (saving.value) return;
    const gameRoot = workspace.gameOverview?.starsectorRoot ?? null;
    if (gameRoot) {
      destination.value = { kind: 'game-mods', starsectorRoot: gameRoot };
    } else {
      const parentDirectory = await pickDirectoryDialog('选择新 Mod 的父目录');
      if (!parentDirectory) return;
      destination.value = { kind: 'directory', parentDirectory };
    }
    Object.assign(template, createDefaultNewModTemplate());
    visible.value = true;
  }

  async function submitCreateMod(): Promise<boolean> {
    const target = destination.value;
    if (!target) {
      feedback.error('未确定新 Mod 的保存位置');
      return false;
    }
    const validationError = validateNewModTemplate(template);
    if (validationError) {
      feedback.warning(warningNotice(validationError, 'mod_creation.template_invalid', `New Mod template invalid: ${validationError}`));
      return false;
    }
    saving.value = true;
    try {
      const created = await createModProject({
        destination: target,
        template: { ...template },
      });
      visible.value = false;
      feedback.info('Mod 已创建，正在打开');
      void settleCreatedModOpening(created);
      return true;
    } catch (error) {
      feedback.error(error, '创建 Mod 失败');
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function settleCreatedModOpening(created: Awaited<ReturnType<typeof createModProject>>) {
    try {
      const opened = await openCreatedModProject(created);
      if (!opened) return;
      feedback.success(`Mod 已创建并打开：${opened.modName}`);
      for (const warning of opened.warnings) feedback.warning(warning);
    } catch (error) {
      feedback.error(error, 'Mod 已创建，但打开失败');
    }
  }

  return {
    beginCreateMod,
    destinationText,
    saving,
    submitCreateMod,
    template,
    visible,
  };
}
