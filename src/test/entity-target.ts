import type { EntityEditTarget, EntityKind } from '@/shared/types';

const paths: Record<EntityKind, [string, string]> = {
  ship: ['data/hulls', 'ship'],
  weapon: ['data/weapons', 'wpn'],
  projectile: ['data/weapons/proj', 'proj'],
  system: ['data/shipsystems', 'system'],
  skill: ['data/characters/skills', 'skill'],
  variant: ['data/variants', 'variant'],
  skin: ['data/hulls/skins', 'skin'],
  faction: ['data/world/factions', 'faction'],
  mission: ['data/missions', ''],
};

export function entityTargetFixture(kind: EntityKind, id: string, state: 'existing' | 'create' = 'existing'): EntityEditTarget {
  const [directory, extension] = paths[kind];
  const relPath = `${directory}/${id}${extension ? `.${extension}` : ''}`;
  const write = { source: 'mod' as const, root: 'M:/mod', relPath, path: `M:/mod/${relPath}` };
  return { kind, id, write, source: state === 'existing' ? { ...write } : null, state, linkedRecord: null };
}
