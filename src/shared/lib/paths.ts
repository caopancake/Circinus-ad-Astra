export function normalizeFsPath(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/^\/\/\?\/UNC\//i, '//')
    .replace(/^\/\/\?\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  const prefix = normalized.startsWith('//') ? '//' : normalized.startsWith('/') ? '/' : '';
  return prefix + normalized.split('/').filter(Boolean).join('/');
}

export function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function pathHasParentDirComponent(path: string): boolean {
  return normalizeRelPath(path)
    .split('/')
    .some((part) => part === '..');
}

export function isAbsoluteFsPath(path: string): boolean {
  const normalized = normalizeRelPath(path);
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('/');
}

export function pathBasename(path: string): string {
  return normalizeRelPath(path).split('/').filter(Boolean).pop() || path;
}

export function joinRootRelativePath(root: string, relativePath: string): string {
  const parts = normalizeRelPath(relativePath).split('/').filter(Boolean);
  return [root.replace(/[\\/]+$/, ''), ...parts].join('\\');
}

export function gameModsDirectoryPath(starsectorRoot: string): string {
  return joinRootRelativePath(starsectorRoot, 'mods');
}

export function gameCoreDirectoryPath(starsectorRoot: string): string {
  return joinRootRelativePath(starsectorRoot, 'starsector-core');
}

export function pathBelongsToRoot(path: string, root: string): boolean {
  if (pathHasParentDirComponent(path) || pathHasParentDirComponent(root)) return false;
  const normalizedPath = normalizeFsPath(path);
  const normalizedRoot = normalizeFsPath(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function pathIsProjectScopedChangedPath(path: string, root: string): boolean {
  if (pathHasParentDirComponent(path)) return false;
  return !isAbsoluteFsPath(path) || pathBelongsToRoot(path, root);
}

export function closestRootForPath(roots: Iterable<string>, path: string): string | null {
  const matches = [...roots].filter((root) => pathBelongsToRoot(path, root));
  matches.sort((a, b) => normalizeFsPath(b).length - normalizeFsPath(a).length);
  return matches[0] ?? null;
}

export function relativePathFromRoot(root: string, path: string): string {
  const normalizedPath = normalizeRelPath(path).replace(/^\/\/\?\//, '');
  const comparablePath = normalizeFsPath(path);
  const comparableRoot = normalizeFsPath(root);
  if (comparablePath === comparableRoot) return '';
  return normalizedPath.slice(comparableRoot.length + 1);
}
