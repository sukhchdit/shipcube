/** The committed RBAC route matrix: render, parse and drift (US-071 AT-US-071-04/-05; TASK-027). */
import { describe, expect, it } from '@jest/globals';

import { PERMISSION_DEFINITIONS } from '../permissions/index.js';
import type { RoleDefinition } from '../roles.js';
import { matrixDrift, parseRouteMatrix, renderRouteMatrix, ROUTE_MATRIX_COMMAND, ROUTE_MATRIX_PATH } from './document.js';
import { generateMatrix, type MatrixRoute } from './matrix.js';

const ROLE_SET: readonly RoleDefinition<string, string>[] = [
  { key: 'OP_ADMIN', scope: 'OPERATOR', nameKey: 'roles.operator.admin', description: 'staff', permissions: ['shipment:read'] },
  { key: 'CU_VIEWER', scope: 'CUSTOMER', nameKey: 'roles.customer.viewer', description: 'viewer', permissions: ['shipment:read'] },
];
const SOURCE = { roles: ROLE_SET, catalogue: PERMISSION_DEFINITIONS };

const ROUTES: readonly MatrixRoute[] = [
  {
    operationId: 'getShipment',
    method: 'get',
    path: '/api/v1/shipments/{shipmentId}',
    permission: 'shipment:read',
    tenancy: 'tenant',
    auth: ['session'],
  },
  {
    operationId: 'getQuote',
    method: 'get',
    path: '/api/v1/quotes/{quoteId}',
    permission: 'public',
    tenancy: 'guest',
    auth: ['session', 'quote-token'],
    permissionAuthenticated: 'quote:read',
  },
  {
    operationId: 'getMe',
    method: 'get',
    path: '/api/v1/me',
    permission: 'authenticated',
    tenancy: 'user',
    auth: ['session'],
    mfaGateExempt: true,
  },
  {
    operationId: 'receiveStripeWebhook',
    method: 'post',
    path: '/api/v1/webhooks/stripe',
    permission: 'webhook:stripe:receive',
    tenancy: 'public',
    auth: ['signature'],
  },
];
const MATRIX = generateMatrix(ROUTES, SOURCE);
const TEXT = renderRouteMatrix(MATRIX, 3);

describe('renderRouteMatrix', () => {
  it('[AT-US-071-04] renders the banner, the version, one column per caller and one row per route with its metadata', () => {
    expect(TEXT.startsWith(`<!-- GENERATED FILE: do not edit. Regenerate with \`${ROUTE_MATRIX_COMMAND}\``)).toBe(true);
    expect(ROUTE_MATRIX_PATH).toBe('docs/03-architecture/generated/rbac-route-matrix.md');
    expect(TEXT).toContain('Catalogue version: **3**');
    expect(TEXT).toContain(
      '| Operation | Route | Permission | Auth | none | OP_ADMIN | CU_VIEWER | OP_ADMIN+mfa | session:expired | refresh-cookie:valid | refresh-cookie:unknown | quote-token:valid | quote-token:unknown | signature:holds | signature:lacks | signature-header:stripe-signature | signature-header:x-mock-signature | signature-header:x-carrier-signature |',
    );
    expect(TEXT).toContain(
      '| `getShipment` | `GET /api/v1/shipments/{shipmentId}` | `shipment:read` | session | 401 | MFA | Y | Y | 401 | 401 | 401 | 401 | 401 | - | - | 401 | 401 | 401 |',
    );
    expect(TEXT).toContain('each real provider signature header (`<name>: t=0,v1=0`), a foreign credential there');
    expect(TEXT).toContain(
      '| `getQuote` | `GET /api/v1/quotes/{quoteId}` | `public` / session: `quote:read` | session, quote-token | 401 | MFA | 403 |',
    );
    expect(TEXT).toContain('| `getMe` | `GET /api/v1/me` | `authenticated` (MFA-exempt) | session | 401 | Y | Y | Y |');
    expect(TEXT).toContain('| 401 | 401 | Y | 403 | - | - | - |\n');
    expect(TEXT.endsWith('4 operations x 14 callers.\n')).toBe(true);
  });
});

describe('parseRouteMatrix', () => {
  it('reads the columns and rows back; text without the table reads as empty', () => {
    const parsed = parseRouteMatrix(TEXT);
    expect(parsed.columns).toHaveLength(14);
    expect([...parsed.rows.keys()]).toEqual(['getShipment', 'getQuote', 'getMe', 'receiveStripeWebhook']);
    expect(parsed.rows.get('getShipment')?.cells.get('OP_ADMIN')).toBe('MFA');
    expect(parsed.rows.get('getShipment')?.metadata).toBe(
      '`getShipment` | `GET /api/v1/shipments/{shipmentId}` | `shipment:read` | session',
    );
    expect(parseRouteMatrix('# nothing here\n')).toEqual({ columns: [], rows: new Map() });
  });
});

