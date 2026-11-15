/** RBAC matrix generator: callers and the per-cell rules (US-071 AT-US-071-01/-02; D-ARCH-107/109/110; TASK-027). */
import { describe, expect, it } from '@jest/globals';

import { PERMISSION_DEFINITIONS } from '../permissions/index.js';
import { type RoleDefinition, ROLES } from '../roles.js';
import {
  appliesTo,
  expectCell,
  FIXED_CALLERS,
  generateMatrix,
  type MatrixCaller,
  matrixCallers,
  type MatrixRoute,
  presentedKind,
  REFUSALS,
  signatureOnlyOf,
  verifiedId,
} from './matrix.js';

const ROLE_SET: readonly RoleDefinition<string, string>[] = [
  { key: 'OP_ADMIN', scope: 'OPERATOR', nameKey: 'roles.operator.admin', description: 'staff', permissions: ['shipment:read'] },
  {
    key: 'CU_OWNER',
    scope: 'CUSTOMER',
    nameKey: 'roles.customer.owner',
    description: 'owner',
    permissions: ['shipment:read', 'quote:read'],
  },
  { key: 'CU_VIEWER', scope: 'CUSTOMER', nameKey: 'roles.customer.viewer', description: 'viewer', permissions: [] },
];
const CALLERS = new Map(matrixCallers(ROLE_SET).map((caller) => [caller.id, caller]));
const SIGNATURE_ONLY = signatureOnlyOf(PERMISSION_DEFINITIONS);

const route = (overrides: Partial<MatrixRoute>): MatrixRoute => ({
  operationId: 'op',
  method: 'get',
  path: '/x',
  permission: 'shipment:read',
  tenancy: 'tenant',
  auth: ['session'],
  ...overrides,
});
const caller = (id: string): MatrixCaller => {
  const found = CALLERS.get(id);
  if (found === undefined) throw new Error(`no caller ${id}`);
  return found;
};
const cell = (target: MatrixRoute, id: string): ReturnType<typeof expectCell> => expectCell(target, caller(id), SIGNATURE_ONLY);
const outcome = (target: MatrixRoute, id: string): string => cell(target, id).outcome;

describe('matrix callers (the columns)', () => {
  it('lists none, every role in seed order, the verified staff variants, then the fixed credentials and the two signatures', () => {
    expect(matrixCallers(ROLE_SET).map((c) => c.id)).toEqual([
      'none',
      'OP_ADMIN',
      'CU_OWNER',
      'CU_VIEWER',
      'OP_ADMIN+mfa',
      'session:expired',
      'refresh-cookie:valid',
      'refresh-cookie:unknown',
      'quote-token:valid',
      'quote-token:unknown',
      'signature:holds',
      'signature:lacks',
    ]);
    expect(caller('OP_ADMIN')).toMatchObject({ kind: 'role', factor: 'pending', scope: 'OPERATOR' });
    expect(caller('OP_ADMIN+mfa')).toMatchObject({ kind: 'role', factor: 'verified', role: 'OP_ADMIN' });
    expect(caller('CU_OWNER')).toMatchObject({ factor: 'n/a' });
    const owner = caller('CU_OWNER');
    expect(owner.kind === 'role' && [...owner.grants]).toEqual(['shipment:read', 'quote:read']);
    expect(verifiedId('X')).toBe('X+mfa');
  });

  it('the seeded catalogue gives 1 + 17 + 8 + 7 callers (US-071: 8 operator, 5 customer, 4 partner roles)', () => {
    expect(matrixCallers(ROLES)).toHaveLength(33);
  });

  it('each caller presents its kind; signature callers apply only to routes that accept a signature', () => {
    expect([...CALLERS.values()].map(presentedKind)).toEqual([
      'none',
      'session',
      'session',
      'session',
      'session',
      'session',
      'refresh-cookie',
      'refresh-cookie',
      'quote-token',
      'quote-token',
      'signature',
      'signature',
    ]);
    expect(appliesTo(caller(FIXED_CALLERS.signatureHolds), route({ auth: ['signature'] }))).toBe(true);
    expect(appliesTo(caller(FIXED_CALLERS.signatureHolds), route({}))).toBe(false);
    expect(appliesTo(caller(FIXED_CALLERS.guest), route({}))).toBe(true);
    expect(REFUSALS['deny-403-mfa']).toEqual({ status: 403, code: 'AUTHZ_DENIED' });
  });
});

