import { describe, expect, it } from 'vitest';
import { useTextHistory } from './use-text-history';

describe('useTextHistory', () => {
  it('starts with empty stacks', () => {
    const history = useTextHistory();
    expect(history.canUndo.value).toBe(false);
    expect(history.canRedo.value).toBe(false);
    expect(history.undo('current')).toBe('current');
    expect(history.redo('current')).toBe('current');
  });

  it('pushes previous text before each change and undoes through it', () => {
    const history = useTextHistory();
    history.pushChange('v0');
    history.pushChange('v1');
    expect(history.canUndo.value).toBe(true);
    expect(history.undo('v2')).toBe('v1');
    expect(history.undo('v1')).toBe('v0');
    expect(history.canUndo.value).toBe(false);
  });

  it('redoes by replaying the current text onto the redo stack', () => {
    const history = useTextHistory();
    history.pushChange('v0');
    expect(history.undo('v1')).toBe('v0');
    expect(history.canRedo.value).toBe(true);
    expect(history.redo('v0')).toBe('v1');
    expect(history.canRedo.value).toBe(false);
  });

  it('drops the redo stack when a new change follows an undo', () => {
    const history = useTextHistory();
    history.pushChange('v0');
    history.undo('v1');
    history.pushChange('v0');
    expect(history.canRedo.value).toBe(false);
  });

  it('clears both stacks', () => {
    const history = useTextHistory();
    history.pushChange('v0');
    history.undo('v1');
    history.clear();
    expect(history.canUndo.value).toBe(false);
    expect(history.canRedo.value).toBe(false);
  });
});
