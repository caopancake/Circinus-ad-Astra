import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { RowData } from '@/shared/types';
import { useObjectField } from './use-object-field';

describe('useObjectField', () => {
  it('reads object fields with an empty object fallback', () => {
    const target = ref<RowData>({ known: { a: 1 }, broken: 'text' });
    const field = useObjectField(target);
    expect(field.objectField('known')).toEqual({ a: 1 });
    expect(field.objectField('broken')).toEqual({});
    expect(field.objectField('missing')).toEqual({});
    expect(field.objectField('list')).toEqual({});
  });

  it('binds a writable computed that commits through the hook', () => {
    const target = ref<RowData>({});
    const committed: number[] = [];
    const field = useObjectField(target, { onCommit: () => committed.push(committed.length) });
    const binding = field.bindObjectField('spec');
    binding.value = { x: 1 };
    expect(target.value.spec).toEqual({ x: 1 });
    expect(committed).toHaveLength(1);
    expect(binding.value).toEqual({ x: 1 });
  });
});
