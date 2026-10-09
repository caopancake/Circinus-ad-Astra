import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { collectArchitectureFiles } from '../shared/files.mjs';
import { writeBoundaryRule } from './rules/write-boundary.mjs';
import { frontendLayerBoundaryRule } from './rules/frontend-layer-boundary.mjs';
import { sharedTypesBoundaryRule } from './rules/shared-types-boundary.mjs';
import { draftSessionBoundaryRule } from './rules/draft-session-boundary.mjs';
import { rules } from './rules/index.mjs';
import { rustServiceEdgeBoundaryRule } from './rules/rust-service-edge-boundary.mjs';
import { rustProjectLayerBoundaryRule } from './rules/rust-project-layer-boundary.mjs';

const cases = [
  ['core-fields-read', 'src/orchestrators/core-assets.orchestrator.ts', 'src/services/core-assets.service.ts', 'queryCoreFields'],
  ['core-graphics-read', 'src/orchestrators/core-assets.orchestrator.ts', 'src/services/core-assets.service.ts', 'queryCoreGraphics'],
  [
    'config-list-retry',
    'src/app/composables/config/use-config-list-selection.ts',
    'src/orchestrators/project-session-refresh.orchestrator.ts',
    'retryPendingWritesForMod',
  ],
  [
    'commit-recovery',
    'src/orchestrators/project-session-refresh.orchestrator.ts',
    'src/services/project-session.service.ts',
    'synchronizeSessionCommit',
  ],
  [
    'commit-publication',
    'src/orchestrators/file-history-write.orchestrator.ts',
    'src/orchestrators/project-session-refresh.orchestrator.ts',
    'publishCommittedWrite',
  ],
  [
    'projection-pending-owner',
    'src/orchestrators/project-session-refresh.orchestrator.ts',
    'src/shared/runtime/project-projection.ts',
    'markProjectionPending',
  ],
  ['projection-read-owner', 'src/services/query-cache.service.ts', 'src/shared/runtime/project-projection.ts', 'requireProjectionReady'],
  ['window-open', 'src/windows/managed.window.ts', 'src/services/window.service.ts', 'openNativeManagedWindow'],
  ['window-status', 'src/app/composables/use-dirty-window-close-guard.ts', 'src/services/window.service.ts', 'updateNativeWindowStatus'],
  [
    'window-close-cancel',
    'src/app/composables/use-dirty-window-close-guard.ts',
    'src/services/window.service.ts',
    'cancelNativeWindowClose',
  ],
  [
    'window-session-close',
    'src/orchestrators/workspace-lifecycle.orchestrator.ts',
    'src/services/window.service.ts',
    'closeNativeSessionWindows',
  ],
  ['window-reserve', 'src/orchestrators/entity-identity.orchestrator.ts', 'src/services/window.service.ts', 'reserveNativeWindowTargets'],
  ['window-release', 'src/orchestrators/table-save.orchestrator.ts', 'src/services/window.service.ts', 'releaseNativeWindowTargets'],
  ['window-retarget', 'src/orchestrators/entity-identity.orchestrator.ts', 'src/services/window.service.ts', 'retargetNativeWindow'],
  ['entity-target-query', 'src/services/editor.service.ts', 'src/services/entity-query.service.ts', 'querySessionEntityEditTarget'],
  ['entity-intent-query', 'src/services/editor.service.ts', 'src/services/entity-query.service.ts', 'querySessionEntityIdentityIntent'],
  ['config-write', 'src/orchestrators/config-save.orchestrator.ts', 'src/services/config-entity.service.ts', 'saveModInfo'],
  ['table-write', 'src/orchestrators/table-save.orchestrator.ts', 'src/services/csv-table.service.ts', 'saveCsvPatch'],
  ['spec-write', 'src/services/editor.service.ts', 'src/services/editor.service.ts', 'saveEditorSpec'],
  ['text-write', 'src/app/composables/use-file-editor-view-model.ts', 'src/services/files.service.ts', 'writeEditableFileText'],
  ['text-transcode', 'src/app/app-feedback.ts', 'src/services/files.service.ts', 'transcodeFileToUtf8'],
  [
    'history-replay',
    'src/orchestrators/file-history-replay.orchestrator.ts',
    'src/services/file-history.service.ts',
    'replayFileChangeSet',
  ],
  ['query-cache-load', 'src/services/entity-query.service.ts', 'src/services/query-cache.service.ts', 'queryCached'],
  ['live-query-load', 'src/services/entity-query.service.ts', 'src/services/query-cache.service.ts', 'queryLive'],
  ['source-query', 'src/app/composables/use-sample.ts', 'src/services/source-options.service.ts', 'querySourceOptionCatalog'],
  ['hull-query', 'src/app/composables/use-sample.ts', 'src/services/hull-reference.service.ts', 'queryHullReferenceOptions'],
  [
    'resource-reference',
    'src/app/composables/editors/use-resource-reference.ts',
    'src/services/resource-reference.service.ts',
    'resolveModImageReference',
  ],
  ['query-observe', 'src/app/composables/use-sample.ts', 'src/services/query-cache.service.ts', 'subscribeQueryInvalidations'],
  ['resource-observe', 'src/app/composables/use-sample.ts', 'src/services/resource-cache.service.ts', 'hasResourceInvalidation'],
  ['resource-key', 'src/app/composables/use-sample.ts', 'src/services/resource-cache.service.ts', 'resourceCacheKey'],
  ['resource-read', 'src/services/editor.service.ts', 'src/services/resource-cache.service.ts', 'queryResourceDataUrls'],
  [
    'query-project-invalidate',
    'src/orchestrators/project-session-refresh.orchestrator.ts',
    'src/services/query-cache.service.ts',
    'invalidateQueryCacheByProject',
  ],
  [
    'resource-project-invalidate',
    'src/orchestrators/project-session-refresh.orchestrator.ts',
    'src/services/resource-cache.service.ts',
    'invalidateResourceCacheByProject',
  ],
  [
    'query-session-clear',
    'src/orchestrators/workspace-lifecycle.orchestrator.ts',
    'src/services/query-cache.service.ts',
    'invalidateQueryCacheForSession',
  ],
  [
    'resource-session-clear',
    'src/orchestrators/workspace-lifecycle.orchestrator.ts',
    'src/services/resource-cache.service.ts',
    'invalidateResourceCacheForSession',
  ],
  ['session-open', 'src/orchestrators/directory-opening.orchestrator.ts', 'src/services/project-session.service.ts', 'openProject'],
  ['session-close', 'src/orchestrators/workspace-lifecycle.orchestrator.ts', 'src/services/project-session.service.ts', 'closeProject'],
  ['late-session-close', 'src/orchestrators/directory-opening.orchestrator.ts', 'src/services/project-session.service.ts', 'closeProject'],
  [
    'session-refresh',
    'src/orchestrators/project-session-refresh.orchestrator.ts',
    'src/services/project-session.service.ts',
    'requestProjectSessionRefresh',
  ],
  [
    'core-clear',
    'src/orchestrators/workspace-lifecycle.orchestrator.ts',
    'src/services/core-assets.service.ts',
    'invalidateCoreCacheForRoot',
  ],
  ['directory-read', 'src/app/composables/use-workspace-shell-actions.ts', 'src/services/directory.service.ts', 'pickDirectory'],
  [
    'overview-restore',
    'src/orchestrators/workspace-persistence.orchestrator.ts',
    'src/services/directory.service.ts',
    'scanDirectoryGameOverview',
  ],
];

