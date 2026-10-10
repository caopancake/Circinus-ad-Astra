import { noNameExistenceChecksRule } from '../no-name-existence-checks.mjs';
import { architectureRulesSelfBoundaryRule } from '../self-boundary.mjs';
import { csvDraftBoundaryRule } from './csv-draft-boundary.mjs';
import { cssTokenBoundaryRule } from './css-token-boundary.mjs';
import { commandBoundaryRule } from './command-boundary.mjs';
import { csvModuleBoundaryRule } from './csv-module-boundary.mjs';
import { directoryOpeningBoundaryRule } from './directory-opening-boundary.mjs';
import { docsModuleMapRule } from './docs-module-map.mjs';
import { draftSessionBoundaryRule } from './draft-session-boundary.mjs';
import { editorConfigBackendBoundaryRule } from './editor-config-backend-boundary.mjs';
import { editorModuleBoundaryRule } from './editor-module-boundary.mjs';
import { errorBoundaryRule } from './error-boundary.mjs';
import { feedbackBoundaryRule } from './feedback-boundary.mjs';
import { fileEditorBoundaryRule } from './file-editor-boundary.mjs';
import { fileHistoryBoundaryRule } from './file-history-boundary.mjs';
import { frontendLayerBoundaryRule } from './frontend-layer-boundary.mjs';
import { mainHistoryCommandBoundaryRule } from './main-history-command-boundary.mjs';
import { namingBoundaryRule } from './naming-boundary.mjs';
import { parserBoundaryRule } from './parser-boundary.mjs';
import { projectSessionBoundaryRule } from './project-session-boundary.mjs';
import { projectResourcesBoundaryRule } from './project-resources-boundary.mjs';
import { resourceBoundaryRule } from './resource-boundary.mjs';
import { rustProjectLayerBoundaryRule } from './rust-project-layer-boundary.mjs';
import { rustServiceEdgeBoundaryRule } from './rust-service-edge-boundary.mjs';
import { schemaModuleBoundaryRule } from './schema-module-boundary.mjs';
import { sharedTypesBoundaryRule } from './shared-types-boundary.mjs';
import { windowBoundaryRule } from './window-boundary.mjs';
import { workspaceModuleBoundaryRule } from './workspace-module-boundary.mjs';
import { workspacePersistenceBoundaryRule } from './workspace-persistence-boundary.mjs';
import { writeBoundaryRule } from './write-boundary.mjs';

// Meta-rules govern how rules themselves may be written; they live outside
// rules/ so their own source is not a subject of the checks they define.
export const rules = [
  architectureRulesSelfBoundaryRule,
  noNameExistenceChecksRule,
  frontendLayerBoundaryRule,
  mainHistoryCommandBoundaryRule,
  rustProjectLayerBoundaryRule,
  rustServiceEdgeBoundaryRule,
  writeBoundaryRule,
  commandBoundaryRule,
  resourceBoundaryRule,
  fileHistoryBoundaryRule,
  directoryOpeningBoundaryRule,
  editorConfigBackendBoundaryRule,
  projectResourcesBoundaryRule,
  fileEditorBoundaryRule,
  workspacePersistenceBoundaryRule,
  projectSessionBoundaryRule,
  parserBoundaryRule,
  windowBoundaryRule,
  feedbackBoundaryRule,
  errorBoundaryRule,
  namingBoundaryRule,
  sharedTypesBoundaryRule,
  csvModuleBoundaryRule,
  csvDraftBoundaryRule,
  cssTokenBoundaryRule,
  docsModuleMapRule,
  draftSessionBoundaryRule,
  schemaModuleBoundaryRule,
  editorModuleBoundaryRule,
  workspaceModuleBoundaryRule,
];
