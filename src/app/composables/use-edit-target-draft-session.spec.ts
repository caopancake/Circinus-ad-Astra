import { describe, expect, it, vi } from 'vitest';
import {
  useEditTargetDraftSession,
  type EditTargetDraftSession,
  type EditTargetDraftSessionOptions,
  type EditTargetSnapshot,
} from './use-edit-target-draft-session';

interface SampleValue {
  a: number;
}

interface SampleTarget {
  id: string;
}

const target: SampleTarget = { id: 't1' };
const targetKey = (value: SampleTarget) => value.id;

type SampleSessionOptions = Partial<EditTargetDraftSessionOptions<SampleValue, SampleTarget>>;

function createSession(options: SampleSessionOptions = {}): EditTargetDraftSession<SampleValue, SampleTarget> {
  return useEditTargetDraftSession<SampleValue, SampleTarget>({
    emptyValue: { a: 1 },
    targetKey,
    load: () => ({ value: { a: 1 } }),
    ...options,
  });
}

describe('useEditTargetDraftSession dirty binding', () => {
  it('flips dirty reactively when the draft diverges from the baseline', () => {
    const session = createSession();
    expect(session.dirty.value).toBe(false);
    session.setDraft({ a: 2 });
    expect(session.dirty.value).toBe(true);
  });

  it('clears dirty when the draft returns to the baseline value', () => {
    const session = createSession();
    session.setDraft({ a: 2 });
    session.setDraft({ a: 1 });
    expect(session.dirty.value).toBe(false);
  });

  it('keeps the mirrored draft isolated from the submitted value object', () => {
    const session = createSession();
    const submitted: SampleValue = { a: 2 };
    session.setDraft(submitted);
    submitted.a = 99;
    expect(session.draftValue.value).toEqual({ a: 2 });
    expect(session.dirty.value).toBe(true);
  });

  it('restores the baseline through resetDraft', () => {
    const session = createSession();
    session.loadBaseForTarget(target, { a: 1 });
    session.setDraft({ a: 2 });
    session.resetDraft();
    expect(session.dirty.value).toBe(false);
    expect(session.draftValue.value).toEqual({ a: 1 });
  });

  it('dispatches two-way model assignments through the draft state machine', () => {
    const session = createSession();
    session.loadBaseForTarget(target, { a: 1 });
    session.draftValue.value = { a: 2 };
    expect(session.dirty.value).toBe(true);
    session.applyExternalForTarget(target, { a: 3 });
    expect(session.draftValue.value).toEqual({ a: 2 });
    expect(session.pendingExternalValue.value).toEqual({ a: 3 });
  });
});

