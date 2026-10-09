import type { ProjectSessionId, ResourceRef, SourceOptionGroup } from '@/shared/types';
import type { DeepReadonly } from '@/shared/types';

export interface SchemaRuntimeContext {
  modRoot: string;
  sessionId: ProjectSessionId;
  sourceContextKey?: string;
  missionId?: string;
  querySourceOptions?: (source: string, signal?: AbortSignal) => Promise<DeepReadonly<SourceOptionGroup[]>>;
  subscribeSourceOptionInvalidation?: (source: string, resources: () => ResourceRef[], listener: () => void) => () => void;
}
