import { describe, expect, it } from '@jest/globals';
import type { AuditDescriptor } from '@platform/shared';
import Joi from 'joi';

import { defineRoute, type Principal, type RouteDescriptor, type RouteRequestContext, type RouteSpec } from '../routing/define-route.js';
import { ANONYMOUS, readonlySet } from '../routing/route-state.js';
import { SlotNotImplementedError } from '../routing/slot.js';
import {
  AUDIT_NONE_ROUTES,
  AuditDescriptorError,
  auditNoneProblem,
  compileAudit,
  type CompiledAudit,
  entryFor,
  failedOutcomeApplies,
  routeKey,
} from './descriptor-runtime.js';

const ORG = '0193a5b2-7c1e-7d4a-9f3b-0000000000b2';
const USER = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';
const audited = (action: Exclude<AuditDescriptor['action'], 'NONE'>, entity: string | null = 'address'): AuditDescriptor => ({
  action,
  entity,
  sensitivity: 'NORMAL',
  reasonRequired: false,
});
const NONE: AuditDescriptor = { action: 'NONE', entity: null, sensitivity: 'NONE', reasonRequired: false, justification: 'Test.' };

function route(spec: Partial<RouteSpec> = {}): RouteDescriptor {
  const path = spec.path ?? '/address-book';
  const params = path
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
  return defineRoute({
    operationId: 'probeRoute',
    method: 'post',
    path,
    permission: 'address_book:manage',
    audit: audited('CREATE'),
    schema: params.length === 0 ? {} : { params: Joi.object(Object.fromEntries(params.map((name) => [name, Joi.string()]))) },
    rateLimit: 'authenticated',
    idempotency: 'not-applicable',
    tenancy: 'tenant',
    auth: 'session',
    handler: () => ({ status: 204 }),
    ...spec,
  } as RouteSpec);
}

const user: Principal = {
  ...ANONYMOUS,
  credential: 'session',
  authenticated: true,
  actorId: USER,
  orgId: ORG,
  permissions: readonlySet([]),
};

function request(descriptor: RouteDescriptor, overrides: Partial<RouteRequestContext> = {}): RouteRequestContext {
  return {
    route: descriptor,
    input: { params: { addressId: 'a-1' }, query: {}, body: undefined, headers: {} },
    principal: user,
    correlationId: 'corr-runtime-0001',
    transport: { ip: '203.0.113.9', userAgent: '', clientApp: '', routeTemplate: '/api/v1/address-book' },
    ...overrides,
  };
}

const compiled = (descriptor: RouteDescriptor): CompiledAudit => compileAudit(descriptor) as CompiledAudit;

describe('[AT-US-086-02] an incomplete audit descriptor fails to mount, naming method and path', () => {
  it('an audited route without an entity name', () => {
    expect(() => compileAudit(route({ audit: audited('UPDATE', null) }))).toThrow(AuditDescriptorError);
    expect(() => compileAudit(route({ audit: audited('UPDATE', null) }))).toThrow(
      'audit descriptor of POST /address-book (probeRoute): an audited route names its entity',
    );
    expect(() => compileAudit(route({ audit: audited('UPDATE', 'Address') }))).toThrow(/names its entity/);
  });

  it('an audited route without an entity-ID resolver (no auditEntityId, no :<entity>Id parameter, not a CREATE or list)', () => {
    expect(() => compileAudit(route({ method: 'patch', path: '/me', audit: audited('UPDATE', 'user') }))).toThrow(
      'audit descriptor of PATCH /me (probeRoute): an audited route needs an entity-ID resolver (auditEntityId, or a :userId path parameter)',
    );
    expect(() => compileAudit(route({ method: 'post', path: '/exports', audit: audited('VIEW') }))).toThrow(/entity-ID resolver/);
  });

  it('NONE without a justification is refused by defineRoute itself, naming method and path', () => {
    const noJustification = { ...NONE, justification: '' } as AuditDescriptor;
    expect(() => route({ audit: noJustification })).toThrow(/POST \/address-book \(probeRoute\).*NONE needs a justification/);
  });

  it('auditEntityId must be a function and only on an audited route (defineRoute)', () => {
    expect(() => route({ auditEntityId: 'id' as never })).toThrow(/auditEntityId is not a function/);
    expect(() => route({ audit: NONE, auditEntityId: () => 'x' })).toThrow(/auditEntityId is only allowed on an audited route/);
  });

  it('domain-recorded actions are refused until their recorder exists (LOGIN, LOGOUT, MFA_ENROLLED, STATE_TRANSITION)', () => {
    for (const action of ['LOGIN', 'LOGOUT', 'MFA_ENROLLED', 'STATE_TRANSITION'] as const) {
      expect(() => compileAudit(route({ audit: audited(action, 'session') }))).toThrow(SlotNotImplementedError);
    }
  });
});

