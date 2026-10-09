import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorWindowInput } from './use-editor-window-input';
const log = vi.hoisted(() => vi.fn());
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: log }));
beforeEach(() => vi.clearAllMocks());
describe('editor window initialization input', () => {
  it('consumes a preview object as its initialization draft', () => {
    expect(useEditorWindowInput(new URLSearchParams({ kind: 'weapon-preview', draftSnapshot: '{"id":"demo"}' }))).toEqual({
      kind: 'weapon-preview',
      draftSnapshot: { id: 'demo' },
    });
  });
  it('reports malformed initialization JSON once through the log owner', () => {
    expect(useEditorWindowInput(new URLSearchParams({ kind: 'ship', draftSnapshot: '{' })).draftSnapshot).toBeNull();
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'editor.draft_snapshot_invalid', level: 'warning' }));
  });
});
