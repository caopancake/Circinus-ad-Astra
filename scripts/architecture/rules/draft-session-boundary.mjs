import { classifyFrontendPath } from '../../shared/classify.mjs';
import { frontendFile } from '../../shared/files.mjs';
import { importedProjectPaths } from '../../shared/imports.mjs';

const legacyDraftTerms = [
  'useConfigDraft',
  'baseSpec',
  'draftSpec',
  'pendingExternalSpec',
  'baseText',
  'pendingExternalText',
  'setBase',
  'commitDraft',
];
const targetSessionTerms = ['currentTargetKey', 'loadTarget', 'refreshTarget', 'applyExternalForTarget', 'saveDraft'];

export const draftSessionBoundaryRule = {
  name: 'draft-session-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      if (current.layer === 'test') continue;

      for (const imported of importedProjectPaths(file)) {
        if (imported.typeOnly) continue;
        const target = classifyFrontendPath(imported.resolved);
        if (target.domain === 'draft-session' && current.domain !== 'edit-target-draft-session') {
          failures.push(`${file.rel}: business editing modules must use edit target draft session, not draft session primitive`);
        }
        if (isEditSessionPrimitive(target) && !isEditSessionAdapter(current)) {
          failures.push(
            `${file.rel}: edit session primitives must be consumed through their adapters (use-draft-session, use-snapshot-history, file-history store, tables-edit-history store)`,
          );
        }
        if (target.domain === 'config-editor-draft-session' && current.role === 'component' && current.domain === 'config') {
          failures.push(`${file.rel}: config editor components must consume editor ViewModel output, not config draft session`);
        }
        if (current.domain === 'edit-target-draft-session' && ownsBusinessDependency(target)) {
          failures.push(
            `${file.rel}: edit target draft session must receive load/save callbacks instead of importing business dependencies`,
          );
        }
      }

      if (isBusinessEditingModule(current) && legacyDraftTerms.some((term) => file.text.includes(term))) {
        failures.push(`${file.rel}: editing modules must not keep legacy manual draft state or old draft primitive methods`);
      }
      if (current.role === 'component' && current.domain === 'config' && targetSessionTerms.some((term) => file.text.includes(term))) {
        failures.push(`${file.rel}: config editor components must not own edit target draft session actions`);
      }
    }
    return failures;
  },
};

/** @param {import('../../shared/classify.mjs').FrontendPathClass} target @returns {boolean} */
function ownsBusinessDependency(target) {
  return target.role === 'api' || target.role === 'service' || target.role === 'orchestrator' || target.role === 'store';
}

/** @param {import('../../shared/classify.mjs').FrontendPathClass} target @returns {boolean} */
function isEditSessionPrimitive(target) {
  return target.layer === 'domain' && target.domain === 'edit-session';
}

/** @param {import('../../shared/classify.mjs').FrontendPathClass} current @returns {boolean} */
function isEditSessionAdapter(current) {
  if (current.layer === 'test') return true;
  return (
    (current.layer === 'app' &&
      current.role === 'composable' &&
      (current.domain === 'draft-session' || current.domain === 'snapshot-history')) ||
    (current.layer === 'stores' && (current.domain === 'file-history' || current.domain === 'tables-edit-history'))
  );
}

/** @param {import('../../shared/classify.mjs').FrontendPathClass} current @returns {boolean} */
function isBusinessEditingModule(current) {
  if (current.layer !== 'app') return false;
  return (
    current.domain === 'config' ||
    current.domain === 'config-mod-info-view-model' ||
    current.domain === 'editor-window-view-model' ||
    current.domain === 'file-editor-view-model'
  );
}
