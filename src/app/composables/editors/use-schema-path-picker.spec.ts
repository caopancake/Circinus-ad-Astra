import { describe, expect, it, vi } from 'vitest';
import { useSchemaPathPicker } from './use-schema-path-picker';

const mocks = vi.hoisted(() => ({ pick: vi.fn(), warning: vi.fn() }));
vi.mock('@/shared/runtime/dialog.runtime', () => ({ pickImageFileDialog: mocks.pick, pickFileDialog: mocks.pick }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ warning: mocks.warning }) }));

describe('schema path bases', () => {
  it('stores the task-relative icon path and rejects files outside the task', async () => {
    const setPath = vi.fn();
    const picker = useSchemaPathPicker({
      runtimeContext: () => ({ sessionId: 's1', modRoot: 'M:/mod', missionId: 'demo' }),
      pathBase: () => 'mission',
      setPath,
    });
    mocks.pick.mockResolvedValueOnce('M:/mod/data/missions/demo/icon.png');
    await picker.pickPathFile({ imageFilter: true });
    expect(setPath).toHaveBeenCalledWith('icon.png');
    expect('data/missions/demo/' + setPath.mock.calls[0]![0]).toBe('data/missions/demo/icon.png');
    setPath.mockClear();
    mocks.warning.mockClear();
    mocks.pick.mockResolvedValueOnce('M:/mod/graphics/icon.png');
    await picker.pickPathFile({ imageFilter: true });
    expect(setPath).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });
});
