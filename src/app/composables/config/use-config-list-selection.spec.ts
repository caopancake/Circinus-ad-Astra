import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfigListSelection } from './use-config-list-selection';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useWriteSyncStore } from '@/stores/write-sync.store';
import { savedWriteFixture } from '@/test/write-result';
import type { AppFeedback, CommittedWriteEvent } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  retry: vi.fn(),
  feedback: { success: vi.fn(), error: vi.fn(), confirmWarning: vi.fn<AppFeedback['confirmWarning']>() },
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => mocks.feedback }));
vi.mock('@/orchestrators/config-save.orchestrator', () => ({ completeConfigSave: mocks.complete }));
vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({ retryPendingWritesForMod: mocks.retry }));
let wrapper: VueWrapper;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mocks.retry.mockResolvedValue(undefined);
  mocks.complete.mockImplementation(async (modRoot: string, _session: string, result: CommittedWriteEvent['result']) => {
    useWriteSyncStore().markAccepted({ modRoot, result } as CommittedWriteEvent);
  });
});
afterEach(() => wrapper?.unmount());

function harness() {
  const modRoot = ref<string | null>('M:/mod');
  const sessionId = ref<string | null>('s1');
  const dirty = ref(false);
  let selection!: ReturnType<typeof useConfigListSelection>;
  wrapper = mount({
    setup() {
      selection = useConfigListSelection({ modRoot, sessionId, label: '战役' });
      return () => null;
    },
  });
  useDraftSessionsStore().registerDraftSession(modRoot, dirty);
  selection.reconcile(['a', 'b']);
  return { selection, modRoot, sessionId, dirty };
}

function mutation(
  selection: ReturnType<typeof useConfigListSelection>,
  options: { changesTarget?: boolean; accept?: () => Promise<boolean> } = {},
) {
  const write = vi.fn(async () => savedWriteFixture());
  const accept =
    options.accept ??
    vi.fn(async () => {
      selection.selectedId.value = 'b';
      return true;
    });
  return {
    write,
    accept,
    run: () =>
      selection.mutate({
        sessionId: 's1',
        modRoot: 'M:/mod',
        changesTarget: options.changesTarget ?? true,
        label: 'Created mission',
        write,
        accept,
      }),
  };
}

