import { classifyFrontendPath } from './classify.mjs';
import { dependencyOrigins } from './imports.mjs';

/** @typedef {import('./classify.mjs').FrontendPathClass} PathRole */
/** @typedef {{ path?: string, layer: string, domain?: string, role?: string }} Owner */
/** @typedef {{ path?: string, layer?: string, role: string, domain: string, names: string[], capability: string, owners: Owner[] }} CapabilityRule */

/** @type {Owner[]} */
const readOwners = [{ layer: 'services' }, { layer: 'orchestrators' }, { layer: 'app', role: 'composable' }];
/** @type {CapabilityRule[]} */
export const frontendCapabilities = [
  {
    path: 'src/shared/runtime/command.runtime.ts',
    layer: 'shared',
    role: 'shared',
    domain: 'runtime',
    names: ['invokeCommand'],
    capability: 'command-transport',
    owners: [{ layer: 'services' }, { layer: 'shared', role: 'api' }],
  },
  {
    role: 'service',
    domain: 'app-settings',
    names: ['loadSettings'],
    capability: 'settings-read',
    owners: [{ path: 'src/main.ts', layer: 'app' }],
  },
  {
    role: 'service',
    domain: 'app-settings',
    names: ['saveSettings'],
    capability: 'settings-write',
    owners: [{ layer: 'orchestrators', domain: 'settings-persistence' }],
  },
  {
    role: 'service',
    domain: 'app-log',
    names: ['recordLogBestEffort'],
    capability: 'log-record',
    owners: readOwners.concat([{ layer: 'app', domain: 'app-feedback' }]),
  },
  {
    role: 'service',
    domain: 'app-log',
    names: ['startPerformanceLogSink'],
    capability: 'log-lifecycle',
    owners: [{ path: 'src/main.ts', layer: 'app' }],
  },
  {
    role: 'service',
    domain: 'app-log',
    names: ['loadLogStatus', 'openLogFile', 'clearLog'],
    capability: 'log-maintenance',
    owners: [{ layer: 'app', role: 'composable', domain: 'settings-view-model' }],
  },
  {
    role: 'service',
    domain: 'app-config',
    names: ['openConfigFolder', 'clearConfig'],
    capability: 'config-maintenance',
    owners: [{ layer: 'app', role: 'composable', domain: 'app-config-actions' }],
  },
  {
    role: 'service',
    domain: 'workspace-state',
    names: ['loadPersistedWorkspace', 'savePersistedWorkspace'],
    capability: 'workspace-persistence',
    owners: [{ layer: 'orchestrators', domain: 'workspace-persistence' }],
  },
  {
    role: 'service',
    domain: 'mod-creation',
    names: ['createNewModProject'],
    capability: 'mod-create',
    owners: [{ layer: 'orchestrators', domain: 'mod-creation' }],
  },
  {
    role: 'service',
    domain: 'core-assets',
    names: ['queryCoreFields', 'queryCoreGraphics'],
    capability: 'core-index-read',
    owners: [{ layer: 'orchestrators', domain: 'core-assets' }],
  },
  {
    path: 'src/shared/runtime/project-projection.ts',
    layer: 'shared',
    role: 'shared',
    domain: 'runtime',
    names: ['markProjectionPending'],
    capability: 'projection-state',
    owners: [{ layer: 'orchestrators', domain: 'project-session-refresh' }],
  },
  {
    path: 'src/shared/runtime/project-projection.ts',
    layer: 'shared',
    role: 'shared',
    domain: 'runtime',
    names: ['markProjectionReady'],
    capability: 'projection-state',
    owners: [
      { layer: 'orchestrators', domain: 'project-session-refresh' },
      { layer: 'orchestrators', domain: 'workspace-lifecycle' },
    ],
  },
  {
    path: 'src/shared/runtime/project-projection.ts',
    layer: 'shared',
    role: 'shared',
    domain: 'runtime',
    names: ['requireProjectionReady'],
    capability: 'projection-read',
    owners: [{ layer: 'services' }],
  },
  {
    role: 'orchestrator',
    domain: 'project-session-refresh',
    names: ['publishCommittedWrite'],
    capability: 'commit-synchronize',
    owners: ['file-history-write', 'file-history-replay', 'editor-window', 'file-editor-window'].map((domain) => ({
      layer: 'orchestrators',
      domain,
    })),
  },
  {
    role: 'orchestrator',
    domain: 'project-session-refresh',
    names: ['retryPendingWritesForMod'],
    capability: 'commit-retry',
    owners: [
      { layer: 'orchestrators', domain: 'table-save' },
      { layer: 'orchestrators', domain: 'config-save' },
      { layer: 'orchestrators', domain: 'file-history-replay' },
      { layer: 'orchestrators', domain: 'workspace-lifecycle' },
      { layer: 'app', role: 'composable', domain: 'workspace-shell-actions' },
      { layer: 'app', role: 'composable', domain: 'config-list-selection' },
    ],
  },
  {
    role: 'orchestrator',
    domain: 'project-session-refresh',
    names: ['retryPendingProjectSessionWrites'],
    capability: 'commit-retry',
    owners: [{ layer: 'app', role: 'composable', domain: 'write-sync-view-model' }],
  },
  {
    role: 'orchestrator',
    domain: 'project-session-refresh',
    names: ['listenCommittedWrites', 'listenProjectSessionInvalidated', 'applyProjectSessionCacheInvalid'],
    capability: 'commit-observe',
    owners: [{ layer: 'orchestrators' }, { layer: 'app', role: 'composable' }],
  },
  {
    role: 'orchestrator',
    domain: 'project-session-refresh',
    names: ['applyCommittedWriteCacheInvalid'],
    capability: 'commit-accept',
    owners: [{ layer: 'orchestrators', domain: 'entity-identity' }],
  },
  {
    role: 'service',
    domain: 'window',
    names: ['openNativeManagedWindow'],
    capability: 'window-open',
    owners: [{ layer: 'windows', domain: 'managed' }],
  },
  {
    role: 'service',
    domain: 'window',
    names: ['updateNativeWindowStatus', 'cancelNativeWindowClose'],
    capability: 'window-lifecycle-guard',
    owners: [{ layer: 'app', role: 'composable', domain: 'dirty-window-close-guard' }],
  },
  {
    role: 'service',
    domain: 'window',
    names: ['closeNativeSessionWindows'],
    capability: 'session-window-close',
    owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
  },
  {
    role: 'service',
    domain: 'window',
    names: ['reserveNativeWindowTargets', 'releaseNativeWindowTargets'],
    capability: 'entity-window-identity',
    owners: [
      { layer: 'orchestrators', domain: 'entity-identity' },
      { layer: 'orchestrators', domain: 'table-save' },
      { layer: 'orchestrators', domain: 'config-save' },
    ],
  },
  {
    role: 'service',
    domain: 'window',
    names: ['retargetNativeWindow'],
    capability: 'window-identity-handoff',
    owners: [{ layer: 'orchestrators', domain: 'entity-identity' }],
  },
  {
    layer: 'app',
    role: 'module',
    domain: 'app-feedback',
    names: ['createAppFeedback'],
    capability: 'feedback-factory',
    owners: [{ layer: 'app', domain: 'app-feedback', role: 'composable' }],
  },
  {
    role: 'external',
    domain: '@tauri-apps/api/core',
    names: ['invoke'],
    capability: 'invoke-wire',
    owners: [{ path: 'src/shared/runtime/command.runtime.ts', layer: 'shared', domain: 'runtime' }],
  },
  ...['naive-ui', 'naive-ui/es/message', 'naive-ui/es/dialog', 'naive-ui/es/discrete'].map((domain) => ({
    role: 'external',
    domain,
    names: ['useMessage', 'useDialog', 'createDiscreteApi'],
    capability: 'feedback-runtime',
    owners: [{ layer: 'app', domain: 'app-feedback', role: 'composable' }],
  })),
  {
    role: 'service',
    domain: 'entity-query',
    names: [
      'querySessionEntity',
      'querySessionEntityEditTarget',
      'querySessionEntityIdentityIntent',
      'querySessionEntityList',
      'querySessionEditorDraftResources',
    ],
    capability: 'session-query-load',
    owners: [{ layer: 'services' }],
  },
  {
    role: 'service',
    domain: 'source-options',
    names: ['querySourceOptionCatalog'],
    capability: 'source-query',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'resource-reference',
    names: ['resolveModImageReference'],
    capability: 'resource-reference',
    owners: [{ layer: 'app', role: 'composable', domain: 'resource-reference' }],
  },
  {
    role: 'service',
    domain: 'hull-reference',
    names: ['querySessionHullReferences', 'queryHullReferenceOptions', 'queryHullPreviewMetadata', 'queryBuiltInWeaponSlotOptions'],
    capability: 'hull-query',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'csv-table',
    names: ['queryTableWindow', 'querySessionCsvRowPreview', 'queryTableRowPreviewDataUrl'],
    capability: 'table-query',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'csv-table',
    names: ['captureAssociatedSpecTarget'],
    capability: 'table-identity-prepare',
    owners: [{ layer: 'orchestrators', domain: 'table-save' }],
  },
  {
    role: 'service',
    domain: 'config-entity',
    names: [
      'saveModInfo',
      'saveIndexedConfigEntity',
      'createIndexedConfigEntity',
      'deleteIndexedConfigEntity',
      'saveVariantEntity',
      'createVariantEntity',
      'deleteVariantEntity',
      'saveSkinEntity',
      'createSkinEntity',
      'deleteSkinEntity',
    ],
    capability: 'config-write',
    owners: [{ layer: 'orchestrators', domain: 'config-save' }],
  },
  {
    role: 'service',
    domain: 'config-entity',
    names: [
      'captureConfigIdentityIntent',
      'listConfigFactionRecords',
      'listConfigMissionRecords',
      'listVariantRecords',
      'getConfigFamilyRecord',
      'getConfigFactionRecord',
      'listSkinRecords',
      'queryFactionPreviewImages',
      'queryMissionDraftIcon',
      'getConfigMissionEditorData',
    ],
    capability: 'config-query',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'csv-table',
    names: ['saveCsvPatch'],
    capability: 'table-write',
    owners: [{ layer: 'orchestrators', domain: 'table-save' }],
  },
  {
    role: 'service',
    domain: 'editor',
    names: ['saveEditorSpec', 'saveEditorSpecByKind'],
    capability: 'spec-write',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'editor',
    names: [
      'queryEditorEntityBundle',
      'refreshBundleResources',
      'queryDraftEditorImages',
      'refreshBundleProjectiles',
      'queryEditorIdentityIntent',
      'queryEditorEditInfo',
    ],
    capability: 'editor-query',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'editor',
    names: ['loadImportedSpecFile'],
    capability: 'spec-import',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'files',
    names: ['writeEditableFileText', 'transcodeFileToUtf8', 'saveModFiles'],
    capability: 'text-write',
    owners: readOwners.concat([{ layer: 'app', domain: 'app-feedback' }]),
  },
  {
    role: 'service',
    domain: 'file-history',
    names: ['replayFileChangeSet'],
    capability: 'history-replay',
    owners: [{ layer: 'orchestrators', domain: 'file-history-replay' }],
  },
  {
    role: 'service',
    domain: 'file-history',
    names: ['loadFileHistory', 'clearSavedFileHistory'],
    capability: 'history-wire',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'files',
    names: ['loadEditableFileData', 'queryFileTextIdentityIntent', 'followFileTextIdentity'],
    capability: 'text-read',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'query-cache',
    names: ['queryCached', 'queryLive'],
    capability: 'query-cache-load',
    owners: ['entity-query', 'csv-table', 'source-options', 'hull-reference', 'resource-reference'].map((domain) => ({
      layer: 'services',
      domain,
    })),
  },
  {
    role: 'service',
    domain: 'query-cache',
    names: [
      'subscribeQueryInvalidations',
      'hasQueryInvalidation',
      'hasEntityInvalidation',
      'hasSourceInvalidation',
      'hasTableInvalidation',
    ],
    capability: 'cache-observe',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'resource-cache',
    names: ['subscribeResourceInvalidations', 'hasResourceInvalidation', 'resourceCacheKey', 'RESOURCE_DATA_URL_CACHE_CAPACITY'],
    capability: 'cache-observe',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'query-cache',
    names: ['invalidateQueryCacheByProject'],
    capability: 'project-cache-invalidate',
    owners: [{ layer: 'orchestrators', domain: 'project-session-refresh' }],
  },
  {
    role: 'service',
    domain: 'resource-cache',
    names: ['invalidateResourceCacheByProject'],
    capability: 'project-cache-invalidate',
    owners: [{ layer: 'orchestrators', domain: 'project-session-refresh' }],
  },
  {
    role: 'service',
    domain: 'query-cache',
    names: ['invalidateQueryCacheForSession'],
    capability: 'session-cache-clear',
    owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
  },
  {
    role: 'service',
    domain: 'resource-cache',
    names: ['invalidateResourceCacheForSession'],
    capability: 'session-cache-clear',
    owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
  },
  {
    role: 'service',
    domain: 'resource-cache',
    names: ['queryResourceDataUrls'],
    capability: 'resource-load',
    owners: ['config-resource', 'csv-table', 'editor', 'resource-media'].map((domain) => ({ layer: 'services', domain })),
  },
  {
    role: 'service',
    domain: 'project-session',
    names: ['openProject'],
    capability: 'session-open',
    owners: [{ layer: 'orchestrators', domain: 'directory-opening' }],
  },
  {
    role: 'service',
    domain: 'project-session',
    names: ['closeProject'],
    capability: 'session-close',
    owners: ['directory-opening', 'workspace-lifecycle'].map((domain) => ({ layer: 'orchestrators', domain })),
  },
  {
    role: 'service',
    domain: 'project-session',
    names: ['requestProjectSessionRefresh', 'synchronizeSessionCommit'],
    capability: 'session-refresh',
    owners: [{ layer: 'orchestrators', domain: 'project-session-refresh' }],
  },
  {
    role: 'service',
    domain: 'core-assets',
    names: ['invalidateCoreCacheForRoot'],
    capability: 'core-cache-clear',
    owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
  },
  {
    role: 'service',
    domain: 'directory',
    names: ['pickDirectory', 'detectDirectoryTarget', 'scanDirectoryGameOverview'],
    capability: 'directory-read',
    owners: [
      { layer: 'orchestrators', domain: 'directory-opening' },
      { layer: 'orchestrators', domain: 'workspace-persistence' },
      { layer: 'app', domain: 'workspace-shell-actions' },
    ],
  },
];

