import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectManifest, ProjectSessionInvalidationResult, WriteResult } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  requestProjectSessionRefresh: vi.fn(),
  invalidateQueryCacheByProject: vi.fn(),
  invalidateResourceCacheByProject: vi.fn(),
  emitWindowEvent: vi.fn(async () => {}),
}));

vi.mock('@/services/session.service', () => ({
  requestProjectSessionRefresh: mocks.requestProjectSessionRefresh,
}));

vi.mock('@/services/query-cache.service', () => ({
  invalidateQueryCacheByProject: mocks.invalidateQueryCacheByProject,
}));

vi.mock('@/services/resource-cache.service', () => ({
  invalidateResourceCacheByProject: mocks.invalidateResourceCacheByProject,
}));

vi.mock('@/windows/tauri.events', () => ({
  emitWindowEvent: mocks.emitWindowEvent,
  listenWindowEvent: vi.fn(async () => async () => {}),
}));

import {
  applyProjectSessionCacheInvalid,
  refreshLoadedSessionsAfterWrite,
  refreshProjectSessionAfterWrite,
} from './project-session-refresh.orchestrator';
import { useProjectStore } from '@/stores/project.store';

function manifestFixture(modRoot: string, sessionId: string): ProjectManifest {
  return {
    sessionId,
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: null,
    tableSummaries: {} as ProjectManifest['tableSummaries'],
    tableEntitySummaries: {} as ProjectManifest['tableEntitySummaries'],
    entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
    warnings: [],
  };
}

function refreshResult(modRoot: string, sessionId: string): ProjectSessionInvalidationResult {
  return {
    manifest: manifestFixture(modRoot, sessionId),
    invalidation: { paths: ['data/hulls/x.ship'], tables: ['ships'], entities: [], resources: [], queryScopes: [], session: false },
  };
}

function writeResult(changes: { path: string }[]): WriteResult {
  return {
    changes: changes.map((change) => ({
      kind: 'file' as const,
      path: change.path,
      beforeExists: true,
      beforeText: null,
      beforeDataBase64: null,
      beforeFiles: [],
      afterExists: true,
      afterText: null,
      afterDataBase64: null,
      afterFiles: [],
    })),
    invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    keyMap: [],
    refreshedEntity: null,
  };
}

describe('refreshProjectSessionAfterWrite', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('refreshes the session, swaps the manifest and broadcasts invalidation', async () => {
    const project = useProjectStore();
    project.registerProjectManifest(manifestFixture('C:/mods/alpha', 's1'));
    mocks.requestProjectSessionRefresh.mockResolvedValue(refreshResult('C:/mods/alpha', 's1'));

    const event = await refreshProjectSessionAfterWrite('C:/mods/alpha', writeResult([{ path: 'data/hulls/x.ship' }]), 's1');
    expect(event.manifest.sessionId).toBe('s1');
    expect(project.getManifest('C:/mods/alpha')?.sessionId).toBe('s1');
    expect(mocks.invalidateResourceCacheByProject).toHaveBeenCalledWith('s1', event.invalidation);
    expect(mocks.invalidateQueryCacheByProject).toHaveBeenCalledWith('s1', event.invalidation);
    expect(mocks.emitWindowEvent).toHaveBeenCalledWith('project-session-invalidated', event);
  });

  it('rejects writes for unloaded mods', async () => {
    setActivePinia(createPinia());
    await expect(refreshProjectSessionAfterWrite('C:/mods/ghost', writeResult([{ path: 'x' }]))).rejects.toMatchObject({
      action: 'refresh-project-session-after-write',
    });
  });

  it('rejects writes whose session changed', async () => {
    useProjectStore().registerProjectManifest(manifestFixture('C:/mods/alpha', 's2'));
    await expect(refreshProjectSessionAfterWrite('C:/mods/alpha', writeResult([{ path: 'x' }]), 's1')).rejects.toMatchObject({
      action: 'refresh-project-session-after-write',
    });
  });

  it('rejects write results that miss the mod scope entirely', async () => {
    useProjectStore().registerProjectManifest(manifestFixture('C:/mods/alpha', 's1'));
    await expect(
      refreshProjectSessionAfterWrite('C:/mods/alpha', writeResult([{ path: 'C:/mods/other/data/hulls/x.ship' }]), 's1'),
    ).rejects.toMatchObject({ action: 'refresh-project-session-after-write' });
  });

  it('scopes relative changes by mod root and absolute changes by path ownership', async () => {
    const project = useProjectStore();
    project.registerProjectManifest(manifestFixture('C:/mods/alpha', 's1'));
    project.registerProjectManifest(manifestFixture('C:/mods/beta', 's2'));
    mocks.requestProjectSessionRefresh.mockImplementation(async (sessionId: string) => {
      const modRoot = sessionId === 's1' ? 'C:/mods/alpha' : 'C:/mods/beta';
      return refreshResult(modRoot, sessionId);
    });

    const events = await refreshLoadedSessionsAfterWrite(
      writeResult([{ path: 'data/hulls/alpha-only.ship' }, { path: 'C:/mods/beta/data/hulls/beta.ship' }]),
      'C:/mods/alpha',
    );
    expect(events.map((event) => event.manifest.modRoot).sort()).toEqual(['C:/mods/alpha', 'C:/mods/beta']);
    expect(mocks.requestProjectSessionRefresh).toHaveBeenCalledTimes(2);
  });

  it('applies cache invalidation for a received event', () => {
    const event = { manifest: manifestFixture('C:/mods/alpha', 's1'), invalidation: refreshResult('C:/mods/alpha', 's1').invalidation };
    applyProjectSessionCacheInvalid(event);
    expect(mocks.invalidateResourceCacheByProject).toHaveBeenCalledWith('s1', event.invalidation);
    expect(mocks.invalidateQueryCacheByProject).toHaveBeenCalledWith('s1', event.invalidation);
  });
});
