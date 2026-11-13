import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { createAuditChainCheck } from '../health/checks/audit-chain.js';
import { createAuditPartitionsCheck } from '../health/checks/audit-partitions.js';
import { isPendingCheck, pendingCheck } from './readiness.js';
import { readinessChecks } from './services.js';

// The start-up session-integrity check moved with the database composition to ../db/runtime.ts (runtime.test.ts).

/** Repository root from this file (apps/api/src/platform/runtime). */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('pending readiness stubs cannot outlive their replacements (PR-0009 m2, R2-m1, PR9-SEC-11)', () => {
  const fake = { query: () => Promise.resolve({ rows: [] }), ping: () => Promise.resolve('PONG') };
  const audit = {
    partitions: createAuditPartitionsCheck(fake, { onSquatted: () => undefined }),
    chain: createAuditChainCheck(fake),
  };
  /** Names of the readiness checks that are pendingCheck stubs (the brand, not the name). */
  const wiredStubs = (): string[] =>
    readinessChecks(fake as never, audit, fake as never)
      .filter(isPendingCheck)
      .map((check) => check.name);

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name));

  it('the brand identifies stubs only: a copy and the real database/redis checks are not pending (positive control)', () => {
    const stub = pendingCheck('object_storage');
    expect(isPendingCheck(stub)).toBe(true);
    expect(isPendingCheck({ ...stub })).toBe(false);
    expect(wiredStubs()).not.toContain('database');
    expect(wiredStubs()).not.toContain('redis');
  });

  it('once an S3 client exists in apps/api, object_storage is no longer a stub (TASK-019)', () => {
    const usesS3 = sourceFiles(join(REPO_ROOT, 'apps', 'api', 'src')).some((file) =>
      readFileSync(file, 'utf8').includes('@aws-sdk/client-s3'),
    );
    // When this fails: wire a real HeadBucket check into readinessChecks instead of pendingCheck('object_storage').
    expect(usesS3 ? wiredStubs() : []).not.toContain('object_storage');
  });

  it('[PR-0009 m2, D-ARCH-074] the audit components are the real catalogue checks, never stubs (TASK-021)', () => {
    expect(wiredStubs().filter((name) => name.startsWith('audit_'))).toEqual([]);
    // database (the fake), redis, object_storage, then the two audit checks in schema order
    expect(readinessChecks(fake as never, audit, fake as never).slice(3)).toEqual([audit.partitions, audit.chain]);
  });
});
