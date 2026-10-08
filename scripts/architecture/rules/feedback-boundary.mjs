import { frontendFile } from '../../shared/files.mjs';
import { classifyFrontendPath } from '../../shared/classify.mjs';
import { importedProjectPaths } from '../../shared/imports.mjs';
import { dependencyDiagnostic } from '../../shared/frontend-policy.mjs';

export const feedbackBoundaryRule = {
  name: 'feedback-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      if (current.layer === 'shared' && current.role === 'api' && mixesSettingsAndFeedbackLogCommands(file.text)) {
        failures.push(`${file.rel}: split app settings and feedback log APIs instead of using a mixed app config API`);
      }
      if (
        current.layer === 'shared' &&
        current.domain === 'types' &&
        !isTypeBarrel(file.text) &&
        mixesSettingsAndFeedbackLogTypes(file.text)
      ) {
        failures.push(`${file.rel}: app settings and app log wire types must live in separate shared type ownership files`);
      }
      if (current.layer === 'services' && current.domain === 'app-settings') {
        assertNoImportDomain(
          file,
          failures,
          { role: 'api', domain: 'app-feedback-log' },
          'app settings service must not import feedback/log API',
        );
      }
      if (current.layer === 'services' && current.domain === 'app-feedback-log') {
        assertNoImportDomain(
          file,
          failures,
          { role: 'api', domain: 'app-settings' },
          'app feedback log service must not import settings API',
        );
        assertNoImportDomain(
          file,
          failures,
          { layer: 'shared', domain: 'types', text: /\bAppSettings\b/ },
          'app feedback log service must use app log types, not settings types',
        );
      }
    }
    return failures;
  },
};

/** @typedef {{ layer?: string, role?: string, domain?: string, text?: RegExp }} ForbiddenTarget */

/** @param {import('../../shared/files.mjs').RepoFile} file @param {string[]} failures @param {ForbiddenTarget} forbiddenTarget @param {string} message @returns {void} */
function assertNoImportDomain(file, failures, forbiddenTarget, message) {
  const reported = new Set();
  for (const imported of importedProjectPaths(file)) {
    const target = classifyFrontendPath(imported.resolved);
    if (targetMatches(target, imported, forbiddenTarget) && !reported.has(imported.resolved)) {
      failures.push(dependencyDiagnostic(file, imported, message));
      reported.add(imported.resolved);
    }
  }
}

/** @param {import('../../shared/classify.mjs').FrontendPathClass} target @param {import('../../shared/imports.mjs').ResolvedImport} imported @param {ForbiddenTarget} forbiddenTarget @returns {boolean} */
function targetMatches(target, imported, forbiddenTarget) {
  if (forbiddenTarget.layer && target.layer !== forbiddenTarget.layer) return false;
  if (forbiddenTarget.role && target.role !== forbiddenTarget.role) return false;
  if (forbiddenTarget.domain && target.domain !== forbiddenTarget.domain) return false;
  const symbolPattern = forbiddenTarget.text;
  if (symbolPattern && !imported.bindings.some((binding) => symbolPattern.test(binding.importedName ?? ''))) return false;
  return true;
}

/** @param {string} text @returns {boolean} */
function mixesSettingsAndFeedbackLogCommands(text) {
  return (
    /\b(?:load_app_settings|save_app_settings)\b/.test(text) &&
    /\b(?:append_app_log|get_app_log_status|open_app_log_file|clear_app_log_file|open_config_dir|clear_config_files)\b/.test(text)
  );
}

/** @param {string} text @returns {boolean} */
function mixesSettingsAndFeedbackLogTypes(text) {
  return /\bAppSettings\b/.test(text) && /\b(?:APP_LOG_LEVELS|AppLogLevel|AppLogEntry|AppLogStatus)\b/.test(text);
}

/** @param {string} text @returns {boolean} */
function isTypeBarrel(text) {
  return !/\b(?:interface|type|const|enum)\s+[A-Za-z0-9_]+/.test(text);
}
