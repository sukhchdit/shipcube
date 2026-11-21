// Catalog C9 source of truth for idempotency_keys (TASK-040 fix cycle 3): the enum-like CHECKs of the migration equal
// the TypeScript lists the code writes. prisma/tests/catalog/c01-c12.int.test.ts pins the same lists against the live
// schema (it may not import apps/api); this test ties them to the code.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { IDEMPOTENT_METHODS } from './request.js';
import { IDEMPOTENCY_KEY_STATUSES } from './store.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const MIGRATION = join(REPO_ROOT, 'prisma', 'migrations', '20261120100000_idempotency_keys', 'migration.sql');

describe('[C9] idempotency_keys enum CHECKs', () => {
  it('ck_idempotency_keys__method and __status equal IDEMPOTENT_METHODS and IDEMPOTENCY_KEY_STATUSES', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const checkList = (name: string): string[] => {
      const match = new RegExp(`CONSTRAINT "${name}" CHECK \\("[a-z_]+" IN \\(([^)]*)\\)\\)`).exec(sql);
      return (match?.[1] ?? '')
        .split(',')
        .map((value) => value.trim().replace(/^'(.*)'$/, '$1'))
        .sort();
    };
    expect(checkList('ck_idempotency_keys__method')).toEqual([...IDEMPOTENT_METHODS].sort());
    expect(checkList('ck_idempotency_keys__status')).toEqual([...IDEMPOTENCY_KEY_STATUSES].sort());
  });
});
