/**
 * The PRODUCTION audit composition against a real PostgreSQL 18 prepared by the bootstrap lane
 * (D-SEC-PR56-01 condition 1, PR56-SEC-08, PR #56 code review R1-m1, D-TASK029-21, D-ORCH-109, D-ARCH-141; TASK-028).
 *
 * `startApi` runs with the real configuration loader output (`loadConfig` over a generated test environment), the real
 * database runtime as `platform_app`, the real `createApp` and the real capture: the tokeniser, the IP index and the
 * user-agent parser are the ones startApi builds from AUDIT_VAULT_KEY, AUDIT_VAULT_HMAC_KEY and AUDIT_INDEX_KEY and
 * hands through AppDependencies and defaultPipelineSlots to createAuditCapture. Nothing injects a capture. The test
 * seams are the process seams (stdout, exit, events), a listener on an ephemeral loopback port, Valkey and object
 * storage left out of the services (the capture never touches them), and ONLY the authentication slot
 * (`AppDependencies.authenticate`), because the session authenticator (TASK-052) does not exist yet and the stub
 * answers 401 to every credential.
 *
 * The database is prepared by the bootstrap-lane CLI (`npm run db:bootstrap`, tools/db/bootstrap.ts) run as a child
 * process, as the Compose migrate job runs it: roles, the audit tables, their grants and the current partitions. The
 * Prisma migrations are not needed (the fixture routes touch no business table).
 *
 * Cases: a request refused with 403 writes exactly one PERMISSION_DENIED entry whose `ip_token` and
 * `user_agent_token` decrypt in the vault, whose `ip_hash` is the HMAC under the index key and whose `ua_parsed` is the
 * parsed family; an audited fixture route writes its CREATE entry; a composition without the tokeniser is still
 * refused at mount (exit 78, D-TASK029-21 backstop).
 */
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { auditKeyOf, decryptVaultValue } from '@platform/audit';
import { type Config, loadConfig } from '@platform/config';
import { createTestEnv } from '@platform/config/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

import { createApp } from '../../app.js';
import { startApi, type StartApiDependencies } from '../../start-api.js';
import type { ActiveDatabaseRuntime } from '../db/runtime.js';
import { databaseRuntimeFromConfig } from '../db/runtime.js';
import type { AppTransactionClient } from '../db/index.js';
import { defineRoute, type Principal, type RouteDescriptor } from '../routing/define-route.js';
import { ANONYMOUS, markPrivateResponse, readonlySet, setPrincipal } from '../routing/route-state.js';
import type { RouteSlot } from '../routing/slot.js';
import { closeLoopbackServer, fetchOnce, LOOPBACK_TEST_TIMEOUT_MS } from '../routing/tests/loopback.js';
import type { ReadinessProbe } from '../runtime/readiness.js';
import type { RuntimeServices } from '../runtime/services.js';

const STARTUP_TIMEOUT_MS = 240_000;
/** Same pinned image as prisma/tests/harness/postgres.ts (SPK-01). */
const POSTGRES_IMAGE = 'postgres:18@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';
const DATABASE = 'platform';
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
/** A child process that has not finished by then failed (a named rejection instead of the whole test budget). */
const BOOTSTRAP_DEADLINE_MS = 180_000;
const secret = (): string => randomBytes(24).toString('hex');
const ORG = randomUUID();
const USER = '0190c3a4-5b6c-7d8e-9f00-112233445566';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0) Gecko/20100101 Firefox/146.0';

/** A tenant member holding `address_book:read` only. */
const MEMBER: Principal = {
  ...ANONYMOUS,
  credential: 'session',
  authenticated: true,
  actorId: USER,
  orgId: ORG,
  actorScope: 'TENANT',
  permissions: readonlySet(['address_book:read']),
};

/** The test's authentication slot (TASK-052 seam): every request is the member. */
const signedIn: RouteSlot = () => (_req, res, next) => {
  setPrincipal(res, MEMBER);
  markPrivateResponse(res);
  next();
};

