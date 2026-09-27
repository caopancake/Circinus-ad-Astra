import { classifyFrontendPath } from '../../shared/classify.mjs';
import { frontendFile, specFile } from '../../shared/files.mjs';

const manifestMutationNames = ['registerProjectManifest', 'replaceProjectManifest', 'removeProjectManifest'];
const forbiddenManifestPatchNames = ['updateManifest', 'updateEntitySummary'];
const manifestSummaryFields = ['entitySummaries', 'tableSummaries', 'tableEntitySummaries'];

export const projectSessionBoundaryRule = {
  name: 'project-session-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      // Specs assemble the real project store as test fixtures; manifest
      // ownership governs production call sites only.
      if (specFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      const isProjectStore = current.layer === 'stores' && current.domain === 'project';
      const isDirectoryOpening = current.layer === 'orchestrators' && current.domain === 'directory-opening';
      const isProjectSessionRefresh = current.layer === 'orchestrators' && current.domain === 'project-session-refresh';
      const isWorkspaceLifecycle = current.layer === 'orchestrators' && current.domain === 'workspace-lifecycle';
      const isWorkspaceShellActions = current.layer === 'app' && current.domain === 'workspace-shell-actions';
      const isManifestMutationOwner =
        isProjectStore || isDirectoryOpening || isProjectSessionRefresh || isWorkspaceLifecycle || isWorkspaceShellActions;

      if (isProjectStore && forbiddenManifestPatchNames.some((name) => new RegExp(`\\b${name}\\b`).test(file.text))) {
        failures.push(`${file.rel}: project store must not expose partial ProjectManifest patch APIs`);
      }

      for (const name of manifestMutationNames) {
        if (new RegExp(`\\.${name}\\s*\\(`).test(file.text) && !isManifestMutationOwner) {
          failures.push(`${file.rel}: ProjectManifest mutation must be owned by ProjectSession open/remove/refresh boundaries`);
        }
      }

      if (current.layer === 'app' && manifestSummaryFields.some((field) => new RegExp(`\\b${field}\\b`).test(file.text))) {
        failures.push(`${file.rel}: app ViewModels must not read or write ProjectManifest summary fields`);
      }
    }
    return failures;
  },
};