for (const [capability, from, target, name] of cases) {
  test(`${capability} is accepted at its formal owner`, () => {
    const files = architectureFixtures({
      [from]: `import { ${name} } from '@/${target.slice(4, -3)}';`,
      [target]: `export function ${name}() {}`,
    });
    assert.deepEqual(frontendLayerBoundaryRule.check(files), []);
    assert.deepEqual(writeBoundaryRule.check(files), []);
  });
  test(`${capability} is rejected from a window capability consumer`, () => {
    const files = architectureFixtures({
      'src/windows/audit.window.ts': `import { ${name} } from '@/${target.slice(4, -3)}';`,
      [target]: `export function ${name}() {}`,
    });
    assert.equal([...frontendLayerBoundaryRule.check(files), ...writeBoundaryRule.check(files)].length, 1);
  });
}

test('a ViewModel may observe a cache while project invalidation has its own owner', () => {
  const files = architectureFixtures({
    'src/app/composables/use-sample.ts':
      "import { subscribeQueryInvalidations, invalidateQueryCacheByProject } from '@/services/query-cache.service';",
    'src/services/query-cache.service.ts':
      'export function subscribeQueryInvalidations() {} export function invalidateQueryCacheByProject() {}',
  });
  const failures = writeBoundaryRule.check(files);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /project-cache-invalidate \(invalidateQueryCacheByProject\).*orchestrators\/project-session-refresh/);
});

