import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createNewModProject: vi.fn(),
  openCreatedModTarget: vi.fn(),
}));

vi.mock('@/services/mod-creation.service', () => ({
  createNewModProject: mocks.createNewModProject,
}));

vi.mock('@/orchestrators/directory-opening.orchestrator', () => ({
  openCreatedModTarget: mocks.openCreatedModTarget,
}));

vi.mock('@/services/app-feedback-log.service', () => ({
  recordLogBestEffort: vi.fn(),
}));

import { createModProject, openCreatedModProject } from './mod-creation.orchestrator';

const createdFixture = { modRoot: 'C:/games/mods/new_mod', starsectorRoot: 'D:/games/starsector' };
const requestFixture = {
  destination: { kind: 'game-mods' as const, starsectorRoot: 'D:/games/starsector' },
  template: { id: 'new_mod', name: 'New Mod', version: '1.0.0', gameVersion: '0.97a' },
};

describe('createModProject', () => {
  it('creates the mod through the service and returns the result', async () => {
    mocks.createNewModProject.mockResolvedValue(createdFixture);
    await expect(createModProject(requestFixture)).resolves.toEqual(createdFixture);
    expect(mocks.createNewModProject).toHaveBeenCalledWith(requestFixture);
  });

  it('propagates creation failures', async () => {
    mocks.createNewModProject.mockRejectedValue(new Error('target exists'));
    await expect(createModProject(requestFixture)).rejects.toThrow('target exists');
  });
});

describe('openCreatedModProject', () => {
  it('returns the opened mod name and warnings', async () => {
    mocks.openCreatedModTarget.mockResolvedValue({ type: 'mod-loaded', modName: 'New Mod', warnings: ['warn a'] });
    await expect(openCreatedModProject(createdFixture)).resolves.toEqual({ modName: 'New Mod', warnings: ['warn a'] });
  });

  it('rejects an already-loaded outcome as an invalid create result', async () => {
    mocks.openCreatedModTarget.mockResolvedValue({ type: 'already-loaded', modName: 'New Mod' });
    await expect(openCreatedModProject(createdFixture)).rejects.toMatchObject({ action: 'open-created-mod' });
  });

  it('rejects an unknown outcome with its message', async () => {
    mocks.openCreatedModTarget.mockResolvedValue({ type: 'unknown', message: 'unreadable' });
    await expect(openCreatedModProject(createdFixture)).rejects.toThrow('unreadable');
  });

  it('rejects unexpected outcome shapes', async () => {
    mocks.openCreatedModTarget.mockResolvedValue({ type: 'game-overview', availableModCount: 0, root: '', warnings: [] });
    await expect(openCreatedModProject(createdFixture)).rejects.toMatchObject({ action: 'open-created-mod' });
  });
});
