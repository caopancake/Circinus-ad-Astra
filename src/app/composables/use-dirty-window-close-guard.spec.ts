import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h, ref, type Ref } from 'vue';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import { editorUiStubs } from '@/test/ui-stubs';

const mocks = vi.hoisted(() => {
  let closeRequestHandler: ((event: { preventDefault: () => void }) => void | Promise<void>) | null = null;
  return {
    destroyCurrentWindow: vi.fn(async () => {}),
    closeRequestHandler: {
      get: () => closeRequestHandler,
      set: (handler: ((event: { preventDefault: () => void }) => void | Promise<void>) | null) => {
        closeRequestHandler = handler;
      },
    },
    listenCurrentWindowCloseRequest: vi.fn(async (handler: (event: { preventDefault: () => void }) => void | Promise<void>) => {
      closeRequestHandler = handler;
      return () => {
        closeRequestHandler = null;
      };
    }),
    feedback: {
      success: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      confirmDanger: vi.fn(),
      confirmWarning: vi.fn(),
      choose: vi.fn(async () => null as string | null),
    },
  };
});

vi.mock('@/windows/current.window', () => ({
  destroyCurrentWindow: mocks.destroyCurrentWindow,
  listenCurrentWindowCloseRequest: mocks.listenCurrentWindowCloseRequest,
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

import { useDirtyWindowCloseGuard } from './use-dirty-window-close-guard';
import { useSaveCommandStore } from '@/stores/save-command.store';

function mountGuard(dirty: Ref<boolean>) {
  let guard!: ReturnType<typeof useDirtyWindowCloseGuard>;
  mount({
    setup() {
      guard = useDirtyWindowCloseGuard({ content: '未保存', dirty, title: '关闭？' });
      return () => null;
    },
  });
  return guard;
}

function closeRequest(): { prevented: boolean } {
  let prevented = false;
  const handler = mocks.closeRequestHandler.get();
  if (!handler) return { prevented: false };
  handler({
    preventDefault: () => {
      prevented = true;
    },
  });
  return { prevented };
}

describe('useDirtyWindowCloseGuard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.feedback.choose.mockResolvedValue(null);
  });

  it('installs the close request listener', async () => {
    const guard = mountGuard(ref(false));
    await guard.install();
    expect(mocks.listenCurrentWindowCloseRequest).toHaveBeenCalledTimes(1);
    guard.dispose();
  });

  it('lets the window close when the draft is clean', async () => {
    const guard = mountGuard(ref(false));
    await guard.install();
    const { prevented } = closeRequest();
    expect(prevented).toBe(false);
    expect(mocks.feedback.choose).not.toHaveBeenCalled();
    guard.dispose();
  });

  it('intercepts the close and asks for confirmation when dirty', async () => {
    mocks.feedback.choose.mockResolvedValue('discard');
    const guard = mountGuard(ref(true));
    await guard.install();
    const { prevented } = closeRequest();
    expect(prevented).toBe(true);
    await vi.waitFor(() => expect(mocks.feedback.choose).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(mocks.destroyCurrentWindow).toHaveBeenCalledTimes(1));
    guard.dispose();
  });

  it('keeps the window open when the user cancels the confirmation', async () => {
    mocks.feedback.choose.mockResolvedValue(null);
    const guard = mountGuard(ref(true));
    await guard.install();
    closeRequest();
    await vi.waitFor(() => expect(mocks.feedback.choose).toHaveBeenCalledTimes(1));
    expect(mocks.destroyCurrentWindow).not.toHaveBeenCalled();
    guard.dispose();
  });

  it('reports confirmation failures instead of closing silently', async () => {
    mocks.feedback.choose.mockRejectedValue(new Error('dialog broken'));
    const guard = mountGuard(ref(true));
    await guard.install();
    closeRequest();
    await vi.waitFor(() => expect(mocks.feedback.error).toHaveBeenCalledTimes(1));
    expect(mocks.destroyCurrentWindow).not.toHaveBeenCalled();
    guard.dispose();
  });

  it('does not reopen the confirmation while one is pending', async () => {
    let resolveChoice: (value: string | null) => void = () => {};
    mocks.feedback.choose.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveChoice = resolve;
      }),
    );
    const guard = mountGuard(ref(true));
    await guard.install();
    closeRequest();
    closeRequest();
    resolveChoice('discard');
    await vi.waitFor(() => expect(mocks.destroyCurrentWindow).toHaveBeenCalledTimes(1));
    expect(mocks.feedback.choose).toHaveBeenCalledTimes(1);
    guard.dispose();
  });

  it('ignores close requests after disposal', async () => {
    mocks.feedback.choose.mockResolvedValue('discard');
    const guard = mountGuard(ref(true));
    await guard.install();
    guard.dispose();
    const { prevented } = closeRequest();
    expect(prevented).toBe(false);
    expect(mocks.feedback.choose).not.toHaveBeenCalled();
  });

  it.each([true, false])('immediately intercepts close and coalesces requests while save completes with %s', async (saved) => {
    const dirty = ref(true);
    const saving = ref(true);
    let release!: (saved: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    useSaveCommandStore().registerSaveSession({ targetKey: ref('one'), modRoot: ref('M:/mod'), saving, waitForSave: () => promise });
    const guard = mountGuard(dirty);
    await guard.install();
    expect(closeRequest().prevented).toBe(true);
    expect(closeRequest().prevented).toBe(true);
    expect(mocks.destroyCurrentWindow).not.toHaveBeenCalled();
    expect(mocks.feedback.choose).not.toHaveBeenCalled();
    if (saved) dirty.value = false;
    saving.value = false;
    release(saved);
    await flushPromises();
    if (saved) await vi.waitFor(() => expect(mocks.destroyCurrentWindow).toHaveBeenCalledOnce());
    else {
      await Promise.resolve();
      await Promise.resolve();
      expect(mocks.destroyCurrentWindow).not.toHaveBeenCalled();
      expect(mocks.feedback.choose).not.toHaveBeenCalled();
      closeRequest();
      await vi.waitFor(() => expect(mocks.feedback.choose).toHaveBeenCalledOnce());
    }
    guard.dispose();
  });

  it('confirms fresh editing made while the close intent waits for a successful save', async () => {
    const dirty = ref(false),
      saving = ref(true);
    let release!: (saved: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    useSaveCommandStore().registerSaveSession({ targetKey: ref('one'), modRoot: ref('M:/mod'), saving, waitForSave: () => promise });
    const guard = mountGuard(dirty);
    await guard.install();
    expect(closeRequest().prevented).toBe(true);
    dirty.value = true;
    saving.value = false;
    release(true);
    await vi.waitFor(() => expect(mocks.feedback.choose).toHaveBeenCalledOnce());
    expect(mocks.destroyCurrentWindow).not.toHaveBeenCalled();
    guard.dispose();
  });

  it('guards an unfinished JSON input while the formal draft still equals its baseline', async () => {
    mocks.feedback.choose.mockResolvedValue(null);
    let guard!: ReturnType<typeof useDirtyWindowCloseGuard>;
    const wrapper = mount(
      {
        setup() {
          const session = useEditTargetDraftSession({
            emptyValue: {},
            load: () => ({ target: 'one', baseVersions: [], meta: null, value: {} }),
            targetKey: (key: string) => key,
          });
          session.loadBaseForTarget({ target: 'one', value: {}, baseVersions: [], meta: null });
          guard = useDirtyWindowCloseGuard({ content: '未提交输入', title: '关闭？', dirty: session.dirty });
          return () =>
            h(JsonValueInput<'object'>, { value: session.draftValue.value, shape: 'object', label: '规格', onUpdate: session.setDraft });
        },
      },
      { global: { stubs: editorUiStubs } },
    );
    await guard.install();
    await wrapper.get('textarea').setValue('{');
    expect(closeRequest().prevented).toBe(true);
    await vi.waitFor(() => expect(mocks.feedback.choose).toHaveBeenCalledTimes(1));
    expect(mocks.destroyCurrentWindow).not.toHaveBeenCalled();
    guard.dispose();
    wrapper.unmount();
  });
});
