/**
 * `x-idempotency` of the contract (TASK-040; REQ-API-009..011; ADR-0014 amendments 1 and 4; api/README §5; SEC-TC-53
 * contract part, SEC-TC-04). Reads docs/03-architecture/api/openapi.yaml (no app, no database):
 *  - every operation on the ADR-0014 one-time-secret list is `not-applicable`, declares no `Idempotency-Key`
 *    parameter and no `Idempotent-Replayed` response header, so its response (a guest token, a share token, a TOTP
 *    secret, recovery codes) can never be stored in `idempotency_keys`;
 *  - the api/README §5 booking and payment operations are `required`;
 *  - every operation declares a mode, safe methods are `not-applicable`, and an operation that is not
 *    `not-applicable` declares the `Idempotency-Key` parameter.
 * The route-metadata test (tests/generated) pins each mounted route's mode to these values; the idempotency slot refuses
 * a key on nothing and ignores it on a `not-applicable` route (apps/api/src/platform/idempotency).
 */
import { beforeAll, describe, expect, it } from '@jest/globals';

import { type ContractOperation, listOperations, loadContract } from '../../tools/openapi/contract.js';

/**
 * ADR-0014 amendment 1 (createQuote, enrolTotp, regenerateRecoveryCodes, createQuoteShare) and amendment 4 (activateTotp);
 * the same list as ONE_TIME_SECRET_OPERATIONS of tests/generated/route-metadata.ts (kept independent on purpose).
 */
const ADR_0014_ONE_TIME_SECRET = ['createQuote', 'createQuoteShare', 'enrolTotp', 'activateTotp', 'regenerateRecoveryCodes'] as const;

/** api/README §5 "Where": orders, payments, bookings and carrier-side effects. */
const REQUIRED = ['createOrder', 'checkoutOrder', 'confirmPayment', 'schedulePickup', 'reschedulePickup', 'cancelShipment'] as const;

const MODES: readonly unknown[] = ['required', 'optional', 'not-applicable'];
const SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

type Loose = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);

const parameterNames = (op: ContractOperation): string[] =>
  (Array.isArray(op.operation['parameters']) ? (op.operation['parameters'] as unknown[]) : [])
    .filter(isRecord)
    .map((parameter) => String(parameter['name']).toLowerCase());

const responseHeaderNames = (op: ContractOperation): string[] =>
  Object.values(op.operation.responses ?? {})
    .filter(isRecord)
    .flatMap((response) => (isRecord(response['headers']) ? Object.keys(response['headers']) : []))
    .map((name) => name.toLowerCase());

/** The SEC-TC-53 problems of one operation (empty when it can never be idempotency-stored). */
function oneTimeSecretFindings(op: ContractOperation): string[] {
  const findings: string[] = [];
  if (op.operation['x-idempotency'] !== 'not-applicable') findings.push(`x-idempotency ${String(op.operation['x-idempotency'])}`);
  if (parameterNames(op).includes('idempotency-key')) findings.push('declares Idempotency-Key');
  if (responseHeaderNames(op).includes('idempotent-replayed')) findings.push('declares Idempotent-Replayed');
  return findings;
}

let operations: ContractOperation[] = [];
const byId = (operationId: string): ContractOperation => {
  const op = operations.find((candidate) => candidate.operationId === operationId);
  if (op === undefined) throw new Error(`openapi.yaml has no operation ${operationId}`);
  return op;
};

beforeAll(async () => {
  operations = listOperations(await loadContract());
});

describe('[SEC-TC-53] x-idempotency of the ADR-0014 one-time-secret routes', () => {
  it.each(ADR_0014_ONE_TIME_SECRET)(
    '[SEC-TC-53] [SEC-TC-04] %s is not-applicable, without Idempotency-Key or Idempotent-Replayed',
    (id) => {
      expect([id, oneTimeSecretFindings(byId(id))]).toEqual([id, []]);
    },
  );

  it('[SEC-TC-53] planted: a one-time-secret operation made optional, with the header and the replay marker, is named', () => {
    const op = byId('createQuote');
    const doctored: ContractOperation = {
      ...op,
      operation: {
        ...op.operation,
        'x-idempotency': 'optional',
        parameters: [{ name: 'Idempotency-Key', in: 'header' }],
        responses: { '201': { headers: { 'Idempotent-Replayed': {} } } },
      },
    };
    expect(oneTimeSecretFindings(doctored)).toEqual(['x-idempotency optional', 'declares Idempotency-Key', 'declares Idempotent-Replayed']);
  });
});

/**
 * PR040-SEC-07 (TASK-040 part 040-B; D-SECPR040-01): three sets the acceptances of the idempotency store rest on. Each
 * is pinned exactly; changing one needs a security decision. Idempotent = `x-idempotency` other than `not-applicable`.
 */
const isIdempotent = (op: ContractOperation): boolean => op.operation['x-idempotency'] !== 'not-applicable';

/** (a) Public: an operation-level `security` that is empty or has an empty requirement (no credential needed). */
const isPublic = (op: ContractOperation): boolean => {
  const security = op.operation['security'];
  return (
    Array.isArray(security) &&
    (security.length === 0 || security.some((requirement) => isRecord(requirement) && Object.keys(requirement).length === 0))
  );
};

const isViewOrDownload = (op: ContractOperation): boolean => {
  const audit = op.operation['x-audit'];
  return isRecord(audit) && (audit['action'] === 'VIEW' || audit['action'] === 'DOWNLOAD');
};

