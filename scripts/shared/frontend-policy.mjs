import { classifyFrontendPath } from './classify.mjs';
import { dependencyOrigins } from './imports.mjs';

/** @typedef {import('./classify.mjs').FrontendPathClass} PathRole */
/** @typedef {{ layer: string, domain?: string, role?: string }} Owner */
/** @typedef {{ path?: string, layer?: string, role: string, domain: string, names: string[], capability: string, owners: Owner[] }} CapabilityRule */

const readOwners = [{ layer: 'services' }, { layer: 'orchestrators' }, { layer: 'app', role: 'composable' }];
const configWrites = [
  'writeModInfo',
  'writeModFiles',
  'writeIndexedConfigEntity',
  'writeCreateIndexedConfigEntity',
  'writeDeleteIndexedConfigEntity',
  'writeVariantEntity',
  'writeCreateVariantEntity',
  'writeDeleteVariantEntity',
  'writeSkinEntity',
  'writeCreateSkinEntity',
  'writeDeleteSkinEntity',
];
const wireWrites = [
  'saveCsvPatch',
  'saveTextFile',
  'transcodeFileToUtf8',
  'saveEditorSpec',
  'saveModInfo',
  'saveModFiles',
  'applyFileChangeSet',
  'saveIndexedConfigEntity',
  'createIndexedConfigEntity',
  'deleteIndexedConfigEntity',
  'saveVariantEntity',
  'createVariantEntity',
  'deleteVariantEntity',
  'saveSkinEntity',
  'createSkinEntity',
  'deleteSkinEntity',
];

/** @type {CapabilityRule[]} */
export const frontendCapabilities = [
  {
    role: 'service',
    domain: 'assets',
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
    role: 'api',
    domain: 'window',
    names: [
      'openManagedWindow',
      'updateManagedWindowStatus',
      'reserveWindowTargets',
      'releaseWindowTargets',
      'retargetManagedWindow',
      'requestSessionWindowClose',
      'cancelWindowCloseRequest',
    ],
    capability: 'window-wire',
    owners: [{ layer: 'services', domain: 'window' }],
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
    owners: [{ layer: 'shared', role: 'api' }],
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
    domain: 'query',
    names: [
      'querySessionTableWindow',
      'querySessionSourceOptions',
      'querySessionCsvRowPreview',
      'querySessionHullReferences',
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
    role: 'api',
    domain: 'query',
    names: [
      'queryCsvRowPreview',
      'queryCsvSourceOptions',
      'queryCsvTableWindow',
      'queryEntity',
      'queryEntityEditTarget',
      'queryEntityIdentityIntent',
      'queryEntityList',
      'queryHullReferences',
      'queryEditorDraftResources',
    ],
    capability: 'query-wire',
    owners: [{ layer: 'services', domain: 'query' }],
  },
  {
    role: 'service',
    domain: 'write',
    names: configWrites,
    capability: 'config-write',
    owners: [{ layer: 'orchestrators', domain: 'config-save' }],
  },
  {
    role: 'service',
    domain: 'write',
    names: ['writeCsvPatch'],
    capability: 'table-write',
    owners: [{ layer: 'orchestrators', domain: 'table-save' }],
  },
  {
    role: 'service',
    domain: 'write',
    names: ['writeEditorSpec'],
    capability: 'spec-write',
    owners: [{ layer: 'services', domain: 'editor' }],
  },
  {
    role: 'service',
    domain: 'write',
    names: ['writeTextFile', 'writeTranscodedFile'],
    capability: 'text-write',
    owners: [{ layer: 'services', domain: 'files' }],
  },
  {
    role: 'service',
    domain: 'write',
    names: ['replayFileChangeSet'],
    capability: 'history-replay',
    owners: [{ layer: 'orchestrators', domain: 'file-history-replay' }],
  },
  { role: 'api', domain: 'write', names: wireWrites, capability: 'write-wire', owners: [{ layer: 'services', domain: 'write' }] },
  {
    role: 'api',
    domain: 'write',
    names: ['queryFileHistory', 'clearFileHistory'],
    capability: 'history-wire',
    owners: [{ layer: 'services', domain: 'file-history' }],
  },
  {
    role: 'service',
    domain: 'file-history',
    names: ['loadFileHistory', 'clearSavedFileHistory'],
    capability: 'history-state',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'query-cache',
    names: ['queryCached'],
    capability: 'query-cache-load',
    owners: [{ layer: 'services', domain: 'query' }],
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
    role: 'api',
    domain: 'query',
    names: ['queryResourceDataUrlBatch'],
    capability: 'resource-wire',
    owners: [{ layer: 'services', domain: 'resource-cache' }],
  },
  {
    role: 'api',
    domain: 'query',
    names: ['resolveModRelativePath'],
    capability: 'resource-path-wire',
    owners: [{ layer: 'services', domain: 'resource-reference' }],
  },
  {
    role: 'service',
    domain: 'session',
    names: ['openProject'],
    capability: 'session-open',
    owners: [{ layer: 'orchestrators', domain: 'directory-opening' }],
  },
  {
    role: 'service',
    domain: 'session',
    names: ['closeProject'],
    capability: 'session-close',
    owners: ['directory-opening', 'workspace-lifecycle'].map((domain) => ({ layer: 'orchestrators', domain })),
  },
  {
    role: 'service',
    domain: 'session',
    names: ['requestProjectSessionRefresh', 'synchronizeSessionCommit'],
    capability: 'session-refresh',
    owners: [{ layer: 'orchestrators', domain: 'project-session-refresh' }],
  },
  {
    role: 'service',
    domain: 'session',
    names: ['invalidateCoreCacheForRoot'],
    capability: 'core-cache-clear',
    owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
  },
  {
    role: 'service',
    domain: 'session',
    names: ['pickDirectory', 'detectDirectoryTarget', 'scanDirectoryGameOverview'],
    capability: 'directory-read',
    owners: [
      { layer: 'orchestrators', domain: 'directory-opening' },
      { layer: 'orchestrators', domain: 'workspace-persistence' },
      { layer: 'app', domain: 'workspace-shell-actions' },
    ],
  },
  {
    role: 'api',
    domain: 'session',
    names: [
      'openProjectSession',
      'closeProjectSession',
      'invalidateProjectSession',
      'synchronizeCommittedWrite',
      'invalidateCoreCache',
      'detectDirectory',
      'scanGameOverview',
    ],
    capability: 'session-wire',
    owners: [{ layer: 'services', domain: 'session' }],
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
    current.layer === owner.layer &&
    (owner.domain === undefined || current.domain === owner.domain) &&
    (owner.role === undefined || current.role === owner.role)
  );
}

const serviceEdges = new Set([
  'query -> query-cache',
  'resource-media -> resource-cache',
  'config-entity -> config-resource',
  'config-entity -> query',
  'config-resource -> query',
  'config-resource -> resource-cache',
  'csv-table -> query',
  'csv-table -> resource-cache',
  'files -> write',
  'editor -> files',
  'editor -> query',
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