const TENANT_ROUTE = {
  schema: {},
  rateLimit: 'authenticated',
  idempotency: 'not-applicable',
  tenancy: 'tenant',
  auth: 'session',
} as const;

/** Needs a permission the member lacks: 403 AUTHZ_DENIED, one PERMISSION_DENIED entry. */
const manageAddress: RouteDescriptor = defineRoute({
  ...TENANT_ROUTE,
  operationId: 'createAddress',
  method: 'post',
  path: '/fixtures/address-book',
  permission: 'address_book:manage',
  audit: { action: 'CREATE', entity: 'address', sensitivity: 'SENSITIVE', reasonRequired: false },
  handler: () => ({ status: 201, body: { id: 'unreachable' } }),
});

const CREATED_ID = randomUUID();
/** An audited route the member may call: its CREATE entry is written in the handler transaction. */
const createNote: RouteDescriptor = defineRoute({
  ...TENANT_ROUTE,
  operationId: 'createNoteFixture',
  method: 'post',
  path: '/fixtures/notes',
  permission: 'address_book:read',
  audit: { action: 'CREATE', entity: 'note', sensitivity: 'NORMAL', reasonRequired: false },
  handler: () => ({ status: 201, body: { id: CREATED_ID } }),
});

interface Started {
  readonly server: Server | undefined;
  readonly exits: number[];
  readonly lines: Record<string, unknown>[];
  readonly runtime: ActiveDatabaseRuntime<AppTransactionClient> | undefined;
}

let container: StartedPostgreSqlContainer;
let admin: pg.Client;
let config: Config;
let started: Started;

/** startApi with the production composition; `strip` removes the privacy dependencies (the backstop case). */
async function start(options: { readonly strip?: boolean } = {}): Promise<Started> {
  const exits: number[] = [];
  const raw: string[] = [];
  let server: Server | undefined;
  let runtime: ActiveDatabaseRuntime<AppTransactionClient> | undefined;
  const listening = new Promise<void>((resolve) => {
    const deps: Partial<StartApiDependencies> = {
      loadConfig: () => Promise.resolve({ config, secrets: new Map() }),
      stdout: {
        write: (chunk: string, callback?: (error?: Error | null) => void) => {
          raw.push(chunk);
          callback?.();
          return true;
        },
      },
      exitProcess: (code: number): never => {
        exits.push(code);
        resolve();
        return undefined as never;
      },
      processEvents: new EventEmitter(),
      createRuntimeServices: (cfg, service, log) => {
        runtime = databaseRuntimeFromConfig(cfg, service, log);
        const probe = { startDraining: () => undefined, draining: false, readiness: () => Promise.reject(new Error('unused')) };
        return {
          tenantTx: runtime.tenantTx,
          probe: probe as unknown as ReadinessProbe,
          resources: runtime.resources,
          startup: () => (runtime as ActiveDatabaseRuntime<AppTransactionClient>).startup(),
        } as unknown as RuntimeServices;
      },
      // The real createApp over the dependencies startApi composed; only the authentication slot is replaced.
      createApp: (deps) => {
        const { auditPrivacy, ...withoutPrivacy } = deps;
        const composed = options.strip === true || auditPrivacy === undefined ? withoutPrivacy : { ...withoutPrivacy, auditPrivacy };
        const app = createApp({ ...composed, authenticate: signedIn });
        return {
          listen: (_port, callback) => {
            server = app.listen(0, '127.0.0.1', (error?: Error) => {
              callback(error);
              resolve();
            });
            return server;
          },
        };
      },
      modules: [{ name: 'fixtures', routes: [manageAddress, createNote] }],
    };
    void startApi(deps);
  });
  await listening;
  const lines = raw
    .flatMap((chunk) => chunk.split('\n').filter((line) => line !== ''))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { server, exits, lines, runtime };
}

const urlOf = (server: Server | undefined, path: string): string =>
  `http://127.0.0.1:${String((server?.address() as AddressInfo).port)}${path}`;

