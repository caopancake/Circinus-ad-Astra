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
});
