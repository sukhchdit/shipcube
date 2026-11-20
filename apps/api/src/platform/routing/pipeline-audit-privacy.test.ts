/**
 * The audit capture composition through createApp and defaultPipelineSlots (D-SEC-PR56-01 condition 1, PR56-SEC-08,
 * D-ARCH-141, D-TASK029-20/21; TASK-028), without a database: with the privacy dependencies the capture mounts audited
 * routes and routes that can answer 403; without them the D-TASK029-21 refusal stays the backstop. The database proof
 * (one PERMISSION_DENIED entry with resolvable tokens) is apps/api/src/platform/audit/composition.int.test.ts.
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import { createAuditPrivacy } from '@platform/audit';

import { AuthenticateSeamError, createApp, RateLimitMissingError, type AppDependencies } from '../../app.js';
import type { TenantTxRunner } from '../db/index.js';
import { DEFAULT_RATE_LIMIT_SETTINGS } from '../rate-limit/tests/settings.js';
import { defineRoute, type RouteDescriptor } from './define-route.js';
import { defaultPipelineSlots } from './pipeline.js';
import type { RouteSlot } from './slot.js';

const key = (keyId: string) => {
  const material = new Uint8Array(randomBytes(32));
  return { keyId, localOnly: false, material: { reveal: () => material.slice() } };
};
const privacy = createAuditPrivacy({ vaultKey: key('vault-v1'), vaultHmacKey: key('vault-hmac-v1'), indexKey: key('audit-index-v1') });

/** Never runs a transaction: these cases only compose and mount. */
const runner = { withTenantTx: () => Promise.reject(new Error('not used')) } as unknown as TenantTxRunner<unknown>;

const audited: RouteDescriptor = defineRoute({
  operationId: 'createAddress',
  method: 'post',
  path: '/address-book',
  permission: 'address_book:manage',
  audit: { action: 'CREATE', entity: 'address', sensitivity: 'SENSITIVE', reasonRequired: false },
  schema: {},
  rateLimit: 'authenticated',
  idempotency: 'not-applicable',
  tenancy: 'tenant',
  auth: 'session',
  handler: () => ({ status: 201, body: { id: 'a-1' } }),
});

const rateLimit = { settings: DEFAULT_RATE_LIMIT_SETTINGS };

const base: AppDependencies = {
  health: [],
  modules: [{ name: 'addresses', routes: [audited] }],
  tenantTx: runner,
  auditConfig: { DB_AUDIT_LOCK_TIMEOUT_MS: 250 },
  logger: { info: () => undefined, debug: () => undefined, error: () => undefined },
};

describe('[D-SEC-PR56-01] [D-ARCH-141] createApp composes the capture with the privacy dependencies', () => {
  it('with auditPrivacy an audited, permission-gated route mounts', () => {
    expect(() => createApp({ ...base, auditPrivacy: privacy })).not.toThrow();
  });

  it('[D-TASK029-21] without auditPrivacy the same route is still refused at mount (the backstop keeps its behaviour)', () => {
    expect(() => createApp(base)).toThrow(
      /cannot honour PERMISSION_DENIED entries on createAddress; an audit tokeniser in the composition \(TASK-028\)/,
    );
  });

  it('auditPrivacy without auditConfig composes no capture: an audited route is refused for want of one', () => {
    const withoutConfig: AppDependencies = { health: base.health, modules: base.modules, tenantTx: runner };
    expect(() => createApp({ ...withoutConfig, auditPrivacy: privacy })).toThrow(/a configured audit capture \(TASK-029\)/);
  });

  it('defaultPipelineSlots hands the privacy dependencies to the capture (the tx slot mounts the audited route)', () => {
    const slots = defaultPipelineSlots({ tenantTx: runner, auditConfig: { DB_AUDIT_LOCK_TIMEOUT_MS: 250 }, auditPrivacy: privacy });
    expect(() => slots.execute(audited)).not.toThrow();
    expect(() => slots.authorise(audited)).not.toThrow();
    const bare = defaultPipelineSlots({ tenantTx: runner, auditConfig: { DB_AUDIT_LOCK_TIMEOUT_MS: 250 } });
    expect(() => bare.execute(audited)).toThrow(/an audit tokeniser in the composition \(TASK-028\)/);
  });

  it('the authenticate test seam replaces only the authentication slot; the capture is still the composed one', () => {
    const mounted: string[] = [];
    const authenticate: RouteSlot = (route) => {
      mounted.push(route.operationId);
      return (_req, _res, next) => next();
    };
    expect(() => createApp({ ...base, auditPrivacy: privacy, authenticate })).not.toThrow();
    expect(mounted).toEqual(['createAddress']);
    // The capture behind it is the composed one: without privacy the seam does not make the route mountable.
    expect(() => createApp({ ...base, authenticate })).toThrow(/an audit tokeniser in the composition \(TASK-028\)/);
  });

  it('[dup-review R1-m6] the authenticate seam is refused in live mode, whatever else the composition holds', () => {
    const authenticate: RouteSlot = () => (_req, _res, next) => next();
    expect(() => createApp({ ...base, auditPrivacy: privacy, authenticate, apiMode: 'live' })).toThrow(AuthenticateSeamError);
    expect(() => createApp({ ...base, auditPrivacy: privacy, apiMode: 'live', rateLimit })).not.toThrow();
  });

  it('[PR041-SEC-08] a live composition without the rate limiters is refused at boot; a test one is not', () => {
    expect(() => createApp({ ...base, auditPrivacy: privacy, apiMode: 'live' })).toThrow(RateLimitMissingError);
    expect(() => createApp({ ...base, auditPrivacy: privacy, apiMode: 'test' })).not.toThrow();
    expect(() => createApp({ ...base, auditPrivacy: privacy })).not.toThrow();
  });
});
