import { classifyFrontendPath } from '../../shared/classify.mjs';
import { frontendFile } from '../../shared/files.mjs';

export const editorModuleBoundaryRule = {
  name: 'editor-module-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      if (!isEditorSurface(current)) continue;
      if (/\bqueryCsvTableWindow\s*\(/.test(file.text)) {
        failures.push(`${file.rel}: editor candidates must use source/entity query, not CSV windows`);
      }
      if (
        /function\s+queryEditorEntityBundle[\s\S]*?Promise\.all\(\s*\[[\s\S]*?querySessionEntity\(sessionId,\s*['"]ship['"][\s\S]*?querySessionEntity\(sessionId,\s*['"]weapon['"][\s\S]*?querySessionEntity\(sessionId,\s*['"]projectile['"]/m.test(
          file.text,
        )
      ) {
        failures.push(`${file.rel}: editor bundle query must be selected by editor kind, not a full entity fan-out`);
      }
    }
    return failures;
  },
};

/** @param {import('../../shared/classify.mjs').FrontendPathClass} current @returns {boolean} */
function isEditorSurface(current) {
  return current.layer === 'app' && (current.domain === 'editors' || current.domain === 'editor-window');
}
