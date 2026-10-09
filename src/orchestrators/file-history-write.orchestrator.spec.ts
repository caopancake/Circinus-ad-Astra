import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { savedWriteFixture } from '@/test/write-result';
const mocks = vi.hoisted(() => ({ publishCommittedWrite: vi.fn(), recordLogBestEffort: vi.fn() }));
vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({ publishCommittedWrite: mocks.publishCommittedWrite }));
vi.mock('@/services/app-feedback-log.service', () => ({ recordLogBestEffort: mocks.recordLogBestEffort }));
import { completeSavedWrite } from './file-history-write.orchestrator';
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mocks.publishCommittedWrite.mockResolvedValue(undefined);
});
describe('saved write completion', () => {
  it('submits the complete persisted receipt to the sole synchronization owner', async () => {
    const receipt = savedWriteFixture();
    await completeSavedWrite({ modRoot: 'M:/mod', sessionId: 's1', result: receipt, label: 'saved' });
    expect(mocks.publishCommittedWrite).toHaveBeenCalledWith('M:/mod', receipt, 's1');
  });
  it('accepts a zero-change receipt through the same credentials boundary', async () => {
    const receipt = savedWriteFixture();
    await completeSavedWrite({ modRoot: 'M:/mod', sessionId: 's1', result: receipt, label: 'saved' });
    expect(mocks.publishCommittedWrite).toHaveBeenCalledOnce();
  });
  it('reports persisted synchronization failure with its committed identity', async () => {
    mocks.publishCommittedWrite.mockRejectedValueOnce(new Error('broadcast'));
    await expect(
      completeSavedWrite({ modRoot: 'M:/mod', sessionId: 's1', result: savedWriteFixture(), label: 'saved' }),
    ).rejects.toMatchObject({ action: 'sync-saved-write' });
    expect(mocks.recordLogBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'write.sync_pending', path: 'M:/mod', fields: { sessionId: 's1' } }),
    );
  });
});
