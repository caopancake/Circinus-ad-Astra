import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frontendLayerBoundaryRule } from './rules/frontend-layer-boundary.mjs';
import { architectureFixtures } from '../shared/check-fixtures.mjs';

test('extensionless relative and alias imports reveal an orchestrator cycle', () => {
  const files = architectureFixtures({
    'src/orchestrators/alpha.orchestrator.ts': "import { beta } from '@/orchestrators/beta.orchestrator'; export function alpha() {}",
    'src/orchestrators/beta.orchestrator.ts': "import { alpha } from './alpha.orchestrator'; export function beta() {}",
  });
  assert.equal(frontendLayerBoundaryRule.check(files).filter((failure) => failure.includes('dependency cycle')).length, 1);
});

test('one-way runtime imports and type-only edges keep the dependency graph acyclic', () => {
  const files = architectureFixtures({
    'src/orchestrators/alpha.orchestrator.ts': "import { beta } from './beta.orchestrator'; export interface Alpha {}",
    'src/orchestrators/beta.orchestrator.ts': "import type { Alpha } from './alpha.orchestrator'; export function beta() {}",
  });
  assert.deepEqual(frontendLayerBoundaryRule.check(files), []);
});

test('a mixed type import still participates in runtime cycle detection', () => {
  const files = architectureFixtures({
    'src/orchestrators/alpha.orchestrator.ts': "import { type Beta, beta } from './beta.orchestrator'; export function alpha() {}",
    'src/orchestrators/beta.orchestrator.ts':
      "import { alpha } from './alpha.orchestrator'; export interface Beta {} export function beta() {}",
  });
  assert.equal(frontendLayerBoundaryRule.check(files).length, 1);
});

test('component dependency rejection has one owner and one source-positioned diagnostic', () => {
  const files = architectureFixtures({
    'src/app/components/config/Audit.vue':
      '<script setup lang="ts">\nimport { saveCsvPatch, writeEditableFileText } from "@/services/csv-table.service";\n</script><template><div /></template>',
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {} export function writeEditableFileText() {}',
  });
  const failures = frontendLayerBoundaryRule.check(files);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /Audit.vue:2:\d+: src\/services\/csv-table.service.ts: components must consume/);
});

test('layer directions govern type imports and production capability constraints exempt test fixtures', () => {
  const files = architectureFixtures({
    'src/domain/sample.ts': "import type { State } from '@/stores/sample.store';",
    'src/stores/sample.store.ts': 'export interface State {}',
    'src/app/components/sample.spec.ts': "import { saveCsvPatch } from '@/services/csv-table.service';",
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
  });
  assert.equal(frontendLayerBoundaryRule.check(files).length, 1);
});
