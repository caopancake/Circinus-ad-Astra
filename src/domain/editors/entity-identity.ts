import { normalizeFsPath } from '@/shared/lib/paths';
import { AppError } from '@/shared/lib/errors';
import { variantFamily, skinFamily } from '@/domain/config/config-entity-families';
import type { EntityKind, RowData, WindowIdentity } from '@/shared/types';
import type { EntityEditInfo, FileVersion } from '@/shared/types';

export function captureIdentityVersions(baseline: FileVersion[], destination: FileVersion): FileVersion[] {
  return baseline.some((version) => normalizeFsPath(version.path) === normalizeFsPath(destination.path))
    ? baseline
    : [...baseline, destination];
}

export function handoffTableVersions(baseline: FileVersion[], info: EntityEditInfo): FileVersion[] {
  const linked = info.baseVersions.filter((version) => normalizeFsPath(version.path) !== normalizeFsPath(info.target.write.path));
  return [...baseline.filter((version) => !linked.some((next) => normalizeFsPath(next.path) === normalizeFsPath(version.path))), ...linked];
}

export function entityContentId(kind: EntityKind, content: RowData): string {
  const field = kind === 'ship' ? 'hullId' : kind === 'variant' ? variantFamily.idField : kind === 'skin' ? skinFamily.idField : 'id';
  const id = content[field];
  if (typeof id !== 'string') throw new AppError(`${field} 必须是字符串`, { action: 'prepare-entity-identity' });
  return id;
}

export function windowIdentityKey(identity: WindowIdentity): string {
  if (identity.type === 'spec')
    return JSON.stringify([identity.type, identity.sessionId, identity.kind, normalizeFsPath(identity.modRoot), identity.id]);
  if (identity.type === 'file')
    return JSON.stringify([identity.type, identity.sessionId, normalizeFsPath(identity.modRoot), normalizeFsPath(identity.path)]);
  return JSON.stringify([
    identity.type,
    identity.modRoot === null ? null : normalizeFsPath(identity.modRoot),
    normalizeFsPath(identity.path),
  ]);
}
