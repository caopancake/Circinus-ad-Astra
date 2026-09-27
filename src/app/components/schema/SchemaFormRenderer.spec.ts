import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import type { RowData } from '@/shared/types';
import type { FileSchema } from '@/domain/schema/schema.types';
import SchemaFormRenderer from './SchemaFormRenderer.vue';
import { editorUiStubs } from '@/test/ui-stubs';

const schema: FileSchema = {
  $schema: 'starsector-devtool/field-schema/v1',
  id: 'fixture',
  sections: [
    { id: 'main', label: '主要', fields: [{ key: 'name', type: 'string', label: '名称' }] },
    { id: 'extra-section', label: '次要', collapsed: true, fields: [{ key: 'level', type: 'integer', label: '等级' }] },
  ],
};

function mountForm(modelValue: RowData) {
  return mount(SchemaFormRenderer, {
    props: { schema, modelValue },
    global: {
      stubs: {
        ...editorUiStubs,
        SchemaFieldRenderer: {
          name: 'SchemaFieldRenderer',
          props: ['field', 'value'],
          emits: ['update'],
          template: '<div class="field-stub" @click="$emit(\'update\', $event)" />',
        },
        JsonFieldEditor: {
          name: 'JsonFieldEditor',
          props: ['knownKeys', 'modelValue'],
          emits: ['update:modelValue'],
          template: '<div class="json-stub" />',
        },
      },
    },
  });
}

describe('SchemaFormRenderer', () => {
  it('renders one block per schema section plus the extra fields section', () => {
    const form = mountForm({ name: 'a', level: 1 });
    expect(form.findAll('.schema-section')).toHaveLength(2);
    expect(form.findAll('.field-stub')).toHaveLength(2);
    expect(form.find('.json-stub').exists()).toBe(false);
  });

  it('toggles section collapse on header clicks', async () => {
    const form = mountForm({});
    const headers = form.findAll('.section-header');
    expect(headers[1]!.find('.collapsed').exists()).toBe(true);
    await headers[1]!.trigger('click');
    expect(headers[1]!.find('.collapsed').exists()).toBe(false);
    await headers[1]!.trigger('click');
    expect(headers[1]!.find('.collapsed').exists()).toBe(true);
  });

  it('writes field updates back into the model with dotted paths', async () => {
    const form = mountForm({ name: 'a' });
    const fields = form.findAllComponents({ name: 'SchemaFieldRenderer' });
    fields[0]!.vm.$emit('update', 'renamed');
    await nextTick();
    expect(form.emitted('update:modelValue')?.at(-1)).toEqual([{ name: 'renamed' }]);
  });

  it('renders extra keys through the JSON editor and writes them back', async () => {
    const form = mountForm({ name: 'a', bonus: 5 });
    const json = form.findComponent({ name: 'JsonFieldEditor' });
    expect(json.exists()).toBe(true);
    // Non multi-source schemas hand the whole model to the JSON editor.
    expect(json.props('modelValue')).toEqual({ name: 'a', bonus: 5 });
    expect(json.props('knownKeys')).toEqual(['name', 'level']);

    json.vm.$emit('update:modelValue', { bonus: 7 });
    await nextTick();
    // Non multi-source schemas replace the whole model with the JSON editor value.
    expect(form.emitted('update:modelValue')?.at(-1)).toEqual([{ bonus: 7 }]);
  });
});
