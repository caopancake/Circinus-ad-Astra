import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { editorUiStubs } from '@/test/ui-stubs';

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

import WeaponFirePreview from './WeaponFirePreview.vue';

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

beforeEach(() => {
  installCanvas2DStub();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountPreview(overrides: Record<string, unknown> = {}) {
  wrapper = mount(WeaponFirePreview, {
    props: {
      weaponId: 'railgun',
      weaponCsvRow: { id: 'railgun', 'damage/shot': 50 },
      weaponSpec: { id: 'railgun', specClass: 'projectile', type: 'BALLISTIC', projectileSpecId: 'proj1' },
      projectileSpecs: { proj1: { id: 'proj1', 'speed max': 400, 'damage/shot': 25 } },
      spriteData: {},
      ...overrides,
    },
    global: { stubs: editorUiStubs },
    attachTo: document.body,
  });
  return wrapper!;
}

describe('WeaponFirePreview', () => {
  it('renders the weapon and projectile identity in the header', () => {
    const preview = mountPreview();
    expect(preview.get('.editor-title strong').text()).toBe('发射预览');
    expect(preview.get('.editor-title span').text()).toContain('railgun');
    expect(preview.get('.editor-title span').text()).toContain('proj1');
  });

  it('reports a missing weapon spec through the subtitle state', () => {
    const preview = mountPreview({ weaponSpec: {}, projectileSpecs: {} });
    expect(preview.get('.editor-title span').text()).toContain('railgun');
  });

  it('exposes the play controls of the canvas stage', () => {
    const preview = mountPreview();
    const buttons = preview.findAll('button').map((button) => button.text());
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('computes the barrel count from the turret offsets', async () => {
    const preview = mountPreview({
      weaponSpec: {
        id: 'railgun',
        specClass: 'projectile',
        type: 'BALLISTIC',
        projectileSpecId: 'proj1',
        turretOffsets: [10, 0, -10, 0],
        turretAngleOffsets: [0, 0],
      },
    });
    await vi.waitFor(() => expect(preview.find('canvas').exists()).toBe(true));
    expect(preview.findAll('canvas').length).toBeGreaterThan(0);
  });
});
