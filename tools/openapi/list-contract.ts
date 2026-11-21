/**
 * List-pagination rules of the contract (US-037 AT-US-037-08 and AT-US-037-09; REQ-API-007/008; ADR-0016 item 5 and
 * amendment 5 (d); api/README.md §4; DR-A21). Pure: it reads a dereferenced document and returns findings, each naming
 * the route; `list-contract.test.ts` runs it on the real contract (zero findings) and on seeded defects.
 *
 * A list operation is a GET whose 200 JSON body is an object with an `items` array, named `list...` or carrying a page
 * field (the `<Thing>List` schemas; `isListOperation`). Rules:
 *  - `list-without-pagination`: it declares no `limit` or no `cursor` query parameter (AT-US-037-09);
 *  - `list-without-page-fields`: its body lacks `next_cursor` or `has_more`;
 *  - `limit-out-of-policy`: `limit` is not an integer parameter with `minimum: 1`, a `maximum` and a `default` in
 *    1..maximum, or its maximum exceeds 100, 200 on an audit list (tagged `audit` AND under `/audit/`: the tag alone
 *    does not raise a business list's cap, PR045-SEC-07), or the operation's `x-max-limit`;
 *  - `max-limit-not-reference`: `x-max-limit` on an operation whose `x-tenancy` is not `public` (AT-US-037-08: tenant,
 *    user, guest and operator lists never raise the cap; ADR-0016 amendment 5 (d) allows bounded global reference lists
 *    only);
 *  - `max-limit-invalid`: `x-max-limit` is not an integer in 101..300, or differs from the `limit` maximum.
 */
import { type ContractOperation, listOperations, type OpenApiDocument } from './contract.js';

export type ListContractRule =
  'list-without-pagination' | 'list-without-page-fields' | 'limit-out-of-policy' | 'max-limit-not-reference' | 'max-limit-invalid';

export interface ListContractFinding {
  readonly rule: ListContractRule;
  /** `GET /api/v1/organisations/{orgId}/members (listMembers)`. */
  readonly route: string;
  readonly message: string;
}

/** Business lists (REQ-API-007). */
export const STANDARD_MAX_LIMIT = 100;
/** Audit lists (DR-A21). */
export const AUDIT_MAX_LIMIT = 200;
/** Bounded global reference lists (ADR-0016 amendment 5 (d)). */
export const REFERENCE_MAX_LIMIT = 300;

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The 200 `application/json` schema of an operation, if any. */
function successSchema(operation: ContractOperation): Json | undefined {
  const ok = operation.operation.responses?.['200'];
  const content = isObject(ok) ? ok['content'] : undefined;
  const media = isObject(content) ? content['application/json'] : undefined;
  const schema = isObject(media) ? media['schema'] : undefined;
  return isObject(schema) ? schema : undefined;
}

function propertiesOf(schema: Json): Json {
  const properties = schema['properties'];
  return isObject(properties) ? properties : {};
}

/**
 * A GET whose 200 body is an object with an `items` array and that is named or shaped as a list: its operationId starts
 * with `list` (api/README.md §1 naming) or its body has `next_cursor` or `has_more`. A document with an `items`
 * array of its own (the customs declaration's line items) is not a list.
 */
export function isListOperation(operation: ContractOperation): boolean {
  if (operation.method !== 'GET') return false;
  const schema = successSchema(operation);
  const properties = schema === undefined ? {} : propertiesOf(schema);
  const items = properties['items'];
  if (!isObject(items) || items['type'] !== 'array') return false;
  return /^list[A-Z]/.test(operation.operationId) || Object.hasOwn(properties, 'next_cursor') || Object.hasOwn(properties, 'has_more');
}

/** The query parameters of an operation, the path item's included (operation-level wins on a name clash). */
function queryParameters(doc: OpenApiDocument, operation: ContractOperation): Map<string, Json> {
  const declared = [
    ...(doc.paths[operation.path]?.parameters ?? []),
    ...((operation.operation['parameters'] as unknown[] | undefined) ?? []),
  ];
  const query = new Map<string, Json>();
  for (const parameter of declared) {
    if (isObject(parameter) && parameter['in'] === 'query' && typeof parameter['name'] === 'string')
      query.set(parameter['name'], parameter);
  }
  return query;
}

