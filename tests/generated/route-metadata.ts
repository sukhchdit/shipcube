/**
 * Route metadata versus the contract (US-067, REQ-RBAC-005, api/README.md §15 assertions 1-6 and 9; TASK-020). Input:
 * the routes the drift walker found in the composed app and, for each, the `defineRoute` descriptor the registry holds
 * for its last handler. Output: one finding per disagreement, each naming `METHOD path`. Pure; the suite in
 * route-metadata.test.ts feeds it the real app and seeded defects. The same descriptors feed the RBAC-matrix, audit and
 * abuse generators (TASK-027, TASK-033, TASK-278).
 *
 * Schema parity (assertion 5) compares, per request part, the property names, the required set, closed objects and the
 * enum / length / range / pattern constraints of each top-level property. Headers the pipeline owns (correlation,
 * language, idempotency, preconditions, CSRF, re-auth proof, guest token) are excluded from the header comparison.
 */
import { isPermission, isRouteMarker, type RouteAuth } from '@platform/authz';
import { ERROR_CATALOGUE, isErrorCode } from '@platform/shared';
import type Joi from 'joi';

import type { RouteDescriptor, RouteSchemas } from '../../apps/api/src/platform/routing/define-route.js';
import { type ContractOperation, type OpenApiDocument, listOperations } from '../../tools/openapi/contract.js';
import { type MountedRoute, routeKey } from '../../tools/openapi/drift.js';

export type MetadataRule =
  'raw-handler' | 'operation-id' | 'count' | 'permission' | 'audit' | 'extension' | 'auth' | 'schema' | 'error-codes' | 'one-time-secret';

export interface MetadataFinding {
  readonly rule: MetadataRule;
  readonly route: string;
  readonly message: string;
}

export interface MetadataInput {
  readonly doc: OpenApiDocument;
  readonly mounted: readonly MountedRoute[];
  readonly descriptorOf: (handler: unknown) => RouteDescriptor | undefined;
  /** operationIds of the implemented-operations ledger. */
  readonly implemented: readonly string[];
}

/** ADR-0014 am. 1 and 4: routes returning a one-time secret are never idempotency-stored (SEC-TC-53). */
export const ONE_TIME_SECRET_OPERATIONS = [
  'createQuote',
  'createQuoteShare',
  'enrolTotp',
  'activateTotp',
  'regenerateRecoveryCodes',
] as const;

/** Request headers the pipeline slots own; route schemas do not declare them. */
export const PIPELINE_HEADERS: ReadonlySet<string> = new Set([
  'x-correlation-id',
  'accept-language',
  'idempotency-key',
  'if-match',
  'if-none-match',
  'x-csrf-token',
  'x-reauth-proof',
  'x-quote-token',
]);

type Loose = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (inner === undefined ? null : inner));

/** The authentication the contract's `security` requirement implies. */
export function contractAuth(op: ContractOperation, doc: OpenApiDocument): RouteAuth {
  const declared = op.operation['security'] ?? doc['security' as `x-${string}`];
  const requirements = Array.isArray(declared) ? (declared as unknown[]).filter(isRecord) : [];
  if (requirements.length === 0) return 'anonymous';
  const schemes = requirements.flatMap((requirement) => Object.keys(requirement));
  if (schemes.some((scheme) => scheme.endsWith('Signature'))) return 'signature';
  if (schemes.includes('quoteToken')) return 'quote-token';
  if (requirements.some((requirement) => Object.keys(requirement).length === 0)) return 'anonymous';
  return 'session';
}

/** A comparable view of one property: type, required, enum, bounds, pattern. */
interface PropertyShape {
  readonly type?: string;
  readonly enum?: readonly unknown[];
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
}

interface PartShape {
  readonly properties: Readonly<Record<string, PropertyShape>>;
  readonly required: readonly string[];
  readonly closed: boolean;
}

const EMPTY_PART: PartShape = { properties: {}, required: [], closed: true };

