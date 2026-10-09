import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { prepareArchitectureFiles } from './imports.mjs';

const ignoredDirs = new Set(['.git', 'dist', 'node_modules', 'release', 'target']);
const ignoredPathParts = ['src-tauri/gen', 'src-tauri/target'];
const architectureExtensions = new Set(['.css', '.js', '.json', '.jsx', '.mjs', '.rs', '.ts', '.tsx', '.vue']);

/** @typedef {{ path: string, rel: string }} RepoPath */
/** @typedef {RepoPath & { text: string }} SourceFile */
/** @typedef {SourceFile & import('./frontend-source.mjs').FrontendSource & { dependencies: import('./imports.mjs').ResolvedImport[], dependencyFailures: string[] }} RepoFile */

/**
 * Walks the repository once with the shared ignore rules and keeps the files
 * accepted by `include(rel, extension)`. Collection-scope differences between
 * entry scripts are expressed only through the predicate.
 *
 * @param {string} root
 * @param {(rel: string, extension: string) => boolean} include
 * @returns {Promise<RepoPath[]>}
 */
export async function collectRepoPaths(root, include) {
  return collectPaths(root, root, include);
}

/**
 * Architecture-entry view of the repository: sources plus the module docs the
 * docs contract governs. Every returned file is read eagerly.
 *
 * @param {string} root
 * @returns {Promise<RepoFile[]>}
 */
export async function collectArchitectureFiles(root) {
  const available = await collectRepoPaths(root, () => true);
  const paths = available.filter((file) => isArchitecturePath(file.rel, extname(file.rel)));
  const files = await Promise.all(
    paths.map(async (path) => ({
      ...path,
      text: await readFile(path.path, 'utf8'),
    })),
  );
  return prepareArchitectureFiles(
    files,
    available.map((file) => file.rel),
  );
}

/**
 * @param {string} rel
 * @param {string} extension
 * @returns {boolean}
 */
function isArchitecturePath(rel, extension) {
  const isModuleDoc = extension === '.md' && rel.startsWith('.zcode/modules/');
  const isModuleMap = extension === '.md' && rel === '.zcode/module-map.md';
  return (
    (architectureExtensions.has(extension) && (extension !== '.json' || rel.startsWith('schemas/') || rel === 'tsconfig.json')) ||
    isModuleDoc ||
    isModuleMap
  );
}

/** @param {string} path @returns {boolean} */
export function frontendFile(path) {
  return path.startsWith('src/') && /\.(?:ts|tsx|js|jsx|mjs|vue)$/.test(path);
}

/// Colocated test files: production naming and failure-semantics conventions
/// do not govern them.
/** @param {string} path @returns {boolean} */
export function specFile(path) {
  return /\.spec\.(ts|tsx)$/.test(path) || path.startsWith('src/test/');
}

/** @param {string} path @returns {boolean} */
export function rustFile(path) {
  return path.endsWith('.rs');
}

/**
 * Rust command modules are the only allowed save/load command surface.
 * @param {string} path
 * @returns {boolean}
 */
export function rustCommandModule(path) {
  return path.startsWith('src-tauri/src/commands/');
}

/** @param {RepoFile[]} files @param {string} rel @returns {RepoFile | undefined} */
export function singleFileByRel(files, rel) {
  return files.find((file) => file.rel === rel);
}

/**
 * @param {string} root
 * @param {string} dir
 * @param {(rel: string, extension: string) => boolean} include
 * @returns {Promise<RepoPath[]>}
 */
async function collectPaths(root, dir, include) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const rel = normalizePath(relative(root, path));
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name) || ignoredPathParts.some((part) => rel.startsWith(`${part}/`) || rel === part)) continue;
      files.push(...(await collectPaths(root, path, include)));
      continue;
    }
    const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')) : '';
    if (include(rel, extension)) files.push({ path, rel });
  }
  return files;
}

/** @param {string} path @returns {string} */
function normalizePath(path) {
  return path.replace(/\\/g, '/');
}
