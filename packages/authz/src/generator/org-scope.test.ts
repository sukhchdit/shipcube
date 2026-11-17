/** SEC-TC-01 org-scope cases of the RBAC matrix (T-32, AC-06; ADR-0005 am. 3; TASK-027, TASK-289). */
import { describe, expect, it } from '@jest/globals';

import { PERMISSION_DEFINITIONS } from '../permissions/index.js';
import type { RoleDefinition } from '../roles.js';
import { generateMatrix, type MatrixRoute } from './matrix.js';
import { ORG_PATH_PARAMETER, orgMismatchCases, orgScopedRoutes, pathParameterNames } from './org-scope.js';

const ROLE_SET: readonly RoleDefinition<string, string>[] = [
  { key: 'OP_ADMIN', scope: 'OPERATOR', nameKey: 'k', description: 'd', permissions: ['org:read', 'audit:read'] },
  { key: 'PA_OWNER', scope: 'PARTNER', nameKey: 'k', description: 'd', permissions: ['org:update'] },
  { key: 'CU_OWNER', scope: 'CUSTOMER', nameKey: 'k', description: 'd', permissions: ['org:read'] },
];

const route = (operationId: string, path: string, permission: string, tenancy = 'tenant'): MatrixRoute => ({
  operationId,
  method: 'get',
  path,
  permission,
  tenancy,
  auth: ['session'],
});

describe('[SEC-TC-01] org-scoped routes and their cases', () => {
  it('reads Express and OpenAPI path parameters', () => {
    expect(pathParameterNames('/organisations/{orgId}/members/:membershipId')).toEqual(['orgId', 'membershipId']);
    expect(pathParameterNames('/me')).toEqual([]);
    expect(ORG_PATH_PARAMETER).toBe('orgId');
  });

  it('PR #48 R1-n1 / PR48-SEC-05 item 3: a parameter inside a segment is enumerated too (/x/:orgId.json, /x/{orgId}.csv)', () => {
    expect(pathParameterNames('/organisations/:orgId.json')).toEqual(['orgId']);
    expect(pathParameterNames('/organisations/{orgId}.csv')).toEqual(['orgId']);
    expect(pathParameterNames('/reports/:from-:to/org-{orgId}')).toEqual(['from', 'to', 'orgId']);
    expect(pathParameterNames('/exports/x:orgId')).toEqual(['orgId']);
    expect(
      orgScopedRoutes([
        route('exportOrganisation', '/organisations/:orgId.json', 'org:read'),
        route('exportOrganisationCsv', '/organisations/{orgId}.csv', 'org:read'),
        route('getOrganisationById', '/organisations/:orgIdentifier', 'org:read'),
      ]).map((r) => r.operationId),
    ).toEqual(['exportOrganisation', 'exportOrganisationCsv']);
  });

  it('covers tenant routes with an orgId parameter only (operator cross-tenant routes name the organisation by design)', () => {
    const routes = [
      route('getOrganisation', '/organisations/{orgId}', 'org:read'),
      route('adminGetOrganisation', '/admin/organisations/{orgId}', 'org:read:any_org', 'operator-cross-tenant'),
      route('getShipment', '/shipments/:shipmentId', 'shipment:read'),
      route('listMembers', '/organisations/:orgId/members', 'org:read'),
    ];
    expect(orgScopedRoutes(routes).map((r) => r.operationId)).toEqual(['getOrganisation', 'listMembers']);
  });

  it('picks an allowed caller, customer roles first, then partner, then staff with a verified factor; a route no role may call is a finding', () => {
    const matrix = generateMatrix(
      [
        route('getOrganisation', '/organisations/{orgId}', 'org:read'),
        route('updateOrganisation', '/organisations/{orgId}', 'org:update'),
        route('readOrgAudit', '/organisations/{orgId}/audit', 'audit:read'),
        route('exportOrg', '/organisations/{orgId}/export', 'audit:export'),
        route('getShipment', '/shipments/{shipmentId}', 'shipment:read'),
        // Allowed for `none` and the credential callers too: only a role caller can name an active organisation.
        { ...route('getOrgCard', '/organisations/{orgId}/card', 'public'), auth: ['anonymous'] },
      ],
      { roles: ROLE_SET, catalogue: PERMISSION_DEFINITIONS },
    );
    const { cases, findings } = orgMismatchCases(matrix);
    expect(cases.map((c) => [c.route.operationId, c.caller.id])).toEqual([
      ['getOrganisation', 'CU_OWNER'],
      ['updateOrganisation', 'PA_OWNER'],
      ['readOrgAudit', 'OP_ADMIN+mfa'],
      ['getOrgCard', 'CU_OWNER'],
    ]);
    expect(findings).toEqual([
      '[SEC-TC-01] GET /organisations/{orgId}/export (exportOrg): no seeded role is allowed, so the org-scope case cannot be built',
    ]);
  });
});