interface EntryRow {
  readonly action: string;
  readonly outcome: string;
  readonly entity_name: string;
  readonly entity_id: string | null;
  readonly org_id: string;
  readonly user_id: string;
  readonly ip_token: string | null;
  readonly user_agent_token: string | null;
  readonly ip_hash: Buffer | null;
  readonly ip_hash_key_id: string | null;
  readonly ip_coarse: string | null;
  readonly ua_parsed: string | null;
  readonly details: Record<string, unknown> | null;
}

async function entries(action: string): Promise<EntryRow[]> {
  const result = await admin.query<EntryRow>(
    `SELECT action, outcome, entity_name, entity_id, org_id::text AS org_id, user_id::text AS user_id, ip_token::text AS ip_token,
            user_agent_token::text AS user_agent_token, ip_hash, ip_hash_key_id, host(ip_coarse) AS ip_coarse, ua_parsed, details
       FROM public.audit_entries WHERE org_id = $1::uuid AND action = $2`,
    [ORG, action],
  );
  return result.rows;
}

/** Decrypts a vault token with the configured AUDIT_VAULT_KEY; also returns its subject. */
async function resolveToken(token: string): Promise<{ readonly value: string; readonly subject: { kind: string; ref_id: string } }> {
  const result = await admin.query<{ token: string; ciphertext: Buffer; ciphertext_key_id: string; kind: string; ref_id: string }>(
    `SELECT v.token::text AS token, v.ciphertext, v.ciphertext_key_id, s.kind, s.ref_id::text AS ref_id
       FROM public.audit_pii_vault v JOIN public.data_subjects s ON s.id = v.subject_id WHERE v.token = $1::uuid`,
    [token],
  );
  const [row] = result.rows;
  if (row === undefined || config.AUDIT_VAULT_KEY === undefined) throw new Error(`token ${token} is not in the vault`);
  const value = decryptVaultValue(auditKeyOf(config.AUDIT_VAULT_KEY), {
    token: row.token,
    ciphertext: new Uint8Array(row.ciphertext),
    ciphertextKeyId: row.ciphertext_key_id,
  });
  return { value, subject: { kind: row.kind, ref_id: row.ref_id } };
}

/** Runs the bootstrap-lane CLI (`npm run db:bootstrap`) against the container; resolves on exit code 0. */
function bootstrap(superuserUrl: string, passwords: { readonly migrator: string; readonly app: string }): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tsx = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const child = spawn(process.execPath, [tsx, '--conditions=@platform/source', join('tools', 'db', 'bootstrap.ts')], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        APP_ENV: 'test',
        DATABASE_BOOTSTRAP_URL: superuserUrl,
        BOOTSTRAP_MIGRATOR_PASSWORD: passwords.migrator,
        BOOTSTRAP_APP_PASSWORD: passwords.app,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdout.resume();
    const timer = setTimeout(() => child.kill(), BOOTSTRAP_DEADLINE_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`db:bootstrap exited ${String(code)}: ${stderr.slice(0, 2_000)}`));
    });
  });
}

beforeAll(async () => {
  const superuserPassword = secret();
  container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withUsername('postgres')
    .withPassword(superuserPassword)
    .withDatabase(DATABASE)
    .start();
  const host = container.getHost();
  const port = container.getPort();
  const passwords = { migrator: secret(), app: secret() };
  await bootstrap(`postgresql://postgres:${superuserPassword}@${host}:${String(port)}/${DATABASE}`, passwords);
  admin = new pg.Client({
    host,
    port,
    user: 'postgres',
    password: superuserPassword,
    database: DATABASE,
    options: '-c search_path=pg_catalog,pg_temp',
  });
  await admin.connect();
  const appUrl = `postgresql://platform_app:${passwords.app}@${host}:${String(port)}/${DATABASE}?sslmode=disable`;
  config = loadConfig({ ...createTestEnv({ service: 'api' }), DATABASE_URL: appUrl }, { service: 'api' });
  started = await start();
}, STARTUP_TIMEOUT_MS);

afterAll(async () => {
  if (started?.server !== undefined) await closeLoopbackServer(started.server);
  for (const resource of started?.runtime?.resources ?? []) await resource.close().catch(() => undefined);
  await admin?.end();
  await container?.stop();
}, STARTUP_TIMEOUT_MS);