/**
 * (c) A schema (dereferenced; `allOf`/`oneOf`/`anyOf`, nested properties and items included) that declares a
 * `client_secret` property. Examples are not schemas and are skipped; a reference cycle is visited once.
 */
function declaresClientSecret(schema: unknown, seen: Set<unknown> = new Set()): boolean {
  if (typeof schema !== 'object' || schema === null || seen.has(schema)) return false;
  seen.add(schema);
  if (Array.isArray(schema)) return schema.some((item) => declaresClientSecret(item, seen));
  const node = schema as Loose;
  if (isRecord(node['properties']) && Object.hasOwn(node['properties'], 'client_secret')) return true;
  return Object.entries(node).some(([name, value]) => name !== 'example' && name !== 'examples' && declaresClientSecret(value, seen));
}

/** The 2xx response schemas of an operation contain a `client_secret` property. */
const returnsClientSecret = (op: ContractOperation): boolean =>
  Object.entries(op.operation.responses ?? {})
    .filter(([status]) => /^2(?:\d\d|XX)$/u.test(status))
    .some(([, response]) => isRecord(response) && declaresClientSecret(response['content']));

const idempotentIdsWhere = (all: readonly ContractOperation[], predicate: (op: ContractOperation) => boolean): string[] =>
  all
    .filter((op) => isIdempotent(op) && predicate(op))
    .map((op) => op.operationId)
    .sort();

/** A copy of an operation under another id with other metadata (planted negatives). */
const planted = (op: ContractOperation, changes: Loose): ContractOperation => ({
  ...op,
  operationId: 'planted',
  operation: { ...op.operation, ...changes },
});

describe('[PR040-SEC-07] the idempotent operation sets the store relies on (a security decision to change)', () => {
  it('(a) the public idempotent operations are exactly {recordConsent} (the only network-scoped keys)', () => {
    expect(idempotentIdsWhere(operations, isPublic)).toEqual(['recordConsent']);
  });

  it('(a) planted: a bearer operation made public is named; a public not-applicable one is not', () => {
    expect(idempotentIdsWhere([...operations, planted(byId('createOrder'), { security: [] })], isPublic)).toEqual([
      'planted',
      'recordConsent',
    ]);
    expect(idempotentIdsWhere([planted(byId('createOrder'), { security: [{}, { bearerAuth: [] }] })], isPublic)).toEqual(['planted']);
    expect(idempotentIdsWhere([planted(byId('createQuote'), { security: [] })], isPublic)).toEqual([]);
  });

  it('(b) the idempotent operations with a VIEW or DOWNLOAD audit action are exactly {emailShipmentDocuments}', () => {
    expect(idempotentIdsWhere(operations, isViewOrDownload)).toEqual(['emailShipmentDocuments']);
  });

  it('(b) planted: an idempotent operation whose audit action becomes VIEW is named', () => {
    const op = byId('createOrder');
    const view = planted(op, { 'x-audit': { ...(op.operation['x-audit'] as Loose), action: 'VIEW' } });
    expect(idempotentIdsWhere([...operations, view], isViewOrDownload)).toEqual(['emailShipmentDocuments', 'planted']);
  });

  it('(c) the idempotent operations whose 2xx schema has client_secret are exactly {checkoutOrder, confirmPayment, createPaymentMethodSetup}', () => {
    expect(idempotentIdsWhere(operations, returnsClientSecret)).toEqual(['checkoutOrder', 'confirmPayment', 'createPaymentMethodSetup']);
  });

  it('(c) planted: a 2xx schema gaining a nested client_secret under allOf is named; an example or a 4xx schema alone is not', () => {
    const secret = { type: 'object', properties: { intent: { type: 'object', properties: { client_secret: { type: 'string' } } } } };
    const nested = { '201': { content: { 'application/json': { schema: { allOf: [secret] } } } } };
    expect(idempotentIdsWhere([...operations, planted(byId('createOrder'), { responses: nested })], returnsClientSecret)).toContain(
      'planted',
    );
    const exampleOnly = { '200': { content: { 'application/json': { schema: { type: 'object' }, example: { client_secret: 'x' } } } } };
    const errorOnly = { '409': { content: { 'application/json': { schema: secret } } } };
    for (const responses of [exampleOnly, errorOnly]) {
      expect(idempotentIdsWhere([planted(byId('createOrder'), { responses })], returnsClientSecret)).toEqual([]);
    }
  });
});

describe('[REQ-API-009] x-idempotency modes of the contract', () => {
  it.each(REQUIRED)('%s requires an Idempotency-Key and declares the header', (id) => {
    const op = byId(id);
    expect([id, op.operation['x-idempotency'], parameterNames(op).includes('idempotency-key')]).toEqual([id, 'required', true]);
  });

  it('every operation declares a mode; safe methods are not-applicable; an idempotent operation declares the header', () => {
    const problems = operations.flatMap((op) => {
      const mode = op.operation['x-idempotency'];
      const where = `${op.method} ${op.fullPath} (${op.operationId})`;
      if (!MODES.includes(mode)) return [`${where}: mode ${String(mode)}`];
      if (SAFE_METHODS.includes(op.method) && mode !== 'not-applicable') return [`${where}: ${String(mode)} on a safe method`];
      if (mode !== 'not-applicable' && !parameterNames(op).includes('idempotency-key')) return [`${where}: no Idempotency-Key parameter`];
      return [];
    });
    expect(problems).toEqual([]);
  });
});
