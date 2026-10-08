import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const completeSavedWrite = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/orchestrators/file-history-write.orchestrator', () => ({ completeSavedWrite }));

import type { EditorSpecSavedEvent, FileEditorSavedEvent } from '@/windows/window.events';
import { handleEditorSpecSaved, handleFileEditorSaved } from '@/orchestrators/file-save.orchestrator';
import type { WriteResult } from '@/shared/types';

const MOD_ROOT = 'M:\\test-mod';

function resultWithChanges(count: number): WriteResult {
  return {
    baseVersions: [],
    commitId: 1,
    history: { revision: 1, undoStack: [], redoStack: [] },
    changes: Array.from({ length: count }, (_, index) => ({
      path: `${MOD_ROOT}\\file${index}.csv`,
      kind: 'file' as const,
      beforeExists: true,
      beforeText: '',
      beforeDataBase64: null,
      beforeFiles: [],
      afterExists: true,
      afterText: '',
      afterDataBase64: null,
      afterFiles: [],
    })),
    invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    keyMap: [],
    refreshedEntity: null,
  };
}

function editorEvent(changes: number): EditorSpecSavedEvent {
  return {
    kind: 'ship',
    sessionId: 'sess-1',
    modRoot: MOD_ROOT,
    id: 'npc_dave',
    spec: {},
    writeResult: resultWithChanges(changes),
  };
}

beforeEach(() => setActivePinia(createPinia()));

describe('file-save orchestrator', () => {
  it('ignores editor spec saves without file changes', async () => {
    expect(await handleEditorSpecSaved(editorEvent(0))).toBe(false);
    expect(completeSavedWrite).not.toHaveBeenCalled();
  });

  it('records editor spec saves with the spec id as label', async () => {
    expect(await handleEditorSpecSaved(editorEvent(2))).toBe(true);
    expect(completeSavedWrite).toHaveBeenCalledWith(
      { modRoot: MOD_ROOT, sessionId: 'sess-1', label: '保存 npc_dave spec', result: expect.anything() },
      expect.anything(),
    );
  });

  it('ignores file editor saves without file changes', async () => {
    const event: FileEditorSavedEvent = {
      sessionId: 'sess-1',
      modRoot: MOD_ROOT,
      path: `${MOD_ROOT}\\data\\missions\\demo.txt`,
      writeResult: resultWithChanges(0),
    };
    expect(await handleFileEditorSaved(event)).toBe(false);
    expect(completeSavedWrite).not.toHaveBeenCalled();
  });

  it('records file editor saves with the file name as label', async () => {
    const event: FileEditorSavedEvent = {
      sessionId: 'sess-1',
      modRoot: MOD_ROOT,
      path: `${MOD_ROOT}\\data\\missions\\demo.txt`,
      writeResult: resultWithChanges(1),
    };
    expect(await handleFileEditorSaved(event)).toBe(true);
    expect(completeSavedWrite).toHaveBeenCalledWith(
      { modRoot: MOD_ROOT, sessionId: 'sess-1', label: '保存 demo.txt', result: expect.anything() },
      expect.anything(),
    );
  });
});
