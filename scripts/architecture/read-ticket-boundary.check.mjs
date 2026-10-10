import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { readTicketBoundaryRule } from './rules/read-ticket-boundary.mjs';

test('readers use the formal ticket owner instead of a second acceptance path', () => {
  const files = architectureFixtures({
    'src/app/composables/use-sample.ts':
      "import { createReadTicketOwner } from '@/shared/runtime/read-request'; " +
      "const reads = createReadTicketOwner(); reads.consume('list', {}, load, { ready });",
  });
  assert.deepEqual(readTicketBoundaryRule.check(files), []);
});

test('legacy reader acceptance paths are rejected', () => {
  const files = architectureFixtures({
    'src/app/composables/use-sample.ts': "const reads = createQueryReadOwner(); reads.read('list', {}, load);",
  });
  assert.equal(readTicketBoundaryRule.check(files).length, 2);
});