/** @param {string} rel @param {string} name @returns {CapabilityRule | undefined} */
export function capabilityFor(rel, name) {
  const target = classifyFrontendPath(rel);
  const domain = target.layer === 'external' ? rel : target.domain;
  return frontendCapabilities.find(
    (rule) =>
      (rule.path === undefined || rule.path === rel) &&
      (rule.layer === undefined || rule.layer === target.layer) &&
      rule.role === target.role &&
      rule.domain === domain &&
      rule.names.includes(name),
  );
}

/** @param {PathRole} role @param {string} rel @returns {boolean} */
export function hasCapabilityBoundary(role, rel) {
  return frontendCapabilities.some(
    (rule) =>
      (rule.path === undefined || rule.path === rel) &&
      (rule.layer === undefined || rule.layer === role.layer) &&
      rule.role === role.role &&
      rule.domain === role.domain,
  );
}

/** @param {import('./imports.mjs').ResolvedImport} edge @param {Map<string, import('./files.mjs').RepoFile>} nodes @returns {import('./imports.mjs').ExportOrigin[]} */
export function capabilityOrigins(edge, nodes) {
  return dependencyOrigins(
    edge,
    nodes,
    (rel, name) => Boolean(capabilityFor(rel, name)),
    (rel) => frontendCapabilities.filter((rule) => rule.role === 'external' && rule.domain === rel).flatMap((rule) => rule.names),
  );
}