describe('useEditTargetDraftSession save binding', () => {
  it('commits the saved snapshot and clears dirty', async () => {
    const save = vi.fn(async (_target: SampleTarget, draft: SampleValue) => ({ value: draft }));
    const session = createSession({ save });
    session.loadBaseForTarget(target, { a: 1 });
    session.setDraft({ a: 2 });
    const result = await session.saveDraft();
    expect(save).toHaveBeenCalledWith(target, { a: 2 }, []);
    expect(result).toEqual({ value: { a: 2 } });
    expect(session.dirty.value).toBe(false);
    expect(session.draftValue.value).toEqual({ a: 2 });
    expect(session.saving.value).toBe(false);
  });

  it('stages the save result as pending external when the draft moved during the request', async () => {
    let resolveSave: (snapshot: EditTargetSnapshot<SampleValue>) => void = () => {};
    const save = vi.fn(
      () =>
        new Promise<EditTargetSnapshot<SampleValue>>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const session = createSession({ save });
    session.loadBaseForTarget(target, { a: 1 });
    session.setDraft({ a: 2 });
    const pending = session.saveDraft();
    expect(session.saving.value).toBe(true);
    session.setDraft({ a: 9 });
    resolveSave({ value: { a: 2 } });
    const result = await pending;
    expect(result).toEqual({ value: { a: 2 } });
    expect(session.dirty.value).toBe(true);
    expect(session.draftValue.value).toEqual({ a: 9 });
    expect(session.pendingExternalValue.value).toEqual({ a: 2 });
    expect(session.hasPendingExternalValue.value).toBe(true);
    expect(session.saving.value).toBe(false);
    session.draftValue.value = { a: 1 };
    expect(session.dirty.value).toBe(true);
    session.resetDraft();
    expect(session.draftValue.value).toEqual({ a: 2 });
    expect(session.dirty.value).toBe(false);
  });

  it('preserves a return to the old baseline while a save is pending', async () => {
    let resolveSave!: (snapshot: EditTargetSnapshot<SampleValue>) => void;
    const session = createSession({ save: () => new Promise((resolve) => (resolveSave = resolve)) });
    session.loadBaseForTarget(target, { a: 1 });
    session.draftValue.value = { a: 2 };
    const pending = session.saveDraft();
    session.draftValue.value = { a: 1 };
    resolveSave({ value: { a: 2 } });
    await pending;
    expect(session.draftValue.value).toEqual({ a: 1 });
    expect(session.dirty.value).toBe(true);
    session.loadPendingExternal();
    expect(session.draftValue.value).toEqual({ a: 2 });
    expect(session.dirty.value).toBe(false);
  });

  it('keeps rejected saves dirty and skips the saved callback', async () => {
    const onSaved = vi.fn();
    const session = createSession({ save: async () => {}, onSaved });
    session.loadBaseForTarget(target, { a: 1 });
    session.draftValue.value = { a: 2 };
    expect(await session.saveDraft()).toBeNull();
    expect(session.dirty.value).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('useEditTargetDraftSession external updates', () => {
  it('stages external updates while dirty and exposes the notice reactively', () => {
    const session = createSession({ externalNotice: '外部更新' });
    session.loadBaseForTarget(target, { a: 1 });
    session.setDraft({ a: 2 });
    session.applyExternalForTarget(target, { a: 3 });
    expect(session.dirty.value).toBe(true);
    expect(session.draftValue.value).toEqual({ a: 2 });
    expect(session.pendingExternalValue.value).toEqual({ a: 3 });
    expect(session.hasPendingExternalValue.value).toBe(true);
    expect(session.externalUpdateNotice.value).toBe('外部更新');
    session.loadPendingExternal();
    expect(session.draftValue.value).toEqual({ a: 3 });
    expect(session.dirty.value).toBe(false);
    expect(session.externalUpdateNotice.value).toBe('');
  });

  it('uses the default notice when no custom text is configured', () => {
    const session = createSession();
    session.loadBaseForTarget(target, { a: 1 });
    session.setDraft({ a: 2 });
    session.applyExternalForTarget(target, { a: 3 });
    expect(session.externalUpdateNotice.value).toBe('外部版本已更新，当前未保存草稿已保留。');
  });

  it('applies external updates directly when clean', () => {
    const session = createSession();
    session.loadBaseForTarget(target, { a: 1 });
    session.applyExternalForTarget(target, { a: 3 });
    expect(session.dirty.value).toBe(false);
    expect(session.draftValue.value).toEqual({ a: 3 });
    expect(session.pendingExternalValue.value).toBeNull();
    expect(session.externalUpdateNotice.value).toBe('');
  });

  it('ignores external updates for a different target', () => {
    const session = createSession();
    session.loadBaseForTarget(target, { a: 1 });
    session.applyExternalForTarget({ id: 'other' }, { a: 3 });
    expect(session.draftValue.value).toEqual({ a: 1 });
    expect(session.dirty.value).toBe(false);
  });
});

describe('useEditTargetDraftSession target loading', () => {
  it('bumps revision only when the loaded base changes the draft', () => {
    const session = createSession({ emptyValue: { a: 0 } });
    expect(session.revision.value).toBe(0);
    session.loadBaseForTarget(target, { a: 1 });
    expect(session.revision.value).toBe(1);
    session.loadBaseForTarget(target, { a: 1 });
    expect(session.revision.value).toBe(1);
    session.loadBaseForTarget(target, { a: 2 });
    expect(session.revision.value).toBe(2);
    expect(session.dirty.value).toBe(false);
    expect(session.draftValue.value).toEqual({ a: 2 });
  });

  it('keeps revision stable across draft edits', () => {
    const session = createSession({ emptyValue: { a: 0 } });
    session.loadBaseForTarget(target, { a: 1 });
    expect(session.revision.value).toBe(1);
    session.setDraft({ a: 2 });
    expect(session.revision.value).toBe(1);
  });
});
