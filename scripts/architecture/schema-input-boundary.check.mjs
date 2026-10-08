import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { schemaModuleBoundaryRule } from './rules/schema-module-boundary.mjs';

test('a schema dispatcher must own plain and enhanced mode selection', () => {
  const files = architectureFixtures({
    'src/app/components/schema/Fields.vue':
      '<script setup lang="ts">interface FieldSchema {} defineProps<{ field: FieldSchema }>();</script><template><input v-if="field.type === \'integer\'" /></template>',
  });
  assert.equal(schemaModuleBoundaryRule.check(files).length, 1);
});

test('a scalar input consumes field semantics within its declared presentation', () => {
  const files = architectureFixtures({
    'src/app/components/schema/Scalar.vue':
      '<script setup lang="ts">interface FieldSchema {} defineProps<{ field: FieldSchema }>();</script><template><input :disabled="field.editable === false" /></template>',
  });
  assert.deepEqual(schemaModuleBoundaryRule.check(files), []);
});

test('a dispatcher accepts an inherited effective input mode', () => {
  const files = architectureFixtures({
    'src/app/components/schema/Fields.vue':
      '<script setup lang="ts">interface FieldSchema {} defineProps<{ field: FieldSchema }>(); const plainMode = true;</script><template><input v-if="plainMode && field.type === \'integer\'" /></template>',
  });
  assert.deepEqual(schemaModuleBoundaryRule.check(files), []);
});