describe('[US-086] descriptor compilation: modes and entity-ID resolvers', () => {
  it('NONE compiles to nothing; write actions are write mode; VIEW / DOWNLOAD with an id are view mode; a list VIEW is list mode', () => {
    expect(compileAudit(route({ audit: NONE }))).toBeUndefined();
    for (const action of ['CREATE', 'UPDATE', 'DELETE', 'CONFIG_CHANGE'] as const) {
      expect(compiled(route({ path: '/address-book/:addressId', audit: audited(action) })).mode).toBe('write');
    }
    expect(compiled(route({ method: 'get', path: '/address-book/:addressId', audit: audited('VIEW') })).mode).toBe('view');
    expect(compiled(route({ method: 'get', path: '/address-book/:addressId', audit: audited('DOWNLOAD') })).mode).toBe('view');
    expect(compiled(route({ method: 'get', audit: audited('VIEW') })).mode).toBe('list');
  });

  it('resolvers: explicit auditEntityId first, then :<camelCase entity>Id, then the CREATE result id', () => {
    const explicit = compiled(route({ path: '/address-book/:addressId', auditEntityId: () => 'explicit' }));
    expect(explicit.entityId(request(explicit.route), undefined)).toBe('explicit');
    const party = compiled(route({ method: 'patch', path: '/shipments/:shipmentPartyId', audit: audited('UPDATE', 'shipment_party') }));
    expect(
      party.entityId(
        request(party.route, { input: { params: { shipmentPartyId: 'p-7' }, query: {}, body: undefined, headers: {} } }),
        undefined,
      ),
    ).toBe('p-7');
    const create = compiled(route());
    expect(create.entityId(request(create.route), { status: 201, body: { id: 'new-1' } })).toBe('new-1');
    expect(create.entityId(request(create.route), { status: 201, body: [1] })).toBeUndefined();
    expect(create.entityId(request(create.route), undefined)).toBeUndefined();
  });
});

