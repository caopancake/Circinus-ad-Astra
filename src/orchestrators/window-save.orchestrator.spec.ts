import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => {
  const unlisteners: Array<() => void> = [];
  return {
    unlisteners,
    listeners: new Map<string, (event: unknown) => Promise<void> | void>(),
    handleEditorSpecSaved: vi.fn(async () => true),
    handleFileEditorSaved: vi.fn(async () => undefined),
  };
});

vi.mock('@/orchestrators/file-save.orchestrator', () => ({
  handleEditorSpecSaved: mocks.handleEditorSpecSaved,
  handleFileEditorSaved: mocks.handleFileEditorSaved,
}));
vi.mock('@/windows/tauri.events', () => ({
  listenWindowEvent: async (eventName: string, handler: (event: unknown) => Promise<void> | void) => {
    mocks.listeners.set(eventName, handler);
    const unlisten = () => mocks.listeners.delete(eventName);
    mocks.unlisteners.push(unlisten);
    return unlisten;
  },
  emitWindowEvent: vi.fn(),
}));

import { WINDOW_EVENTS } from '@/windows/window.events';
import { listenWindowSaveEvents } from '@/orchestrators/window-save.orchestrator';

beforeEach(() => {
  setActivePinia(createPinia());
  mocks.unlisteners.length = 0;
  mocks.listeners.clear();
  mocks.handleEditorSpecSaved.mockClear();
  mocks.handleFileEditorSaved.mockClear();
});

describe('window-save orchestrator', () => {
  it('registers handlers for both save events and forwards editor saves to the callback', async () => {
    const onEditorSpecSaved = vi.fn();
    await listenWindowSaveEvents({ onEditorSpecSaved });

    expect(mocks.listeners.get(WINDOW_EVENTS.editorSpecSaved)).toBeTypeOf('function');
    expect(mocks.listeners.get(WINDOW_EVENTS.fileEditorSaved)).toBeTypeOf('function');

    const event = {
      kind: 'ship',
      sessionId: 'sess-1',
      modRoot: 'M:\\mod',
      id: 'npc_dave',
      spec: {},
      writeResult: {
        baseVersions: [],
        commitId: 1,
        history: { revision: 1, undoStack: [], redoStack: [] },
        changes: [{ path: 'x', kind: 'csv', beforeBase64: null, afterBase64: null, beforeText: '', afterText: '' }],
        invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
        keyMap: [],
        refreshedEntity: null,
        warnings: [],
      },
    };
    await mocks.listeners.get(WINDOW_EVENTS.editorSpecSaved)?.(event);

    expect(mocks.handleEditorSpecSaved).toHaveBeenCalledWith(event);
    expect(onEditorSpecSaved).toHaveBeenCalledWith(event);
  });

  it('does not invoke the callback when the editor save was filtered out', async () => {
    mocks.handleEditorSpecSaved.mockResolvedValue(false);
    const onEditorSpecSaved = vi.fn();
    await listenWindowSaveEvents({ onEditorSpecSaved });

    await mocks.listeners.get(WINDOW_EVENTS.editorSpecSaved)?.({
      kind: 'ship',
      sessionId: '',
      modRoot: '',
      id: '',
      spec: {},
      writeResult: {
        baseVersions: [],
        commitId: 1,
        history: { revision: 1, undoStack: [], redoStack: [] },
        changes: [],
        invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
        keyMap: [],
        refreshedEntity: null,
        warnings: [],
      },
    });

    expect(onEditorSpecSaved).not.toHaveBeenCalled();
  });

  it('delegates file editor saves and releases every listener on dispose', async () => {
    const dispose = await listenWindowSaveEvents();
    expect(mocks.unlisteners.length).toBe(2);

    await mocks.listeners.get(WINDOW_EVENTS.fileEditorSaved)?.({
      sessionId: 'sess-1',
      modRoot: 'M:\\mod',
      path: 'x.txt',
      writeResult: {
        baseVersions: [],
        commitId: 1,
        history: { revision: 1, undoStack: [], redoStack: [] },
        changes: [],
        invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
        keyMap: [],
        refreshedEntity: null,
        warnings: [],
      },
    });
    expect(mocks.handleFileEditorSaved).toHaveBeenCalledTimes(1);

    dispose();
    expect(mocks.listeners.size).toBe(0);
  });
});
