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

import ProjectileEditor from './ProjectileEditor.vue';

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function mountEditor(projectile: RowData) {
  wrapper = mount(ProjectileEditor, {
    props: {
      modRoot: 'M:/mod',
      sessionId: 'sess-1',
      projectileId: 'proj1',
      projectile,
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

describe('ProjectileEditor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    installCanvas2DStub();
  });

  it('renders the editor shell with close and save actions', async () => {
    const editor = mountEditor({ id: 'proj1', specClass: 'projectile' });
    const buttons = editor.findAll('button').map((button) => button.text());
    expect(buttons).toContain('关闭');
    expect(buttons).toContain('保存');
  });

  it('switches the spec class branch through the select', async () => {
    const editor = mountEditor({ id: 'proj1', specClass: 'projectile' });
    const selects = editor.findAll('select');
    await selects[0]!.setValue(JSON.stringify('missile'));
    await nextTick();
    const last = editor.emitted('draft-changed')?.at(-1)?.[0] as Record<string, unknown>;
    expect(last.specClass).toBe('missile');
  });

  it('hides projectile-only sections for missiles', async () => {
    const editor = mountEditor({ id: 'proj1', specClass: 'missile' });
    expect(editor.html()).not.toContain('弹体外观');
  });

  it('adds game-loadable engines with unique ids after deletion', async () => {
    const editor = mountEditor({
      id: 'proj1',
      specClass: 'missile',
      engineSlots: [
        { id: 'ES1', loc: [1, 2] },
        { id: 'ES3', loc: [3, 4] },
      ],
    });
    await editor
      .findAll('button')
      .find((button) => button.text() === '添加引擎槽')!
      .trigger('click');
    const draft = editor.emitted('draft-changed')!.at(-1)![0] as RowData;
    const slots = draft.engineSlots as RowData[];
    expect(slots.map((slot) => slot.id)).toEqual(['ES1', 'ES3', 'ES2']);
    expect(slots[2]).toMatchObject({ id: 'ES2', loc: [0, 0], angle: 180, width: 8, length: 20, style: 'CUSTOM' });
    expect(slots[2]!.styleSpec).toMatchObject({
      mode: 'QUAD_STRIP',
      engineColor: [255, 145, 75, 255],
      contrailColor: [100, 100, 100, 150],
      contrailDuration: 0.5,
      contrailWidthMult: 2,
      contrailMaxSpeedMult: 0,
      contrailAngularVelocityMult: 0.5,
      type: 'SMOKE',
    });
  });

  it('offers the game projectile spawn enum', () => {
    const editor = mountEditor({ id: 'proj1', specClass: 'projectile' });
    const options = editor
      .findAll('select')[1]!
      .findAll('option')
      .map((option) => option.text());
    expect(options).toEqual(['BEAM', 'BALLISTIC_AS_BEAM', 'BALLISTIC', 'PLASMA', 'MISSILE', 'OTHER']);
  });

  it('offers both phase missile types accepted by the game', () => {
    const editor = mountEditor({ id: 'proj1', specClass: 'missile' });
    const options = editor
      .findAll('select')[1]!
      .findAll('option')
      .map((option) => option.text());
    expect(options).toContain('PHASE_CHARGE');
    expect(options).toContain('PHASE_MINE');
    expect(options).toHaveLength(17);
  });
});