function joiProperty(description: Loose): PropertyShape {
  const rules = Array.isArray(description['rules']) ? (description['rules'] as unknown[]).filter(isRecord) : [];
  const limit = (name: string): number | undefined => {
    const args = rules.find((rule) => rule['name'] === name)?.['args'];
    const value = isRecord(args) ? args['limit'] : undefined;
    return typeof value === 'number' ? value : undefined;
  };
  const patternArgs = rules.find((rule) => rule['name'] === 'pattern')?.['args'];
  const regex = isRecord(patternArgs) ? patternArgs['regex'] : undefined;
  const min = limit('min');
  const max = limit('max');
  const flags = isRecord(description['flags']) ? description['flags'] : {};
  const allow = Array.isArray(description['allow']) ? (description['allow'] as unknown[]) : undefined;
  const type = description['type'] === 'date' ? 'string' : description['type'];
  return {
    ...(typeof type === 'string' ? { type: type === 'number' && rules.some((r) => r['name'] === 'integer') ? 'integer' : type } : {}),
    ...(flags['only'] === true && allow !== undefined ? { enum: [...allow].sort() } : {}),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(typeof regex === 'string' ? { pattern: regex.replace(/^\/(.*)\/[a-z]*$/, '$1') } : {}),
  };
}

export function joiPart(schema: Joi.ObjectSchema | undefined): PartShape {
  if (schema === undefined) return EMPTY_PART;
  const description = schema.describe() as Loose;
  const keys = isRecord(description['keys']) ? description['keys'] : {};
  const flags = isRecord(description['flags']) ? description['flags'] : {};
  const properties: Record<string, PropertyShape> = {};
  const required: string[] = [];
  for (const [name, key] of Object.entries(keys)) {
    if (!isRecord(key)) continue;
    properties[name] = joiProperty(key);
    if (isRecord(key['flags']) && key['flags']['presence'] === 'required') required.push(name);
  }
  return { properties, required: required.sort(), closed: flags['unknown'] !== true };
}

function openApiProperty(schema: unknown): PropertyShape {
  if (!isRecord(schema)) return {};
  const type = Array.isArray(schema['type']) ? (schema['type'] as unknown[]).find((t) => t !== 'null') : schema['type'];
  const number = (key: string): number | undefined => {
    const value = schema[key];
    return typeof value === 'number' ? value : undefined;
  };
  const min = number('minLength') ?? number('minimum') ?? number('minItems');
  const max = number('maxLength') ?? number('maximum') ?? number('maxItems');
  return {
    ...(typeof type === 'string' ? { type } : {}),
    ...(Array.isArray(schema['enum']) ? { enum: [...(schema['enum'] as unknown[])].sort() } : {}),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(typeof schema['pattern'] === 'string' ? { pattern: schema['pattern'] } : {}),
  };
}

function openApiParameters(op: ContractOperation, location: 'path' | 'query' | 'header'): PartShape {
  const parameters = Array.isArray(op.operation['parameters']) ? (op.operation['parameters'] as unknown[]).filter(isRecord) : [];
  const properties: Record<string, PropertyShape> = {};
  const required: string[] = [];
  for (const parameter of parameters) {
    if (parameter['in'] !== location || typeof parameter['name'] !== 'string') continue;
    const name = location === 'header' ? parameter['name'].toLowerCase() : parameter['name'];
    if (location === 'header' && PIPELINE_HEADERS.has(name)) continue;
    properties[name] = openApiProperty(parameter['schema']);
    if (parameter['required'] === true) required.push(name);
  }
  return { properties, required: required.sort(), closed: true };
}

function openApiBody(op: ContractOperation): PartShape {
  const content = isRecord(op.operation.requestBody) ? op.operation.requestBody['content'] : undefined;
  const media = isRecord(content) ? content['application/json'] : undefined;
  const schema = isRecord(media) ? media['schema'] : undefined;
  if (!isRecord(schema)) return EMPTY_PART;
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  return {
    properties: Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, openApiProperty(value)])),
    required: Array.isArray(schema['required']) ? (schema['required'] as string[]).slice().sort() : [],
    closed: schema['additionalProperties'] === false,
  };
}

