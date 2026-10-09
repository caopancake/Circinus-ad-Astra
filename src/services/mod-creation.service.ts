import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { CreatedMod, CreateModRequest } from '@/shared/types';

export function createNewModProject(request: CreateModRequest): Promise<CreatedMod> {
  return invokeCommand('create_mod', { payload: request });
}
