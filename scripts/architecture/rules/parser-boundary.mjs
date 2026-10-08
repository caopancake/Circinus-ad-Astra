import { rustFile } from '../../shared/files.mjs';
import { cratePaths } from '../../shared/rust-crate-paths.mjs';

export const parserBoundaryRule = {
  name: 'parser-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!rustFile(file.rel)) continue;
      const role = parserRustRole(file.rel);
      if (role === 'parser' && hasLocalStarsectorPath(file.text)) {
        failures.push(`${file.rel}: parser tests must use deterministic inline samples, not local Starsector paths`);
      }
      if (usesStrictJsonParse(file.text) && !mayUseStrictJsonParse(role)) {
        failures.push(`${file.rel}: Mod JSON-like reads must go through alex_json IO/parser boundary`);
      }
      const usedCrates = cratePaths(file.text, file.rel).map((parts) => `crate::${parts.join('::')}`);
      if (usedCrates.some((path) => path.startsWith('crate::parsers::parse_csv_bytes')) && !mayParseCsvBytes(role)) {
        failures.push(`${file.rel}: CSV bytes must be parsed through CSV IO or alex_csv parser tests`);
      }
      if (usedCrates.some((path) => path.startsWith('crate::parsers::render_csv_text')) && !mayRenderCsvText(role)) {
        failures.push(`${file.rel}: CSV text rendering belongs to CSV/config write boundaries`);
      }
    }
    return failures;
  },
};

/** @param {string} rel @returns {'parser' | 'io' | 'tool-json' | 'config-service' | 'project-write' | 'service' | 'other'} */
function parserRustRole(rel) {
  if (rel.startsWith('src-tauri/src/parsers/')) return 'parser';
  if (rel.startsWith('src-tauri/src/io/')) return 'io';
  if (rel.startsWith('src-tauri/src/domain/well_known_labels')) return 'tool-json';
  if (rel.startsWith('src-tauri/src/domain/spec_construction.')) return 'tool-json';
  if (rel.startsWith('src-tauri/src/services/app_settings')) return 'tool-json';
  if (rel.startsWith('src-tauri/src/services/workspace_persistence')) return 'tool-json';
  if (rel.startsWith('src-tauri/src/services/editor_config/')) return 'config-service';
  if (rel.startsWith('src-tauri/src/services/project/write/')) return 'project-write';
  if (rel.startsWith('src-tauri/src/services/')) return 'service';
  return 'other';
}

/** @param {string} text @returns {boolean} */
function hasLocalStarsectorPath(text) {
  return /[A-Z]:\/Starsector|[A-Z]:\\Starsector/.test(text);
}

/** @param {string} text @returns {boolean} */
function usesStrictJsonParse(text) {
  return /\bserde_json::from_str\b/.test(text);
}

/** @param {string} role @returns {boolean} */
function mayUseStrictJsonParse(role) {
  return role === 'parser' || role === 'tool-json';
}

/** @param {string} role @returns {boolean} */
function mayParseCsvBytes(role) {
  return role === 'parser' || role === 'io';
}

/** @param {string} role @returns {boolean} */
function mayRenderCsvText(role) {
  return role === 'parser' || role === 'config-service' || role === 'project-write';
}