function partProblems(part: string, joi: PartShape, contract: PartShape): string[] {
  const problems: string[] = [];
  const names = (shape: PartShape) => Object.keys(shape.properties).sort();
  if (canonical(names(joi)) !== canonical(names(contract))) {
    problems.push(`${part}: Joi declares [${names(joi).join(', ')}], OpenAPI [${names(contract).join(', ')}]`);
  }
  if (canonical(joi.required) !== canonical(contract.required)) {
    problems.push(`${part}: Joi requires [${joi.required.join(', ')}], OpenAPI [${contract.required.join(', ')}]`);
  }
  if (!joi.closed || !contract.closed)
    problems.push(`${part}: both sides must be closed objects (unknown(false) / additionalProperties: false)`);
  for (const name of names(joi)) {
    const left = joi.properties[name];
    const right = contract.properties[name];
    if (right === undefined || left === undefined) continue;
    for (const facet of ['type', 'enum', 'min', 'max', 'pattern'] as const) {
      if (canonical(left[facet]) !== canonical(right[facet])) {
        problems.push(`${part}.${name}: ${facet} ${canonical(left[facet])} in Joi, ${canonical(right[facet])} in OpenAPI`);
      }
    }
  }
  return problems;
}

/** Assertion 5: Joi and OpenAPI agree on every request part. Exported for the seeded-defect tests. */
export function schemaProblems(route: RouteDescriptor, op: ContractOperation): string[] {
  const schema: RouteSchemas = route.schema;
  return [
    ...partProblems('params', joiPart(schema.params), openApiParameters(op, 'path')),
    ...partProblems('query', joiPart(schema.query), openApiParameters(op, 'query')),
    ...partProblems('headers', joiPart(schema.headers), openApiParameters(op, 'header')),
    ...partProblems('body', joiPart(schema.body), openApiBody(op)),
  ];
}

function permissionProblems(route: RouteDescriptor, op: ContractOperation): string[] {
  const declared = op.operation['x-permission'];
  const problems: string[] = [];
  if (declared !== route.permission) problems.push(`permission ${route.permission} in metadata, ${String(declared)} in openapi.yaml`);
  if (!isPermission(route.permission) && !isRouteMarker(route.permission))
    problems.push(`permission ${String(route.permission)} not in catalogue`);
  if (isRouteMarker(route.permission) && route.permissionJustification !== op.operation['x-permission-justification']) {
    problems.push('permissionJustification differs from x-permission-justification');
  }
  return problems;
}

function auditProblems(route: RouteDescriptor, op: ContractOperation): string[] {
  const contract = isRecord(op.operation['x-audit']) ? op.operation['x-audit'] : {};
  const pick = (audit: Loose) => ({
    action: audit['action'],
    entity: audit['entity'] ?? null,
    sensitivity: audit['sensitivity'],
    reasonRequired: audit['reasonRequired'],
    justification: audit['justification'],
    additional: audit['additional'] ?? [],
  });
  const left = canonical(pick(route.audit as unknown as Loose));
  const right = canonical(pick(contract));
  return left === right ? [] : [`audit ${left} in metadata, ${right} in openapi.yaml`];
}

function extensionProblems(route: RouteDescriptor, op: ContractOperation): string[] {
  const pairs: [string, unknown, unknown][] = [
    ['x-idempotency', route.idempotency, op.operation['x-idempotency']],
    ['x-rate-limit-class', route.rateLimit, op.operation['x-rate-limit-class']],
    ['x-rate-limit-route', route.rateLimitRoute, op.operation['x-rate-limit-route']],
    ['x-tenancy', route.tenancy, op.operation['x-tenancy']],
    ['x-reauth-scope', route.reauth?.scope, op.operation['x-reauth-scope']],
    ['x-reauth-max-age', route.reauth?.maxAgeSeconds, op.operation['x-reauth-max-age']],
    ['x-mfa-gate-exempt', route.mfaGateExempt, op.operation['x-mfa-gate-exempt']],
    ['x-csrf', route.csrf, op.operation['x-csrf']],
  ];
  return pairs
    .filter(([, left, right]) => canonical(left) !== canonical(right))
    .map(([name, left, right]) => `${name} ${canonical(left)} in metadata, ${canonical(right)} in openapi.yaml`);
}

