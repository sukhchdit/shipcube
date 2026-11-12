/**
 * Pure parts of the bootstrap runner and the reset guard (the PostgreSQL 18 runs are prisma/tests/bootstrap).
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  BootstrapError,
  DEFAULT_BOOTSTRAP_DIR,
  bootstrapVariables,
  listBootstrapFiles,
  readSecret,
  reapplyDatabaseLevel,
  runBootstrap,
} from './bootstrap.js';
import { resetTarget } from './reset.js';
import { referencedVariables, substituteVariables } from './sql-text.js';

const work = mkdtempSync(join(tmpdir(), 'bootstrap-unit-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** Random test-only role passwords (never committed values). */
const passwords = { migrator: randomBytes(32).toString('base64url'), app: randomBytes(32).toString('base64url') };
const unused = { host: 'unused.invalid' };

describe('role passwords reach the server only as SCRAM-SHA-256 verifiers (PR5-SEC-01)', () => {
  it('substitutes verifiers into 00-roles.sql: the SQL text contains neither plaintext password', () => {
    const roles = readFileSync(join(DEFAULT_BOOTSTRAP_DIR, '00-roles.sql'), 'utf8');
    const sql = substituteVariables(roles, { ...bootstrapVariables({ passwords }), db_name: 'platform' });
    expect(sql).not.toContain(passwords.migrator);
    expect(sql).not.toContain(passwords.app);
    expect(sql.match(/PASSWORD 'SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}'/g)).toHaveLength(2);
  });

  it.each([['migrator_password'], ['app_password'], ['APP_PASSWORD'], ['other_password']])(
    'refuses a plaintext %s variable from the caller before connecting',
    async (name) => {
      const options = { connection: unused, passwords, vars: { [name]: passwords.app } };
      await expect(runBootstrap(options)).rejects.toThrow(new RegExp(`variable ${name} is reserved`));
      await expect(reapplyDatabaseLevel(options)).rejects.toThrow(new RegExp(`variable ${name} is reserved`));
    },
  );

  it('refuses a short or non-ASCII role password before connecting, without echoing it', async () => {
    const short = 'Short-pw-1';
    await expect(runBootstrap({ connection: unused, passwords: { ...passwords, app: short } })).rejects.toThrow(
      /^passwords\.app: a role password must be at least 24 characters long$/,
    );
    await expect(runBootstrap({ connection: unused, passwords: { ...passwords, migrator: `${'ü'.repeat(30)}` } })).rejects.toThrow(
      /^passwords\.migrator: a role password must consist of printable ASCII characters only$/,
    );
  });
});

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
    await expect(runBootstrap({ connection: unused, passwords, vars: { db_name: 'x' } })).rejects.toThrow(/variable db_name is reserved/);
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
  const migrator = 'postgresql://platform_migrator@127.0.0.1:5432/platform';

  it('needs --yes and a loopback host, and never touches the maintenance or template databases', () => {
    expect(resetTarget('postgresql://admin@127.0.0.1:5432/platform', ['--yes'], migrator)).toEqual({
      database: 'platform',
      maintenanceUrl: 'postgresql://admin@127.0.0.1:5432/postgres',
    });
    expect(() => resetTarget('postgresql://admin@127.0.0.1:5432/platform', [], migrator)).toThrow(/pass --yes/);
    expect(() => resetTarget(undefined, ['--yes'], migrator)).toThrow(/DATABASE_BOOTSTRAP_URL is not set/);
    expect(() => resetTarget('postgresql://admin@db.example.com/platform', ['--yes'], migrator)).toThrow(
      /only runs against a loopback host/,
    );
    expect(() => resetTarget('postgresql://admin@localhost/postgres', ['--yes'], migrator)).toThrow(/refuses database "postgres"/);
    expect(() => resetTarget('postgresql://admin@localhost/template1', ['--yes'], migrator)).toThrow(/refuses database/);
  });

  it('checks the host pg actually connects to: host/hostaddr query parameters and an empty host are refused (CR m4, PR5-SEC-03)', () => {
    for (const url of [
      'postgresql://admin@127.0.0.1:5432/platform?host=db.example.com',
      'postgresql://admin@localhost/platform?host=db.example.com',
      'postgresql://admin@127.0.0.1:5432/platform?hostaddr=10.0.0.5',
      'postgresql://admin@127.0.0.1:5432/platform?sslmode=disable&HOST=db.example.com',
    ]) {
      expect(() => resetTarget(url, ['--yes'], migrator)).toThrow(/refuses host\/hostaddr query parameters in DATABASE_BOOTSTRAP_URL/);
    }
    expect(() => resetTarget('postgresql://admin@127.0.0.1:5432/platform', ['--yes'], `${migrator}?host=db.example.com`)).toThrow(
      /refuses host\/hostaddr query parameters in DATABASE_MIGRATOR_URL/,
    );
    expect(() => resetTarget('postgresql:///platform', ['--yes'], migrator)).toThrow(/DATABASE_BOOTSTRAP_URL names no host/);
    expect(() => resetTarget('mysql://admin@127.0.0.1/platform', ['--yes'], migrator)).toThrow(/must be a postgres/);
    expect(() => resetTarget('not a url', ['--yes'], migrator)).toThrow(/DATABASE_BOOTSTRAP_URL is not a valid URL/);
  });

  it('accepts other loopback forms and a Unix socket path', () => {
    expect(resetTarget('postgresql://admin@[::1]:5432/platform', ['--yes'], 'postgresql://m@[::1]:5432/platform').database).toBe(
      'platform',
    );
    expect(resetTarget('postgresql://admin@127.0.0.2/platform', ['--yes'], 'postgresql://m@127.0.0.2:5432/platform').database).toBe(
      'platform',
    );
    const socket = 'postgresql://admin@%2Fvar%2Frun%2Fpostgresql/platform';
    expect(resetTarget(socket, ['--yes'], 'postgresql://m@%2Fvar%2Frun%2Fpostgresql/platform')).toEqual({
      database: 'platform',
      maintenanceUrl: 'postgresql://admin@%2Fvar%2Frun%2Fpostgresql/postgres',
    });
  });

  it('requires DATABASE_MIGRATOR_URL to name the same host, port and database as the reset target (CR m4, PR5-SEC-03)', () => {
    const target = 'postgresql://admin@127.0.0.1:5432/platform';
    expect(() => resetTarget(target, ['--yes'], undefined)).toThrow(/DATABASE_MIGRATOR_URL is not set/);
    const mismatch = /DATABASE_MIGRATOR_URL must name the same host, port and database as DATABASE_BOOTSTRAP_URL/;
    expect(() => resetTarget(target, ['--yes'], 'postgresql://m@127.0.0.1:5432/other')).toThrow(mismatch);
    expect(() => resetTarget(target, ['--yes'], 'postgresql://m@db.example.com:5432/platform')).toThrow(mismatch);
    expect(() => resetTarget(target, ['--yes'], 'postgresql://m@127.0.0.1:6543/platform')).toThrow(mismatch);
    expect(() => resetTarget(target, ['--yes'], 'postgresql://m@127.0.0.1/platform?port=6543')).toThrow(mismatch);
    expect(resetTarget(target, ['--yes'], 'postgresql://m@127.0.0.1/platform').database).toBe('platform');
  });
});
