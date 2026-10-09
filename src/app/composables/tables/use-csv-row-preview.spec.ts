import { defineComponent, h, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { useCsvRowPreview } from './use-csv-row-preview';
import { waitForRead } from '@/shared/runtime/read-request';
import type { CsvRowPreviewTarget } from '@/shared/types';

const error = vi.hoisted(() => vi.fn());
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error }) }));

describe('CSV row preview ownership', () => {
  it('ends old target waits and suppresses their late failure while retaining the new preview', async () => {
    const target = ref<CsvRowPreviewTarget | null>({ sessionId: 'a', table: 'ships', rowKey: 'old' });
    let fail!: (error: unknown) => void;
    let oldSignal!: AbortSignal;
    const query = vi.fn((captured: CsvRowPreviewTarget, signal?: AbortSignal) => {
      if (captured.rowKey !== 'old') return Promise.resolve('data:current');
      oldSignal = signal!;
      return waitForRead(
        new Promise<string>((_resolve, reject) => {
          fail = reject;
        }),
        captured,
        signal,
      );
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          const src = useCsvRowPreview({ target: () => target.value, query });
          return () => h('img', { src: src.value });
        },
      }),
    );
    target.value = { sessionId: 'b', table: 'ships', rowKey: 'next' };
    await flushPromises();
    expect(oldSignal.aborted).toBe(true);
    expect(wrapper.attributes('src')).toBe('data:current');
    fail(new Error('old session failure'));
    await flushPromises();
    expect(error).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
