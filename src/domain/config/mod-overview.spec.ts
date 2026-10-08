import { describe, expect, it } from 'vitest';
import type { ProjectManifest } from '@/shared/types';
import { buildConfigModOverview } from './mod-overview';

function manifestFixture(): ProjectManifest {
  return {
    baseVersions: [],
    sessionId: 's1',
    modRoot: 'C:/mods/alpha',
    starsectorRoot: 'D:/games/starsector',
    coreAvailable: true,
    associatedSpecTables: [],
    modInfo: { name: 'Alpha', version: { major: 1, minor: 2, patch: 0 } },
    tableSummaries: {} as ProjectManifest['tableSummaries'],
    tableEntitySummaries: {
      ships: 10,
      weapons: 20,
      wings: 1,
      hullmods: 2,
      shipSystems: 3,
      industries: 4,
      skills: 5,
    } as ProjectManifest['tableEntitySummaries'],
    entitySummaries: { factions: 4, missions: 5, ships: 0, weapons: 0, projectiles: 0, variants: 3, skins: 2, systems: 0, skills: 0 },
    warnings: [],
  };
}

describe('buildConfigModOverview', () => {
  it('presents the unloaded placeholder without a manifest', () => {
    const overview = buildConfigModOverview(null);
    expect(overview.modName).toBe('Mod 概览');
    expect(overview.modRootText).toBe('未加载');
    expect(overview.coreAvailable).toBe(false);
    expect(overview.coreResourceText).toContain('未找到');
    expect(overview.breakdown).toEqual([]);
    expect(overview.tableTotal).toBe(0);
    expect(overview.configTotal).toBe(0);
  });

  it('projects mod info and the core directory for a loaded manifest', () => {
    const overview = buildConfigModOverview(manifestFixture());
    expect(overview.modName).toBe('Alpha');
    expect(overview.modVersion).toBe('1.2.0');
    expect(overview.modRootText).toBe('C:/mods/alpha');
    expect(overview.coreAvailable).toBe(true);
    expect(overview.coreResourceText).toContain('D:/games/starsector');
    expect(overview.coreResourceText).toContain('starsector-core');
  });

  it('sums table and config breakdown categories separately', () => {
    const overview = buildConfigModOverview(manifestFixture());
    expect(overview.tableTotal).toBe(10 + 20 + 1 + 2 + 3 + 4 + 5);
    expect(overview.configTotal).toBe(2 + 3 + 4 + 5);
    expect(overview.breakdown.filter((item) => item.category === 'table')).toHaveLength(7);
    expect(overview.breakdown.filter((item) => item.category === 'config')).toHaveLength(4);
  });

  it('reports core absence even when a root path exists', () => {
    const manifest = { ...manifestFixture(), coreAvailable: false };
    const overview = buildConfigModOverview(manifest);
    expect(overview.coreResourceText).toContain('未找到');
  });
});
