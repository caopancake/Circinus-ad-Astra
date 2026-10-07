import { openCreatedModTarget, type DirectoryOpeningOutcome } from '@/orchestrators/directory-opening.orchestrator';
import { createNewModProject } from '@/services/mod-creation.service';
import { AppError } from '@/shared/lib/errors';
import { measurePerformanceAsync } from '@/shared/runtime/performance';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { logFields } from '@/shared/lib/log-fields';
import type { CreatedMod, CreateModRequest } from '@/shared/types';

export interface CreatedModProject {
  modName: string;
  warnings: string[];
}

export async function createModProject(request: CreateModRequest): Promise<CreatedMod> {
  const created = await measurePerformanceAsync(
    'frontend.createModProject',
    { destination: request.destination.kind, modId: request.template.id },
    () => createNewModProject(request),
  );
  recordLogBestEffort({
    level: 'info',
    code: 'mod.created',
    message: 'mod created',
    path: null,
    line: null,
    fields: logFields({ modRoot: created.modRoot, template: request.template.id, destination: request.destination.kind }),
  });
  return created;
}

export async function openCreatedModProject(created: CreatedMod): Promise<CreatedModProject | null> {
  const outcome = await measurePerformanceAsync(
    'frontend.openCreatedModProject',
    { modRoot: created.modRoot, hasStarsectorRoot: Boolean(created.starsectorRoot) },
    () => openCreatedModTarget(created),
  );
  return openedCreatedMod(outcome);
}

function openedCreatedMod(outcome: DirectoryOpeningOutcome): CreatedModProject | null {
  if (outcome.type === 'cancelled') return null;
  if (outcome.type === 'mod-loaded') {
    return { modName: outcome.modName, warnings: outcome.warnings };
  }
  if (outcome.type === 'already-loaded') {
    throw new AppError(`新建 Mod 已意外存在于工作区：${outcome.modName}`, { action: 'open-created-mod' });
  }
  if (outcome.type === 'unknown') {
    throw new AppError(`Mod 已创建，但无法打开：${outcome.message}`, { action: 'open-created-mod' });
  }
  throw new AppError('Mod 已创建，但创建结果打开返回了无效状态', { action: 'open-created-mod' });
}
