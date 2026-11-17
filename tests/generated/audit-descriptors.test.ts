/**
 * Build-time audit descriptor checks over the composed app and the contract (REQ-AUDIT-006, US-086 AT-US-086-02 and
 * AT-US-086-07; TASK-029). Every route main.ts mounts compiles under the capture middleware's mount rules, and declares
 * `NONE` only when it is on the REQ-AUDIT-006 closed list; the closed list equals the contract's NONE operations, so a
 * contract change cannot widen it silently. Seeded defects prove each rule names the route.
 */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import {
  AUDIT_NONE_ROUTES,
  AuditDescriptorError,
  auditNoneProblem,
  compileAudit,
  routeKey,
} from '../../apps/api/src/platform/audit/descriptor-runtime.js';
import { RouteDefinitionError } from '../../apps/api/src/platform/routing/define-route.js';
import { fixtureRoute } from '../../apps/api/src/platform/routing/tests/fixture-route.js';
import { listOperations, loadContract, type OpenApiDocument } from '../../tools/openapi/contract.js';
import { type ApiMounts, loadApiMounts } from './api-mounts.js';

// Composes the app (a cold module graph) and dereferences the contract: the 5 s default is too short under host load.
jest.setTimeout(60_000);

let api: ApiMounts;
let doc: OpenApiDocument;

beforeAll(async () => {
  api = loadApiMounts();
  doc = await loadContract();
});

const expressPath = (path: string): string => path.replaceAll(/\{([^}]+)\}/g, ':$1');

describe('[REQ-AUDIT-006] the composed app: every route honours the audit descriptor rules', () => {
  it('[AT-US-086-07] no mounted route declares NONE outside the REQ-AUDIT-006 closed list', () => {
    expect(api.descriptors.length).toBeGreaterThan(0);
    expect(api.descriptors.map(auditNoneProblem).filter((problem) => problem !== undefined)).toEqual([]);
  });

  it('[AT-US-086-02] every mounted audited route compiles (entity name and entity-ID resolver present)', () => {
    const problems: string[] = [];
    for (const descriptor of api.descriptors) {
      try {
        compileAudit(descriptor);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    expect(problems).toEqual([]);
  });

  it('the closed list equals the contract operations whose x-audit action is NONE', () => {
    const contractNone = listOperations(doc)
      .filter((op) => (op.operation['x-audit'] as { action?: unknown } | undefined)?.action === 'NONE')
      .map((op) => `${op.method} ${expressPath(op.path)}`)
      .sort();
    expect(contractNone).toEqual([...AUDIT_NONE_ROUTES].sort());
  });
});

describe('seeded defects: each rule fails naming the route', () => {
  it('[AT-US-086-07] a tenant route declaring NONE with a justification fails, naming method, path and operation', () => {
    const route = fixtureRoute({
      operationId: 'listShipments',
      method: 'get',
      path: '/shipments',
      tenancy: 'tenant',
      transaction: 'tenant',
      handler: () => ({ status: 200 }),
    });
    expect(route.audit.action).toBe('NONE');
    expect(auditNoneProblem(route)).toBe(
      'GET /shipments (listShipments) declares audit action NONE, which REQ-AUDIT-006 allows only for its closed list',
    );
    expect(routeKey(route)).toBe('GET /shipments');
  });

  it('[AT-US-086-02] a descriptor without an entity name or resolver fails to mount; NONE without justification fails to define', () => {
    const noEntity = fixtureRoute({
      operationId: 'updateMe',
      method: 'patch',
      path: '/me',
      transaction: 'tenant',
      audit: { action: 'UPDATE', entity: null, sensitivity: 'NORMAL', reasonRequired: false },
      handler: () => ({ status: 200 }),
    });
    expect(() => compileAudit(noEntity)).toThrow(new AuditDescriptorError(noEntity, 'an audited route names its entity'));
    const noResolver = fixtureRoute({
      operationId: 'updateMe',
      method: 'patch',
      path: '/me',
      transaction: 'tenant',
      audit: { action: 'UPDATE', entity: 'user', sensitivity: 'NORMAL', reasonRequired: false },
      handler: () => ({ status: 200 }),
    });
    expect(() => compileAudit(noResolver)).toThrow(
      /^audit descriptor of PATCH \/me \(updateMe\): an audited route needs an entity-ID resolver/,
    );
    expect(() =>
      fixtureRoute({
        operationId: 'getThing',
        path: '/thing',
        audit: { action: 'NONE', entity: null, sensitivity: 'NONE', reasonRequired: false, justification: ' ' },
        handler: () => ({ status: 200 }),
      }),
    ).toThrow(RouteDefinitionError);
  });
});