describe('AT-US-071-01 / -02 the cell rules', () => {
  it('AT-US-071-01 a catalogued permission: allowed iff the role holds it, else 403 AUTHZ_DENIED; staff before TOTP is 403 by the MFA gate', () => {
    const target = route({});
    expect(cell(target, 'CU_OWNER')).toEqual({ caller: 'CU_OWNER', outcome: 'allow', private: true, foreign: false });
    expect(outcome(target, 'CU_VIEWER')).toBe('deny-403');
    expect(outcome(target, 'OP_ADMIN')).toBe('deny-403-mfa');
    expect(outcome(target, 'OP_ADMIN+mfa')).toBe('allow');
    expect(outcome(route({ mfaGateExempt: true }), 'OP_ADMIN')).toBe('allow');
    expect(outcome(route({ permission: 'quote:read' }), 'OP_ADMIN+mfa')).toBe('deny-403');
  });

  it('AT-US-071-02 a protected route without a credential is 401 AUTH_REQUIRED and private; a declared credential that does not verify is 401', () => {
    expect(cell(route({}), 'none')).toEqual({ caller: 'none', outcome: 'deny-401', private: true, foreign: false });
    expect(cell(route({}), FIXED_CALLERS.expiredBearer)).toEqual({
      caller: 'session:expired',
      outcome: 'deny-401',
      private: true,
      foreign: false,
    });
    const dual = route({ permission: 'public', auth: ['anonymous', 'session'], permissionAuthenticated: 'quote:read' });
    expect(cell(dual, FIXED_CALLERS.expiredBearer)).toMatchObject({ outcome: 'deny-401', private: true });
    expect(outcome(route({ permission: 'public', auth: ['refresh-cookie'] }), FIXED_CALLERS.unknownRefreshCookie)).toBe('deny-401');
  });

  it('D-ARCH-109 a credential outside the set equals no credential: [anonymous] stays public and allowed, [session] stays 401', () => {
    const open = route({ permission: 'public', tenancy: 'public', auth: ['anonymous'] });
    for (const id of ['none', 'CU_OWNER', 'OP_ADMIN', FIXED_CALLERS.expiredBearer, FIXED_CALLERS.refreshCookie, FIXED_CALLERS.guest]) {
      expect(cell(open, id)).toEqual({ caller: id, outcome: 'allow', private: false, foreign: id !== 'none' });
    }
    expect(cell(route({}), FIXED_CALLERS.refreshCookie)).toEqual({
      caller: 'refresh-cookie:valid',
      outcome: 'deny-401',
      private: true,
      foreign: true,
    });
    expect(cell(route({ permission: 'public', auth: ['refresh-cookie'] }), FIXED_CALLERS.expiredBearer)).toMatchObject({
      outcome: 'deny-401',
      foreign: true,
    });
    expect(outcome(route({ permission: 'public', auth: ['refresh-cookie'] }), FIXED_CALLERS.refreshCookie)).toBe('allow');
  });

  it('D-ARCH-107 dual-mode: the public branch is allowed; a session must hold permissionAuthenticated (403 otherwise); a guest token passes', () => {
    const dual = route({ permission: 'public', tenancy: 'guest', auth: ['session', 'quote-token'], permissionAuthenticated: 'quote:read' });
    expect(outcome(dual, 'CU_OWNER')).toBe('allow');
    expect(outcome(dual, 'CU_VIEWER')).toBe('deny-403');
    expect(cell(dual, FIXED_CALLERS.guest)).toMatchObject({ outcome: 'allow', private: true });
    expect(outcome(dual, FIXED_CALLERS.unknownGuestToken)).toBe('deny-401');
    expect(outcome(dual, 'none')).toBe('deny-401');
    expect(outcome(route({ permission: 'public', auth: ['anonymous', 'session'], permissionAuthenticated: 'quote:read' }), 'none')).toBe(
      'allow',
    );
    expect(outcome(route({ permission: 'public', auth: ['session'] }), 'CU_VIEWER')).toBe('allow');
  });

  it('D-ARCH-110 a signature-only permission: a signature holding it is allowed, one without it 403; any other principal 401', () => {
    const signed = route({ permission: 'webhook:stripe:receive', tenancy: 'public', auth: ['signature'] });
    expect(cell(signed, FIXED_CALLERS.signatureHolds)).toEqual({
      caller: 'signature:holds',
      outcome: 'allow',
      private: true,
      foreign: false,
    });
    expect(outcome(signed, FIXED_CALLERS.signatureLacks)).toBe('deny-403');
    expect(outcome(signed, 'OP_ADMIN+mfa')).toBe('deny-401');
    expect(outcome(signed, 'none')).toBe('deny-401');
    // The gate's own refusals, on sets the binding rules forbid (the matrix still states them).
    expect(outcome(route({ permission: 'webhook:stripe:receive', auth: ['session'] }), 'CU_OWNER')).toBe('deny-401');
    expect(outcome(route({ permission: 'webhook:stripe:receive', auth: ['anonymous'] }), 'none')).toBe('deny-401');
    expect(outcome(route({ permission: 'public', auth: ['signature'] }), FIXED_CALLERS.signatureLacks)).toBe('allow');
  });

  it('`authenticated` and catalogued permissions need a user actor: a guest, a refresh-cookie caller or an anonymous caller is 401', () => {
    expect(outcome(route({ permission: 'authenticated' }), 'CU_VIEWER')).toBe('allow');
    expect(outcome(route({ permission: 'shipment:read', auth: ['session', 'quote-token'] }), FIXED_CALLERS.guest)).toBe('deny-401');
    expect(outcome(route({ permission: 'authenticated', auth: ['refresh-cookie'] }), FIXED_CALLERS.refreshCookie)).toBe('deny-401');
    expect(outcome(route({ permission: 'shipment:read', auth: ['anonymous'] }), 'none')).toBe('deny-401');
  });
});

describe('generateMatrix', () => {
  it('one row per route in input order, one cell per applicable caller in column order', () => {
    const matrix = generateMatrix([route({ operationId: 'a' }), route({ operationId: 'b', permission: 'public', auth: ['signature'] })], {
      roles: ROLE_SET,
      catalogue: PERMISSION_DEFINITIONS,
    });
    expect(matrix.callers).toHaveLength(12);
    expect(matrix.rows.map((row) => row.route.operationId)).toEqual(['a', 'b']);
    expect(matrix.rows[0]?.cells.map((c) => c.caller)).toEqual(matrix.callers.filter((c) => c.kind !== 'signature').map((c) => c.id));
    expect(matrix.rows[1]?.cells).toHaveLength(12);
    expect(signatureOnlyOf(PERMISSION_DEFINITIONS).has('webhook:stripe:receive')).toBe(true);
    expect(signatureOnlyOf(PERMISSION_DEFINITIONS).has('shipment:read')).toBe(false);
  });
});