/** @param {PathRole} current @param {PathRole} target @param {import('./imports.mjs').ResolvedImport} edge @returns {string | null} */
export function frontendDependencyFailure(current, target, edge) {
  if (current.role === 'bootstrap' && target.layer === 'styles') return null;
  if (!validFrontendDependency(current.layer, target.layer)) return `${current.layer} must not import ${target.layer}`;
  if (!edge.typeOnly && current.role === 'component' && ['service', 'orchestrator', 'api'].includes(target.role))
    return 'components must consume ViewModel/composable state and actions';
  if (target.role === 'api' && current.layer !== 'services') return 'wire APIs must be consumed through backend capability services';
  if (!edge.typeOnly && current.layer === 'services' && target.layer === 'services' && !allowedServiceEdge(current, target))
    return 'service composition must follow the declared capability dependency matrix';
  const runtimeOwner =
    current.role === 'api' || current.layer === 'windows' || (current.layer === 'shared' && current.domain === 'runtime');
  if (!edge.typeOnly && edge.specifier.startsWith('@tauri-apps/') && !runtimeOwner)
    return 'Tauri runtime access belongs behind wire, window or shared runtime boundaries';
  return null;
}

/** @param {PathRole} current @param {CapabilityRule} capability @returns {boolean} */
export function canConsumeCapability(current, capability) {
  return capability.owners.some((owner) => matchesOwner(current, owner));
}

