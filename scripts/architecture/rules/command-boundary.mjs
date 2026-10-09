import { dependencyOrigins } from '../../shared/imports.mjs';
import { frontendFile, specFile } from '../../shared/files.mjs';
import { COMMAND_TRANSPORT, commandOwners } from '../../shared/command-policy.mjs';

export const commandBoundaryRule = {
  name: 'command-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const nodes = new Map(files.map((file) => [file.rel, file]));
    const failures = [];
    for (const file of files) {
      if (!frontendFile(file.rel) || specFile(file.rel) || file.rel === COMMAND_TRANSPORT) continue;
      for (const call of file.calls) {
        const edge = file.dependencies.find(
          (edge) =>
            !edge.typeOnly &&
            edge.bindings.some((binding) => (call.specifier ? binding.specifier === call.specifier : binding.localName === call.localName)),
        );
        if (!edge) continue;
        const binding = edge.bindings.find((binding) =>
          call.specifier ? binding.specifier === call.specifier : binding.localName === call.localName,
        );
        if (!binding) continue;
        const origins = dependencyOrigins(
          { ...edge, bindings: [{ ...binding, importedName: call.member ?? binding.importedName }] },
          nodes,
          (rel, name) => rel === COMMAND_TRANSPORT && name === 'invokeCommand',
        );
        if (!origins.some((origin) => origin.rel === COMMAND_TRANSPORT && origin.name === 'invokeCommand')) continue;
        const command = call.command;
        const owners =
          command === null
            ? []
            : Object.entries(commandOwners)
                .filter(([, commands]) => commands.includes(command))
                .map(([owner]) => owner);
        if (!call.command || !owners.includes(file.rel))
          failures.push(
            `${file.rel}:${call.line}:${call.column}: ${call.command ?? 'computed command'}: command must be owned by ${owners.join(', ') || 'a declared capability'}`,
          );
      }
    }
    return failures;
  },
};
