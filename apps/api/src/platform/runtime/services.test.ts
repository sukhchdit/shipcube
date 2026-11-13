import { describe, expect, it } from '@jest/globals';

import { createAuditChainCheck } from '../health/checks/audit-chain.js';
import { createAuditPartitionsCheck } from '../health/checks/audit-partitions.js';
import { createObjectStorageCheck } from '../health/checks/object-storage.js';
import { isPendingCheck, pendingCheck } from './readiness.js';
import { readinessChecks } from './services.js';

// The start-up session-integrity check moved with the database composition to ../db/runtime.ts (runtime.test.ts).
// Both source-scan tripwires (S3 client present, packages/audit exports) are retired: every component is now wired.

describe('pending readiness stubs cannot outlive their replacements (PR-0009 m2, R2-m1, PR9-SEC-11)', () => {
  const fake = { query: () => Promise.resolve({ rows: [] }), ping: () => Promise.resolve('PONG') };
  const audit = {
    partitions: createAuditPartitionsCheck(fake, { onSquatted: () => undefined }),
    chain: createAuditChainCheck(fake),
  };
  const objectStorage = createObjectStorageCheck({ checkBucket: () => Promise.resolve() }, 'documents');
  /** Names of the readiness checks that are pendingCheck stubs (the brand, not the name). */
  const wiredStubs = (): string[] =>
    readinessChecks(fake as never, audit, fake as never, objectStorage)
      .filter(isPendingCheck)
      .map((check) => check.name);

  it('the brand identifies stubs only: a copy and the real database/redis checks are not pending (positive control)', () => {
    const stub = pendingCheck('object_storage');
    expect(isPendingCheck(stub)).toBe(true);
    expect(isPendingCheck({ ...stub })).toBe(false);
    expect(wiredStubs()).not.toContain('database');
    expect(wiredStubs()).not.toContain('redis');
  });

  it('no component is a pending stub once object storage and the audit store are wired', () => {
    expect(wiredStubs()).toEqual([]);
  });

  it('object_storage is a real HeadBucket check, no longer a pending stub (TASK-019)', () => {
    expect(wiredStubs()).not.toContain('object_storage');
    // The tripwire is live: a pending stub in that slot would be detected.
    const withStub = readinessChecks(fake as never, audit, fake as never, pendingCheck('object_storage'));
    expect(withStub.filter(isPendingCheck).map((check) => check.name)).toContain('object_storage');
  });

  it('[PR-0009 m2, D-ARCH-074] the audit components are the real catalogue checks, never stubs (TASK-021)', () => {
    expect(wiredStubs().filter((name) => name.startsWith('audit_'))).toEqual([]);
    // database (the fake), redis, object_storage, then the two audit checks in schema order
    expect(readinessChecks(fake as never, audit, fake as never, objectStorage).slice(3)).toEqual([audit.partitions, audit.chain]);
  });
});
