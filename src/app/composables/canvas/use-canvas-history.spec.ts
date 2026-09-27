import { describe, expect, it } from 'vitest';
import type { RowData } from '@/shared/types';
import { useCanvasHistory } from './use-canvas-history';

const state = (marker: number): RowData => ({ marker });

describe('useCanvasHistory', () => {
  it('starts with empty stacks', () => {
    const history = useCanvasHistory();
    expect(history.canUndo.value).toBe(false);
    expect(history.canRedo.value).toBe(false);
    expect(history.undo(state(0))).toBeNull();
    expect(history.redo(state(0))).toBeNull();
  });

  it('undoes back through pushed snapshots', () => {
    const history = useCanvasHistory();
    history.push(state(0));
    history.push(state(1));
    expect(history.canUndo.value).toBe(true);
    expect(history.undo(state(2))).toEqual({ marker: 1 });
    expect(history.undo(state(1))).toEqual({ marker: 0 });
    expect(history.canUndo.value).toBe(false);
  });

  it('redoes undone snapshots with a fresh copy of the current state', () => {
    const history = useCanvasHistory();
    history.push(state(1));
    history.undo(state(0));
    expect(history.canRedo.value).toBe(true);
    expect(history.redo(state(9))).toEqual({ marker: 0 });
    expect(history.canRedo.value).toBe(false);
  });

  it('keeps the stack isolated from later draft mutations via deep clone', () => {
    const history = useCanvasHistory();
    const draft = { slots: [1] } as RowData & { slots: number[] };
    history.push(draft);
    draft.slots.push(2);
    expect(history.undo(draft)).toEqual({ slots: [1] });
  });

  it('clears the redo stack on a new push but not on redo', () => {
    const history = useCanvasHistory();
    history.push(state(1));
    history.undo(state(0));
    history.redo(state(0));
    expect(history.canRedo.value).toBe(false);

    history.push(state(2));
    history.undo(state(9));
    history.push(state(3));
    expect(history.canRedo.value).toBe(false);
    expect(history.undo(state(3))).toEqual({ marker: 3 });
  });

  it('trims to the configured limit', () => {
    const history = useCanvasHistory(2);
    history.push(state(1));
    history.push(state(2));
    history.push(state(3));
    expect(history.undo(state(9))).toEqual({ marker: 3 });
    expect(history.undo(state(3))).toEqual({ marker: 2 });
    expect(history.canUndo.value).toBe(false);
  });

  it('clears both stacks', () => {
    const history = useCanvasHistory();
    history.push(state(1));
    history.undo(state(0));
    history.clear();
    expect(history.canUndo.value).toBe(false);
    expect(history.canRedo.value).toBe(false);
  });
});
