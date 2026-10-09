import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, type EffectScope } from 'vue';

const mocks = vi.hoisted(() => ({
  pickImageFileDialog: vi.fn(async () => null as string | null),
  resolveModImageReference: vi.fn(async () => '' as string),
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

vi.mock('@/shared/runtime/dialog.runtime', () => ({
  pickImageFileDialog: mocks.pickImageFileDialog,
}));

vi.mock('@/services/resource-reference.service', () => ({
  resolveModImageReference: mocks.resolveModImageReference,
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

import { useResourceReference } from './use-resource-reference';
let scope: EffectScope;
beforeEach(() => {
  scope = effectScope();
});
afterEach(() => scope.stop());
function createReference() {
  return scope.run(useResourceReference)!;
}

function referenceOptions() {
  return { sessionId: 's1', modRoot: 'C:/mods/alpha', title: '选择舰船贴图', accepts: () => true };
}

describe('useResourceReference.pickModImageReference', () => {
  it('returns null when the dialog is cancelled', async () => {
    mocks.pickImageFileDialog.mockResolvedValue(null);
    const { pickModImageReference } = createReference();
    await expect(pickModImageReference(referenceOptions())).resolves.toBeNull();
    expect(mocks.pickImageFileDialog).toHaveBeenCalledWith({ defaultPath: 'C:/mods/alpha', title: '选择舰船贴图' });
    expect(mocks.resolveModImageReference).not.toHaveBeenCalled();
  });

  it('resolves the picked file into a mod-relative reference', async () => {
    mocks.pickImageFileDialog.mockResolvedValue('C:/mods/alpha/graphics/ship.png');
    mocks.resolveModImageReference.mockResolvedValue('graphics/ship.png');
    const { pickModImageReference } = createReference();
    await expect(pickModImageReference(referenceOptions())).resolves.toBe('graphics/ship.png');
    expect(mocks.resolveModImageReference).toHaveBeenCalledWith(
      's1',
      'C:/mods/alpha',
      'C:/mods/alpha/graphics/ship.png',
      expect.any(AbortSignal),
    );
  });

  it('reports resolution failures and returns null', async () => {
    mocks.pickImageFileDialog.mockResolvedValue('C:/outside/ship.png');
    mocks.resolveModImageReference.mockRejectedValue(new Error('outside mod root'));
    const { pickModImageReference } = createReference();
    await expect(pickModImageReference(referenceOptions())).resolves.toBeNull();
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default dialog title', async () => {
    mocks.pickImageFileDialog.mockResolvedValue(null);
    const { pickModImageReference } = createReference();
    await pickModImageReference({ sessionId: 's1', modRoot: 'C:/mods/alpha', accepts: () => true });
    expect(mocks.pickImageFileDialog).toHaveBeenCalledWith({ defaultPath: 'C:/mods/alpha', title: '选择贴图文件' });
  });

  it.each(['resolve', 'reject'] as const)('revokes a pending resource %s without a late update or feedback', async (completion) => {
    mocks.pickImageFileDialog.mockResolvedValueOnce('C:/mods/alpha/graphics/image.png');
    let release!: (path: string) => void;
    let reject!: (error: Error) => void;
    let current = true;
    mocks.resolveModImageReference.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          release = yes;
          reject = no;
        }),
    );
    const pending = createReference().pickModImageReference({ ...referenceOptions(), accepts: () => current });
    await Promise.resolve();
    current = false;
    if (completion === 'resolve') release('graphics/image.png');
    else reject(new Error('obsolete'));
    expect(await pending).toBeNull();
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });
});
