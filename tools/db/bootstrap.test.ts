/**
 * Pure parts of the bootstrap runner and the reset guard (the PostgreSQL 18 runs are prisma/tests/bootstrap).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { BootstrapError, DEFAULT_BOOTSTRAP_DIR, listBootstrapFiles, readSecret, runBootstrap } from './bootstrap.js';
import { resetTarget } from './reset.js';
import { referencedVariables } from './sql-text.js';

const work = mkdtempSync(join(tmpdir(), 'bootstrap-unit-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('bootstrap lane files (data-model §4.4, §8.1)', () => {
  const files = listBootstrapFiles(DEFAULT_BOOTSTRAP_DIR);

  it('lists the lane in file-name order with SHA-256 digests of the bytes', () => {
    expect(files.map((file) => file.name)).toEqual(['00-roles.sql', '01-schemas.sql']);
    expect(files.every((file) => file.sha256.length === 32)).toBe(true);
  });

  it('holds placeholders, never values: only the password variables and the reserved db_name are referenced', () => {
    expect(referencedVariables(files[0]?.sql ?? '')).toEqual(['app_password', 'db_name', 'migrator_password']);
    expect(referencedVariables(files[1]?.sql ?? '')).toEqual([]);
    for (const file of files) expect(file.sql).not.toMatch(/PASSWORD\s+'/i);
  });

  it('pins the bootstrap role search path in the database as the last statement of 00-roles.sql (SEC-P3-34 item 1)', () => {
    const roles = readFileSync(join(DEFAULT_BOOTSTRAP_DIR, '00-roles.sql'), 'utf8').trim().split('\n');
    expect(roles.at(-1)).toBe('ALTER ROLE CURRENT_USER IN DATABASE :"db_name" SET search_path = pg_catalog, pg_temp;');
  });

  it('runs the default-privilege statements only after schema platform exists (SEC-P3-37 item 1)', () => {
    const roles = files[0]?.sql ?? '';
    const schemas = files[1]?.sql ?? '';
    expect(roles).not.toMatch(/^ALTER DEFAULT PRIVILEGES/m);
    expect(schemas.indexOf('ALTER DEFAULT PRIVILEGES')).toBeGreaterThan(schemas.indexOf('CREATE SCHEMA IF NOT EXISTS platform'));
  });

  it('rejects a file name outside NN-name.sql', () => {
    const dir = mkdtempSync(join(work, 'names-'));
    writeFileSync(join(dir, 'roles.sql'), 'SELECT 1;');
    expect(() => listBootstrapFiles(dir)).toThrow(/does not match NN-name\.sql/);
  });

  it('refuses the reserved db_name variable before connecting', async () => {
    await expect(runBootstrap({ connection: { host: 'unused.invalid' }, vars: { db_name: 'x' } })).rejects.toThrow(
      /variable db_name is reserved/,
    );
  });

  it('reads secrets from the variable or from the *_FILE path, and fails when neither is set', () => {
    const file = join(work, 'secret');
    writeFileSync(file, 'from-file\n');
    expect(readSecret({ S: 'direct' }, 'S')).toBe('direct');
    expect(readSecret({ S_FILE: file }, 'S')).toBe('from-file');
    expect(() => readSecret({}, 'S')).toThrow(BootstrapError);
  });
});

describe('db:reset guard', () => {
  it('needs --yes and a loopback host, and never touches the maintenance or template databases', () => {
    expect(resetTarget('postgresql://admin@127.0.0.1:5432/platform', ['--yes'])).toEqual({
      database: 'platform',
      maintenanceUrl: 'postgresql://admin@127.0.0.1:5432/postgres',
    });
    expect(() => resetTarget('postgresql://admin@127.0.0.1:5432/platform', [])).toThrow(/pass --yes/);
    expect(() => resetTarget(undefined, ['--yes'])).toThrow(/DATABASE_BOOTSTRAP_URL is not set/);
    expect(() => resetTarget('postgresql://admin@db.example.com/platform', ['--yes'])).toThrow(/only runs against a loopback host/);
    expect(() => resetTarget('postgresql://admin@localhost/postgres', ['--yes'])).toThrow(/refuses database "postgres"/);
    expect(() => resetTarget('postgresql://admin@localhost/template1', ['--yes'])).toThrow(/refuses database/);
  });
});
