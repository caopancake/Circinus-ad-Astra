import { classifyFrontendPath } from '../../shared/classify.mjs';
import { frontendFile, specFile } from '../../shared/files.mjs';

export const resourceBoundaryRule = {
  name: 'resource-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      // Spec fixtures may shape plain ResourceRef wire data and mock the cache
      // service directly; the boundary governs production call sites only.
      if (specFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      if (/\bqueryResourceDataUrl\b|\bquery_resource_data_url\b/.test(file.text)) {
        failures.push(`${file.rel}: single resource data URL APIs are forbidden`);
      }
      if (current.layer !== 'services' && current.layer !== 'shared' && /\bqueryResourceDataUrls\b/.test(file.text)) {
        failures.push(`${file.rel}: batch resource API must be wrapped by resource-cache service`);
      }
      if (/\bPromise\.all\s*\([^)]*queryResource/s.test(file.text)) {
        failures.push(`${file.rel}: resource loading must use one batch request, not per-item promises`);
      }
      if (current.layer !== 'shared' && /source\s*:\s*['"](?:mod|core)['"]|\b(ownerKind|ownerId)\s*:/.test(file.text)) {
        failures.push(`${file.rel}: ResourceRef objects are backend query output; frontend must not construct them`);
      }
    }
    return failures;
  },
};
