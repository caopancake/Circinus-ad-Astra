import { frontendFile, singleFileByRel } from '../../shared/files.mjs';
import { classifyFrontendPath } from '../../shared/classify.mjs';

const storePath = 'src/stores/workspace.store.ts';
const oldWorkspaceNames = ['modList', 'modCount', 'hasAnyMod', 'setGameWorkspace', 'restoreFrom'];
const directWorkspaceWrites = [
  { name: 'activeModRoot', pattern: /\bworkspace\.activeModRoot\s*=(?!=)/ },
  { name: 'currentView', pattern: /\bworkspace\.currentView\s*=(?!=)/ },
  { name: 'configView', pattern: /\bworkspace\.configView\s*=(?!=)/ },
];
const oldWorkspaceCalls = [
  { name: 'removeMod', pattern: /\bworkspace\.removeMod\s*\(/ },
  { name: 'setActiveMod', pattern: /\bworkspace\.setActiveMod\s*\(/ },
  { name: 'setActiveTable', pattern: /\bworkspace\.setActiveTable\s*\(/ },
  { name: 'setActiveConfig', pattern: /\bworkspace\.setActiveConfig\s*\(/ },
  { name: 'navigateTo', pattern: /\bworkspace\.navigateTo\s*\(/ },
];
const componentActivationCalls = /\bworkspace\.(?:activateModOverview|activateModTable|activateModConfig)\s*\(/;
const directoryOpeningDetails = /\b(?:openModProjectManifest|hydrateOpenedModRuntime|rollbackFailedModOpening)\b/;
const lifecycleDetailCalls = /\b(?:invalidateQueryCacheForSession|invalidateResourceCacheForSession|closeProject)\b/;

export const workspaceModuleBoundaryRule = {
  name: 'workspace-module-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    /** @type {string[]} */
    const failures = [];
    for (const file of files) {
      if (frontendFile(file.rel) && classifyFrontendPath(file.rel).layer !== 'test') {
        checkFrontendWorkspaceBoundary(file, failures);
      }
    }
    const workspaceDoc = singleFileByRel(files, '.zcode/modules/workspace.md');
    if (workspaceDoc) {
      checkWorkspaceDocumentBoundary(workspaceDoc, failures);
    }
    return failures;
  },
};

/** @param {import('../../shared/files.mjs').RepoFile} file @param {string[]} failures @returns {void} */
function checkFrontendWorkspaceBoundary(file, failures) {
  for (const name of oldWorkspaceNames) {
    if (new RegExp(`\\b${name}\\b`).test(file.text)) {
      failures.push(`${file.rel}: workspace old API name "${name}" must not remain in frontend code`);
    }
  }

  for (const call of oldWorkspaceCalls) {
    if (call.pattern.test(file.text)) {
      failures.push(`${file.rel}: workspace.${call.name} is not a public workspace runtime action`);
    }
  }

  if (file.rel !== storePath) {
    for (const write of directWorkspaceWrites) {
      if (write.pattern.test(file.text)) {
        failures.push(`${file.rel}: workspace.${write.name} must be changed through workspace store domain actions`);
      }
    }
  }

  if (file.rel.startsWith('src/app/components/') && componentActivationCalls.test(file.text)) {
    failures.push(`${file.rel}: components must activate loaded Mods through workspace navigation actions`);
  }
}

/** @param {import('../../shared/files.mjs').RepoFile} file @param {string[]} failures @returns {void} */
function checkWorkspaceDocumentBoundary(file, failures) {
  if (directoryOpeningDetails.test(file.text)) {
    failures.push(`${file.rel}: workspace document must not expand Directory Opening internal function names`);
  }
  if (lifecycleDetailCalls.test(file.text)) {
    failures.push(`${file.rel}: workspace document must not list session/cache cleanup calls as script steps`);
  }
}
