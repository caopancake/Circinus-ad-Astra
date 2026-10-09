import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { ModOpeningFailure } from '@/shared/types';

beforeEach(() => setActivePinia(createPinia()));

describe('workspace Mod opening failures', () => {
  it('keeps the latest failure for each Mod root', () => {
    const workspace = useWorkspaceStore();
    workspace.setModOpeningFailure(failure('D:\\mods\\a', 'first'));
    workspace.setModOpeningFailure(failure('D:\\mods\\a', 'latest'));
    workspace.setModOpeningFailure(failure('D:\\mods\\b', 'other'));

    expect(workspace.modOpeningFailureList).toHaveLength(2);
    expect(workspace.modOpeningFailures.get('D:\\mods\\a')?.message).toBe('latest');
  });

  it('clears one failure or the entire runtime collection', () => {
    const workspace = useWorkspaceStore();
    workspace.setModOpeningFailure(failure('D:\\mods\\a', 'a'));
    workspace.setModOpeningFailure(failure('D:\\mods\\b', 'b'));

    workspace.clearModOpeningFailure('D:\\mods\\a');
    expect(workspace.modOpeningFailureList.map((item) => item.modRoot)).toEqual(['D:\\mods\\b']);

    workspace.clearModOpeningFailures();
    expect(workspace.hasModOpeningFailures).toBe(false);
  });

  it('keeps failures out of the persisted workspace projection', () => {
    const workspace = useWorkspaceStore();
    workspace.setModOpeningFailure(failure('D:\\mods\\a', 'a'));

    expect(workspace.toPersistedState()).toEqual({
      mods: [],
      starsectorRoot: null,
      gameMods: [],
      gameWarnings: [],
      columnWidths: {},
    });
  });
});

function failure(modRoot: string, message: string): ModOpeningFailure {
  return { modRoot, message, file: null, diagnostic: { code: 'unknown', message, location: null } };
}