describe('config list selection and action boundaries', () => {
  it('selects the domain-ordered first item and retains a surviving selection', () => {
    const { selection } = harness();
    expect(selection.selectedId.value).toBe('a');
    selection.reconcile(['b', 'a']);
    expect(selection.selectedId.value).toBe('a');
    selection.reconcile(['b']);
    expect(selection.selectedId.value).toBe('b');
    selection.reconcile([]);
    expect(selection.selectedId.value).toBeNull();
  });

  it('retains a deleted dirty target until explicit discard is confirmed', async () => {
    const { selection, dirty } = harness();
    dirty.value = true;
    selection.reconcile(['b']);
    expect(selection.selectedId.value).toBe('a');
    expect(selection.deletedTarget.value).toBe(true);
    const pending = selection.discardDeleted();
    await flushPromises();
    mocks.feedback.confirmWarning.mock.lastCall![0].onCancel!();
    await pending;
    expect(selection.selectedId.value).toBe('a');
    const confirmed = selection.discardDeleted();
    await flushPromises();
    mocks.feedback.confirmWarning.mock.lastCall![0].onConfirm();
    await confirmed;
    expect(selection.selectedId.value).toBe('b');
    expect(selection.deletedTarget.value).toBe(false);
  });

  it('confirms dirty before writing and locks through receipt acceptance', async () => {
    const { selection, dirty } = harness();
    dirty.value = true;
    let finish!: () => void;
    const write = vi.fn(
      () =>
        new Promise<ReturnType<typeof savedWriteFixture>>((resolve) => {
          finish = () => resolve(savedWriteFixture());
        }),
    );
    const accept = vi.fn(async () => true);
    const pending = selection.mutate({ sessionId: 's1', modRoot: 'M:/mod', changesTarget: true, label: 'Create', write, accept });
    await flushPromises();
    expect(write).not.toHaveBeenCalled();
    mocks.feedback.confirmWarning.mock.lastCall![0].onConfirm();
    await flushPromises();
    expect(selection.locked.value).toBe(true);
    expect(selection.writing.value).toBe(true);
    finish();
    expect(await pending).toBe(true);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(selection.locked.value).toBe(false);
  });

  it.each(['cancel', 'failure'] as const)('preserves the target on %s', async (outcome) => {
    const { selection, dirty } = harness();
    dirty.value = outcome === 'cancel';
    const action = mutation(selection);
    if (outcome === 'failure') action.write.mockRejectedValueOnce(new Error('write failed'));
    const pending = action.run();
    await flushPromises();
    if (outcome === 'cancel') mocks.feedback.confirmWarning.mock.lastCall![0].onCancel!();
    expect(await pending).toBe(false);
    expect(selection.selectedId.value).toBe('a');
    expect(selection.locked.value).toBe(false);
  });

  it('waits for saving and ends a failed handoff', async () => {
    const { selection } = harness();
    let finish!: (success: boolean) => void;
    const waiting = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    useSaveCommandStore().registerSaveSession({
      modRoot: ref('M:/mod'),
      targetKey: ref('target'),
      saving: ref(true),
      waitForSave: () => waiting,
    });
    const pending = selection.select('b');
    expect(selection.selectedId.value).toBe('a');
    finish(false);
    await pending;
    expect(selection.selectedId.value).toBe('a');
  });

  it('preserves the current target while deleting another entity', async () => {
    const { selection, dirty } = harness();
    dirty.value = true;
    const action = mutation(selection, {
      changesTarget: false,
      accept: async () => {
        selection.reconcile(['a']);
        return true;
      },
    });
    expect(await action.run()).toBe(true);
    expect(selection.selectedId.value).toBe('a');
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
  });

  it.each(['projection', 'broadcast'] as const)('retains completed steps on %s failure and retries the original receipt', async (step) => {
    const { selection } = harness();
    const action = mutation(selection);
    mocks.complete.mockImplementationOnce(async (modRoot, _session, result) => {
      if (step === 'broadcast') useWriteSyncStore().markAccepted({ modRoot, result } as CommittedWriteEvent);
      throw new Error(step);
    });
    expect(await action.run()).toBe(false);
    expect(selection.selectedId.value).toBe(step === 'broadcast' ? 'b' : 'a');
    mocks.retry.mockImplementationOnce(async () => {
      useWriteSyncStore().markAccepted({ modRoot: 'M:/mod', result: savedWriteFixture() } as CommittedWriteEvent);
    });
    const pending = useSaveCommandStore().waitForSaves('M:/mod');
    if (pending) expect(await pending).toBe(true);
    expect(selection.selectedId.value).toBe('b');
    expect(action.write).toHaveBeenCalledTimes(1);
    expect(action.accept).toHaveBeenCalledTimes(1);
  });

  it('retains receipt acceptance after a list query failure', async () => {
    const { selection } = harness();
    const accept = vi.fn(async () => false);
    const action = mutation(selection, { accept });
    expect(await action.run()).toBe(false);
    accept.mockImplementationOnce(async () => {
      selection.selectedId.value = 'b';
      return true;
    });
    expect(await useSaveCommandStore().waitForSaves('M:/mod')).toBe(true);
    expect(action.write).toHaveBeenCalledTimes(1);
    expect(selection.selectedId.value).toBe('b');
  });

  it('binds confirmations and list acceptance to their captured session', async () => {
    const { selection, sessionId, dirty } = harness();
    dirty.value = true;
    const action = mutation(selection);
    const pending = action.run();
    await flushPromises();
    sessionId.value = 's2';
    mocks.feedback.confirmWarning.mock.lastCall![0].onConfirm();
    expect(await pending).toBe(false);
    expect(action.write).not.toHaveBeenCalled();
    expect(selection.selectedId.value).toBeNull();
  });

  it('releases a pending confirmation when the view is disposed', async () => {
    const { selection, dirty } = harness();
    dirty.value = true;
    const action = mutation(selection);
    const pending = action.run();
    await flushPromises();
    wrapper.unmount();
    expect(await pending).toBe(false);
    expect(action.write).not.toHaveBeenCalled();
  });

  it('completes a captured write without accepting presentation into a reopened session', async () => {
    const { selection, sessionId } = harness();
    let finish!: (receipt: ReturnType<typeof savedWriteFixture>) => void;
    const write = vi.fn(
      () =>
        new Promise<ReturnType<typeof savedWriteFixture>>((resolve) => {
          finish = resolve;
        }),
    );
    const accept = vi.fn(async () => true);
    const pending = selection.mutate({ sessionId: 's1', modRoot: 'M:/mod', changesTarget: true, label: 'Create', write, accept });
    await flushPromises();
    sessionId.value = 's2';
    finish(savedWriteFixture());
    expect(await pending).toBe(false);
    expect(mocks.complete).toHaveBeenCalledWith('M:/mod', 's1', expect.anything(), 'Create');
    expect(accept).not.toHaveBeenCalled();
    expect(mocks.feedback.success).not.toHaveBeenCalled();
    expect(selection.selectedId.value).toBeNull();
  });

  it.each([
    ['select', 'session'],
    ['mutate', 'session'],
    ['select', 'unmount'],
    ['mutate', 'unmount'],
  ] as const)('releases a stale %s preparation error on %s', async (action, ending) => {
    const { selection, sessionId } = harness();
    let fail!: (error: Error) => void;
    mocks.retry.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const mutationAction = mutation(selection);
    const pending = action === 'select' ? selection.select('b') : mutationAction.run();
    await flushPromises();
    if (ending === 'session') sessionId.value = 's2';
    else wrapper.unmount();
    fail(new Error('old synchronization'));
    await pending;
    expect(mocks.feedback.error).not.toHaveBeenCalled();
    expect(mutationAction.write).not.toHaveBeenCalled();
    expect(selection.selectedId.value).toBe(ending === 'session' ? null : 'a');
  });
});
