import { classifyFrontendPath } from '../../shared/classify.mjs';
import { dependencyDiagnostic } from '../../shared/frontend-policy.mjs';

export const sharedTypesBoundaryRule = {
  name: 'shared-types-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    for (const file of files) {
      const current = classifyFrontendPath(file.rel);
      if (current.layer === 'test') continue;
      const ownsTypes = current.layer === 'shared' && current.domain === 'types';
      const isBarrel = file.rel.endsWith('/index.ts');
      for (const edge of file.dependencies) {
        const target = classifyFrontendPath(edge.resolved);
        if (target.layer !== 'shared' || target.domain !== 'types') continue;
        const targetBarrel = edge.resolved.endsWith('/index.ts');
        if (ownsTypes && !isBarrel && targetBarrel)
          failures.push(dependencyDiagnostic(file, edge, 'shared type ownership files must consume concrete type files'));
        if (!ownsTypes && !targetBarrel)
          failures.push(dependencyDiagnostic(file, edge, 'shared types must be consumed through the unified barrel'));
      }
    }
    return failures;
  },
};
