import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openManagedWindow: vi.fn(async () => {}),
}));

vi.mock('@/windows/managed.window', () => ({
  openManagedWindow: mocks.openManagedWindow,
  MANAGED_WINDOW_QUERY_MAX_LENGTH: 12000,
  normalizeWindowKey: (value: string) => value,
  hashWindowKey: (value: string) => value,
}));

import { openEditorWindow } from './editor.window';
import type { EditorWindowRequest } from './editor.window';

interface ManagedWindowCall {
  labelPrefix: string;
  singletonKey: string;
  title: string;
  urlParams: Record<string, string | undefined>;
  size: { height: number; minHeight: number; minWidth: number; width: number };
}

function firstWindowCall(): ManagedWindowCall {
  const calls = mocks.openManagedWindow.mock.calls as unknown as Array<[ManagedWindowCall]>;
  return calls[0]![0];
}

const baseRequest: EditorWindowRequest = {
  kind: 'ship',
  sessionId: 's1',
  modRoot: 'C:/mods/alpha',
  id: 'XY',
  settings: {
    theme: 'dark',
    accent: 'blue',
    customAccent: '#3388cc',
    historyLimit: 20,
    editMode: 'smart',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  },
  starsectorRoot: 'D:/games/starsector',
};

describe('openEditorWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a singleton editor window keyed by kind, mod root and id', async () => {
    await openEditorWindow(baseRequest);
    expect(mocks.openManagedWindow).toHaveBeenCalledTimes(1);
    const request = firstWindowCall();
    expect(request.labelPrefix).toBe('editor-ship');
    expect(request.singletonKey).toBe(JSON.stringify(['ship', 'C:/mods/alpha', 'XY']));
    expect(request.title).toBe('舰船编辑器 - XY');
    expect(request.size).toMatchObject({ width: 1160, height: 760 });
    expect(request.urlParams).toMatchObject({
      window: 'editor',
      kind: 'ship',
      sessionId: 's1',
      modRoot: 'C:/mods/alpha',
      id: 'XY',
      starsectorRoot: 'D:/games/starsector',
    });
    expect(JSON.parse(request.urlParams.settings ?? 'null')).toEqual(baseRequest.settings);
    expect(request.urlParams.draftSnapshot).toBeUndefined();
  });

  it('passes the draft snapshot through the URL when small enough', async () => {
    await openEditorWindow({ ...baseRequest, kind: 'weapon', draftSnapshot: { id: 'railgun' } });
    const request = firstWindowCall();
    expect(JSON.parse(request.urlParams.draftSnapshot ?? 'null')).toEqual({ id: 'railgun' });
  });

  it('drops an oversized draft snapshot instead of failing to open', async () => {
    await openEditorWindow({ ...baseRequest, kind: 'weapon', draftSnapshot: { blob: 'x'.repeat(9000) } });
    const request = firstWindowCall();
    expect(request.urlParams.draftSnapshot).toBeUndefined();
  });

  it('honors a custom title', async () => {
    await openEditorWindow({ ...baseRequest, title: '自定义标题' });
    expect(firstWindowCall().title).toBe('自定义标题');
  });
});
