/**
 * Route/document drift (US-034 AT-US-034-01, AT-US-034-02; US-035 AT-US-035-05; REQ-API-002/015; api/README.md §15):
 * the real routers (health at the root, the module registry under /api/v1) against the real contract and the ledger,
 * then one seeded defect per rule on a structuredClone of the document or a small fixture router.
 */
import { beforeAll, describe, expect, it } from '@jest/globals';
import { Router } from 'express';

import { type ApiMounts, loadApiMounts } from './api-mounts.js';
import { type ContractOperation, listOperations, loadContract, type OpenApiDocument, serverBasePath } from './contract.js';
import {
  checkContractDrift,
  type DriftFinding,
  type DriftRule,
  formatFinding,
  listMountedRoutes,
  type Mount,
  normalisePath,
  parseLedger,
  readLedger,
} from './drift.js';

type MutableOperation = Record<string, unknown>;

/** A deep copy of the document with one operation edited (the shared originals stay untouched). */
function withOperation(doc: OpenApiDocument, operationId: string, edit: (op: MutableOperation) => void): OpenApiDocument {
  const copy = structuredClone(doc) as unknown as { paths: Record<string, Record<string, unknown>> };
  const target = Object.values(copy.paths)
    .flatMap((item) => Object.values(item))
    .find((op): op is MutableOperation => typeof op === 'object' && op !== null && (op as MutableOperation).operationId === operationId);
  if (target === undefined) throw new Error(`no operation ${operationId}`);
  edit(target);
  return copy as unknown as OpenApiDocument;
}

/** Replaces `content` of a response/request object without mutating media objects shared through `$ref`. */
function withoutExamples(holder: unknown): Record<string, unknown> {
  const source = holder as { content: Record<string, Record<string, unknown>> };
  const content = Object.fromEntries(
    Object.entries(source.content).map(([type, media]) => [type, { ...media, example: undefined, examples: undefined }]),
  );
  return { ...source, content };
}

