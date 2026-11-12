import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { SessionIntegrityError } from '../db/session-integrity.js';
import { createRuntimeLog } from './log.js';
import { isPendingCheck, pendingCheck } from './readiness.js';
import { readinessChecks, runStartupIntegrityCheck } from './services.js';

/** Repository root from this file (apps/api/src/platform/runtime). */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

const rejectWith = (reason: unknown) =>
  new Promise<never>(() => {
    throw reason;
  });

function capture() {
  const lines: Record<string, unknown>[] = [];
  const log = createRuntimeLog('api', { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) });
  return { lines, log };
}

describe('start-up session-integrity check (PR-0009 M1)', () => {
  it('logs success and resolves true', async () => {
    const { lines, log } = capture();
    await expect(runStartupIntegrityCheck({ recheck: () => Promise.resolve() }, log)).resolves.toBe(true);
    expect(lines).toMatchObject([{ level: 'info', event: 'db.session_integrity_ok' }]);
  });

  it.each([
    ['drift', new SessionIntegrityError(['db_session_default_tampered']), 'SessionIntegrityError'],
    ['an unreachable database', Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { name: 'Error' }), 'Error'],
    ['a non-Error rejection', 'secret-value', 'non-error'],
  ])('never rejects on %s; logs the error class only', async (_label, reason, errorClass) => {
    const { lines, log } = capture();
    const recheck = () => rejectWith(reason);
    await expect(runStartupIntegrityCheck({ recheck }, log)).resolves.toBe(false);
    expect(lines).toMatchObject([{ level: 'warn', event: 'db.session_integrity_failed', error: errorClass }]);
    expect(JSON.stringify(lines)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|secret-value|tampered/u);
  });
});

describe('pending readiness stubs cannot outlive their replacements (PR-0009 m2, R2-m1, PR9-SEC-11)', () => {
  const fake = { query: () => Promise.resolve({ rows: [] }), ping: () => Promise.resolve('PONG') };
  /** Names of the readiness checks that are pendingCheck stubs (the brand, not the name). */
  const wiredStubs = (): string[] =>
    readinessChecks(fake as never, fake as never)
      .filter(isPendingCheck)
      .map((check) => check.name);

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name));

  it('the brand identifies stubs only: a copy and the real database/redis checks are not pending (positive control)', () => {
    const stub = pendingCheck('audit_chain');
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

  it('once packages/audit exports something, the audit checks are no longer stubs (TASK-021)', () => {
    const auditIndex = readFileSync(join(REPO_ROOT, 'packages', 'audit', 'src', 'index.ts'), 'utf8');
    const exportsSomething = /^export\s+(?!\{\s*\};)/mu.test(auditIndex);
    // When this fails: replace pendingCheck('audit_partitions' | 'audit_chain') with the audit store's real checks.
    expect((exportsSomething ? wiredStubs() : []).filter((name) => name.startsWith('audit_'))).toEqual([]);
  });
});