/** Assertion 6 (contract half): every `x-error-codes` entry is a catalogue code with a declared response status. */
export function errorCodeProblems(op: ContractOperation): string[] {
  const codes = Array.isArray(op.operation['x-error-codes']) ? (op.operation['x-error-codes'] as unknown[]) : [];
  const statuses = new Set(Object.keys(op.operation.responses ?? {}));
  return codes.flatMap((code) => {
    if (typeof code !== 'string' || !isErrorCode(code)) return [`x-error-codes entry ${String(code)} is not in the error catalogue`];
    const status = String(ERROR_CATALOGUE[code].status);
    return statuses.has(status) || statuses.has(`${status[0] ?? ''}XX`) || statuses.has('default')
      ? []
      : [`x-error-codes entry ${code} (${status}) has no ${status} response`];
  });
}

/** Assertion 9: one-time-secret routes are not idempotency-stored and declare neither header. */
export function oneTimeSecretProblems(op: ContractOperation): string[] {
  const parameters = Array.isArray(op.operation['parameters']) ? (op.operation['parameters'] as unknown[]).filter(isRecord) : [];
  const problems: string[] = [];
  if (op.operation['x-idempotency'] !== 'not-applicable') problems.push('one-time-secret route must be not-applicable');
  if (parameters.some((p) => String(p['name']).toLowerCase() === 'idempotency-key')) problems.push('declares an Idempotency-Key parameter');
  if (
    canonical(op.operation.responses ?? {})
      .toLowerCase()
      .includes('idempotent-replayed')
  )
    problems.push('declares Idempotent-Replayed');
  return problems;
}

/** Every finding; empty means the mounted routes, their metadata and the contract agree. */
export function checkRouteMetadata({ doc, mounted, descriptorOf, implemented }: MetadataInput): MetadataFinding[] {
  const findings: MetadataFinding[] = [];
  const operations = listOperations(doc);
  const byKey = new Map(operations.map((op) => [routeKey(op.method, op.fullPath), op]));
  const add = (rule: MetadataRule, route: string, messages: readonly string[]): void => {
    for (const message of messages) findings.push({ rule, route, message: `${route}: ${message}` });
  };
  const seen = new Set<string>();
  for (const mountedRoute of mounted) {
    if (mountedRoute.unrecognised !== undefined) continue;
    const name = `${mountedRoute.method} ${mountedRoute.path}`;
    const route = descriptorOf(mountedRoute.handler);
    if (route === undefined) {
      add('raw-handler', name, ['handler not registered through defineRoute (permission, audit descriptor and schema missing)']);
      continue;
    }
    seen.add(route.operationId);
    const op = byKey.get(mountedRoute.key);
    if (op === undefined) continue; // undocumented: the drift check names it
    if (op.operationId !== route.operationId)
      add('operation-id', name, [`operationId ${route.operationId}, openapi.yaml ${op.operationId}`]);
    add('permission', name, permissionProblems(route, op));
    add('audit', name, auditProblems(route, op));
    add('extension', name, extensionProblems(route, op));
    const auth = contractAuth(op, doc);
    if (auth !== route.auth) add('auth', name, [`auth ${route.auth} in metadata, ${auth} from the openapi.yaml security`]);
    add('schema', name, schemaProblems(route, op));
    add('error-codes', name, errorCodeProblems(op));
  }
  if (seen.size !== implemented.length || implemented.some((id) => !seen.has(id))) {
    add('count', '*', [
      `${String(seen.size)} defineRoute operation(s) mounted, ${String(implemented.length)} in the implemented-operations ledger`,
    ]);
  }
  for (const id of ONE_TIME_SECRET_OPERATIONS) {
    const op = operations.find((candidate) => candidate.operationId === id);
    if (op === undefined) add('one-time-secret', id, ['operation is missing from openapi.yaml']);
    else add('one-time-secret', `${op.method} ${op.fullPath}`, oneTimeSecretProblems(op));
  }
  return findings;
}

export const formatMetadataFinding = (finding: MetadataFinding): string => `${finding.rule}: ${finding.message}`;
