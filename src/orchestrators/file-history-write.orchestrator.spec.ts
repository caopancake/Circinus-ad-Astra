import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WriteResult } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  refreshProjectSessionAfterWrite: vi.fn(async () => {}),
}));

vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({
  refreshProjectSessionAfterWrite: mocks.refreshProjectSessionAfterWrite,
  applyCommittedWriteCacheInvalid: vi.fn(),
}));

import { completeSavedWrite } from './file-history-write.orchestrator';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';

function writeResultFixture(changeCount = 1): WriteResult {
  return {
    baseVersions: [],
    commitId: 1,
    history: {
      revision: 1,
      undoStack: [
        { id: 1, timestamp: 1, label: 'save XY', paths: Array.from({ length: changeCount }, (_, index) => `data/hulls/file${index}.ship`) },
      ],
      redoStack: [],
    },
    changes: Array.from({ length: changeCount }, (_, index) => changeRecord(`data/hulls/file${index}.ship`)),
    invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    keyMap: [],
    refreshedEntity: null,
  };
}

function changeRecord(path: string) {
  return {
    kind: 'file' as const,
    path,
    beforeExists: true,
    beforeText: 'before',
    beforeDataBase64: null,
    beforeFiles: [],
    afterExists: true,
    afterText: 'after',
    afterDataBase64: null,
    afterFiles: [],
  };
}

function projectWithSession(modRoot: string, sessionId: string) {
  const project = useProjectStore();
  project.registerProjectManifest({
    baseVersions: [],
    sessionId,
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: null,
    tableSummaries: {} as never,
    tableEntitySummaries: {} as never,
    entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
    warnings: [],
  });
  return project;
}

describe('completeSavedWrite', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('records the write into file history and refreshes the session', async () => {
    const project = projectWithSession('C:/mods/alpha', 's1');
    const fileHistory = useFileHistoryStore();
    const result = writeResultFixture(2);
    await completeSavedWrite({ label: 'save XY', modRoot: 'C:/mods/alpha', result, sessionId: 's1' }, project);
    const stacks = fileHistory.getHistoryStacks('C:/mods/alpha');
    expect(stacks.undoStack).toHaveLength(1);
    expect(stacks.undoStack).toEqual(result.history.undoStack);
    expect(mocks.refreshProjectSessionAfterWrite).toHaveBeenCalledWith('C:/mods/alpha', result, 's1');
  });

  it('rejects completions without a mod root or session', async () => {
    const project = projectWithSession('C:/mods/alpha', 's1');
    await expect(
      completeSavedWrite({ label: 'x', modRoot: '', result: writeResultFixture(), sessionId: 's1' }, project),
    ).rejects.toMatchObject({ action: 'complete-saved-write' });
    await expect(
      completeSavedWrite({ label: 'x', modRoot: 'C:/mods/alpha', result: writeResultFixture(), sessionId: '' }, project),
    ).rejects.toMatchObject({ action: 'complete-saved-write' });
    expect(useFileHistoryStore().getHistoryStacks('C:/mods/alpha').undoStack).toHaveLength(0);
  });

  it('rejects write results without file changes', async () => {
    const project = projectWithSession('C:/mods/alpha', 's1');
    await expect(
      completeSavedWrite({ label: 'x', modRoot: 'C:/mods/alpha', result: writeResultFixture(0), sessionId: 's1' }, project),
    ).rejects.toMatchObject({ action: 'complete-saved-write' });
    expect(mocks.refreshProjectSessionAfterWrite).not.toHaveBeenCalled();
  });

  it('rejects completions whose session is no longer current', async () => {
    const project = projectWithSession('C:/mods/alpha', 's2');
    await expect(
      completeSavedWrite({ label: 'x', modRoot: 'C:/mods/alpha', result: writeResultFixture(), sessionId: 's1' }, project),
    ).rejects.toMatchObject({ action: 'complete-saved-write' });
    expect(mocks.refreshProjectSessionAfterWrite).not.toHaveBeenCalled();
  });

  it('rejects completions for an unloaded mod', async () => {
    setActivePinia(createPinia());
    const project = useProjectStore();
    await expect(
      completeSavedWrite({ label: 'x', modRoot: 'C:/mods/ghost', result: writeResultFixture(), sessionId: 's1' }, project),
    ).rejects.toMatchObject({ action: 'complete-saved-write' });
  });
});