describe('[D-SEC-PR56-01] [D-ARCH-141] the production composition audits with the tokeniser, the IP index and the parser', () => {
  it(
    'startApi composed and listened: no boot refusal, no exit',
    () => {
      expect(started.exits).toEqual([]);
      expect(started.lines.filter((line) => line['level'] === 'error')).toEqual([]);
    },
    LOOPBACK_TEST_TIMEOUT_MS,
  );

  it(
    '[REQ-AUDIT-010] a 403 writes exactly one PERMISSION_DENIED entry with vault tokens, ip_hash and ua_parsed',
    async () => {
      const response = await fetchOnce(urlOf(started.server, '/api/v1/fixtures/address-book'), {
        method: 'POST',
        headers: { 'user-agent': FIREFOX },
      });
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe('AUTHZ_DENIED');

      const denied = await entries('PERMISSION_DENIED');
      expect(denied).toHaveLength(1);
      const [entry] = denied as [EntryRow];
      expect(entry).toMatchObject({
        outcome: 'DENIED',
        entity_name: 'address',
        entity_id: null,
        user_id: USER,
        ua_parsed: 'Firefox 146 / Windows',
        ip_hash_key_id: 'audit-index-v1',
        ip_coarse: '127.0.0.0',
        details: { required_permission: 'address_book:manage' },
      });
      // The tokens resolve in the vault to the raw values, owned by the acting user's data subject.
      const ip = await resolveToken(entry.ip_token as string);
      const userAgent = await resolveToken(entry.user_agent_token as string);
      expect(ip).toEqual({ value: '127.0.0.1', subject: { kind: 'USER', ref_id: USER } });
      expect(userAgent).toEqual({ value: FIREFOX, subject: { kind: 'USER', ref_id: USER } });
      // ip_hash = HMAC-SHA256(AUDIT_INDEX_KEY, canonical IP).
      const indexKey = auditKeyOf(config.AUDIT_INDEX_KEY as NonNullable<Config['AUDIT_INDEX_KEY']>);
      expect(entry.ip_hash?.equals(createHmac('sha256', indexKey.key).update('127.0.0.1', 'utf8').digest())).toBe(true);
      // No personal value in clear anywhere in the row.
      expect(JSON.stringify(entry)).not.toContain(FIREFOX);
    },
    LOOPBACK_TEST_TIMEOUT_MS,
  );

  it(
    'an audited fixture route writes its CREATE entry through the same composition',
    async () => {
      const response = await fetchOnce(urlOf(started.server, '/api/v1/fixtures/notes'), {
        method: 'POST',
        headers: { 'user-agent': FIREFOX },
      });
      expect(response.status).toBe(201);
      const created = await entries('CREATE');
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        outcome: 'SUCCESS',
        entity_name: 'note',
        entity_id: CREATED_ID,
        ua_parsed: 'Firefox 146 / Windows',
      });
      expect((await resolveToken(created[0]?.ip_token as string)).value).toBe('127.0.0.1');
    },
    LOOPBACK_TEST_TIMEOUT_MS,
  );

  it(
    '[D-TASK029-21] a composition without the tokeniser is still refused at mount: exit 78, nothing listens',
    async () => {
      const refused = await start({ strip: true });
      expect(refused.server).toBeUndefined();
      expect(refused.exits).toEqual([78]);
      expect(refused.lines).toContainEqual(
        expect.objectContaining({
          event: 'api.slot_not_implemented',
          slot: 'audit',
          operation: 'createAddress',
          requirement: 'PERMISSION_DENIED entries',
          // The platform log redacts the word 'token' inside strings (NFR-PRIV-001), so only the owner's task id is asserted.
          owner: expect.stringContaining('(TASK-028)'),
        }),
      );
      for (const resource of refused.runtime?.resources ?? []) await resource.close().catch(() => undefined);
    },
    LOOPBACK_TEST_TIMEOUT_MS,
  );
});