/** @param {PathRole} current @param {Owner} owner @returns {boolean} */
function matchesOwner(current, owner) {
  return (
    (owner.path === undefined || current.path === owner.path) &&
    current.layer === owner.layer &&
    (owner.domain === undefined || current.domain === owner.domain) &&
    (owner.role === undefined || current.role === owner.role)
  );
}

const serviceEdges = new Set([
  'entity-query -> query-cache',
  'csv-table -> query-cache',
  'source-options -> query-cache',
  'hull-reference -> query-cache',
  'resource-reference -> query-cache',
  'resource-media -> resource-cache',
  'config-entity -> config-resource',
  'config-entity -> entity-query',
  'config-resource -> resource-cache',
  'csv-table -> entity-query',
  'csv-table -> resource-cache',
  'files -> write',
  'editor -> files',
  'editor -> entity-query',
  'editor -> resource-cache',
  'editor -> write',
]);

/** @param {PathRole} from @param {PathRole} to @returns {boolean} */
export function allowedServiceEdge(from, to) {
  return from.domain === to.domain || serviceEdges.has(`${from.domain} -> ${to.domain}`);
}

/** @param {import('./classify.mjs').FrontendLayer} from @param {import('./classify.mjs').FrontendLayer} to @returns {boolean} */
export function validFrontendDependency(from, to) {
  if (from === 'test') return true;
  if (to === 'test') return false;
  /** @type {Record<string, string[]>} */
  const layers = {
    shared: ['shared'],
    domain: ['domain', 'shared'],
    services: ['services', 'domain', 'shared'],
    stores: ['stores', 'domain', 'shared'],
    orchestrators: ['orchestrators', 'services', 'stores', 'domain', 'windows', 'shared'],
    windows: ['windows', 'orchestrators', 'services', 'domain', 'shared'],
    app: ['app', 'windows', 'orchestrators', 'services', 'stores', 'domain', 'shared'],
    styles: ['styles'],
  };
  return !layers[from] || !layers[to] || layers[from].includes(to);
}

/** @param {import('./files.mjs').RepoFile} file @param {import('./imports.mjs').ResolvedImport} edge @param {string} message @returns {string} */
export function dependencyDiagnostic(file, edge, message) {
  return `${file.rel}:${edge.line}:${edge.column}: ${edge.resolved}: ${message}`;
}
