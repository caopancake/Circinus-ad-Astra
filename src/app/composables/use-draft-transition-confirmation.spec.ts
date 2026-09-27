import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  },
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

import { useDraftTransitionConfirmation } from './use-draft-transition-confirmation';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { ref } from 'vue';

describe('useDraftTransitionConfirmation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('runs the action directly when no mod is active', () => {
    const action = vi.fn();
    const { confirmDraftTransition } = useDraftTransitionConfirmation();
    confirmDraftTransition(null, { title: '切换', content: '内容', action });
    expect(action).toHaveBeenCalledTimes(1);
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
  });

  it('runs the action directly when the mod has no dirty drafts', () => {
    const action = vi.fn();
    const { confirmDraftTransition } = useDraftTransitionConfirmation();
    confirmDraftTransition('C:/mods/alpha', { title: '切换', content: '内容', action });
    expect(action).toHaveBeenCalledTimes(1);
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
  });

  it('asks for confirmation when the mod has dirty drafts', () => {
    const action = vi.fn();
    const draftSessions = useDraftSessionsStore();
    const dirty = ref(true);
    draftSessions.registerDraftSession(ref('C:/mods/alpha'), dirty);
    const { confirmDraftTransition } = useDraftTransitionConfirmation();
    confirmDraftTransition('C:/mods/alpha', { title: '放弃未保存配置修改？', content: '确认继续？', action });
    expect(action).not.toHaveBeenCalled();
    expect(mocks.feedback.confirmWarning).toHaveBeenCalledTimes(1);
    const options = mocks.feedback.confirmWarning.mock.calls[0]![0];
    expect(options.title).toBe('放弃未保存配置修改？');
    expect(options.actionText).toBe('放弃修改并继续');

    options.onConfirm();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('isolates the confirmation to the matching mod root', () => {
    const action = vi.fn();
    const draftSessions = useDraftSessionsStore();
    draftSessions.registerDraftSession(ref('C:/mods/alpha'), ref(true));
    const { confirmDraftTransition } = useDraftTransitionConfirmation();
    confirmDraftTransition('C:/mods/beta', { title: 't', content: 'c', action });
    expect(action).toHaveBeenCalledTimes(1);
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
  });
});
