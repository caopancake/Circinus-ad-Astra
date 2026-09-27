import { describe, expect, it, vi } from 'vitest';

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

function referenceOptions() {
  return { sessionId: 's1', modRoot: 'C:/mods/alpha', title: '选择舰船贴图' };
}

describe('useResourceReference.pickModImageReference', () => {
  it('returns null when the dialog is cancelled', async () => {
    mocks.pickImageFileDialog.mockResolvedValue(null);
    const { pickModImageReference } = useResourceReference();
    await expect(pickModImageReference(referenceOptions())).resolves.toBeNull();
    expect(mocks.pickImageFileDialog).toHaveBeenCalledWith({ defaultPath: 'C:/mods/alpha', title: '选择舰船贴图' });
    expect(mocks.resolveModImageReference).not.toHaveBeenCalled();
  });

  it('resolves the picked file into a mod-relative reference', async () => {
    mocks.pickImageFileDialog.mockResolvedValue('C:/mods/alpha/graphics/ship.png');
    mocks.resolveModImageReference.mockResolvedValue('graphics/ship.png');
    const { pickModImageReference } = useResourceReference();
    await expect(pickModImageReference(referenceOptions())).resolves.toBe('graphics/ship.png');
    expect(mocks.resolveModImageReference).toHaveBeenCalledWith('s1', 'C:/mods/alpha', 'C:/mods/alpha/graphics/ship.png');
  });

  it('reports resolution failures and returns null', async () => {
    mocks.pickImageFileDialog.mockResolvedValue('C:/outside/ship.png');
    mocks.resolveModImageReference.mockRejectedValue(new Error('outside mod root'));
    const { pickModImageReference } = useResourceReference();
    await expect(pickModImageReference(referenceOptions())).resolves.toBeNull();
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default dialog title', async () => {
    mocks.pickImageFileDialog.mockResolvedValue(null);
    const { pickModImageReference } = useResourceReference();
    await pickModImageReference({ sessionId: 's1', modRoot: 'C:/mods/alpha' });
    expect(mocks.pickImageFileDialog).toHaveBeenCalledWith({ defaultPath: 'C:/mods/alpha', title: '选择贴图文件' });
  });
});
