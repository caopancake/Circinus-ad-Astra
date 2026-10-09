import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import WriteSyncNotice from './WriteSyncNotice.vue';
import { useWriteSyncStore } from '@/stores/write-sync.store';
import { savedWriteFixture } from '@/test/write-result';
const mocks = vi.hoisted(() => ({ retry: vi.fn(), error: vi.fn() }));
vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({ retryPendingProjectSessionWrites: mocks.retry }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
function mountNotice() {
  const sync = useWriteSyncStore();
  const entry = sync.enqueue({
    originWindowLabel: 'main',
    sessionId: 's1',
    modRoot: 'M:/mod',
    reason: 'save',
    result: savedWriteFixture(),
  });
  entry.step = 'broadcast';
  sync.markFailed(entry.id, 'broadcast');
  const wrapper = mount(WriteSyncNotice, {
    global: { stubs: { 'n-button': { props: ['loading'], template: '<button :disabled="loading"><slot /></button>' } } },
  });
  return { sync, entry, wrapper };
}
describe('write synchronization notice', () => {
  it('shows the committed pending count and clears it after an explicit retry', async () => {
    const { sync, entry, wrapper } = mountNotice();
    mocks.retry.mockImplementationOnce(async () => sync.complete(entry.id));
    expect(wrapper.get('[role="status"]').text()).toContain('内容已保存，1 项同步待完成');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it('keeps the failed receipt and presents one retry error', async () => {
    const { sync, entry, wrapper } = mountNotice();
    mocks.retry.mockRejectedValueOnce(new Error('still offline'));
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(sync.pending[0]?.id).toBe(entry.id);
    expect(wrapper.get('[role="status"]').text()).toContain('1 项同步待完成');
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });
});