test('the close boundary owns session cleanup and the refresh boundary owns project invalidation', () => {
  const files = architectureFixtures({
    'src/orchestrators/project-session-refresh.orchestrator.ts':
      "import { invalidateQueryCacheForSession } from '@/services/query-cache.service';",
    'src/orchestrators/workspace-lifecycle.orchestrator.ts':
      "import { invalidateQueryCacheByProject } from '@/services/query-cache.service';",
    'src/services/query-cache.service.ts':
      'export function invalidateQueryCacheForSession() {} export function invalidateQueryCacheByProject() {}',
  });
  assert.equal(writeBoundaryRule.check(files).length, 2);
});

test('explicit and extensionless imports reject the same capability once', () => {
  for (const suffix of ['', '.ts']) {
    const files = architectureFixtures({
      'src/windows/audit.window.ts': `import { saveCsvPatch } from '@/services/csv-table.service${suffix}'; import { saveEditorSpec } from '@/services/editor.service${suffix}';`,
      'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
      'src/services/editor.service.ts': 'export function saveEditorSpec() {}',
    });
    const failures = writeBoundaryRule.check(files);
    assert.equal(failures.length, 2);
    assert.equal(failures.filter((failure) => failure.includes('table-write')).length, 1);
    assert.equal(failures.filter((failure) => failure.includes('spec-write')).length, 1);
  }
});

test('protected namespace, export-star and dynamic module consumption retain capability authorization', () => {
  for (const source of [
    "import * as hidden from '@/shared/bridge';",
    "const hidden = import('@/shared/bridge');",
    "import { patch } from '@/shared/bridge';",
  ]) {
    const files = architectureFixtures({
      'src/app/composables/use-sample.ts': source,
      'src/shared/bridge.ts':
        "export * from '@/services/csv-table.service'; export { saveCsvPatch as patch } from '@/services/csv-table.service';",
      'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
    });
    assert.equal(writeBoundaryRule.check(files).length, 1);
  }
});

test('an imported alias in a forwarding module retains its original symbol permission', () => {
  const files = architectureFixtures({
    'src/app/composables/use-sample.ts': "import { submit } from '@/shared/bridge';",
    'src/shared/bridge.ts': "import { saveCsvPatch as patch } from '@/services/csv-table.service'; export const submit = patch;",
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
  });
  assert.match(writeBoundaryRule.check(files)[0], /table-write \(saveCsvPatch\)/);
});

test('file history public aliases form their formal capability boundary', () => {
  const files = architectureFixtures({
    'src/app/composables/use-sample.ts': "import { loadFileHistory } from '@/services/file-history.service';",
    'src/services/file-history.service.ts': 'export function loadFileHistory() {}',
  });
  assert.deepEqual(writeBoundaryRule.check(files), []);
});

test('one invalid component dependency is reported once across the dependency rules', () => {
  const files = architectureFixtures({
    'src/app/components/editors/Audit.vue':
      '<script setup lang="ts">import { saveCsvPatch } from "@/services/csv-table.service";</script><template><div /></template>',
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
  });
  const failures = rules
    .flatMap((rule) => rule.check(files))
    .filter((failure) => failure.includes('Audit.vue') && (failure.includes('components must') || failure.includes('table-write')));
  assert.equal(failures.length, 1);
});

