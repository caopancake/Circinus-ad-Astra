import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

/**
 * Unified edit-session primitive (framework-agnostic; can be wrapped with `reactive()`
 * at the boundary for reactivity). These owners are the only sanctioned implementations
 * of the baseline-draft-dirty-pending-external state machine and the undo/redo stacks;
 * each editing mechanism (config drafts, text undo, CSV undo, file history) specializes
 * or wraps them.
 */

export interface EditSessionValueOptions<T> {
  clone?: (value: T) => T;
  equals?: (left: T, right: T) => boolean;
}

export interface EditSessionValue<T> {
  readonly baseline: T;
  readonly draft: T;
  readonly pendingExternal: T | null;
  readonly revision: number;
  readonly dirty: boolean;
  readonly hasPendingExternal: boolean;
  loadBaseline(value: T): void;
  setDraft(value: T): void;
  applyExternal(value: T, preserveDraft?: boolean): void;
  loadPendingExternal(): void;
  commitSaved(value?: T): void;
  commitSavedBaseline(value: T, preservePendingExternal?: boolean): void;
  resetDraft(): void;
  clear(value: T): void;
}

export function createEditSessionValue<T>(initialValue: T, options: EditSessionValueOptions<T> = {}): EditSessionValue<T> {
  const clone = options.clone ?? deepClone;
  const equals = options.equals ?? stableDeepEqual;
  const state = {
    baseline: clone(initialValue),
    draft: clone(initialValue),
    pendingExternal: null as T | null,
    revision: 0,
  };

  function loadBaseline(value: T): void {
    const next = clone(value);
    const draftChanged = !equals(state.draft, next);
    state.baseline = next;
    state.draft = clone(next);
    state.pendingExternal = null;
    if (draftChanged) state.revision += 1;
  }

  return {
    get baseline() {
      return state.baseline;
    },
    get draft() {
      return state.draft;
    },
    get pendingExternal() {
      return state.pendingExternal;
    },
    get revision() {
      return state.revision;
    },
    get dirty() {
      return !equals(state.baseline, state.draft);
    },
    get hasPendingExternal() {
      return state.pendingExternal !== null;
    },
    loadBaseline,
    setDraft(value) {
      state.draft = clone(value);
    },
    applyExternal(value, preserveDraft = false) {
      if (preserveDraft || !equals(state.baseline, state.draft)) {
        state.pendingExternal = clone(value);
        return;
      }
      loadBaseline(value);
    },
    loadPendingExternal() {
      if (state.pendingExternal === null) return;
      loadBaseline(state.pendingExternal);
    },
    commitSaved(value) {
      const next = clone(value ?? state.draft);
      state.baseline = next;
      state.draft = clone(next);
      state.pendingExternal = null;
    },
    commitSavedBaseline(value, preservePendingExternal = false) {
      const next = clone(value);
      state.baseline = next;
      if (!preservePendingExternal) state.pendingExternal = null;
    },
    resetDraft() {
      state.draft = clone(state.baseline);
    },
    clear(value) {
      loadBaseline(value);
    },
  };
}

export interface UndoStackState<TEntry> {
  undoStack: TEntry[];
  redoStack: TEntry[];
  limit: number;
  sequence: number;
}

/**
 * Sole state shape of the undo/redo dual stacks. The state is plain data (wrap it with
 * `reactive()` for reactivity); every mutation must go through the operation functions
 * below, which take the state as their first argument so each mutation stays trackable
 * through the proxy. Mutating a closure-held or bare object never triggers updates.
 */
export function createUndoStackState<TEntry>(limit = 100): UndoStackState<TEntry> {
  return { undoStack: [], redoStack: [], limit, sequence: 0 };
}

export function nextUndoStackId<TEntry>(state: UndoStackState<TEntry>, idPrefix: string): string {
  return `${idPrefix}_${Date.now()}_${++state.sequence}`;
}

export function canUndoEntry<TEntry>(state: UndoStackState<TEntry>): boolean {
  return state.undoStack.length > 0;
}

export function canRedoEntry<TEntry>(state: UndoStackState<TEntry>): boolean {
  return state.redoStack.length > 0;
}

export function peekUndoEntry<TEntry>(state: UndoStackState<TEntry>): TEntry | undefined {
  return state.undoStack[state.undoStack.length - 1];
}

export function peekRedoEntry<TEntry>(state: UndoStackState<TEntry>): TEntry | undefined {
  return state.redoStack[state.redoStack.length - 1];
}

export function pushUndoEntry<TEntry>(state: UndoStackState<TEntry>, entry: TEntry, { clearRedo = true } = {}): void {
  state.undoStack.push(entry);
  if (clearRedo) state.redoStack.length = 0;
  trimUndoStack(state);
}

export function pushRedoEntry<TEntry>(state: UndoStackState<TEntry>, entry: TEntry): void {
  state.redoStack.push(entry);
}

export function popUndoEntry<TEntry>(state: UndoStackState<TEntry>): TEntry | undefined {
  return state.undoStack.pop();
}

export function popRedoEntry<TEntry>(state: UndoStackState<TEntry>): TEntry | undefined {
  return state.redoStack.pop();
}

export function clearUndoStack<TEntry>(state: UndoStackState<TEntry>): void {
  state.undoStack.length = 0;
  state.redoStack.length = 0;
}

export function setUndoStackLimit<TEntry>(state: UndoStackState<TEntry>, limit: number): void {
  state.limit = limit;
  trimUndoStack(state);
}

function trimUndoStack<TEntry>(state: UndoStackState<TEntry>): void {
  while (state.undoStack.length > state.limit) state.undoStack.shift();
}
