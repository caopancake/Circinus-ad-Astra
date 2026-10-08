/** @typedef {'external' | 'test' | 'shared' | 'domain' | 'services' | 'stores' | 'orchestrators' | 'windows' | 'app' | 'styles' | 'unknown'} FrontendLayer */
/** @typedef {{ layer: FrontendLayer, role: string, domain: string | null }} FrontendPathClass */

/** @param {string} path @returns {FrontendPathClass} */
export function classifyFrontendPath(path) {
  if (!path.startsWith('src/')) return { layer: 'external', role: 'external', domain: null };
  if (/\.spec\.(ts|tsx)$/.test(path)) return { layer: 'test', role: 'test', domain: null };
  if (path.startsWith('src/shared/api/')) return { layer: 'shared', role: 'api', domain: sharedApiDomain(path) };
  if (path.startsWith('src/shared/')) return { layer: 'shared', role: 'shared', domain: sharedDomain(path) };
  if (path.startsWith('src/domain/')) return { layer: 'domain', role: roleFor(path), domain: segment(path, 2) };
  if (path.startsWith('src/services/')) return { layer: 'services', role: 'service', domain: serviceDomain(path) };
  if (path.startsWith('src/stores/')) return { layer: 'stores', role: 'store', domain: suffixDomain(path, '.store.ts') };
  if (path.startsWith('src/orchestrators/'))
    return { layer: 'orchestrators', role: 'orchestrator', domain: suffixDomain(path, '.orchestrator.ts') };
  if (path.startsWith('src/windows/')) return { layer: 'windows', role: 'window', domain: windowDomain(path) };
  if (path.startsWith('src/app/')) return { layer: 'app', role: roleFor(path), domain: appDomain(path) };
  if (path.startsWith('src/styles/')) return { layer: 'styles', role: 'style', domain: null };
  return { layer: 'unknown', role: 'unknown', domain: null };
}

/** @param {string} path @returns {string} */
export function roleFor(path) {
  if (path.endsWith('.vue')) return 'component';
  if (path.endsWith('.store.ts')) return 'store';
  if (path.endsWith('.service.ts')) return 'service';
  if (path.endsWith('.orchestrator.ts')) return 'orchestrator';
  if (path.endsWith('.window.ts')) return 'window';
  if (path.endsWith('.events.ts')) return 'events';
  if (path.endsWith('.types.ts')) return 'types';
  if (path.includes('/composables/')) return 'composable';
  if (path.includes('/lib/')) return 'lib';
  return 'module';
}

/** @param {string} path @param {number} index @returns {string | null} */
function segment(path, index) {
  return path.split('/')[index]?.replace(/\.(?:ts|tsx|js|jsx|mjs|vue)$/, '') ?? null;
}

/** @param {string} path @returns {string | null} */
function appDomain(path) {
  const parts = path.split('/');
  if (parts[2] === 'components') return parts[3] ?? null;
  if (parts[2] === 'composables') {
    // Composables may sit in domain subdirectories; the semantic domain is
    // always derived from the file name, never from the group folder.
    const fileName = parts.at(-1) ?? '';
    return composableDomain(fileName);
  }
  if ((parts[2] ?? '').startsWith('EditorWindow')) return 'editor-window';
  if ((parts[2] ?? '').endsWith('Window.vue')) return 'window-root';
  return parts[2]?.replace(/\.(?:ts|vue)$/, '') ?? null;
}

/** @param {string} fileName @returns {string | null} */
function composableDomain(fileName) {
  if (!fileName.startsWith('use-')) return fileName.replace(/\.ts$/, '') || null;
  return fileName.replace(/^use-/, '').replace(/\.ts$/, '');
}

/** @param {string} path @returns {string | null} */
function serviceDomain(path) {
  return suffixDomain(path, '.service.ts');
}

/** @param {string} path @returns {string} */
function sharedDomain(path) {
  return path.split('/')[2] ?? 'shared';
}

/** @param {string} path @returns {string | null} */
function sharedApiDomain(path) {
  return suffixDomain(path, '-api.ts');
}

/** @param {string} path @returns {string | null} */
function windowDomain(path) {
  const fileName = path.split('/').at(-1) ?? '';
  if (fileName.endsWith('.events.ts')) return fileName.replace(/\.events\.ts$/, '');
  return suffixDomain(path, '.window.ts');
}

/** @param {string} path @param {string} suffix @returns {string | null} */
function suffixDomain(path, suffix) {
  return path.split('/').at(-1)?.replace(suffix, '') ?? null;
}
