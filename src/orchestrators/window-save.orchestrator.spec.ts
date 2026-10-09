import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { CommittedWriteEvent } from '@/shared/types';
import { savedWriteFixture } from '@/test/write-result';
import { entityTargetFixture } from '@/test/entity-target';
const mocks = vi.hoisted(() => ({ handler: null as null | ((event: CommittedWriteEvent) => Promise<void>), stop: vi.fn() }));
vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({
  listenCommittedWrites: vi.fn(async (handler) => {
    mocks.handler = handler;
    return mocks.stop;
  }),
}));
import { listenWindowSaveEvents } from './window-save.orchestrator';
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mocks.handler = null;
});
describe('window committed receipt consumer', () => {
  it('projects a saved spec from the canonical receipt for its application callback', async () => {
    const callback = vi.fn();
    await listenWindowSaveEvents({ onEditorSpecSaved: callback });
    const result = savedWriteFixture({ hullId: 'ship', hullName: 'Saved' });
    result.identityChanges = [{ before: entityTargetFixture('ship', 'ship'), after: entityTargetFixture('ship', 'ship') }];
    await mocks.handler!({ originWindowLabel: 'peer', modRoot: 'M:/mod', sessionId: 's1', reason: 'save', result });
    expect(callback).toHaveBeenCalledWith({
      kind: 'ship',
      modRoot: 'M:/mod',
      sessionId: 's1',
      id: 'ship',
      spec: result.refreshedEntity,
      writeResult: result,
    });
  });
  it('consumes generic file receipts through the shared listener and releases its registration', async () => {
    const stop = await listenWindowSaveEvents();
    await mocks.handler!({ originWindowLabel: 'peer', modRoot: 'M:/mod', sessionId: 's1', reason: 'undo', result: savedWriteFixture() });
    stop();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
});
