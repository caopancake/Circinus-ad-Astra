import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider';
import type { DialogApiInjection } from 'naive-ui/es/dialog/src/DialogProvider';
import { createAppFeedback } from './app-feedback';
import { withCause } from '@/shared/lib/errors';
import { useProjectStore } from '@/stores/project.store';
import { initializeSettingsStore } from '@/stores/settings.store';
import { sessionUpdateFixture } from '@/test/write-result';

const mocks = vi.hoisted(() => ({ log: vi.fn(), open: vi.fn(async () => {}), transcode: vi.fn() }));
vi.mock('@/services/app-feedback-log.service', () => ({ recordLogBestEffort: mocks.log }));
vi.mock('@/windows/file-editor.window', () => ({ openFileEditorWindow: mocks.open }));
vi.mock('@/windows/window-identity.window', () => ({ currentWindowSessionIdentity: () => null }));
vi.mock('@/services/files.service', () => ({ transcodeFileToUtf8: mocks.transcode }));
let wrapper: VueWrapper | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore({
    theme: 'light',
    accent: 'blue',
    customAccent: '#3388cc',
    historyLimit: 20,
    editMode: 'smart',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  });
  const update = sessionUpdateFixture('s1', 'M:/mod');
  if (update.status === 'ready') useProjectStore().registerProjectManifest(update.projection.manifest);
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function feedbackHarness() {
  const messages = { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() };
  const dialogs = { warning: vi.fn(), error: vi.fn(), create: vi.fn() };
  return {
    messages,
    dialogs,
    feedback: createAppFeedback(messages as unknown as MessageApiInjection, dialogs as unknown as DialogApiInjection),
  };
}

describe('feedback diagnostics, file authorization and actions', () => {
  it('renders mapped copy and structured location while logging raw diagnostics', async () => {
    const { feedback, messages } = feedbackHarness();
    const diagnostic = {
      code: 'parse.json_syntax',
      message: 'Unexpected token',
      location: { path: 'M:/mod/demo.skin', line: 3, column: 7 },
    };
    feedback.error(withCause('保存失败', diagnostic, 'save-skin'));
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.text()).toContain('JSON 语法错误');
    expect(wrapper.text()).toContain('第 3 行，第 7 列');
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: 'parse.json_syntax',
        message: 'Unexpected token',
        path: 'M:/mod/demo.skin',
        line: 3,
        fields: { action: 'save-skin', column: '7' },
      }),
    );
    await wrapper.get('button').trigger('click');
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', path: 'M:/mod/demo.skin', line: 3, column: 7 }));
  });

  it('preserves a warning diagnostic independently of its user message', () => {
    const { feedback, messages } = feedbackHarness();
    feedback.warning({
      userMessage: '读取任务失败',
      diagnostic: {
        code: 'parse.json',
        message: 'Raw scan detail',
        location: { path: 'M:/mod/descriptor.json', line: 2, column: null },
      },
    });
    wrapper = mount({ render: messages.warning.mock.lastCall![0] });
    expect(wrapper.text()).toContain('读取任务失败');
    expect(wrapper.text()).toContain('第 2 行');
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ code: 'parse.json', message: 'Raw scan detail' }));
  });

  it('offers transcoding by the wrapped stable code and owning session', () => {
    const { feedback, messages } = feedbackHarness();
    feedback.error(
      withCause('读取失败', {
        code: 'text.invalid_utf8',
        message: 'Invalid byte',
        location: { path: 'M:/mod/notes.txt', line: null, column: null },
      }),
    );
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['打开文件', '转码为 UTF-8']);
  });

  it('keeps outside-root diagnostics as display-only file locations', () => {
    const { feedback, messages } = feedbackHarness();
    feedback.error({ code: 'parse.json', message: 'Raw', location: { path: 'M:/other/demo.json', line: 1, column: 2 } });
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.text()).toContain('M:/other/demo.json');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('routes confirmation cancel events to the pending action', () => {
    const { feedback, dialogs } = feedbackHarness();
    const cancel = vi.fn();
    feedback.confirmWarning({ title: '交接', actionText: '继续', onConfirm: vi.fn(), onCancel: cancel });
    dialogs.warning.mock.lastCall![0].onNegativeClick();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
