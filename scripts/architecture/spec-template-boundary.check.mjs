import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { parserBoundaryRule } from './rules/parser-boundary.mjs';

test('the spec construction owner parses its embedded strict JSON template', () => {
  const files = architectureFixtures({
    'src-tauri/src/domain/spec_construction.rs':
      'let defaults = serde_json::from_str(include_str!("../../../schemas/spec-defaults.json"));',
  });
  assert.deepEqual(parserBoundaryRule.check(files), []);
});

test('a project query consumes the formal Mod JSON parser boundary', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/project/query/spec.rs': 'let content = serde_json::from_str(&text);',
  });
  assert.equal(parserBoundaryRule.check(files).length, 1);
});
