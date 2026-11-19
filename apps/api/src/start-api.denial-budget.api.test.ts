/**
 * The production composition (T-39, D-SECT39-01 item 6; PR48-SEC-06): `startApi` composes the denial budget with the
 * audit capture from the runtime's Valkey client and `AUTHZ_DENIAL_BUDGET_PER_MIN`, passes the real rate limiters and
 * the trusted proxy hops, and the app it builds answers 429 at denial N+1. Everything below the process seams is real:
 * the privacy dependencies built from key material, the capture and writer, `withTenantTx` over a fake database client
 * that answers the audit statements, and the pipeline slots. Only the authentication slot is the test seam (the session
 * authenticator is TASK-052) and Valkey is the script-interpreting fake.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { afterAll, describe, expect, it, jest } from '@jest/globals';
import { RATE_LIMIT_DEFAULTS, type Config } from '@platform/config';
import type { NextFunction, Request, Response } from 'express';
import Joi from 'joi';

import { createApp, type AppDependencies } from './app.js';
import { createWithTenantTx } from './platform/db/with-tenant-tx.js';
import { defineRoute, type Principal } from './platform/routing/define-route.js';
import { ANONYMOUS, markPrivateResponse, readonlySet, setPrincipal } from './platform/routing/route-state.js';
import { closeServedApps, request } from './platform/rate-limit/tests/serve.js';
import { FakeValkey } from './platform/rate-limit/tests/fake-valkey.js';
import type { RuntimeServices } from './platform/runtime/services.js';
import type { RouteSlot } from './platform/routing/slot.js';
import { startApi, type ApiServer } from './start-api.js';

jest.setTimeout(60_000);

afterAll(closeServedApps);

const ORG = '0193a5b2-7c1e-7d4a-9f3b-0000000000b2';
const VIEWER = '0193a5b2-7c1e-7d4a-9f3b-0000000000a2';
const BUDGET = 3;
const CONTEXT_SETTER = ['set', 'config'].join('_');

/** A configuration key version (the shape `@platform/config` parses), with fresh random material. */
const keyVersion = (keyId: string) => {
  const material = new Uint8Array(randomBytes(32));
  return { keyId, purpose: keyId.replace(/-v\d+$/, ''), version: 1, localOnly: false, material: { reveal: () => material.slice() } };
};

