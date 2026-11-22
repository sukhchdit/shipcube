/**
 * List-pagination contract rules (US-037 AT-US-037-08, AT-US-037-09; REQ-API-007; ADR-0016 amendment 5 (d)): the real
 * contract has no finding, and one seeded defect per rule on a structuredClone of it fails naming the route.
 */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { listOperations, loadContract, type OpenApiDocument } from './contract.js';
import { checkListContract, formatListFinding, isListOperation, type ListContractFinding } from './list-contract.js';

// Parses the full contract; the 5 s Jest default is too short under parallel host load (W0-FLAKE).
jest.setTimeout(60_000);

type MutableOperation = Record<string, unknown> & { parameters?: Record<string, unknown>[] };

/** A deep copy of the document with one operation edited (the cached original stays untouched). */
function withOperation(doc: OpenApiDocument, operationId: string, edit: (op: MutableOperation) => void): OpenApiDocument {
  const copy = structuredClone(doc) as unknown as { paths: Record<string, Record<string, unknown>> };
  const target = Object.values(copy.paths)
    .flatMap((item) => Object.values(item))
    .find((op): op is MutableOperation => typeof op === 'object' && op !== null && (op as MutableOperation).operationId === operationId);
  if (target === undefined) throw new Error(`no operation ${operationId}`);
  edit(target);
  return copy as unknown as OpenApiDocument;
}

/**
 * The operation's own copy of its `limit` parameter: the dereferenced document shares one object per `$ref` (the
 * `Limit` component) across operations, and structuredClone keeps that sharing, so an edit in place would reach them all.
 */
const limitOf = (op: MutableOperation): Record<string, unknown> => {
  const parameters = op.parameters ?? [];
  const index = parameters.findIndex((parameter) => parameter['name'] === 'limit');
  const shared = parameters[index];
  if (shared === undefined) throw new Error('no limit parameter');
  const own = { ...shared };
  op.parameters = parameters.map((parameter, at) => (at === index ? own : parameter));
  return own;
};

const setLimitMaximum = (op: MutableOperation, maximum: number): void => {
  const limit = limitOf(op);
  limit['schema'] = { ...(limit['schema'] as Record<string, unknown>), maximum };
};

const rulesFor = (findings: readonly ListContractFinding[], operationId: string): string[] =>
  findings.filter((finding) => finding.route.endsWith(`(${operationId})`)).map((finding) => finding.rule);

