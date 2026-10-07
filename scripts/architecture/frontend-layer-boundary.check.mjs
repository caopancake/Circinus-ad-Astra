import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frontendLayerBoundaryRule } from './rules/frontend-layer-boundary.mjs';

test('extensionless relative and alias imports reveal an orchestrator cycle', () => {
  const files = [
    {
      path: 'src/orchestrators/alpha.orchestrator.ts',
      rel: 'src/orchestrators/alpha.orchestrator.ts',
      text: 'import { beta } from "@/orchestrators/beta.orchestrator";',
    },
    {
      path: 'src/orchestrators/beta.orchestrator.ts',
      rel: 'src/orchestrators/beta.orchestrator.ts',
      text: 'import { alpha } from "./alpha.orchestrator";',
    },
  ];
  assert.ok(frontendLayerBoundaryRule.check(files).some((failure) => failure.includes('dependency cycle')));
});

test('one-way runtime imports and type-only edges keep the dependency graph acyclic', () => {
  const files = [
    {
      path: 'src/orchestrators/alpha.orchestrator.ts',
      rel: 'src/orchestrators/alpha.orchestrator.ts',
      text: 'import { beta } from "./beta.orchestrator";',
    },
    {
      path: 'src/orchestrators/beta.orchestrator.ts',
      rel: 'src/orchestrators/beta.orchestrator.ts',
      text: 'import type { Alpha } from "./alpha.orchestrator";',
    },
  ];
  assert.ok(frontendLayerBoundaryRule.check(files).every((failure) => !failure.includes('dependency cycle')));
});
