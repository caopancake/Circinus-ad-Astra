import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { workspaceModuleBoundaryRule } from './rules/workspace-module-boundary.mjs';

test('workspace activation has its production navigation owner', () => {
  const files = architectureFixtures({
    'src/app/components/tables/Surface.vue': '<script setup lang="ts">workspace.activateModTable("M:/A");</script>',
  });
  assert.equal(workspaceModuleBoundaryRule.check(files).length, 1);
});

test('a colocated input lifecycle test may construct its workspace fixture', () => {
  const files = architectureFixtures({
    'src/app/components/tables/input-lifecycle.spec.ts': 'workspace.activateModTable("M:/A");',
  });
  assert.deepEqual(workspaceModuleBoundaryRule.check(files), []);
});

test('production navigation consumes the workspace activation capability', () => {
  const files = architectureFixtures({
    'src/orchestrators/workspace-navigation.orchestrator.ts': 'workspace.activateModTable("M:/A");',
  });
  assert.deepEqual(workspaceModuleBoundaryRule.check(files), []);
});
