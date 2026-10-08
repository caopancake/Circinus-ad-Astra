import { prepareArchitectureFiles } from './imports.mjs';
import assert from 'node:assert/strict';

/** @param {Record<string, string>} sources @returns {import('./files.mjs').RepoFile[]} */
export function architectureFixtures(sources) {
  const config = JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } });
  return prepareArchitectureFiles(Object.entries({ 'tsconfig.json': config, ...sources }).map(([rel, text]) => ({ path: rel, rel, text })));
}

/** @param {import('./files.mjs').RepoFile[]} files @param {(file: import('./files.mjs').RepoFile) => boolean} predicate @returns {import('./files.mjs').RepoFile} */
export function fixtureFile(files, predicate) {
  const file = files.find(predicate);
  assert.ok(file, 'the declared source fixture exists');
  return file;
}
