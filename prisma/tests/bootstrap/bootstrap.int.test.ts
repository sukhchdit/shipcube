/**
 * Bootstrap lane on PostgreSQL 18 (data-model.md §4.4, §8.1; SEC-P3-27 item 4, SEC-P3-34, SEC-P3-37 item 1;
 * TASK-003). The runner is tools/db/bootstrap.ts; the files are prisma/bootstrap/*.sql.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { BootstrapError, DEFAULT_BOOTSTRAP_DIR, LEDGER_TABLE, connectPrivileged, runBootstrap } from '../../../tools/db/bootstrap.js';
import { normaliseSchemaDump } from '../../../tools/db/up-down-up.js';
import { APP_ROLE, MIGRATOR, PlatformPostgres, SUPERUSER } from '../harness/postgres.js';

const FILES = readdirSync(DEFAULT_BOOTSTRAP_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

let db: PlatformPostgres;
const work: string[] = [];

/** A private copy of the bootstrap lane that a test may modify. */
function laneCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrap-lane-'));
  work.push(dir);
  cpSync(DEFAULT_BOOTSTRAP_DIR, dir, { recursive: true });
  return dir;
}

async function query<T extends pg.QueryResultRow>(database: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await db.superuser(database);
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

async function asRole<T extends pg.QueryResultRow>(config: pg.ClientConfig, sql: string): Promise<T[]> {
  const client = new pg.Client(config);
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

/** SQLSTATE of the error `sql` raises for `config`, or 'none'. */
async function sqlState(config: pg.ClientConfig, sql: string): Promise<string> {
  try {
    await asRole(config, sql);
    return 'none';
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
}

beforeAll(async () => {
  db = await PlatformPostgres.start();
}, 180_000);

afterAll(async () => {
  work.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  await db?.stop();
});

describe('bootstrap runner (data-model §8.1)', () => {
  it('applies every file in file-name order and records each in the ledger with its SHA-256', async () => {
    await db.createDatabase('order_db');
    const result = await db.bootstrap('order_db');
    expect(result.applied).toEqual(FILES);
    expect(FILES).toEqual(['00-roles.sql', '01-schemas.sql', '02-role-backstops.sql']);
    const rows = await query<{ file_name: string; sha256: Buffer; applied_by: string }>(
      'order_db',
      `SELECT file_name, sha256, applied_by FROM ${LEDGER_TABLE} ORDER BY applied_at, file_name`,
    );
    expect(rows.map((row) => row.file_name)).toEqual(FILES);
    for (const row of rows) {
      const expected = createHash('sha256')
        .update(readFileSync(join(DEFAULT_BOOTSTRAP_DIR, row.file_name)))
        .digest('hex');
      expect(row.sha256.toString('hex')).toBe(expected);
      expect(row.applied_by).toBe(SUPERUSER);
    }
  }, 120_000);

  it('is idempotent: a second run applies nothing, and re-running the files themselves changes nothing', async () => {
    await db.createDatabase('idem_db');
    await db.bootstrap('idem_db');
    const again = await db.bootstrap('idem_db');
    expect(again.applied).toEqual([]);
    expect(again.skipped).toEqual(FILES);
    // The files are idempotent too: a lane copy without the ledger rows re-applies them cleanly.
    const before = normaliseSchemaDump(await db.dumpSchema('idem_db'));
    await query('idem_db', `DELETE FROM ${LEDGER_TABLE}`);
    const rerun = await db.bootstrap('idem_db');
    expect(rerun.applied).toEqual(FILES);
    expect(normaliseSchemaDump(await db.dumpSchema('idem_db'))).toBe(before);
    expect(before).toContain('CREATE SCHEMA platform');
  }, 120_000);

  it('fails on a changed SHA-256 of an applied file and applies nothing after it', async () => {
    const lane = laneCopy();
    await db.createDatabase('sha_db');
    await db.bootstrap('sha_db', lane);
    appendFileSync(join(lane, '01-schemas.sql'), '\n-- an edit after the file was applied\n');
    writeFileSync(join(lane, '99-later.sql'), 'SET search_path = pg_catalog, pg_temp;\nCREATE SCHEMA never_created;\n');
    await expect(db.bootstrap('sha_db', lane)).rejects.toThrow(/01-schemas\.sql changed after it was applied/);
    const schemas = await query<{ n: string }>(
      'sha_db',
      "SELECT count(*)::text AS n FROM pg_catalog.pg_namespace WHERE nspname = 'never_created'",
    );
    expect(schemas[0]?.n).toBe('0');
  }, 120_000);

  it('fails when an applied file disappears or a new file sorts before an applied one', async () => {
    const lane = laneCopy();
    await db.createDatabase('order2_db');
    await db.bootstrap('order2_db', lane);
    writeFileSync(join(lane, '00-zz-late.sql'), 'SET search_path = pg_catalog, pg_temp;\n');
    await expect(db.bootstrap('order2_db', lane)).rejects.toThrow(
      /00-zz-late\.sql sorts before the already applied (?:01|02)-[a-z-]+\.sql/,
    );
    rmSync(join(lane, '00-zz-late.sql'));
    rmSync(join(lane, '01-schemas.sql'));
    await expect(db.bootstrap('order2_db', lane)).rejects.toThrow(/missing from the lane: 01-schemas\.sql/);
  }, 120_000);

  it('rolls a failing file back as a whole and records nothing for it', async () => {
    const lane = laneCopy();
    writeFileSync(join(lane, '99-broken.sql'), 'SET search_path = pg_catalog, pg_temp;\nCREATE SCHEMA half_done;\nSELECT 1/0;\n');
    await db.createDatabase('broken_db');
    await expect(db.bootstrap('broken_db', lane)).rejects.toThrow(/99-broken\.sql failed: division by zero \(SQLSTATE 22012\)/);
    const rows = await query<{ file_name: string }>('broken_db', `SELECT file_name FROM ${LEDGER_TABLE} ORDER BY 1`);
    expect(rows.map((row) => row.file_name)).toEqual(FILES);
    const schemas = await query<{ n: string }>(
      'broken_db',
      "SELECT count(*)::text AS n FROM pg_catalog.pg_namespace WHERE nspname = 'half_done'",
    );
    expect(schemas[0]?.n).toBe('0');
  }, 120_000);

  it('refuses before applying anything when a variable is missing or a reserved variable (db_name, *_password) is supplied', async () => {
    await db.createDatabase('vars_db');
    const connection = db.bootstrapConnection('vars_db');
    const lane = laneCopy();
    writeFileSync(join(lane, '02-extra.sql'), "SET search_path = pg_catalog, pg_temp;\nSELECT :'extra_value';\n");
    await expect(runBootstrap({ connection, passwords: db.passwords, dir: lane })).rejects.toThrow(
      /02-extra\.sql needs variable\(s\) extra_value/,
    );
    await expect(runBootstrap({ connection, passwords: db.passwords, vars: { db_name: 'other' } })).rejects.toThrow(BootstrapError);
    await expect(runBootstrap({ connection, passwords: db.passwords, vars: { migrator_password: db.passwords.migrator } })).rejects.toThrow(
      /variable migrator_password is reserved/,
    );
    const ledger = await query<{ t: string | null }>('vars_db', "SELECT pg_catalog.to_regclass('public.bootstrap_migrations')::text AS t");
    expect(ledger[0]?.t).toBeNull();
  }, 120_000);

  it('runs every privileged session with search_path pg_catalog, pg_temp (SEC-P3-27 item 4, SEC-P3-34 item 2)', async () => {
    const client = await connectPrivileged(db.bootstrapConnection('postgres'));
    try {
      expect((await client.query<{ search_path: string }>('SHOW search_path')).rows[0]?.search_path).toBe('pg_catalog,pg_temp');
    } finally {
      await client.end();
    }
    await expect(
      connectPrivileged({ connectionString: `${db.migratorUrl('postgres')}?options=-c%20search_path%3Dpublic` }),
    ).rejects.toThrow(/must not carry an options parameter/);
  }, 60_000);
});

describe('roles, ownership and grants after bootstrap (data-model §4.4)', () => {
  let database: string;
  beforeAll(async () => {
    database = await db.clone(await db.template({ migrated: false }));
  }, 180_000);

  it('[AT-US-074-04] the runtime role platform_app is not superuser, has no BYPASSRLS, CREATEROLE or CREATEDB and owns nothing', async () => {
    const roles = await query<Record<string, unknown>>(
      database,
      `SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit, rolcanlogin, rolconnlimit
         FROM pg_catalog.pg_roles WHERE rolname = $1`,
      [APP_ROLE],
    );
    expect(roles[0]).toEqual({
      rolname: APP_ROLE,
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolinherit: false,
      rolcanlogin: true,
      rolconnlimit: 200,
    });
    const owned = await query<{ n: string }>(
      database,
      `SELECT ((SELECT count(*) FROM pg_catalog.pg_class WHERE relowner = $1::regrole)
             + (SELECT count(*) FROM pg_catalog.pg_proc WHERE proowner = $1::regrole)
             + (SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspowner = $1::regrole))::text AS n`,
      [APP_ROLE],
    );
    expect(owned[0]?.n).toBe('0');
    const memberships = await query<{ n: string }>(
      database,
      'SELECT count(*)::text AS n FROM pg_catalog.pg_auth_members WHERE member = $1::regrole',
      [APP_ROLE],
    );
    expect(memberships[0]?.n).toBe('0');
  }, 60_000);

  it('[AT-US-074-04] the migration role platform_migrator is a different role without superuser, BYPASSRLS, CREATEDB or CREATEROLE', async () => {
    const rows = await query<Record<string, unknown>>(
      database,
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = $1`,
      [MIGRATOR],
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: true });
  }, 60_000);

  it('creates the no-login roles and grants platform_definer to the migrator with INHERIT FALSE, SET TRUE only (C13 local)', async () => {
    const roles = await query<{ rolname: string; rolcanlogin: boolean; rolinherit: boolean; rolbypassrls: boolean }>(
      database,
      `SELECT rolname, rolcanlogin, rolinherit, rolbypassrls FROM pg_catalog.pg_roles
        WHERE rolname IN ('platform_definer', 'platform_audit_owner', 'platform_schema_owner', 'platform_erasure') ORDER BY rolname`,
    );
    expect(roles.map((role) => [role.rolname, role.rolcanlogin, role.rolbypassrls])).toEqual([
      ['platform_audit_owner', false, false],
      ['platform_definer', false, false],
      ['platform_erasure', false, false],
      ['platform_schema_owner', false, false],
    ]);
    const members = await query<{ role: string; member: string; admin_option: boolean; inherit_option: boolean; set_option: boolean }>(
      database,
      `SELECT roleid::regrole::text AS role, member::regrole::text AS member, admin_option, inherit_option, set_option
         FROM pg_catalog.pg_auth_members
        WHERE roleid::regrole::text LIKE 'platform\\_%' OR member::regrole::text LIKE 'platform\\_%'`,
    );
    expect(members).toEqual([{ role: 'platform_definer', member: MIGRATOR, admin_option: false, inherit_option: false, set_option: true }]);
  }, 60_000);

  it('gives schemas public and platform to platform_schema_owner; the migrator has USAGE and CREATE, the runtime role USAGE only', async () => {
    const rows = await query<Record<string, unknown>>(
      database,
      `SELECT n.nspname, pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
              pg_catalog.has_schema_privilege('platform_migrator', n.oid, 'CREATE') AS migrator_create,
              pg_catalog.has_schema_privilege('platform_app', n.oid, 'USAGE') AS app_usage,
              pg_catalog.has_schema_privilege('platform_app', n.oid, 'CREATE') AS app_create,
              pg_catalog.has_schema_privilege('public', n.oid, 'USAGE') AS public_usage
         FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('public', 'platform') ORDER BY n.nspname`,
    );
    expect(rows).toEqual([
      {
        nspname: 'platform',
        owner: 'platform_schema_owner',
        migrator_create: true,
        app_usage: true,
        app_create: false,
        public_usage: false,
      },
      { nspname: 'public', owner: 'platform_schema_owner', migrator_create: true, app_usage: true, app_create: false, public_usage: false },
    ]);
  }, 60_000);

  it('keeps the ledger owned by the bootstrap role with no privilege for any platform role', async () => {
    const rows = await query<Record<string, unknown>>(
      database,
      `SELECT pg_catalog.pg_get_userbyid(c.relowner) AS owner,
              pg_catalog.has_table_privilege('platform_migrator', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS migrator,
              pg_catalog.has_table_privilege('platform_app', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS app
         FROM pg_catalog.pg_class c WHERE c.oid = 'public.bootstrap_migrations'::regclass`,
    );
    expect(rows).toEqual([{ owner: SUPERUSER, migrator: false, app: false }]);
  }, 60_000);

  it('pins the bootstrap role search path in the database and leaves no database-wide default (SEC-P3-34 items 1 and 3)', async () => {
    const rows = await query<{ setrole: string; setconfig: string[] }>(
      database,
      `SELECT CASE s.setrole WHEN 0 THEN '<database-wide>' ELSE s.setrole::regrole::text END AS setrole, s.setconfig
         FROM pg_catalog.pg_db_role_setting s
        WHERE s.setdatabase = (SELECT oid FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database())`,
    );
    expect(rows).toEqual([{ setrole: SUPERUSER, setconfig: ['search_path=pg_catalog, pg_temp'] }]);
    // Without the libpq option, a bootstrap-role session in this database still resolves through pg_catalog only.
    const client = new pg.Client(db.bootstrapConnection(database));
    await client.connect();
    try {
      expect((await client.query<{ search_path: string }>('SHOW search_path')).rows[0]?.search_path).toBe('pg_catalog, pg_temp');
    } finally {
      await client.end();
    }
  }, 60_000);

  it('does not let the migrator own the database, set database defaults or create schemas (SEC-P3-34 item 5)', async () => {
    const owner = await query<{ owner: string }>(
      database,
      'SELECT pg_catalog.pg_get_userbyid(datdba) AS owner FROM pg_catalog.pg_database WHERE datname = $1',
      [database],
    );
    expect(owner[0]?.owner).toBe(SUPERUSER);
    const migrator = db.migratorConnection(database);
    expect(await sqlState(migrator, `ALTER DATABASE "${database}" SET search_path = public, pg_catalog`)).toBe('42501');
    expect(await sqlState(migrator, 'CREATE SCHEMA squat')).toBe('42501');
    expect(await sqlState(migrator, 'CREATE EXTENSION IF NOT EXISTS hstore')).toBe('42501');
    expect(await sqlState(migrator, 'ALTER SCHEMA public RENAME TO p2')).toBe('42501');
    expect(await sqlState(db.appConnection(database), 'CREATE TABLE public.squat (id int)')).toBe('42501');
  }, 60_000);

  it('installs the trusted extensions as the bootstrap role (SEC-P3-34 item 5)', async () => {
    const rows = await query<{ extname: string; owner: string; schema: string }>(
      database,
      `SELECT e.extname, pg_catalog.pg_get_userbyid(e.extowner) AS owner, e.extnamespace::regnamespace::text AS schema
         FROM pg_catalog.pg_extension e WHERE e.extname <> 'plpgsql' ORDER BY e.extname`,
    );
    expect(rows).toEqual([
      { extname: 'btree_gin', owner: SUPERUSER, schema: 'public' },
      { extname: 'btree_gist', owner: SUPERUSER, schema: 'public' },
      { extname: 'pg_trgm', owner: SUPERUSER, schema: 'public' },
    ]);
  }, 60_000);

  it('records global default privileges that revoke EXECUTE from PUBLIC, after schema platform exists (SEC-P3-37 item 1)', async () => {
    const rows = await query<{ role: string; ns: string; objtype: string; acl: string[] }>(
      database,
      `SELECT pg_catalog.pg_get_userbyid(defaclrole) AS role, defaclnamespace::text AS ns, defaclobjtype::text AS objtype,
              defaclacl::text[] AS acl
         FROM pg_catalog.pg_default_acl ORDER BY 1`,
    );
    expect(rows).toEqual([
      { role: 'platform_audit_owner', ns: '0', objtype: 'f', acl: ['platform_audit_owner=X/platform_audit_owner'] },
      { role: 'platform_definer', ns: '0', objtype: 'f', acl: ['platform_definer=X/platform_definer'] },
      { role: 'platform_migrator', ns: '0', objtype: 'f', acl: ['platform_migrator=X/platform_migrator'] },
    ]);
  }, 60_000);

  it('makes a function the migrator creates in schema platform non-executable by PUBLIC and platform_app (SEC-P3-37 item 1)', async () => {
    const client = new pg.Client(db.migratorConnection(database));
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE FUNCTION platform.sec_p3_37_probe() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$');
      const rows = await client.query<{ app: boolean; anyone: boolean }>(
        `SELECT pg_catalog.has_function_privilege('platform_app', 'platform.sec_p3_37_probe()', 'EXECUTE') AS app,
                pg_catalog.has_function_privilege('public', 'platform.sec_p3_37_probe()', 'EXECUTE') AS anyone`,
      );
      expect(rows.rows[0]).toEqual({ app: false, anyone: false });
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  }, 60_000);

  it('applies the runtime and migrator role settings', async () => {
    const rows = await query<{ role: string; setconfig: string[] }>(
      database,
      `SELECT setrole::regrole::text AS role, setconfig FROM pg_catalog.pg_db_role_setting
        WHERE setdatabase = 0 AND setrole IN ('platform_app'::regrole, 'platform_migrator'::regrole) ORDER BY 1`,
    );
    expect(rows).toEqual([
      {
        role: 'platform_app',
        // 02-role-backstops.sql adds the statement_timeout backstop (ADR-0005 am. 10 item 12, D-ARCH-064).
        setconfig: [
          'search_path=pg_catalog, public',
          'idle_in_transaction_session_timeout=15s',
          'lock_timeout=2s',
          'statement_timeout=30s',
        ],
      },
      { role: 'platform_migrator', setconfig: ['lock_timeout=3s'] },
    ]);
  }, 60_000);
});
