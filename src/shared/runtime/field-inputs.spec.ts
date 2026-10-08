import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { createFieldInputs, type FieldInput } from './field-inputs';

function field(key: string, commit: FieldInput['commit']): FieldInput {
  return { key, label: key, dirty: ref(true), commit, focus: vi.fn(), cancel: vi.fn() };
}

describe('target field input lifecycle', () => {
  it('commits in registration order and waits for consumer projections', async () => {
    const inputs = createFieldInputs(ref('one'));
    const projection = ref('base');
    const observed: string[] = [];
    inputs.register(
      field('first', () => {
        projection.value = 'first';
        return null;
      }),
    );
    inputs.register(
      field('second', () => {
        observed.push(projection.value);
        return null;
      }),
    );
    await inputs.commit();
    expect(observed).toEqual(['first']);
  });

  it('preserves successful fields and focuses the first rejected field', async () => {
    const inputs = createFieldInputs(ref('one'));
    const first = field(
      'first',
      vi.fn(() => null),
    );
    const second = field(
      'second',
      vi.fn(() => '请输入 JSON 对象'),
    );
    const third = field(
      'third',
      vi.fn(() => null),
    );
    [first, second, third].forEach(inputs.register);
    await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs', message: 'second：请输入 JSON 对象' });
    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(second.focus).toHaveBeenCalledTimes(1);
    expect(third.commit).not.toHaveBeenCalled();
  });

  it('revokes pending acceptance when the edit target changes', async () => {
    const target = ref('one');
    const inputs = createFieldInputs(target);
    const later = field(
      'later',
      vi.fn(() => null),
    );
    inputs.register(
      field('first', () => {
        target.value = 'two';
        return null;
      }),
    );
    inputs.register(later);
    await inputs.commit();
    expect(later.commit).not.toHaveBeenCalled();
  });

  it('cancels only the removed field subtree and releases registrations', async () => {
    const inputs = createFieldInputs();
    const nested = field('array/row/field', () => null);
    const other = field('array/another/field', () => null);
    const unregister = inputs.register(nested);
    inputs.register(other);
    inputs.cancel('array/row');
    expect(nested.cancel).toHaveBeenCalledTimes(1);
    expect(other.cancel).not.toHaveBeenCalled();
    unregister();
    await nextTick();
    inputs.release();
    expect(inputs.dirty.value).toBe(false);
    expect(inputs.commit()).toBeUndefined();
  });
});
