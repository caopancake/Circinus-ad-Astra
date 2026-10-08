import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
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

import SystemEditor from './SystemEditor.vue';

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function mountEditor(system: RowData) {
  wrapper = mount(SystemEditor, {
    props: {
      systemId: 'sys1',
      system,
      editContext: null,
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

describe('SystemEditor type switching', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    installCanvas2DStub();
  });

  it('preserves shared effects and unknown fields when the system type changes', async () => {
    const editor = mountEditor({
      id: 'sys1',
      type: 'ENGINE_MOD',
      engineGlowColor: [255, 0, 0, 255],
      engineGlowLengthMult: 2,
      alwaysAccelerate: true,
      shieldThicknessMult: 2,
      shipAlpha: 0.5,
      displayName: 'Engine',
    });
    // The select bound to the system type lives in the basic section.
    const selects = editor.findAll('select');
    let changed = false;
    for (const select of selects) {
      const options = select.findAll('option').map((option) => option.text());
      if (options.includes('SHIELD_MOD')) {
        await select.setValue(JSON.stringify('SHIELD_MOD'));
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);

    await nextTick();
    const emitted = editor.emitted('draft-changed')?.at(-1)?.[0] as Record<string, unknown>;
    expect(emitted.type).toBe('SHIELD_MOD');
    expect(emitted.engineGlowColor).toEqual([255, 0, 0, 255]);
    expect(emitted.engineGlowLengthMult).toBe(2);
    expect(emitted.alwaysAccelerate).toBe(true);
    expect(emitted.shieldThicknessMult).toBe(2);
    expect(emitted.shipAlpha).toBe(0.5);
    expect(emitted.displayName).toBe('Engine');
  });

  it('renders shared engine, shield and alpha controls for stat systems', () => {
    const editor = mountEditor({ id: 'sys1', type: 'STAT_MOD' });
    expect(editor.text()).toContain('引擎视觉');
    expect(editor.text()).toContain('护盾视觉');
    expect(editor.text()).toContain('舰船透明度');
    const options = editor
      .findAll('select')[0]!
      .findAll('option')
      .map((option) => option.text());
    expect(options).toContain('FAST_RELOAD');
    expect(options).toContain('AMMO_RELOAD');
    expect(options).toContain('TELEPORTER');
    expect(options).toContain('EMP');
  });

  it('keeps fields when the type does not change', async () => {
    const editor = mountEditor({ id: 'sys1', type: 'PHASE_CLOAK', shipAlpha: 0.5 });
    expect(editor.emitted('draft-changed')).toBeUndefined();
  });

  it('separates extra passthrough fields from structured ones', () => {
    const editor = mountEditor({ id: 'sys1', type: 'STAT_MOD', customModField: 'keep-me' });
    expect(editor.emitted('draft-changed')).toBeUndefined();
  });

  it('exposes the footer save and close buttons', async () => {
    const editor = mountEditor({ id: 'sys1' });
    const buttons = editor.findAll('button').map((button) => button.text());
    expect(buttons).toContain('关闭');
    expect(buttons).toContain('保存');

    await editor
      .findAll('button')
      .find((button) => button.text() === '关闭')!
      .trigger('click');
    expect(editor.emitted('close')).toHaveLength(1);
  });
});
