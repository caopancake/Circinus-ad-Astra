import { rustFile } from '../../shared/files.mjs';
import { cratePaths } from '../../shared/rust-crate-paths.mjs';
import { productionRustSource } from '../../shared/rust-source.mjs';

// Horizontal edges between top-level backend services. The `project` subtree
// has its own layer matrix (rust-project-layer-boundary) and is referenced
// here only as a single dependency target.
const allowedServiceEdges = new Set([
  'app_config -> app_paths',
  'app_config -> app_settings',
  'app_config -> system_open',
  'app_log -> app_paths',
  'app_log -> app_settings',
  'app_log -> system_open',
  'app_settings -> app_paths',
  'app_settings -> workspace_persistence',
  'app_settings -> file_history',
  'project_session -> app_log',
  'project_session -> app_paths',
  'project_session -> directory_opening',
  'project_session -> project',
  'editor_config -> file_changes',
  'file_editor -> file_changes',
  'file_editor -> project',
  'windows -> project',
  'mod_creation -> directory_opening',
  'workspace_persistence -> app_paths',
  'write_transactions -> app_settings',
  'write_transactions -> file_changes',
  'write_transactions -> file_history',
  'write_transactions -> project',
]);

export const rustServiceEdgeBoundaryRule = {
  name: 'rust-service-edge-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!rustFile(file.rel)) continue;
      const from = topLevelServiceModule(file.rel);
      if (!from) continue;
      const productionText = productionRustSource(file.text);
      const rejected = new Set();
      for (const parts of cratePaths(productionText, file.rel)) {
        if (parts[0] !== 'services' || parts.length < 2) continue;
        const to = parts[1] === 'project' ? 'project' : parts[1];
        if (to === from || allowedServiceEdges.has(`${from} -> ${to}`)) continue;
        if (!rejected.has(to))
          failures.push(`${file.rel}: backend service ${from} must not depend on service ${to} (crate::${parts.join('::')})`);
        rejected.add(to);
      }
    }
    return failures;
  },
};

/** @param {string} rel @returns {string | null} */
function topLevelServiceModule(rel) {
  const match = /^src-tauri\/src\/services\/([^/]+?)(?:\.rs|\/)/.exec(rel);
  if (!match) return null;
  return match[1] === 'project' ? null : match[1];
}