describe('openapi route/document drift', () => {
  let doc: OpenApiDocument;
  let ledger: string[];
  let byId: ReadonlyMap<string, ContractOperation>;
  let api: ApiMounts;
  const now = new Date('2026-11-13T00:00:00Z');
  const realMounts = (): Mount[] => api.mounts;

  beforeAll(async () => {
    [doc, ledger, api] = await Promise.all([loadContract(), readLedger(), loadApiMounts()]);
    byId = new Map(listOperations(doc).map((op) => [op.operationId, op]));
  });

  const operation = (id: string): ContractOperation => {
    const op = byId.get(id);
    if (op === undefined) throw new Error(`no operation ${id}`);
    return op;
  };

  const drift = (overrides: { doc?: OpenApiDocument; mounts?: Mount[]; implemented?: string[]; at?: Date } = {}): DriftFinding[] =>
    checkContractDrift({
      doc: overrides.doc ?? doc,
      mounted: listMountedRoutes(overrides.mounts ?? realMounts()),
      implemented: overrides.implemented ?? ledger,
      now: overrides.at ?? now,
    });

  const findingsOf = (findings: DriftFinding[], rule: DriftRule): DriftFinding[] => findings.filter((f) => f.rule === rule);

  const expectFinding = (findings: DriftFinding[], rule: DriftRule, id: string, message?: string): void => {
    const op = operation(id);
    expect(findingsOf(findings, rule)).toContainEqual(
      expect.objectContaining({ method: op.method, path: op.fullPath, operationId: id, ...(message === undefined ? {} : { message }) }),
    );
  };

  it('[AT-US-034-01] every mounted route is documented and every ledger operation is implemented', () => {
    expect(drift().map(formatFinding)).toEqual([]);
  });

  it('mounts the module routers under the base path the contract serves them on', () => {
    expect(api.apiPrefix).toBe(serverBasePath(doc.servers));
    expect(api.mounts.slice(1).every((mount) => mount.prefix === api.apiPrefix)).toBe(true);
  });

  it('lists the mounted health routes (GET only, the implied HEAD is not a route)', () => {
    expect(listMountedRoutes(realMounts()).map((route) => route.key)).toEqual(
      expect.arrayContaining(['GET /health/live', 'GET /health/ready']),
    );
    expect(listMountedRoutes(realMounts()).some((route) => route.method === 'HEAD')).toBe(false);
  });

  it('[AT-US-034-02-1] a mounted route missing from the document is named with its method and path', () => {
    const extra = Router();
    extra.get('/widgets/:widgetId', (_req, res) => {
      res.end();
    });
    const findings = drift({ mounts: [...realMounts(), { prefix: api.apiPrefix, router: extra }] });
    expect(findingsOf(findings, 'undocumented-route')).toEqual([
      { rule: 'undocumented-route', method: 'GET', path: '/api/v1/widgets/:widgetId', message: 'mounted but not in openapi.yaml' },
    ]);
  });

  it('[AT-US-034-02-2] a documented ledger operation with no implementation is named', () => {
    const findings = drift({ implemented: [...ledger, 'createQuote'] });
    expectFinding(findings, 'not-mounted', 'createQuote');
    expect(findingsOf(findings, 'not-mounted')).toHaveLength(1);
  });

  it('[AT-US-034-02-3] an operation lacking a request or a response example is named', () => {
    const noRequestExample = withOperation(doc, 'createQuote', (op) => {
      op.requestBody = withoutExamples(op.requestBody);
    });
    expectFinding(drift({ doc: noRequestExample }), 'missing-example', 'createQuote', 'request body has no example');

    const noResponseExample = withOperation(doc, 'getLiveness', (op) => {
      const responses = op.responses as Record<string, unknown>;
      op.responses = { ...responses, '200': withoutExamples(responses['200']) };
    });
    expectFinding(drift({ doc: noResponseExample }), 'missing-example', 'getLiveness', 'response 200 has no example');
  });

  it('[AT-US-034-02-4] an operation lacking its list of error codes is named', () => {
    for (const codes of [undefined, []]) {
      const edited = withOperation(doc, 'getReadiness', (op) => {
        op['x-error-codes'] = codes;
      });
      expectFinding(drift({ doc: edited }), 'missing-error-codes', 'getReadiness');
    }
  });

  it('[AT-US-034-02-5] an operation lacking its permission extension (or a public justification) is named', () => {
    const noPermission = withOperation(doc, 'createQuote', (op) => {
      op['x-permission'] = undefined;
    });
    expectFinding(drift({ doc: noPermission }), 'missing-permission', 'createQuote', 'no x-permission');

    const unjustified = withOperation(doc, 'getLiveness', (op) => {
      op['x-permission-justification'] = ' ';
    });
    expectFinding(
      drift({ doc: unjustified }),
      'missing-permission',
      'getLiveness',
      'x-permission public without x-permission-justification',
    );
  });

  it('[AT-US-035-05] a deprecated operation without a sunset date fails the contract test', () => {
    const deprecated = withOperation(doc, 'createQuote', (op) => {
      op.deprecated = true;
    });
    expectFinding(drift({ doc: deprecated }), 'deprecated-without-sunset', 'createQuote');

    const invalidSunset = withOperation(doc, 'createQuote', (op) => {
      op.deprecated = true;
      op['x-sunset'] = 'next spring';
    });
    expectFinding(drift({ doc: invalidSunset }), 'deprecated-without-sunset', 'createQuote');

    const withSunset = withOperation(doc, 'createQuote', (op) => {
      op.deprecated = true;
      op['x-sunset'] = '2027-06-30';
    });
    expect(drift({ doc: withSunset })).toEqual([]);
  });

  it('[AT-US-035-05] a mounted deprecated operation past its sunset date is named; before it, it is not', () => {
    const deprecated = withOperation(doc, 'getLiveness', (op) => {
      op.deprecated = true;
      op['x-sunset'] = new Date('2026-06-30T00:00:00Z');
    });
    expectFinding(drift({ doc: deprecated }), 'sunset-passed', 'getLiveness');
    expect(drift({ doc: deprecated, at: new Date('2026-01-01T00:00:00Z') })).toEqual([]);
  });

  it('flags a missing, non-camelCase or duplicate operationId', () => {
    const live = operation('getLiveness');
    const cases: [string | undefined, string][] = [
      [undefined, 'no operationId'],
      ['Get_liveness', 'operationId Get_liveness is not camelCase'],
      ['getReadiness', 'operationId getReadiness is not unique'],
    ];
    for (const [id, message] of cases) {
      const edited = withOperation(doc, 'getLiveness', (op) => {
        op.operationId = id;
      });
      expect(findingsOf(drift({ doc: edited, implemented: ['getReadiness'] }), 'operation-id')).toContainEqual(
        expect.objectContaining({ method: live.method, path: live.fullPath, message }),
      );
    }
  });

  it('flags a mounted, documented operation missing from the ledger and a ledger entry the document lacks', () => {
    const findings = drift({ implemented: ['getLiveness', 'noSuchOperation'] });
    expectFinding(findings, 'not-in-ledger', 'getReadiness');
    expect(findingsOf(findings, 'unknown-ledger-entry')).toEqual([
      expect.objectContaining({ operationId: 'noSuchOperation', message: 'not an operationId in openapi.yaml' }),
    ]);
  });

  it('reports router layers it cannot resolve instead of skipping them', () => {
    const nested = Router();
    nested.get('/inner', (_req, res) => {
      res.end();
    });
    const outer = Router();
    outer.use(nested); // mounted without a path: recursed
    outer.use('/prefixed', nested); // Express 5 keeps no mount path: reported
    outer.all('/any', (_req, res) => {
      res.end();
    });
    outer.get('/files{/:name}', (_req, res) => {
      res.end();
    });
    outer.head('/probe', (_req, res) => {
      res.end();
    });
    outer.use((_req, _res, next) => {
      next();
    });
    const routes = listMountedRoutes([
      { prefix: '/x', router: outer },
      { prefix: '/y', router: { notARouter: true } },
    ]);
    expect(routes.filter((route) => route.unrecognised === undefined).map((route) => route.key)).toEqual(['GET /x/inner', 'HEAD /x/probe']);
    expect(routes.filter((route) => route.unrecognised !== undefined).map((route) => [route.path, route.unrecognised])).toEqual([
      ['/x', 'nested router "router" mounted under a path'],
      ['/x/any', 'router.all() route matches every method'],
      ['/x/files{/:name}', 'route path uses optional/wildcard/regexp syntax'],
      ['/y', 'mounted value is not an Express router (no stack)'],
    ]);
    expect(findingsOf(checkContractDrift({ doc, mounted: routes, implemented: [] }), 'unrecognised-route')).toHaveLength(4);
  });

  it('normalises Express and OpenAPI parameters to the same key', () => {
    expect(normalisePath('/api/v1/shipments/:shipmentId/labels/:labelId')).toBe('/api/v1/shipments/{}/labels/{}');
    expect(normalisePath('/api/v1/shipments/{shipmentId}/labels/{labelId}')).toBe('/api/v1/shipments/{}/labels/{}');
    expect(() => normalisePath(`/${'a'.repeat(3000)}`)).toThrow('path longer than');
  });

  it('validates the ledger file', () => {
    expect(parseLedger({ operations: ['getLiveness'] })).toEqual(['getLiveness']);
    expect(() => parseLedger({ operations: 'getLiveness' })).toThrow('must be an array');
    expect(() => parseLedger({ operations: ['Get-Liveness'] })).toThrow('must be an array');
    expect(() => parseLedger({ operations: ['getLiveness', 'getLiveness'] })).toThrow('duplicate operationId');
  });
});
