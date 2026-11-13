/**
 * SPK-04 (TASK-018) THROWAWAY tripwire (code review R1-M1, D-ORCH-033): the benchmark runner is not executed by any CI
 * lane, so this unit test keeps it from rotting silently. It fails when a file the harness reads is moved or deleted
 * (the bootstrap lane, the migrations, the Postgres harness, the API runtime, the k6 script, the fixture) and when
 * product code starts importing the harness (D-ARCH-089 condition: nothing under apps/** or packages/** may).
 * Lifecycle: deleted by the TASK-280 PR with runner.ts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../../../../tools/test-support/process.js';
import { harnessPaths } from './paths.js';

const repoRoot = findRepoRoot();
const paths = harnessPaths(repoRoot);

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.react-router', 'coverage', 'build']);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) found.push(...sourceFiles(join(dir, entry.name)));
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

describe('SPK-04 harness path tripwire', () => {
  it.each([
    ['bootstrap lane directory', paths.bootstrapDir],
    ['bootstrap 10-audit.sql', paths.bootstrapFiles[0] ?? ''],
    ['bootstrap 90-audit-ddl-guard.sql', paths.bootstrapFiles[1] ?? ''],
    ['migrations directory', paths.migrationsDir],
    ['tenant business fixture', paths.businessFixture],
    ['server entry', paths.serverEntry],
    ['k6 script directory', paths.k6ScriptDir],
    ['k6 script', paths.k6Script],
    ['Postgres test harness', paths.postgresHarness],
    ['API database runtime', paths.apiRuntime],
  ])('%s exists', (_label, path) => {
    expect(path).not.toBe('');
    expect(existsSync(path)).toBe(true);
  });

  it('the bootstrap files are regular files and the migrations directory holds at least one migration.sql', () => {
    for (const file of paths.bootstrapFiles) expect(statSync(file).isFile()).toBe(true);
    const migrations = readdirSync(paths.migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(migrations.length).toBeGreaterThan(0);
    for (const dir of migrations) expect(existsSync(join(paths.migrationsDir, dir.name, 'migration.sql'))).toBe(true);
  });

  it('the real audit bootstrap still creates the tables the harness uses (no private audit DDL is needed)', () => {
    const audit = readFileSync(paths.bootstrapFiles[0] ?? '', 'utf8');
    for (const table of ['audit_entries', 'audit_stream_heads', 'data_subjects', 'audit_pii_vault']) {
      expect(audit).toContain(`CREATE TABLE public.${table}`);
    }
  });

  it('the harness fixture does not create audit objects (the real bootstrap owns them)', () => {
    const fixture = readFileSync(paths.businessFixture, 'utf8');
    expect(fixture).not.toMatch(/CREATE\s+TABLE\s+public\.(?:audit_|data_subjects)/i);
  });

  it('no product code under apps/** or packages/** imports the harness or its fixtures', () => {
    const offenders = [...sourceFiles(join(repoRoot, 'apps')), ...sourceFiles(join(repoRoot, 'packages'))].filter((file) =>
      /spikes\/spk04|spk04-audit|\bSPK04_AUDIT\b/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
