import { frontendFile } from '../../shared/files.mjs';

export const windowBoundaryRule = {
  name: 'window-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      if (/export\s+interface\s+(?:EditorSpecSavedEvent|FileEditorSavedEvent)\s*\{[\s\S]*?\bchanges\s*:/m.test(file.text)) {
        failures.push(`${file.rel}: window save events must carry WriteResult, not raw changes`);
      }
    }
    return failures;
  },
};