describe('list pagination contract rules (US-037)', () => {
  let doc: OpenApiDocument;

  beforeAll(async () => {
    doc = await loadContract();
  });

  it('the contract has list operations and none breaks a rule', () => {
    const lists = listOperations(doc).filter(isListOperation);
    expect(lists.length).toBeGreaterThan(20);
    expect(lists.map((op) => op.operationId)).toEqual(expect.arrayContaining(['listMembers', 'listCountries', 'listAuditEntries']));
    expect(checkListContract(doc).map(formatListFinding)).toEqual([]);
  });

  it('[AT-US-037-09] a list route lacking limit and cursor fails the contract test, naming the route', () => {
    const broken = withOperation(doc, 'listMembers', (op) => {
      op.parameters = (op.parameters ?? []).filter((parameter) => !['limit', 'cursor'].includes(String(parameter['name'])));
    });
    const findings = checkListContract(broken);
    expect(findings.map(formatListFinding)).toEqual([
      'list-without-pagination: GET /api/v1/organisations/{orgId}/members (listMembers): list route lacks the limit and cursor parameter(s)',
    ]);
  });

  it('[AT-US-037-09] a list route lacking only the cursor parameter fails too', () => {
    const broken = withOperation(doc, 'listMembers', (op) => {
      op.parameters = (op.parameters ?? []).filter((parameter) => parameter['name'] !== 'cursor');
    });
    expect(rulesFor(checkListContract(broken), 'listMembers')).toEqual(['list-without-pagination']);
  });

  it('[AT-US-037-08] a tenant list route declaring x-max-limit fails the contract test, naming the route', () => {
    const broken = withOperation(doc, 'listMembers', (op) => {
      op['x-max-limit'] = 300;
      setLimitMaximum(op, 300);
    });
    const findings = checkListContract(broken);
    expect(findings.map(formatListFinding)).toEqual([
      'max-limit-not-reference: GET /api/v1/organisations/{orgId}/members (listMembers): declares x-max-limit on a tenant list; only public reference lists may raise the cap',
    ]);
  });

  it('[AT-US-037-08] a tenant list raising the limit maximum without x-max-limit fails as out of policy', () => {
    const broken = withOperation(doc, 'listMembers', (op) => setLimitMaximum(op, 101));
    expect(checkListContract(broken).map(formatListFinding)).toEqual([
      'limit-out-of-policy: GET /api/v1/organisations/{orgId}/members (listMembers): limit maximum 101 exceeds 100',
    ]);
  });

  it('a public reference list may declare x-max-limit 300 with a matching limit maximum (ADR-0016 amendment 5 (d))', () => {
    const reference = withOperation(doc, 'listCountries', (op) => {
      op['x-max-limit'] = 300;
      setLimitMaximum(op, 300);
    });
    expect(rulesFor(checkListContract(reference), 'listCountries')).toEqual([]);
  });

  it('x-max-limit out of 101..300 or different from the limit maximum is invalid', () => {
    const tooHigh = withOperation(doc, 'listCountries', (op) => {
      op['x-max-limit'] = 301;
      setLimitMaximum(op, 301);
    });
    expect(rulesFor(checkListContract(tooHigh), 'listCountries')).toEqual(['max-limit-invalid']);
    const mismatch = withOperation(doc, 'listCountries', (op) => {
      op['x-max-limit'] = 300;
    });
    expect(rulesFor(checkListContract(mismatch), 'listCountries')).toEqual(['max-limit-invalid']);
    const notNumber = withOperation(doc, 'listCountries', (op) => {
      op['x-max-limit'] = '300';
    });
    expect(rulesFor(checkListContract(notNumber), 'listCountries')).toEqual(['max-limit-invalid', 'max-limit-invalid']);
  });

  it('audit lists may go to 200 but not beyond; business lists not beyond 100', () => {
    expect(
      rulesFor(checkListContract(withOperation(doc, 'listAuditEntries', (op) => setLimitMaximum(op, 201))), 'listAuditEntries'),
    ).toEqual(['limit-out-of-policy']);
    expect(rulesFor(checkListContract(withOperation(doc, 'listCountries', (op) => setLimitMaximum(op, 200))), 'listCountries')).toEqual([
      'limit-out-of-policy',
    ]);
  });

  it('PR045-SEC-07: an audit tag alone does not raise a list cap to 200; the list must also be under /audit/', () => {
    const tagged = withOperation(doc, 'listMembers', (op) => {
      op['tags'] = [...((op['tags'] as string[] | undefined) ?? []), 'audit'];
      setLimitMaximum(op, 200);
    });
    expect(rulesFor(checkListContract(tagged), 'listMembers')).toEqual(['limit-out-of-policy']);
    const untagged = withOperation(doc, 'listAuditEntries', (op) => {
      op['tags'] = [];
      setLimitMaximum(op, 200);
    });
    expect(rulesFor(checkListContract(untagged), 'listAuditEntries')).toEqual(['limit-out-of-policy']);
  });

  it('a limit without minimum 1, an integer maximum or a default within range is out of policy', () => {
    for (const schema of [
      { type: 'integer', minimum: 0, maximum: 100, default: 25 },
      { type: 'number', minimum: 1, maximum: 100, default: 25 },
      { type: 'integer', minimum: 1, default: 25 },
      { type: 'integer', minimum: 1, maximum: 100 },
      { type: 'integer', minimum: 1, maximum: 100, default: 101 },
      { type: 'integer', minimum: 1, maximum: 100, default: 0 },
    ]) {
      const broken = withOperation(doc, 'listMembers', (op) => {
        limitOf(op)['schema'] = schema;
      });
      expect(rulesFor(checkListContract(broken), 'listMembers')).toEqual(['limit-out-of-policy']);
    }
    const noSchema = withOperation(doc, 'listMembers', (op) => {
      delete limitOf(op)['schema'];
    });
    expect(rulesFor(checkListContract(noSchema), 'listMembers')).toEqual(['limit-out-of-policy']);
  });

  it('a list body without next_cursor or has_more fails', () => {
    const broken = withOperation(doc, 'listMembers', (op) => {
      const ok = (op['responses'] as Record<string, { content: Record<string, { schema: { properties: Record<string, unknown> } }> }>)[
        '200'
      ];
      const schema = ok?.content['application/json']?.schema;
      if (schema === undefined) throw new Error('no 200 schema');
      schema.properties = Object.fromEntries(Object.entries(schema.properties).filter(([name]) => name !== 'next_cursor'));
    });
    expect(rulesFor(checkListContract(broken), 'listMembers')).toEqual(['list-without-page-fields']);
  });

  it('only GET operations with an items array are lists; path-level limit and cursor parameters count', () => {
    const lists = listOperations(doc).filter(isListOperation);
    expect(lists.every((op) => op.method === 'GET')).toBe(true);
    const listMembers = listOperations(doc).find((op) => op.operationId === 'listMembers');
    if (listMembers === undefined) throw new Error('no listMembers');
    const moved = structuredClone(doc) as unknown as {
      paths: Record<string, { parameters?: unknown[]; get: MutableOperation }>;
    };
    const item = moved.paths[listMembers.path];
    if (item === undefined) throw new Error('no path item');
    const pagination = (item.get.parameters ?? []).filter((parameter) => ['limit', 'cursor'].includes(String(parameter['name'])));
    item.get.parameters = (item.get.parameters ?? []).filter((parameter) => !pagination.includes(parameter));
    item.parameters = [...(item.parameters ?? []), ...pagination];
    expect(rulesFor(checkListContract(moved as unknown as OpenApiDocument), 'listMembers')).toEqual([]);
  });
});
