import type { EditorWindowKind, TableKey } from '@/shared/types';

interface AssociatedSpecDefinition {
  kind: 'ship' | 'weapon' | 'system' | 'skill';
  editorKinds: EditorWindowKind[];
}

const ASSOCIATED_SPEC_DEFINITIONS: Partial<Record<TableKey, AssociatedSpecDefinition>> = {
  ships: {
    kind: 'ship',
    editorKinds: ['ship'],
  },
  weapons: {
    kind: 'weapon',
    editorKinds: ['weapon', 'weapon-preview'],
  },
  shipSystems: {
    kind: 'system',
    editorKinds: ['system'],
  },
  skills: {
    kind: 'skill',
    editorKinds: [],
  },
};

export function associatedSpecEditorKinds(table: TableKey): EditorWindowKind[] {
  return [...(ASSOCIATED_SPEC_DEFINITIONS[table]?.editorKinds ?? [])];
}
export function associatedSpecKind(table: TableKey) {
  return ASSOCIATED_SPEC_DEFINITIONS[table]?.kind ?? null;
}
