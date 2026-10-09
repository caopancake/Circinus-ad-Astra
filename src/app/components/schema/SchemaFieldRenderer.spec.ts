import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldSchema } from '@/domain/schema/schema.types';
import { initializeSettingsStore } from '@/stores/settings.store';
import SchemaFieldRenderer from './SchemaFieldRenderer.vue';
import { editorUiStubs } from '@/test/ui-stubs';
import { nSelect } from '@/test/ui-stubs';
import { h, nextTick, ref } from 'vue';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { applySchemaFieldUpdate } from '@/domain/schema/schema-values';

const mocks = vi.hoisted(() => ({
  queryCoreFields: vi.fn(async () => ({})),
  queryCoreGraphics: vi.fn(async () => ['graphics/one.png', 'graphics/two.png']),
}));

vi.mock('@/services/core-assets.service', () => ({
  queryCoreFields: mocks.queryCoreFields,
  queryCoreGraphics: mocks.queryCoreGraphics,
}));

vi.mock('@/services/app-log.service', () => ({
  recordLogBestEffort: vi.fn(),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  }),
}));

const SETTINGS = {
  theme: 'light',
  accent: 'blue',
  customAccent: '#3388cc',
  historyLimit: 20,
  editMode: 'smart',
  starsectorRoot: null,
  logDirectory: null,
  logLevel: 'info',
} as const;

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function fieldFixture(type: FieldSchema['type'], extra: Partial<FieldSchema> = {}): FieldSchema {
  return { key: 'field', type, label: 'Field', ...extra };
}

function mountField(field: FieldSchema, value: unknown, props: Record<string, unknown> = {}) {
  wrapper = mount(SchemaFieldRenderer, {
    props: { field, value, runtimeContext: null, ...props },
    global: { stubs: editorUiStubs },
  });
  return wrapper!;
}

describe('SchemaFieldRenderer smart mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({ ...SETTINGS });
  });

  it('preserves object-array input nodes and focus across cloned drafts', async () => {
    wrapper = mount(
      {
        setup() {
          const draft = useEditTargetDraftSession({
            emptyValue: [{ name: 'A' }, { name: 'B' }],
            load: () => ({ target: 'one', baseVersions: [], meta: null, value: [] as { name: string }[] }),
            targetKey: (id: string) => id,
          });
          return () =>
            h(SchemaFieldRenderer, {
              field: fieldFixture('array-of-object', { nested: [{ key: 'name', type: 'string', label: 'Name' }] }),
              value: draft.draftValue.value,
              onUpdate: (value) => {
                if (value.kind === 'set') draft.draftValue.value = value.value as { name: string }[];
              },
            });
        },
      },
      { global: { stubs: editorUiStubs }, attachTo: document.body },
    );
    const first = wrapper.get('input');
    first.element.focus();
    await first.setValue('AX');
    expect(wrapper.get('input').element).toBe(first.element);
    expect(document.activeElement).toBe(first.element);
    expect(wrapper.findAll('.array-item')).toHaveLength(2);
  });

  it('keeps key-value expansion attached to the surviving row', async () => {
    const values = ref({ A: 'a', B: 'b', C: 'c' });
    wrapper = mount(
      {
        setup: () => () =>
          h(SchemaFieldRenderer, {
            field: fieldFixture('key-value'),
            value: values.value,
            onUpdate: (value) => {
              if (value.kind === 'set') values.value = value.value as typeof values.value;
            },
          }),
      },
      { global: { stubs: editorUiStubs } },
    );
    wrapper.findAllComponents(nSelect)[1]!.vm.$emit('update:show', true);
    await nextTick();
    await wrapper.findAll('.kv-row')[0]!.get('button').trigger('click');
    const selects = wrapper.findAllComponents(nSelect);
    expect(selects.map((select) => select.props('value'))).toEqual(['B', 'C']);
    expect(selects[0]!.props('show')).toBe(true);
    expect(selects[1]!.props('show')).toBeUndefined();
  });

  it('renders strings as a single-line input and emits text', async () => {
    const field = mountField(fieldFixture('string'), 'hello');
    const input = field.get('input');
    expect((input.element as HTMLInputElement).value).toBe('hello');
    await input.setValue('world');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 'world' }]);
  });

  it('emits typed numbers for integer and float fields', async () => {
    const integer = mountField(fieldFixture('integer'), 3);
    await integer.get('input').setValue('9');
    expect(integer.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 9 }]);

    const float = mountField(fieldFixture('float'), 0.5);
    await float.get('input').setValue('1.5');
    expect(float.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 1.5 }]);
  });

  it('toggles boolean fields through the switch stub', async () => {
    const field = mountField(fieldFixture('boolean'), false);
    await field.get('.n-switch-stub').trigger('click');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: true }]);
  });

  it('renders enum options and emits the selected value', async () => {
    const field = mountField(fieldFixture('enum', { options: ['A', 'B'] }), 'A');
    const select = field.get('select');
    const options = select.findAll('option');
    expect(options.map((option) => option.text())).toEqual(['A', 'B']);
    await select.setValue(JSON.stringify('B'));
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 'B' }]);
  });

  it('renders string arrays as a multi picker in smart mode', () => {
    const field = mountField(fieldFixture('string-array'), ['a', 'b']);
    expect(field.find('select').exists()).toBe(true);
  });

  it('keeps boolean-like plain values for text fields', async () => {
    const field = mountField(fieldFixture('text'), 'multi\nline');
    expect(field.get('textarea')).toBeTruthy();
    await field.get('textarea').setValue('changed');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 'changed' }]);
  });

  it('renders path and color fields as raw inputs', async () => {
    const path = mountField(fieldFixture('path'), 'graphics/x.png');
    await path.get('input').setValue('graphics/y.png');
    expect(path.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 'graphics/y.png' }]);

    // Smart mode renders color fields through the ColorPicker text input.
    const color = mountField(fieldFixture('color-rgba'), [255, 0, 0, 255]);
    const colorInput = color.get('.color-picker-text-input');
    expect((colorInput.element as HTMLInputElement).value).toBe('255,0,0,255');
    await colorInput.setValue('[1, 2, 3, 4]');
    await colorInput.trigger('keyup.enter');
    expect(color.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: [1, 2, 3, 4] }]);
  });

  it('disables fields flagged as read-only', () => {
    const field = mountField(fieldFixture('string', { editable: false }), 'fixed');
    expect(field.get('input').attributes('disabled')).toBeDefined();
  });
});