test('shared type ownership uses resolved module identity for all import forms', () => {
  const files = architectureFixtures({
    'src/shared/types/index.ts': "export type { Shape } from './shape.types';",
    'src/shared/types/shape.types.ts': 'export interface Shape {}',
    'src/shared/types/other.types.ts': "type Shape = import('./index').Shape;",
    'src/domain/sample.ts': "type Shape = import('@/shared/types/shape.types').Shape;",
  });
  assert.equal(sharedTypesBoundaryRule.check(files).length, 2);
});

test('flat edit-session primitives retain their declared adapter ownership', () => {
  const files = architectureFixtures({
    'src/domain/edit-session.ts': 'export function createEditSessionValue() {}',
    'src/app/composables/use-draft-session.ts': "import { createEditSessionValue } from '@/domain/edit-session';",
    'src/app/composables/use-snapshot-history.ts': "import { createEditSessionValue } from '@/domain/edit-session';",
    'src/app/composables/use-sample.ts': "import { createEditSessionValue } from '@/domain/edit-session';",
  });
  assert.equal(draftSessionBoundaryRule.check(files).length, 1);
});

test('every actual repository dependency resolves and all registered rules execute', async () => {
  const files = await collectArchitectureFiles(process.cwd());
  assert.deepEqual(
    files.flatMap((file) => file.dependencyFailures),
    [],
  );
  assert.deepEqual(
    rules.flatMap((rule) => rule.check(files)),
    [],
  );
  const result = spawnSync(process.execPath, ['scripts/check-architecture.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Architecture check passed/);
});

test('runtime exports at protected providers declare their capability contract', () => {
  const files = architectureFixtures({ 'src/services/csv-table.service.ts': 'export function writeExtra() {}' });
  assert.match(writeBoundaryRule.check(files)[0], /writeExtra: public runtime exports must declare/);
});

test('Rust module and layer restrictions report each dependency fact once', () => {
  const horizontal = architectureFixtures({
    'src-tauri/src/services/example.rs': 'use crate::services::app_log::{first, second}; fn run() { crate::services::app_log::first(); }',
  });
  assert.equal(rustServiceEdgeBoundaryRule.check(horizontal).length, 1);
  const layers = architectureFixtures({
    'src-tauri/src/models/example.rs': 'use crate::services::app_log::{first, second}; fn run() { crate::services::app_log::first(); }',
  });
  assert.equal(rustProjectLayerBoundaryRule.check(layers).length, 1);
});

test('Rust public query names retain their facade ownership and internal query modules retain their layer', () => {
  const facade = architectureFixtures({
    'src-tauri/src/services/file_editor.rs': 'fn run() { crate::services::project::query_entity_identity_intent(); }',
  });
  assert.deepEqual(rustProjectLayerBoundaryRule.check(facade), []);
  assert.deepEqual(rustServiceEdgeBoundaryRule.check(facade), []);
  const internal = architectureFixtures({
    'src-tauri/src/services/file_editor.rs': 'fn run() { crate::services::project::query::identity(); }',
  });
  assert.equal(rustProjectLayerBoundaryRule.check(internal).length, 1);
});

test('runtime and type edges share one layer-violation diagnostic', () => {
  const files = architectureFixtures({
    'src/domain/sample.ts': "import { type Shape, run } from '@/stores/sample.store';",
    'src/stores/sample.store.ts': 'export interface Shape {} export function run() {}',
  });
  assert.equal(frontendLayerBoundaryRule.check(files).length, 1);
});

test('production fixture consumption has one diagnostic and tests may consume production', () => {
  for (const source of ["import { fixture } from '@/test/entity-target';", "import type { Fixture } from '@/test/entity-target';"]) {
    const files = architectureFixtures({
      'src/domain/example.ts': source,
      'src/test/entity-target.ts': 'export interface Fixture {} export function fixture() {}',
    });
    const failures = rules.flatMap((rule) => rule.check(files)).filter((failure) => failure.includes('src/domain/example.ts'));
    assert.equal(failures.length, 1);
    assert.match(failures[0], /domain must not import test/);
  }
  const files = architectureFixtures({
    'src/domain/example.spec.ts': "import { example } from './example';",
    'src/domain/example.ts': 'export function example() {}',
  });
  assert.deepEqual(
    rules.flatMap((rule) => rule.check(files)).filter((failure) => failure.includes('src/domain/example.spec.ts')),
    [],
  );
});

test('feedback construction has one owner for direct and forwarded runtime imports', () => {
  for (const source of [
    "import { useMessage, useDialog } from 'naive-ui'; useMessage(); useDialog();",
    "import * as feedback from '@/shared/feedback-bridge';",
    "const feedback = import('@/shared/feedback-bridge');",
  ]) {
    const files = architectureFixtures({
      'src/app/composables/use-sample.ts': source,
      'src/shared/feedback-bridge.ts': "export * from 'naive-ui';",
    });
    assert.equal(
      rules.flatMap((rule) => rule.check(files)).filter((failure) => failure.includes('src/app/composables/use-sample.ts')).length,
      1,
    );
  }
});

test('invoke aliases and namespace imports remain wire capabilities', () => {
  for (const source of ["import { invoke as send } from '@tauri-apps/api/core';", "import * as core from '@tauri-apps/api/core';"]) {
    const files = architectureFixtures({ 'src/windows/audit.window.ts': source });
    assert.equal([...frontendLayerBoundaryRule.check(files), ...writeBoundaryRule.check(files)].length, 1);
    assert.match(writeBoundaryRule.check(files)[0], /invoke-wire/);
  }
  const files = architectureFixtures({
    'src/app/composables/use-sample.ts': "import { send } from '@/shared/runtime/bridge';",
    'src/shared/runtime/bridge.ts': "export { invoke as send } from '@tauri-apps/api/core';",
  });
  assert.match(writeBoundaryRule.check(files)[0], /invoke-wire/);
});

test('the feedback hook consumes the feedback factory through its declared capability', () => {
  const files = architectureFixtures({
    'src/app/app-feedback.ts': 'export function createAppFeedback() {}',
    'src/app/composables/use-app-feedback.ts':
      "import { useMessage } from 'naive-ui/es/message'; import { useDialog } from 'naive-ui/es/dialog'; import { createAppFeedback } from '@/app/app-feedback';",
    'src/app/composables/use-sample.ts': "import { createAppFeedback } from '@/app/app-feedback';",
  });
  assert.equal(writeBoundaryRule.check(files).length, 1);
  assert.match(writeBoundaryRule.check(files)[0], /feedback-factory/);
});

test('a pure domain with the same semantic name retains its own ownership', () => {
  const files = architectureFixtures({
    'src/domain/app-feedback.ts': 'export function createAppFeedback() {}',
    'src/domain/consumer.ts': "import { createAppFeedback } from './app-feedback';",
  });
  assert.deepEqual(writeBoundaryRule.check(files), []);
});

test('command-domain purity has one dependency owner', () => {
  const files = architectureFixtures({
    'src/domain/workspace/commands.ts':
      "import { querySessionEntity } from '@/services/entity-query.service'; export function shortcutCommandFromKeyEvent() {}",
    'src/services/entity-query.service.ts': 'export function querySessionEntity() {}',
  });
  assert.equal(
    rules.flatMap((rule) => rule.check(files)).filter((failure) => failure.includes('src/domain/workspace/commands.ts')).length,
    1,
  );
});

test('window settings consumption is constrained through the actual settings capability module', () => {
  const files = architectureFixtures({
    'src/windows/audit.window.ts': "import { loadSettings } from '@/services/app-settings.service';",
    'src/services/app-settings.service.ts': 'export function loadSettings() {}',
  });
  const failures = rules.flatMap((rule) => rule.check(files)).filter((failure) => failure.includes('src/windows/audit.window.ts'));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /settings-read/);
});
