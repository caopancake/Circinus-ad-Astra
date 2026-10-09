import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { commandBoundaryRule } from './rules/command-boundary.mjs';
import { COMMAND_TRANSPORT, commandOwners } from '../shared/command-policy.mjs';

const provider = 'export function invokeCommand() {}';
const imports = [
  "import { invokeCommand as run } from '@/shared/runtime/command.runtime'; run('load_app_settings');",
  "import * as wire from '@/shared/runtime/command.runtime'; wire.invokeCommand('load_app_settings');",
  "import { invokeCommand } from '@/shared/runtime/command.runtime'; const run = invokeCommand; run('load_app_settings');",
  "import { run } from '@/shared/command-bridge'; run('load_app_settings');",
  "const wire = await import('@/shared/runtime/command.runtime'); wire.invokeCommand('load_app_settings');",
  "(await import('@/shared/runtime/command.runtime')).invokeCommand('load_app_settings');",
  "const { invokeCommand: run } = await import('@/shared/runtime/command.runtime'); run('load_app_settings');",
];

for (const [index, source] of imports.entries()) {
  test(`command source form ${index + 1} retains ownership and location`, () => {
    const files = architectureFixtures({
      [COMMAND_TRANSPORT]: provider,
      'src/shared/command-bridge.ts': "export { invokeCommand as run } from '@/shared/runtime/command.runtime';",
      'src/services/app-settings.service.ts': source,
      'src/services/example.service.ts': source,
    });
    const failures = commandBoundaryRule.check(files);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /example\.service\.ts:1:\d+: load_app_settings/);
  });
}

test('computed commands require declared protocol facts', () => {
  const files = architectureFixtures({
    [COMMAND_TRANSPORT]: provider,
    'src/services/app-settings.service.ts': "import { invokeCommand } from '@/shared/runtime/command.runtime'; invokeCommand(name);",
  });
  assert.equal(commandBoundaryRule.check(files).length, 1);
});

test('scoped aliases and shadowed parameters retain their lexical ownership', () => {
  const source =
    "import { invokeCommand } from '@/shared/runtime/command.runtime'; function local(invokeCommand) { invokeCommand('save_app_settings'); } function actual() { const run = invokeCommand; run('load_app_settings'); }";
  const files = architectureFixtures({ [COMMAND_TRANSPORT]: provider, 'src/services/example.service.ts': source });
  const failures = commandBoundaryRule.check(files);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /load_app_settings/);
});

test('every declared command has exactly one capability owner', () => {
  const commands = Object.values(commandOwners).flat();
  assert.equal(commands.length, 60);
  assert.equal(new Set(commands).size, 60);
});