describe('SchemaFieldRenderer plain mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({ ...SETTINGS, editMode: 'plain' });
  });

  it('renders enums as plain text inputs without options', async () => {
    const field = mountField(fieldFixture('enum', { options: ['A'] }), 'A');
    const input = field.get('input');
    expect((input.element as HTMLInputElement).value).toBe('A');
    await input.setValue('B');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 'B' }]);
  });

  it('joins string arrays into a comma list and splits input back', async () => {
    const field = mountField(fieldFixture('string-array'), ['a', 'b']);
    expect((field.get('input').element as HTMLInputElement).value).toBe('a, b');
    await field.get('input').setValue('x, y');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: ['x', 'y'] }]);
  });

  it('wraps tag selections into the game tag format', async () => {
    const field = mountField(fieldFixture('tag-select'), ['tag1']);
    expect((field.get('input').element as HTMLInputElement).value).toBe('tag1');
    await field.get('input').setValue('tag2, tag3');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: ['tag2', 'tag3'] }]);
  });

  it('emits raw numbers without number controls in plain mode', async () => {
    const field = mountField(fieldFixture('integer'), 4);
    await field.get('input').setValue('12');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 12 }]);
  });

  it('keeps incomplete scalar text outside the typed draft and removes optional keys on commit', async () => {
    let session!: ReturnType<typeof useEditTargetDraftSession<Record<string, import('@/shared/types').JsonValue>, string, null>>;
    const save = vi.fn(async (_target: string, value: Record<string, import('@/shared/types').JsonValue>) => ({
      target: 'one',
      baseVersions: [],
      meta: null,
      value,
    }));
    wrapper = mount(
      {
        setup() {
          session = useEditTargetDraftSession({
            emptyValue: {},
            load: () => ({ target: 'one', baseVersions: [], meta: null, value: { count: 4 } }),
            save,
            targetKey: (key: string) => key,
          });
          return () =>
            h(SchemaFieldRenderer, {
              field: fieldFixture('integer', { key: 'count' }),
              value: session.draftValue.value.count,
              onUpdate: (update) => session.setDraft(applySchemaFieldUpdate(session.draftValue.value, 'count', update)),
            });
        },
      },
      { global: { stubs: editorUiStubs }, attachTo: document.body },
    );
    await session.loadTarget('one');
    await wrapper.get('input').setValue('-');
    expect(session.draftValue.value.count).toBe(4);
    expect(session.dirty.value).toBe(true);
    await expect(session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(document.activeElement).toBe(wrapper.get('input').element);
    await wrapper.get('input').setValue('');
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', {}, []);
  });
});
