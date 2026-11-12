/**
 * Bootstrap sessions on PostgreSQL 18 (TASK-003 fix cycle 1):
 * - PR5-SEC-01: role passwords reach the server only as SCRAM-SHA-256 verifiers, so neither the DDL log
 *   (`log_statement = ddl`, the success path) nor the error log (`log_min_error_statement`, the failure path) holds a
 *   plaintext password, and both roles still log in with it.
 * - CR m6: a runner that cannot get the bootstrap-lane advisory lock fails with a lock timeout instead of hanging.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { DEFAULT_BOOTSTRAP_DIR, LOCK_KEY, reapplyDatabaseLevel, runBootstrap } from '../../../tools/db/bootstrap.js';
import { APP_ROLE, MIGRATOR, PlatformPostgres } from '../harness/postgres.js';

let db: PlatformPostgres;
const work: string[] = [];

beforeAll(async () => {
  db = await PlatformPostgres.start({ log_statement: 'ddl' });
}, 180_000);

afterAll(async () => {
  await db?.stop();
  for (const dir of work) rmSync(dir, { recursive: true, force: true });
});

/** A private copy of the bootstrap lane that a test may modify. */
function laneCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrap-lane-'));
  work.push(dir);
  cpSync(DEFAULT_BOOTSTRAP_DIR, dir, { recursive: true });
  return dir;
}

/** The server log up to a sentinel error raised now, so every earlier line has been flushed. */
async function serverLog(): Promise<string> {
  const sentinel = `log_sentinel_${randomBytes(6).toString('hex')}`;
  const client = await db.superuser('postgres');
  try {
    await expect(client.query(`SELECT 1/0 AS ${sentinel}`)).rejects.toThrow(/division by zero/);
  } finally {
    await client.end();
  }
  const stream = await db.container.logs();
  let text = '';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the sentinel did not reach the server log within 30 s')), 30_000);
      stream.on('data', (chunk: Buffer | string) => {
        text += chunk.toString();
        if (text.includes(sentinel)) {
          clearTimeout(timer);
          resolve();
        }
      });
      stream.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  } finally {
    stream.destroy();
  }
  return text;
}

async function rows<T extends pg.QueryResultRow>(config: pg.ClientConfig, sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client(config);
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

describe('bootstrap sessions', () => {
  it('sends role passwords only as SCRAM-SHA-256 verifiers: no plaintext in the server log on success or error (PR5-SEC-01)', async () => {
    await db.createDatabase('scram_db');
    await db.bootstrap('scram_db');
    const lane = laneCopy();
    appendFileSync(join(lane, '00-roles.sql'), '\nSELECT 1/0;\n');
    const failure = reapplyDatabaseLevel({ connection: db.bootstrapConnection('scram_db'), passwords: db.passwords, dir: lane });
    await expect(failure).rejects.toThrow(/00-roles\.sql failed on scram_db: division by zero \(SQLSTATE 22012\)/);

    const log = await serverLog();
    // Controls: the DDL log captured the role statements (success path) and the failing file (error path).
    expect(log).toMatch(/ALTER ROLE platform_migrator[\s\S]*?PASSWORD 'SCRAM-SHA-256\$4096:/);
    expect(log).toMatch(/STATEMENT:[\s\S]*?SELECT 1\/0;/);
    expect(log).not.toContain(db.passwords.migrator);
    expect(log).not.toContain(db.passwords.app);

    const stored = await rows<{ rolname: string; rolpassword: string }>(
      db.bootstrapConnection('scram_db'),
      'SELECT rolname, rolpassword FROM pg_catalog.pg_authid WHERE rolname = ANY($1) ORDER BY rolname',
      [[APP_ROLE, MIGRATOR]],
    );
    expect(stored.map((row) => row.rolname)).toEqual([APP_ROLE, MIGRATOR]);
    for (const row of stored) expect(row.rolpassword).toMatch(/^SCRAM-SHA-256\$4096:/);

    const app = await rows<{ who: string }>(db.appConnection('scram_db'), 'SELECT CURRENT_USER AS who');
    const migrator = await rows<{ who: string }>(db.migratorConnection('scram_db'), 'SELECT CURRENT_USER AS who');
    expect([app[0]?.who, migrator[0]?.who]).toEqual([APP_ROLE, MIGRATOR]);
  }, 180_000);

  it('fails with a lock timeout instead of waiting forever when another session holds the bootstrap-lane lock (CR m6)', async () => {
    await db.createDatabase('lock_db');
    const holder = await db.superuser('lock_db');
    try {
      await holder.query('SELECT pg_catalog.pg_advisory_lock($1::bigint)', [LOCK_KEY]);
      const started = Date.now();
      await expect(
        runBootstrap({ connection: db.bootstrapConnection('lock_db'), passwords: db.passwords, lockTimeoutMs: 500 }),
      ).rejects.toThrow(/bootstrap lane lock not acquired within 500 ms \(another runner holds it\): .*SQLSTATE 55P03/);
      expect(Date.now() - started).toBeLessThan(20_000);
    } finally {
      await holder.end();
    }
    const ledger = await rows<{ t: string | null }>(
      db.bootstrapConnection('lock_db'),
      "SELECT pg_catalog.to_regclass('public.bootstrap_migrations')::text AS t",
    );
    expect(ledger[0]?.t).toBeNull();
  }, 120_000);
});