const routeOf = (operation: ContractOperation): string => `${operation.method} ${operation.fullPath} (${operation.operationId})`;

const tagsOf = (operation: ContractOperation): readonly unknown[] => {
  const tags = operation.operation['tags'];
  return Array.isArray(tags) ? tags : [];
};

/** An audit list: tagged `audit` and under the audit paths (the tag alone does not qualify; PR045-SEC-07). */
const isAuditList = (operation: ContractOperation): boolean => tagsOf(operation).includes('audit') && operation.path.startsWith('/audit/');

/** The findings of `x-max-limit` and of the `limit` parameter of one list operation. */
function limitFindings(operation: ContractOperation, limit: Json): ListContractFinding[] {
  const route = routeOf(operation);
  const findings: ListContractFinding[] = [];
  const declaredCap = operation.operation['x-max-limit'];
  if (declaredCap !== undefined) {
    if (operation.operation['x-tenancy'] !== 'public') {
      findings.push({
        rule: 'max-limit-not-reference',
        route,
        message: `declares x-max-limit on a ${String(operation.operation['x-tenancy'])} list; only public reference lists may raise the cap`,
      });
    }
    if (
      typeof declaredCap !== 'number' ||
      !Number.isInteger(declaredCap) ||
      declaredCap <= STANDARD_MAX_LIMIT ||
      declaredCap > REFERENCE_MAX_LIMIT
    ) {
      findings.push({ rule: 'max-limit-invalid', route, message: `x-max-limit must be an integer in 101..${String(REFERENCE_MAX_LIMIT)}` });
    }
  }
  const schema = isObject(limit['schema']) ? limit['schema'] : {};
  const { minimum, maximum } = schema;
  const fallback = schema['default'];
  if (
    schema['type'] !== 'integer' ||
    minimum !== 1 ||
    typeof maximum !== 'number' ||
    !Number.isInteger(maximum) ||
    typeof fallback !== 'number' ||
    !Number.isInteger(fallback) ||
    fallback < 1 ||
    fallback > maximum
  ) {
    findings.push({
      rule: 'limit-out-of-policy',
      route,
      message: 'limit must be an integer with minimum 1, a maximum and a default in 1..maximum',
    });
    return findings;
  }
  if (declaredCap !== undefined) {
    if (maximum !== declaredCap)
      findings.push({ rule: 'max-limit-invalid', route, message: `limit maximum ${String(maximum)} differs from x-max-limit` });
    return findings;
  }
  const cap = isAuditList(operation) ? AUDIT_MAX_LIMIT : STANDARD_MAX_LIMIT;
  if (maximum > cap)
    findings.push({ rule: 'limit-out-of-policy', route, message: `limit maximum ${String(maximum)} exceeds ${String(cap)}` });
  return findings;
}

/** Every list-pagination finding of the document, in document order. */
export function checkListContract(doc: OpenApiDocument): ListContractFinding[] {
  const findings: ListContractFinding[] = [];
  for (const operation of listOperations(doc)) {
    if (!isListOperation(operation)) continue;
    const route = routeOf(operation);
    const query = queryParameters(doc, operation);
    const limit = query.get('limit');
    const missing = ['limit', 'cursor'].filter((name) => !query.has(name));
    if (missing.length > 0) {
      findings.push({ rule: 'list-without-pagination', route, message: `list route lacks the ${missing.join(' and ')} parameter(s)` });
    }
    const body = propertiesOf(successSchema(operation) ?? {});
    const absent = ['next_cursor', 'has_more'].filter((name) => !Object.hasOwn(body, name));
    if (absent.length > 0) findings.push({ rule: 'list-without-page-fields', route, message: `list body lacks ${absent.join(' and ')}` });
    if (limit !== undefined) findings.push(...limitFindings(operation, limit));
  }
  return findings;
}

/** One line per finding, for test failure messages. */
export const formatListFinding = (finding: ListContractFinding): string => `${finding.rule}: ${finding.route}: ${finding.message}`;