/** A database client that answers the context statement and the audit writer's statements, keeping what commits. */
const appended: unknown[] = [];
class FakeTx {
  readonly log: unknown[] = [];
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
    const sql = strings.join('?');
    if (sql.includes('audit_stream_heads h')) {
      return Promise.resolve([{ entry_count: '0', head_hash: '0'.repeat(64), head_us: null, now_us: '1800000000000000' }] as T);
    }
    if (sql.includes(CONTEXT_SETTER))
      return Promise.resolve([{ org_id: null, actor_id: null, actor_scope: null, guest_token_hash: null }] as T);
    if (sql.includes('public.data_subjects s')) {
      const kinds = values[0] as unknown[];
      return Promise.resolve(kinds.map((_kind, index) => ({ ord: index + 1, id: randomUUID() })) as T);
    }
    if (sql.includes('audit_pii_vault')) {
      const subjects = values[0] as unknown[];
      return Promise.resolve(subjects.map((_subject, index) => ({ ord: index + 1, token: randomUUID() })) as T);
    }
    return Promise.resolve([] as T);
  }
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> {
    const sql = strings.join('?');
    if (sql.includes('INSERT INTO public.audit_entries')) this.log.push(values);
    return Promise.resolve(1);
  }
}
const client = {
  async $transaction<R>(fn: (tx: FakeTx) => Promise<R>): Promise<R> {
    const tx = new FakeTx();
    const result = await fn(tx);
    appended.push(...tx.log);
    return result;
  },
  $queryRaw: <T>(): Promise<T> => Promise.resolve([] as T),
};
const runner = createWithTenantTx(
  client,
  { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
  {
    onSecurityEvent: () => undefined,
    countSessionContextLeak: () => undefined,
    markNotReady: () => undefined,
    scopeClient: () => client,
    env: {},
  },
);

const viewer: Principal = {
  ...ANONYMOUS,
  credential: 'session',
  authenticated: true,
  actorId: VIEWER,
  orgId: ORG,
  actorScope: 'TENANT',
  permissions: readonlySet([]),
};

const gated = defineRoute({
  operationId: 'listAddresses',
  method: 'get',
  path: '/address-book',
  permission: 'address_book:read',
  audit: { action: 'VIEW', entity: 'address', sensitivity: 'NORMAL', reasonRequired: false },
  schema: { query: Joi.object({}) },
  rateLimit: 'authenticated',
  idempotency: 'not-applicable',
  tenancy: 'tenant',
  auth: 'session',
  handler: () => ({ status: 200, body: { data: [] } }),
});

function configuration(): Config {
  const defaults = Object.fromEntries(Object.entries(RATE_LIMIT_DEFAULTS).map(([name, value]) => [name, value.value])) as Record<
    string,
    number
  >;
  return {
    APP_LOG_LEVEL: 'error',
    APP_PORT: 3000,
    APP_ENV: 'local',
    DOCS_ENABLED: false,
    TRUST_PROXY_HOPS: 1,
    DB_AUDIT_LOCK_TIMEOUT_MS: 250,
    AUDIT_VAULT_KEY: keyVersion('vault-v1'),
    AUDIT_VAULT_HMAC_KEY: keyVersion('vault-hmac-v1'),
    AUDIT_INDEX_KEY: keyVersion('audit-index-v1'),
    RATE_LIMIT_PUBLIC_PER_MIN: defaults['public'],
    RATE_LIMIT_AUTH_PER_IP_PER_MIN: defaults['authIp'],
    RATE_LIMIT_AUTH_PER_ACCOUNT_PER_MIN: defaults['authAccount'],
    RATE_LIMIT_AUTHENTICATED_PER_MIN: defaults['authenticated'],
    RATE_LIMIT_WEBHOOK_PER_MIN: defaults['webhook'],
    RATE_LIMIT_CSP_REPORT_PER_MIN: defaults['cspReport'],
    RATE_LIMIT_PUBLIC_QUOTE_PER_MIN: defaults['publicQuoteMin'],
    RATE_LIMIT_PUBLIC_QUOTE_PER_HOUR: defaults['publicQuoteHour'],
    RATE_LIMIT_PUBLIC_TRACKING_PER_MIN: defaults['publicTrackingMin'],
    RATE_LIMIT_PUBLIC_TRACKING_PER_HOUR: defaults['publicTrackingHour'],
    RATE_LIMIT_EMAIL_SEND_PER_ADDRESS_PER_HOUR: defaults['emailAddress'],
    RATE_LIMIT_EMAIL_SEND_PER_IP_PER_HOUR: defaults['emailIp'],
    RATE_QUOTE_CREATE_PER_USER_PER_MIN: defaults['quoteUserMin'],
    RATE_QUOTE_CREATE_PER_USER_PER_HOUR: defaults['quoteUserHour'],
    RATE_QUOTE_CREATE_PER_ORG_PER_HOUR: defaults['quoteOrgHour'],
    SSE_MAX_STREAMS_PER_IP: defaults['streamsIp'],
    SSE_MAX_STREAMS_PER_USER: defaults['streamsUser'],
    AUTHZ_DENIAL_BUDGET_PER_MIN: BUDGET,
  } as unknown as Config;
}

interface Started {
  readonly composed: AppDependencies;
  readonly app: ReturnType<typeof createApp>;
  readonly valkey: FakeValkey;
}

async function start(): Promise<Started> {
  const valkey = new FakeValkey();
  const services = {
    valkey,
    tenantTx: runner,
    probe: { startDraining: () => undefined, readiness: () => Promise.resolve({}) },
    resources: [],
    startup: () => Promise.resolve(),
  } as unknown as RuntimeServices;
  let composed: AppDependencies | undefined;
  let app: ReturnType<typeof createApp> | undefined;
  const server: ApiServer = Object.assign(new EventEmitter(), {
    close: (callback: (error?: Error) => void) => callback(),
    closeIdleConnections: () => undefined,
    closeAllConnections: () => undefined,
  });
  const signedIn: RouteSlot = () => (_req: Request, res: Response, next: NextFunction) => {
    setPrincipal(res, viewer);
    markPrivateResponse(res);
    next();
  };
  await startApi({
    loadConfig: () => Promise.resolve({ config: configuration(), secrets: new Map() }),
    stdout: { write: (_chunk: string, callback?: (error?: Error | null) => void) => (callback?.(), true) },
    exitProcess: (code: number): never => {
      throw new Error(`exit ${String(code)}`);
    },
    processEvents: new EventEmitter(),
    createRuntimeServices: () => services,
    // The one test seam: the authentication slot. Every other dependency is what startApi composed.
    createApp: (deps) => {
      composed = deps;
      app = createApp({ ...deps, authenticate: signedIn });
      return { listen: (_port, callback) => (callback(), server) };
    },
    modules: [{ name: 'addresses', routes: [gated] }],
  });
  if (composed === undefined || app === undefined) throw new Error('createApp was not called');
  return { composed, app, valkey };
}

describe('[T-39] [D-SECT39-01 item 6] [PR48-SEC-06] startApi composes the real limiters and the denial budget', () => {
  it('passes the Valkey client, the settings and the trusted proxy hops to createApp (the production composition is not the seam)', async () => {
    const { composed, valkey } = await start();
    expect(composed.rateLimit?.valkey).toBe(valkey);
    expect(composed.rateLimit?.settings.AUTHZ_DENIAL_BUDGET_PER_MIN).toBe(BUDGET);
    expect(composed.trustProxyHops).toBe(1);
    expect('authenticate' in composed).toBe(false);
  });

  it('the app startApi composed answers 403 for denials 1..N, an aggregated entry and 429 at denial N+1, and nothing for N+2', async () => {
    const { app, valkey } = await start();
    appended.length = 0;
    const statuses: number[] = [];
    for (let denial = 1; denial <= BUDGET + 2; denial += 1) {
      const res = await request(app)
        .get('/api/v1/address-book')
        .set('X-Forwarded-For', `203.0.113.${String(denial)}`);
      statuses.push(res.status);
      if (denial === BUDGET + 1) {
        expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
        expect(res.headers['retry-after']).toMatch(/^\d+$/);
        expect(res.headers['ratelimit-limit']).toBe(String(BUDGET));
        expect(res.headers['ratelimit-remaining']).toBe('0');
      }
    }
    expect(statuses).toEqual([403, 403, 403, 429, 429]);
    // One audit statement per written entry: N individual and the one aggregated entry.
    expect(appended).toHaveLength(BUDGET + 1);
    expect(
      valkey
        .keys()
        .filter((key) => key.startsWith('rl:authz-denial'))
        .sort(),
    ).toEqual([`rl:authz-denial-carry:${ORG}:${VIEWER}`, `rl:authz-denial:${ORG}:${VIEWER}`].sort());
  });
});
