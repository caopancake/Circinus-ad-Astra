export const EDITOR_KINDS = ['ship', 'weapon', 'projectile', 'system'] as const;
export const EDITOR_WINDOW_KINDS = ['ship', 'weapon', 'projectile', 'system', 'weapon-preview'] as const;

export type EditorKind = (typeof EDITOR_KINDS)[number];
export type EditorWindowKind = (typeof EDITOR_WINDOW_KINDS)[number];

export type EditorSpecKind = EditorKind;
export type WeaponSpecClass = 'projectile' | 'beam';
export type ProjectileSpecClass = 'projectile' | 'missile';
export type EditorResourceKind = EditorSpecKind | 'faction' | 'mission';

export interface EditableFileData {
  path: string;
  text: string;
  baseVersions: import('@/shared/types/write.types').FileVersion[];
}
