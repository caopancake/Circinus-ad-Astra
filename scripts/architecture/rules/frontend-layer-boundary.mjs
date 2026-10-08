import { classifyFrontendPath } from '../../shared/classify.mjs';
import { frontendFile } from '../../shared/files.mjs';
import { importedProjectPaths } from '../../shared/imports.mjs';
import { dependencyDiagnostic, frontendDependencyFailure } from '../../shared/frontend-policy.mjs';

export const frontendLayerBoundaryRule = {
  name: 'frontend-layer-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      if (current.layer === 'test') continue;
      const rejected = new Set();
      /** @param {import('../../shared/imports.mjs').ResolvedImport} edge @param {string} message */
      function reject(edge, message) {
        const key = JSON.stringify([edge.resolved, message]);
        if (!rejected.has(key)) failures.push(dependencyDiagnostic(file, edge, message));
        rejected.add(key);
      }
      for (const edge of importedProjectPaths(file)) {
        const target = classifyFrontendPath(edge.resolved);
        const reason = frontendDependencyFailure(current, target, edge);
        if (reason) reject(edge, reason);
      }
      if (current.role === 'api' && /\bexport\s+(?:interface|type)\s+(?!\{)/.test(file.text))
        failures.push(`${file.rel}: wire APIs must consume business types from shared/types or domain`);
      if (/\b(?:localStorage|sessionStorage|indexedDB)\b/.test(file.text))
        failures.push(`${file.rel}: app state persistence must use app config services`);
    }
    failures.push(...orchestratorCycleFailures(files));
    return failures;
  },
};

/** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
function orchestratorCycleFailures(files) {
  const modules = files.filter((file) => classifyFrontendPath(file.rel).layer === 'orchestrators');
  const graph = new Map(
    modules.map((file) => [
      file.rel,
      file.dependencies
        .filter((edge) => !edge.typeOnly && classifyFrontendPath(edge.resolved).layer === 'orchestrators')
        .map((edge) => edge.resolved),
    ]),
  );
  const visiting = new Set();
  const visited = new Set();
  /** @type {string[]} */
  const failures = [];
  /** @param {string} rel @param {string[]} trail */
  function visit(rel, trail) {
    if (visiting.has(rel)) {
      failures.push(`${rel}: orchestrator dependency cycle detected: ${[...trail.slice(trail.indexOf(rel)), rel].join(' -> ')}`);
      return;
    }
    if (visited.has(rel)) return;
    visiting.add(rel);
    for (const target of /** @type {string[]} */ (graph.get(rel))) visit(target, [...trail, rel]);
    visiting.delete(rel);
    visited.add(rel);
  }
  for (const rel of graph.keys()) visit(rel, []);
  return failures;
}
