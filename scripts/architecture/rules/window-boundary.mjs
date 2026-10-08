import { classifyFrontendPath } from '../../shared/classify.mjs';
import { frontendFile } from '../../shared/files.mjs';
import { importedProjectPaths } from '../../shared/imports.mjs';
import { dependencyDiagnostic } from '../../shared/frontend-policy.mjs';

export const windowBoundaryRule = {
  name: 'window-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      for (const imported of importedProjectPaths(file)) {
        if (imported.typeOnly) continue;
        const target = classifyFrontendPath(imported.resolved);
        if (current.layer === 'windows' && target.layer === 'services' && target.domain === 'app-settings') {
          failures.push(dependencyDiagnostic(file, imported, 'windows must receive settings by request data or events'));
        }
      }
      if (current.layer === 'windows' && /\bopenProject\s*\(|\bopenProjectSession\s*\(/.test(file.text)) {
        failures.push(`${file.rel}: child windows must not open ProjectSession`);
      }
      if (/export\s+interface\s+(?:EditorSpecSavedEvent|FileEditorSavedEvent)\s*\{[\s\S]*?\bchanges\s*:/m.test(file.text)) {
        failures.push(`${file.rel}: window save events must carry WriteResult, not raw changes`);
      }
    }
    return failures;
  },
};