describe('[AT-US-071-04/-05] matrixDrift names what changed', () => {
  it('the rendered document has no drift', () => {
    expect(matrixDrift(parseRouteMatrix(TEXT), MATRIX)).toEqual([]);
    expect(matrixDrift(parseRouteMatrix(TEXT), MATRIX, { mode: 'subset' })).toEqual([]);
  });

  it('AT-US-071-04 a new route and a new role are named; a removed route and a removed role too (full mode only)', () => {
    const extra: MatrixRoute = { ...ROUTES[0], operationId: 'getParcel', path: '/api/v1/parcels/{parcelId}' } as MatrixRoute;
    const roles = [...ROLE_SET, { key: 'CU_AUDITOR', scope: 'CUSTOMER' as const, nameKey: 'k', description: 'd', permissions: [] }];
    const grown = generateMatrix([...ROUTES, extra], { roles, catalogue: PERMISSION_DEFINITIONS });
    expect(matrixDrift(parseRouteMatrix(TEXT), grown)).toEqual([
      'role CU_AUDITOR has no column in the committed matrix',
      'route GET /api/v1/parcels/{parcelId} (getParcel) has no row in the committed matrix',
    ]);
    const shrunk = generateMatrix(ROUTES.slice(1), { roles: ROLE_SET.slice(1), catalogue: PERMISSION_DEFINITIONS });
    expect(matrixDrift(parseRouteMatrix(TEXT), shrunk)).toEqual([
      'column OP_ADMIN of the committed matrix is no longer generated (a removed role or caller)',
      'column OP_ADMIN+mfa of the committed matrix is no longer generated (a removed role or caller)',
      'committed row getShipment has no route (a removed operation)',
    ]);
    expect(matrixDrift(parseRouteMatrix(TEXT), shrunk, { mode: 'subset' })).toEqual([]);
  });

  it('AT-US-071-05 a changed seeded grant is named per cell; a changed permission or credential set is named per route', () => {
    const roles = ROLE_SET.map((role) => (role.key === 'CU_VIEWER' ? { ...role, permissions: [] } : role));
    expect(matrixDrift(parseRouteMatrix(TEXT), generateMatrix(ROUTES, { roles, catalogue: PERMISSION_DEFINITIONS }))).toEqual([
      'route GET /api/v1/shipments/{shipmentId} (getShipment) x role CU_VIEWER: committed Y, generated 403',
    ]);
    const moved = generateMatrix(
      ROUTES.map((route) => (route.operationId === 'getMe' ? { ...route, mfaGateExempt: false } : route)),
      SOURCE,
    );
    expect(matrixDrift(parseRouteMatrix(TEXT), moved)).toEqual([
      'route GET /api/v1/me (getMe): committed metadata "`getMe` | `GET /api/v1/me` | `authenticated` (MFA-exempt) | session" differs from "`getMe` | `GET /api/v1/me` | `authenticated` | session"',
      'route GET /api/v1/me (getMe) x role OP_ADMIN: committed Y, generated MFA',
    ]);
    expect(matrixDrift(parseRouteMatrix(TEXT), moved, { mode: 'subset' })).toEqual([
      'route GET /api/v1/me (getMe) x role OP_ADMIN: committed Y, generated MFA',
    ]);
  });

  it('a hand-edited cell, a truncated row and a non-role caller column are named', () => {
    const edited = TEXT.replace(
      '| `getMe` | `GET /api/v1/me` | `authenticated` (MFA-exempt) | session | 401 | Y |',
      '| `getMe` | `GET /api/v1/me` | `authenticated` (MFA-exempt) | session | Y | Y |',
    );
    expect(matrixDrift(parseRouteMatrix(edited), MATRIX)).toEqual([
      'route GET /api/v1/me (getMe) x caller none: committed Y, generated 401',
    ]);
    const truncated = TEXT.replace(/^(\| `receiveStripeWebhook` .*?) \| Y \| 403 \| - \| - \| - \|$/mu, '$1 |');
    expect(matrixDrift(parseRouteMatrix(truncated), MATRIX)).toEqual([
      'route POST /api/v1/webhooks/stripe (receiveStripeWebhook) x caller signature:holds: committed , generated Y',
      'route POST /api/v1/webhooks/stripe (receiveStripeWebhook) x caller signature:lacks: committed , generated 403',
      'route POST /api/v1/webhooks/stripe (receiveStripeWebhook) x caller signature-header:stripe-signature: committed , generated -',
      'route POST /api/v1/webhooks/stripe (receiveStripeWebhook) x caller signature-header:x-mock-signature: committed , generated -',
      'route POST /api/v1/webhooks/stripe (receiveStripeWebhook) x caller signature-header:x-carrier-signature: committed , generated -',
    ]);
  });
});
