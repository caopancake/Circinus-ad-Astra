import { describe, expect, it } from 'vitest';
import { computed, reactive } from 'vue';
import {
  canRedoEntry,
  canUndoEntry,
  clearUndoStack,
  createEditSessionValue,
  createUndoStackState,
  nextUndoStackId,
  peekRedoEntry,
  peekUndoEntry,
  popRedoEntry,
  popUndoEntry,
  pushRedoEntry,
  pushUndoEntry,
  setUndoStackLimit,
} from './edit-session';

const identity = <T>(value: T): T => value;
const strictEquals = <T>(left: T, right: T): boolean => left === right;

describe('createEditSessionValue', () => {
  function createNumberSession(initial = 1) {
    return createEditSessionValue(initial, { clone: identity, equals: strictEquals });
  }

  it('starts clean with baseline equal to draft', () => {
    const session = createNumberSession(1);
    expect(session.baseline).toBe(1);
    expect(session.draft).toBe(1);
    expect(session.dirty).toBe(false);
    expect(session.revision).toBe(0);
    expect(session.hasPendingExternal).toBe(false);
    expect(session.pendingExternal).toBeNull();
  });

  it('derives dirty from baseline and draft', () => {
    const session = createNumberSession(1);
    session.setDraft(2);
    expect(session.dirty).toBe(true);
    session.setDraft(1);
    expect(session.dirty).toBe(false);
  });

  it('resetDraft restores the baseline', () => {
    const session = createNumberSession(1);
    session.setDraft(2);
    session.resetDraft();
    expect(session.draft).toBe(1);
    expect(session.dirty).toBe(false);
  });

  it('commitSaved promotes the draft to baseline by default', () => {
    const session = createNumberSession(1);
    session.setDraft(2);
    session.commitSaved();
    expect(session.baseline).toBe(2);
    expect(session.draft).toBe(2);
    expect(session.dirty).toBe(false);
  });

  it('commitSaved accepts an explicit saved value', () => {
    const session = createNumberSession(1);
    session.setDraft(2);
    session.commitSaved(5);
    expect(session.baseline).toBe(5);
    expect(session.draft).toBe(5);
  });

  it('commits the persisted baseline while preserving subsequent edits', () => {
    const session = createNumberSession(1);
    session.setDraft(3);
    session.commitSavedBaseline(2);
    expect(session.baseline).toBe(2);
    expect(session.draft).toBe(3);
    expect(session.dirty).toBe(true);
    expect(session.pendingExternal).toBe(2);
    session.setDraft(1);
    expect(session.dirty).toBe(true);
    session.resetDraft();
    expect(session.draft).toBe(2);
    expect(session.dirty).toBe(false);
  });

  it('loadBaseline replaces baseline and draft and bumps revision only when the draft changed', () => {
    const session = createNumberSession(1);
    session.loadBaseline(3);
    expect(session.baseline).toBe(3);
    expect(session.draft).toBe(3);
    expect(session.revision).toBe(1);
    session.loadBaseline(3);
    expect(session.revision).toBe(1);
  });

  it('applyExternal adopts the value when clean and parks it when dirty', () => {
    const session = createNumberSession(1);
    session.applyExternal(4);
    expect(session.baseline).toBe(4);
    expect(session.draft).toBe(4);
    expect(session.revision).toBe(1);

    session.setDraft(5);
    session.applyExternal(7);
    expect(session.baseline).toBe(4);
    expect(session.draft).toBe(5);
    expect(session.pendingExternal).toBe(7);
    expect(session.hasPendingExternal).toBe(true);
  });

  it('loadPendingExternal adopts the parked external value', () => {
    const session = createNumberSession(1);
    session.setDraft(5);
    session.applyExternal(7);
    session.loadPendingExternal();
    expect(session.baseline).toBe(7);
    expect(session.draft).toBe(7);
    expect(session.pendingExternal).toBeNull();
  });

  it('commitSaved clears a pending external value', () => {
    const session = createNumberSession(1);
    session.setDraft(5);
    session.applyExternal(7);
    session.commitSaved(6);
    expect(session.pendingExternal).toBeNull();
  });

  it('clear behaves like loadBaseline', () => {
    const session = createNumberSession(1);
    session.setDraft(2);
    session.clear(9);
    expect(session.baseline).toBe(9);
    expect(session.draft).toBe(9);
  });

  it('uses the injected clone and equals', () => {
    const seen: string[] = [];
    const session = createEditSessionValue('a', {
      clone: (value) => {
        seen.push(`clone:${value}`);
        return value;
      },
      equals: (left, right) => left.trim() === right.trim(),
    });
    session.setDraft('a  ');
    expect(session.dirty).toBe(false);
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('createUndoStackState', () => {
  it('push clears the redo stack', () => {
    const stack = createUndoStackState<number>();
    pushUndoEntry(stack, 1);
    pushUndoEntry(stack, 2);
    popUndoEntry(stack);
    pushUndoEntry(stack, 3);
    expect(canRedoEntry(stack)).toBe(false);
    expect(stack.undoStack).toEqual([1, 3]);
  });

  it('moves entries between the undo and redo stacks', () => {
    const stack = createUndoStackState<number>();
    pushUndoEntry(stack, 1);
    pushUndoEntry(stack, 2);
    expect(canUndoEntry(stack)).toBe(true);
    expect(peekUndoEntry(stack)).toBe(2);
    const undoEntry = popUndoEntry(stack);
    expect(undoEntry).toBe(2);
    pushRedoEntry(stack, undoEntry!);
    expect(canRedoEntry(stack)).toBe(true);
    expect(peekRedoEntry(stack)).toBe(2);
    const redoEntry = popRedoEntry(stack);
    expect(redoEntry).toBe(2);
    pushUndoEntry(stack, redoEntry!, { clearRedo: false });
    expect(stack.undoStack).toEqual([1, 2]);
  });

  it('trims the undo stack to the limit', () => {
    const stack = createUndoStackState<number>(2);
    pushUndoEntry(stack, 1);
    pushUndoEntry(stack, 2);
    pushUndoEntry(stack, 3);
    expect(stack.undoStack).toEqual([2, 3]);
    setUndoStackLimit(stack, 1);
    expect(stack.undoStack).toEqual([3]);
    expect(stack.limit).toBe(1);
  });

  it('generates prefixed unique ids via nextUndoStackId', () => {
    const stack = createUndoStackState<number>();
    const first = nextUndoStackId(stack, 'hist');
    const second = nextUndoStackId(stack, 'hist');
    expect(first.startsWith('hist_')).toBe(true);
    expect(second.startsWith('hist_')).toBe(true);
    expect(first).not.toBe(second);
  });

  it('clear empties both stacks', () => {
    const stack = createUndoStackState<number>();
    pushUndoEntry(stack, 1);
    pushRedoEntry(stack, 9);
    clearUndoStack(stack);
    expect(canUndoEntry(stack)).toBe(false);
    expect(canRedoEntry(stack)).toBe(false);
  });

  it('stays reactive when the state is wrapped by Vue reactive', () => {
    const stack = reactive(createUndoStackState<number>());
    const count = computed(() => stack.undoStack.length);
    expect(count.value).toBe(0);
    pushUndoEntry(stack, 1);
    expect(count.value).toBe(1);
    popUndoEntry(stack);
    expect(count.value).toBe(0);
  });
});
