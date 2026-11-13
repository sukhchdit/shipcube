import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { createObjectStorageCheck } from '../health/checks/object-storage.js';
import { isPendingCheck, pendingCheck } from './readiness.js';
import { readinessChecks } from './services.js';

// The start-up session-integrity check moved with the database composition to ../db/runtime.ts (runtime.test.ts).

/** Repository root from this file (apps/api/src/platform/runtime). */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('pending readiness stubs cannot outlive their replacements (PR-0009 m2, R2-m1, PR9-SEC-11)', () => {
  const fake = { query: () => Promise.resolve({ rows: [] }), ping: () => Promise.resolve('PONG') };
  const objectStorage = createObjectStorageCheck({ checkBucket: () => Promise.resolve() }, 'documents');
  /** Names of the readiness checks that are pendingCheck stubs (the brand, not the name). */
  const wiredStubs = (): string[] =>
    readinessChecks(fake as never, fake as never, objectStorage)
      .filter(isPendingCheck)
      .map((check) => check.name);

  it('the brand identifies stubs only: a copy and the real database/redis checks are not pending (positive control)', () => {
    const stub = pendingCheck('audit_chain');
    expect(isPendingCheck(stub)).toBe(true);
    expect(isPendingCheck({ ...stub })).toBe(false);
    expect(wiredStubs()).not.toContain('database');
    expect(wiredStubs()).not.toContain('redis');
  });

  it('object_storage is a real HeadBucket check, no longer a pending stub (TASK-019)', () => {
    expect(wiredStubs()).not.toContain('object_storage');
    // The tripwire is live: a pending stub in that slot would be detected.
    const withStub = readinessChecks(fake as never, fake as never, pendingCheck('object_storage'));
    expect(withStub.filter(isPendingCheck).map((check) => check.name)).toContain('object_storage');
  });

  it('once packages/audit exports something, the audit checks are no longer stubs (TASK-021)', () => {
    const auditIndex = readFileSync(join(REPO_ROOT, 'packages', 'audit', 'src', 'index.ts'), 'utf8');
    const exportsSomething = /^export\s+(?!\{\s*\};)/mu.test(auditIndex);
    // When this fails: replace pendingCheck('audit_partitions' | 'audit_chain') with the audit store's real checks.
    expect((exportsSomething ? wiredStubs() : []).filter((name) => name.startsWith('audit_'))).toEqual([]);
  });
});
