import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { SessionIntegrityError } from '../db/session-integrity.js';
import { createRuntimeLog } from './log.js';
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

describe('pending readiness stubs cannot outlive their replacements (PR-0009 m2, PR9-SEC-11)', () => {
  const pendingNames = (): string[] => {
    const fake = { query: () => Promise.resolve({ rows: [] }), ping: () => Promise.resolve('PONG') };
    const checks = readinessChecks(fake as never, fake as never);
    return checks.filter((check) => check.name !== 'database' && check.name !== 'redis').map((check) => check.name);
  };

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name));

  it('object_storage stays pending only while no S3 client exists in apps/api (TASK-019)', () => {
    const usesS3 = sourceFiles(join(REPO_ROOT, 'apps', 'api', 'src')).some((file) =>
      readFileSync(file, 'utf8').includes('@aws-sdk/client-s3'),
    );
    // When this fails: wire a real HeadBucket check into readinessChecks instead of pendingCheck('object_storage').
    expect({ usesS3, pending: pendingNames().includes('object_storage') }).toEqual({ usesS3: false, pending: true });
  });

  it('the audit checks stay pending only while packages/audit exports nothing (TASK-021)', () => {
    const auditIndex = readFileSync(join(REPO_ROOT, 'packages', 'audit', 'src', 'index.ts'), 'utf8');
    const exportsSomething = /^export\s+(?!\{\s*\};)/mu.test(auditIndex);
    // When this fails: replace pendingCheck('audit_partitions' | 'audit_chain') with the audit store's real checks.
    expect({ exportsSomething, pending: pendingNames() }).toEqual({
      exportsSomething: false,
      pending: ['object_storage', 'audit_partitions', 'audit_chain'],
    });
  });
});
