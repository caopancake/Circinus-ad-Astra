import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RowData } from '@/shared/types';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { editorUiStubs } from '@/test/ui-stubs';

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

vi.mock('@/shared/runtime/dialog.runtime', () => ({
  pickImageFileDialog: vi.fn(async () => null),
  pickFileDialog: vi.fn(async () => null),
  pickDirectoryDialog: vi.fn(async () => null),
}));

import WeaponEditor from './WeaponEditor.vue';

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function mountEditor(weapon: RowData) {
  wrapper = mount(WeaponEditor, {
    props: {
      modRoot: 'M:/mod',
      sessionId: 'sess-1',
      weaponId: 'railgun',
      weapon,
      spriteData: {},
      projectileOptions: [{ label: 'proj1', value: 'proj1' }],
      draftRevision: 0,
      dirty: false,
      canSave: false,
      saving: false,
      externalUpdateNotice: '',
    },
    global: { stubs: editorUiStubs },
    attachTo: document.body,
  });
  return wrapper!;
}

describe('WeaponEditor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    installCanvas2DStub();
  });

  it('renders the editor shell with close and save actions', () => {
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile', type: 'BALLISTIC' });
    const buttons = editor.findAll('button').map((button) => button.text());
    expect(buttons).toContain('关闭');
    expect(buttons).toContain('保存');
  });

  it('switches the weapon type through the type select', async () => {
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile', type: 'BALLISTIC' });
    const selects = editor.findAll('select');
    const typeSelect = selects.find((select) => select.findAll('option').some((option) => option.text() === 'ENERGY'));
    expect(typeSelect).toBeTruthy();
    await typeSelect!.setValue(JSON.stringify('ENERGY'));
    const last = editor.emitted('draft-changed')?.at(-1)?.[0] as Record<string, unknown>;
    expect(last.type).toBe('ENERGY');
  });

  it('renders the weapon canvas and barrel structure for projectile weapons', () => {
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile', type: 'BALLISTIC' });
    expect(editor.find('canvas.editor-canvas').exists()).toBe(true);
  });

  it('shows the beam color fields for beam specs', () => {
    const editor = mountEditor({ id: 'laser', specClass: 'beam', type: 'ENERGY', 'beam speed': 1 });
    expect(editor.html()).toContain('fringeColor');
  });
});
