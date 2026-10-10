import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { csvModuleBoundaryRule } from './rules/csv-module-boundary.mjs';

test('table workspace search fields consume the toolbar select outside the grid', () => {
  const files = architectureFixtures({
    'src/app/components/TableWorkspace.vue':
      '<template><n-select :options="searchOptions" @update:value="csvTable.setSearchField" /></template>' +
      "<script setup>import { csvSearchOptions } from '@/domain/tables/csv-search';</script>",
  });
  assert.deepEqual(csvModuleBoundaryRule.check(files), []);
});

test('grid cell selection retains its dedicated picker boundary', () => {
  const files = architectureFixtures({
    'src/app/components/tables/CsvGrid.vue': '<template><n-select :options="searchOptions" /></template>',
  });
  assert.equal(csvModuleBoundaryRule.check(files).length, 1);
});
