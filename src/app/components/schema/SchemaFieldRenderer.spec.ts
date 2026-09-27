import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldSchema } from '@/domain/schema/schema.types';
import { initializeSettingsStore } from '@/stores/settings.store';
import SchemaFieldRenderer from './SchemaFieldRenderer.vue';
import { editorUiStubs } from '@/test/ui-stubs';

const mocks = vi.hoisted(() => ({
  queryCoreFields: vi.fn(async () => ({})),
  queryCoreGraphics: vi.fn(async () => ['graphics/one.png', 'graphics/two.png']),
}));

vi.mock('@/services/assets.service', () => ({
  queryCoreFields: mocks.queryCoreFields,
  queryCoreGraphics: mocks.queryCoreGraphics,
}));

vi.mock('@/services/app-feedback-log.service', () => ({
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

  it('renders strings as a single-line input and emits text', async () => {
    const field = mountField(fieldFixture('string'), 'hello');
    const input = field.get('input');
    expect((input.element as HTMLInputElement).value).toBe('hello');
    await input.setValue('world');
    expect(field.emitted('update')?.at(-1)).toEqual(['world']);
  });

  it('emits typed numbers for integer and float fields', async () => {
    const integer = mountField(fieldFixture('integer'), 3);
    await integer.get('input').setValue('9');
    expect(integer.emitted('update')?.at(-1)).toEqual([9]);

    const float = mountField(fieldFixture('float'), 0.5);
    await float.get('input').setValue('1.5');
    expect(float.emitted('update')?.at(-1)).toEqual([1.5]);
  });

  it('toggles boolean fields through the switch stub', async () => {
    const field = mountField(fieldFixture('boolean'), false);
    await field.get('.n-switch-stub').trigger('click');
    expect(field.emitted('update')?.at(-1)).toEqual([true]);
  });

  it('renders enum options and emits the selected value', async () => {
    const field = mountField(fieldFixture('enum', { options: ['A', 'B'] }), 'A');
    const select = field.get('select');
    const options = select.findAll('option');
    expect(options.map((option) => option.text())).toEqual(['A', 'B']);
    await select.setValue(JSON.stringify('B'));
    expect(field.emitted('update')?.at(-1)).toEqual(['B']);
  });

  it('renders string arrays as a multi picker in smart mode', () => {
    const field = mountField(fieldFixture('string-array'), ['a', 'b']);
    expect(field.find('select').exists()).toBe(true);
  });

  it('keeps boolean-like plain values for text fields', async () => {
    const field = mountField(fieldFixture('text'), 'multi\nline');
    expect(field.get('textarea')).toBeTruthy();
    await field.get('textarea').setValue('changed');
    expect(field.emitted('update')?.at(-1)).toEqual(['changed']);
  });

  it('renders path and color fields as raw inputs', async () => {
    const path = mountField(fieldFixture('path'), 'graphics/x.png');
    await path.get('input').setValue('graphics/y.png');
    expect(path.emitted('update')?.at(-1)).toEqual(['graphics/y.png']);

    // Smart mode renders color fields through the ColorPicker text input.
    const color = mountField(fieldFixture('color-rgba'), [255, 0, 0, 255]);
    const colorInput = color.get('.color-picker-text-input');
    expect((colorInput.element as HTMLInputElement).value).toBe('255,0,0,255');
    await colorInput.setValue('[1, 2, 3, 4]');
    await colorInput.trigger('keyup.enter');
    expect(color.emitted('update')?.at(-1)).toEqual([[1, 2, 3, 4]]);
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
    expect(field.emitted('update')?.at(-1)).toEqual(['B']);
  });

  it('joins string arrays into a comma list and splits input back', async () => {
    const field = mountField(fieldFixture('string-array'), ['a', 'b']);
    expect((field.get('input').element as HTMLInputElement).value).toBe('a, b');
    await field.get('input').setValue('x, y');
    expect(field.emitted('update')?.at(-1)).toEqual([['x', 'y']]);
  });

  it('wraps tag selections into the game tag format', async () => {
    const field = mountField(fieldFixture('tag-select'), ['tag1']);
    expect((field.get('input').element as HTMLInputElement).value).toBe('tag1');
    await field.get('input').setValue('tag2, tag3');
    expect(field.emitted('update')?.at(-1)).toEqual([['tag2', 'tag3']]);
  });

  it('emits raw numbers without number controls in plain mode', async () => {
    const field = mountField(fieldFixture('integer'), 4);
    await field.get('input').setValue('12');
    expect(field.emitted('update')?.at(-1)).toEqual([12]);
  });
});
