import { describe, expect, it } from 'vitest';
import type { ProjectManifest } from '@/shared/types';
import { MODULE_LABELS } from '@/shared/lib/starsector';
import { buildModNavigationSections, isModNavigationItemActive } from './mod-navigation';

function manifestFixture(): ProjectManifest {
  return {
    baseVersions: [],
    sessionId: 's1',
    modRoot: 'C:/mods/alpha',
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: null,
    tableSummaries: {} as ProjectManifest['tableSummaries'],
    tableEntitySummaries: { ships: 10, weapons: 20 } as ProjectManifest['tableEntitySummaries'],
    entitySummaries: { factions: 4, missions: 5, ships: 0, weapons: 0, projectiles: 0, variants: 3, skins: 2, systems: 0, skills: 0 },
    warnings: [],
  };
}

const sections = () => buildModNavigationSections(manifestFixture());

describe('buildModNavigationSections', () => {
  it('builds the four fixed sections in order', () => {
    expect(sections().map((section) => section.id)).toEqual(['workspace', 'mod-info', 'combat', 'campaign']);
  });

  it('keeps workspace and mod-info entries without counts', () => {
    const byId = new Map(sections().map((section) => [section.id, section]));
    expect(byId.get('workspace')?.items.map((item) => item.id)).toEqual(['config:mod-overview', 'config:file-history']);
    expect(byId.get('workspace')?.items.every((item) => item.count === null)).toBe(true);
    expect(byId.get('mod-info')?.items.map((item) => item.id)).toEqual(['config:mod-info']);
  });

  it('reads config counts from the manifest entity summaries', () => {
    const byId = new Map(sections().map((section) => [section.id, section]));
    const combat = byId.get('combat')!;
    const campaign = byId.get('campaign')!;
    expect(combat.items.find((item) => item.id === 'config:skins')?.count).toBe(2);
    expect(combat.items.find((item) => item.id === 'config:variants')?.count).toBe(3);
    expect(campaign.items.find((item) => item.id === 'config:factions')?.count).toBe(4);
    expect(campaign.items.find((item) => item.id === 'config:mission')?.count).toBe(5);
  });

  it('reads table counts from the manifest table summaries and labels them', () => {
    const combat = sections().find((section) => section.id === 'combat')!;
    const ships = combat.items.find((item) => item.id === 'table:ships')!;
    expect(ships.label).toBe(MODULE_LABELS.ships);
    expect(ships.count).toBe(10);
    expect(ships.target).toEqual({ type: 'table', table: 'ships' });
  });

  it('defaults every count to zero without a manifest', () => {
    const empty = buildModNavigationSections(null);
    const counts = empty.flatMap((section) => section.items.map((item) => item.count));
    expect(counts.every((count) => count === null || count === 0)).toBe(true);
  });
});

describe('isModNavigationItemActive', () => {
  it('activates config items only for the matching config view', () => {
    const item = sections()[0]!.items[0]!;
    expect(isModNavigationItemActive(item, 'config', 'mod-overview', 'ships')).toBe(true);
    expect(isModNavigationItemActive(item, 'config', 'factions', 'ships')).toBe(false);
    expect(isModNavigationItemActive(item, 'table', 'mod-overview', 'ships')).toBe(false);
  });

  it('activates table items only for the matching table', () => {
    const item = sections()
      .find((section) => section.id === 'combat')!
      .items.find((entry) => entry.id === 'table:ships')!;
    expect(isModNavigationItemActive(item, 'table', 'mod-overview', 'ships')).toBe(true);
    expect(isModNavigationItemActive(item, 'table', 'mod-overview', 'weapons')).toBe(false);
    expect(isModNavigationItemActive(item, 'config', 'mod-overview', 'ships')).toBe(false);
  });
});
