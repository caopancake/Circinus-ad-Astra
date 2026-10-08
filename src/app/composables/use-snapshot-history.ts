import { computed, shallowReactive, watch, type Ref } from 'vue';
import {
  canRedoEntry,
  canUndoEntry,
  clearUndoStack,
  createUndoStackState,
  popRedoEntry,
  popUndoEntry,
  pushRedoEntry,
  pushUndoEntry,
} from '@/domain/edit-session';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import type { EditContext } from '@/shared/types';

export function useSnapshotHistory<T>(
  context: Readonly<Ref<EditContext | null>>,
  limit: number,
  clone = deepClone<T>,
  equals = stableDeepEqual,
) {
  const stack = shallowReactive(createUndoStackState<{ before: T; after: T }>(limit));
  stack.undoStack = shallowReactive(stack.undoStack);
  stack.redoStack = shallowReactive(stack.redoStack);
  const canUndo = computed(() => canUndoEntry(stack));
  const canRedo = computed(() => canRedoEntry(stack));
  const clear = () => clearUndoStack(stack);
  watch(
    context,
    (next) => {
      if (!next || next.handoff !== 'save') clear();
    },
    { flush: 'sync' },
  );
  function push(before: T, after: T) {
    if (!equals(before, after)) pushUndoEntry(stack, { before: clone(before), after: clone(after) });
  }
  function undo(): T | null {
    if (!canUndo.value) return null;
    const entry = popUndoEntry(stack)!;
    pushRedoEntry(stack, entry);
    return clone(entry.before);
  }
  function redo(): T | null {
    if (!canRedo.value) return null;
    const entry = popRedoEntry(stack)!;
    pushUndoEntry(stack, entry, { clearRedo: false });
    return clone(entry.after);
  }
  return { canUndo, canRedo, push, undo, redo, clear };
}
