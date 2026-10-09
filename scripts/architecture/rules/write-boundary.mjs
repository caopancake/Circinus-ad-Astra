import { classifyFrontendPath } from '../../shared/classify.mjs';
import { frontendFile } from '../../shared/files.mjs';
import {
  capabilityFor,
  capabilityOrigins,
  hasCapabilityBoundary,
  canConsumeCapability,
  dependencyDiagnostic,
  frontendDependencyFailure,
} from '../../shared/frontend-policy.mjs';

export const writeBoundaryRule = {
  name: 'write-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const nodes = new Map(files.map((file) => [file.rel, file]));
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel)) continue;
      const current = classifyFrontendPath(file.rel);
      if (current.layer === 'test') continue;
      if (hasCapabilityBoundary(current, file.rel)) {
        for (const binding of file.exports) {
          if (!binding.typeOnly && !capabilityFor(file.rel, binding.exportedName))
            failures.push(`${file.rel}: ${binding.exportedName}: public runtime exports must declare their capability ownership`);
        }
      }
      for (const edge of file.dependencies) {
        if (edge.typeOnly) continue;
        const target = classifyFrontendPath(edge.resolved);
        if (frontendDependencyFailure(current, target, edge)) continue;
        const origins = capabilityOrigins(edge, nodes);
        /** @type {Map<string, {names: Set<string>, owners: import('../../shared/frontend-policy.mjs').Owner[]}>} */
        const rejected = new Map();
        for (const origin of origins) {
          const capability = capabilityFor(origin.rel, origin.name);
          if (capability && !canConsumeCapability(current, capability)) {
            const rejection = rejected.get(capability.capability) ?? { names: new Set(), owners: capability.owners };
            rejection.names.add(origin.name);
            rejected.set(capability.capability, rejection);
          }
        }
        for (const [capability, rejection] of rejected) {
          const owners = rejection.owners.map((owner) => [owner.layer, owner.domain ?? owner.role].filter(Boolean).join('/')).join(', ');
          failures.push(
            dependencyDiagnostic(file, edge, `${capability} (${[...rejection.names].sort().join(', ')}) must be owned by ${owners}`),
          );
        }
      }
    }
    return failures;
  },
};
