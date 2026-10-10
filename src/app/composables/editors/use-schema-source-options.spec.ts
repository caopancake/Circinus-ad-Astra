import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useSchemaSourceOptions } from './use-schema-source-options';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';

const errors = vi.hoisted(() => vi.fn());
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: errors }) }));

describe('schema source query lifecycle', () => {
  it('revokes a pending source when the field no longer declares a source', async () => {
    errors.mockClear();
    let finish!: (value: []) => void;
    let signal!: AbortSignal;
    const field = ref({ key: 'id', label: 'ID', type: 'enum' as const, source: 'csv:weapons.id' });
    const query = vi.fn((_source: string, current?: AbortSignal) => {
      signal = current!;
      return new Promise<[]>((resolve) => {
        finish = resolve;
      });
    });
    let source!: ReturnType<typeof useSchemaSourceOptions>;
    const wrapper = mount({
      setup() {
        source = useSchemaSourceOptions({
          field: () => field.value,
          value: () => '',
          runtimeContext: () => ({ sessionId: 's1', modRoot: 'M:/A', querySourceOptions: query }),
        });
        return () => null;
      },
    });
    field.value.source = '';
    await nextTick();
    expect(signal.aborted).toBe(true);
    finish([]);
    await flushPromises();
    expect(source.sourceOptions.value).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('clears old options and reports a rejected target query once, then retries', async () => {
    errors.mockClear();
    const query = vi.fn(async () => [
      { origin: 'mod' as const, options: [{ label: 'A', value: 'a', origin: 'mod' as const, description: null, resourceRef: null }] },
    ]);
    const context = ref<SchemaRuntimeContext>({ sessionId: 's1', modRoot: 'M:/A', querySourceOptions: query });
    let source!: ReturnType<typeof useSchemaSourceOptions>;
    const wrapper = mount({
      setup() {
        source = useSchemaSourceOptions({
          field: () => ({ key: 'id', label: 'ID', type: 'enum', source: 'csv:weapons.id' }),
          value: () => '',
          runtimeContext: () => context.value,
        });
        return () => null;
      },
    });
    await flushPromises();
    expect(source.sourceOptions.value[0]?.children?.[0]?.value).toBe('a');
    query.mockRejectedValueOnce(new Error('query failed'));
    context.value = { ...context.value, sessionId: 's2', modRoot: 'M:/B' };
    await flushPromises();
    expect(source.sourceOptions.value).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    await source.reloadSourceOptions();
    expect(source.sourceOptions.value[0]?.children?.[0]?.value).toBe('a');
    wrapper.unmount();
  });
});
