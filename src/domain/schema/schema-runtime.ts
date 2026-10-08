import type { ProjectSessionId, ResourceRef, SourceOptionGroup } from '@/shared/types';

export interface SchemaRuntimeContext {
  modRoot: string;
  sessionId: ProjectSessionId;
  sourceContextKey?: string;
  missionId?: string;
  querySourceOptions?: (source: string) => Promise<SourceOptionGroup[]>;
  subscribeSourceOptionInvalidation?: (source: string, resources: () => ResourceRef[], listener: () => void) => () => void;
}
