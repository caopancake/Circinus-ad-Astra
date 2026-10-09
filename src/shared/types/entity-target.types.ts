import type { EntityKind, ResourceSource } from '@/shared/types/query.types';
import type { TableKey } from '@/shared/types/tables.types';
import type { FileVersion } from '@/shared/types/write.types';

export interface EntityFileLocation {
  source: ResourceSource;
  root: string;
  relPath: string;
  path: string;
}

export type EntityLinkedRecord = { kind: 'csv'; table: TableKey; rowKey: string } | { kind: 'index'; path: string; rowIndex: number };

export interface EntityEditTarget {
  kind: EntityKind;
  id: string;
  source: EntityFileLocation | null;
  write: EntityFileLocation;
  state: 'existing' | 'create';
  linkedRecord: EntityLinkedRecord | null;
}

export interface EntityEditInfo {
  target: EntityEditTarget;
  baseVersions: FileVersion[];
}

export interface EntityIdentityIntent {
  source: EntityEditTarget;
  nextId: string;
  nextWrite: EntityFileLocation;
  destinationVersion: FileVersion;
}

export interface EntityIdentityChange {
  before: EntityEditTarget;
  after: EntityEditTarget;
}
