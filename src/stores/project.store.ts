import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ProjectManifest, ProjectSessionId } from '@/shared/types';
import { cell } from '@/shared/lib/starsector';
import { useWorkspaceStore } from '@/stores/workspace.store';

export const useProjectStore = defineStore('project', () => {
  const manifests = ref<Map<string, ProjectManifest>>(new Map());

  // Active mod identity is owned by the workspace store; project projects it
  // onto its manifests instead of keeping its own copy in sync.
  const activeModRoot = computed(() => useWorkspaceStore().activeModRoot);
  const activeManifest = computed<ProjectManifest | null>(() =>
    activeModRoot.value ? (manifests.value.get(activeModRoot.value) ?? null) : null,
  );
  const activeSessionId = computed<ProjectSessionId | null>(() => activeManifest.value?.sessionId ?? null);
  const projectName = computed(() => cell(activeManifest.value?.modInfo?.name) || 'Circinus ad Astra');

  function getManifest(modRoot: string): ProjectManifest | null {
    return manifests.value.get(modRoot) ?? null;
  }

  function getSessionId(modRoot: string): ProjectSessionId | null {
    return getManifest(modRoot)?.sessionId ?? null;
  }

  function removeProjectManifest(modRoot: string) {
    manifests.value.delete(modRoot);
  }

  function registerProjectManifest(manifest: ProjectManifest) {
    manifests.value.set(manifest.modRoot, manifest);
  }

  function replaceProjectManifest(manifest: ProjectManifest) {
    if (!manifests.value.has(manifest.modRoot)) return;
    manifests.value.set(manifest.modRoot, manifest);
  }

  return {
    activeManifest,
    activeModRoot,
    activeSessionId,
    manifests,
    projectName,
    getManifest,
    getSessionId,
    removeProjectManifest,
    registerProjectManifest,
    replaceProjectManifest,
  };
});
