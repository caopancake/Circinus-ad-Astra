import { classifyFrontendPath } from '../../shared/classify.mjs';
import { frontendFile } from '../../shared/files.mjs';
import { importSpecifiers } from '../../shared/imports.mjs';

export const csvModuleBoundaryRule = {
  name: 'csv-module-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      if (!isCsvGridSurface(file.text, current)) continue;
      if (/<n-select\b/i.test(file.text)) {
        failures.push(`${file.rel}: CSV Grid must use CsvCellPicker instead of Naive select controls`);
      }
      for (const imported of importSpecifiers(file)) {
        if (imported.typeOnly || imported.specifier !== 'naive-ui') continue;
        if (/\bNSelect\b/.test(imported.importedName ?? '')) {
          failures.push(`${file.rel}: CSV Grid must not import Naive select controls`);
        }
      }
      if (/\brevertChanges\s*\(|\bsaveAll[A-Za-z0-9_]*Csv|\bsaveCsvTables\b/.test(file.text)) {
        failures.push(`${file.rel}: CSV actions must stay scoped to the active table`);
      }
    }
    return failures;
  },
};

/** @param {string} text @param {import('../../shared/classify.mjs').FrontendPathClass} current @returns {boolean} */
function isCsvGridSurface(text, current) {
  return current.layer === 'app' && (current.domain === 'tables' || /\bCsvGrid\b/.test(text));
}