describe('[US-086] entry assembly (PR42-SEC-15: client-shaped values only in the writer shape, else null)', () => {
  const create = compiled(route());

  it('an authenticated request: USER actor, its organisation, request correlation id, template route and method', () => {
    const entry = entryFor({
      compiled: create,
      request: request(create.route),
      result: { status: 201, body: { id: 'n-1' } },
      action: 'CREATE',
      outcome: 'SUCCESS',
    });
    expect(entry).toEqual({
      action: 'CREATE',
      outcome: 'SUCCESS',
      entityName: 'address',
      entityId: 'n-1',
      orgId: ORG,
      actor: { type: 'USER', userId: USER },
      origin: {
        sourceApp: 'api',
        correlationId: 'corr-runtime-0001',
        ip: '203.0.113.9',
        userAgent: null,
        uaParsed: null,
        httpMethod: 'POST',
        route: '/api/v1/address-book',
      },
    });
  });

  it('an anonymous request without an organisation: ANONYMOUS actor, SYSTEM shard (orgId null)', () => {
    const entry = entryFor({
      compiled: create,
      request: request(create.route, { principal: ANONYMOUS }),
      result: undefined,
      action: 'CREATE',
      outcome: 'FAILED',
    });
    expect(entry).toMatchObject({ actor: { type: 'ANONYMOUS' }, orgId: null, entityId: null });
  });

  it('a malformed entity id, user agent parse or template, and an unparseable IP become null; details merge in', () => {
    const transport = { ip: 'not-an-ip', userAgent: 'curl/8', clientApp: 'web', routeTemplate: '/x?y=1' };
    const entry = entryFor({
      compiled: create,
      request: request(create.route, { transport }),
      result: { status: 201, body: { id: 'a@b.example' } },
      action: 'CREATE',
      outcome: 'SUCCESS',
      details: { status: 201 },
      parseUserAgent: () => 'curl; 8',
    });
    expect(entry).toMatchObject({ entityId: null, details: { status: 201 } });
    expect(entry.origin).toMatchObject({ ip: null, userAgent: 'curl/8', uaParsed: null, route: null, sourceApp: 'web' });
    const parsed = entryFor({
      compiled: create,
      request: request(create.route, { transport }),
      result: undefined,
      action: 'CREATE',
      outcome: 'SUCCESS',
      parseUserAgent: () => 'curl 8',
    });
    expect(parsed.origin.uaParsed).toBe('curl 8');
  });

  it('[AT-US-086-04] a list view records the sorted filter summary (every value tokenised) and the result count; another body shape counts null', () => {
    const list = compiled(route({ method: 'get', audit: audited('VIEW') }));
    const query = { status: 'OPEN', after: '2026-01-01', page: { size: 20 }, skipped: undefined };
    const entry = entryFor({
      compiled: list,
      request: request(list.route, { input: { params: {}, query, body: undefined, headers: {} } }),
      result: { status: 200, body: { data: [1, 2, 3] } },
      action: 'VIEW',
      outcome: 'SUCCESS',
    });
    const details = entry.details as { filter: Record<string, { value: string; field: string }>; result_count: number };
    expect(Object.keys(details.filter)).toEqual(['after', 'page', 'status']);
    expect(details.filter['page']).toMatchObject({ value: '{"size":20}', field: 'filter' });
    expect(details.result_count).toBe(3);
    const odd = entryFor({
      compiled: list,
      request: request(list.route),
      result: { status: 200, body: 'x' },
      action: 'VIEW',
      outcome: 'SUCCESS',
    });
    expect(odd.details).toEqual({ filter: {}, result_count: null });
    // a denial (no result) of a list route records no list summary
    expect(
      entryFor({ compiled: list, request: request(list.route), result: undefined, action: 'VIEW', outcome: 'DENIED' }),
    ).not.toHaveProperty('details');
  });
});

describe('[REQ-AUDIT-010] FAILED applies to authenticated mutating requests ending in 409, 422 or 5xx', () => {
  const post = route();
  it.each([
    [409, true],
    [422, true],
    [500, true],
    [503, true],
    [400, false],
    [404, false],
  ])('status %i -> %s', (status, expected) => {
    expect(failedOutcomeApplies(post, request(post), status)).toBe(expected);
  });

  it('never for a GET or an anonymous caller', () => {
    const get = route({ method: 'get', audit: audited('VIEW') });
    expect(failedOutcomeApplies(get, request(get), 500)).toBe(false);
    expect(failedOutcomeApplies(post, request(post, { principal: ANONYMOUS }), 500)).toBe(false);
  });
});

describe('[AT-US-086-07] NONE outside the REQ-AUDIT-006 closed list is rejected, naming the route', () => {
  it('a tenant route declaring NONE with a justification fails, naming method, path and operation', () => {
    expect(auditNoneProblem(route({ audit: NONE }))).toBe(
      'POST /address-book (probeRoute) declares audit action NONE, which REQ-AUDIT-006 allows only for its closed list',
    );
  });

  it('closed-list routes and audited routes pass', () => {
    expect(auditNoneProblem(route({ method: 'get', path: '/reference/volumetric', audit: NONE }))).toBeUndefined();
    expect(auditNoneProblem(route())).toBeUndefined();
    expect(AUDIT_NONE_ROUTES.has(routeKey({ method: 'get', path: '/health/live' }))).toBe(true);
  });
});
