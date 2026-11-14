// Contract stubs built at run time from openapi.yaml examples (TASK-017 sheet item, US-034, ADR-0016 §1): frontend
// tasks can run against a documented response before their API task merges. Nothing generated is committed, so a
// stub cannot drift from the contract. Pure: `buildStubs` reads the dereferenced document, `resolveStub` picks the
// stub and variant for a request (default: first 2xx, first example; `Prefer: code=` / `example=` select others).
import { type HttpMethod, listOperations, type OpenApiDocument } from '../../tools/openapi/contract.js';
import { declaredKinds, PRIVATE_NO_STORE } from '../api/helpers/cache-control.js';
import { compilePathTemplate, matchAll, type PathTemplate } from '../api/helpers/path-match.js';

/** SEC-TC-29: the `Cache-Control` value of a response that must not be stored by the browser or a shared cache. */
export const PRIVATE_CACHE_CONTROL = PRIVATE_NO_STORE.join(', ');

/** One documented response example: a status, its media type and one example value. */
export interface StubVariant {
  readonly status: number;
  /** `undefined` when the response declares no content (204, 304). */
  readonly contentType: string | undefined;
  /** Example name (`default`, an error code, ...); `undefined` when the response has no example. */
  readonly exampleName: string | undefined;
  /** The example value; `undefined` for no content or no example. */
  readonly body: unknown;
  /** Declared response headers with a documented example value (X-Correlation-Id is set by the server). */
  readonly headers: Readonly<Record<string, string>>;
}

export interface ContractStub extends StubVariant {
  readonly operationId: string;
  readonly method: Uppercase<HttpMethod>;
  /** Served path template, e.g. `/api/v1/shipments/{shipmentId}`. */
  readonly fullPath: string;
  /** Whether a concrete request path (query ignored) matches `fullPath`. */
  readonly matcher: (path: string) => boolean;
  /** `x-error-codes` of the operation. */
  readonly errorCodes: readonly string[];
  /** The credential kinds the operation's `security` declares (D-ARCH-109): only these make a response private. */
  readonly auth: readonly string[];
  /** Every documented status/example pair, in document order. */
  readonly variants: readonly StubVariant[];
}

export interface StubSelection {
  readonly operationId?: string | undefined;
  readonly status?: number | undefined;
  readonly exampleName?: string | undefined;
}

export type StubResolution =
  | { readonly kind: 'stub'; readonly stub: ContractStub; readonly variant: StubVariant }
  | { readonly kind: 'no-variant'; readonly stub: ContractStub; readonly reason: string }
  | { readonly kind: 'method-not-allowed'; readonly allow: readonly string[] }
  /** OPTIONS on a known path without an OPTIONS operation: 204 + Allow, as the API answers (PR #21 R1-m3). */
  | { readonly kind: 'options'; readonly allow: readonly string[] }
  | { readonly kind: 'not-found' };

type JsonObject = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const objectAt = (value: unknown, key: string): JsonObject => {
  const child = isObject(value) ? value[key] : undefined;
  return isObject(child) ? child : {};
};

/** The `value` of an OpenAPI Example object (`externalValue` is not supported). */
const valueOf = (example: unknown): unknown => (isObject(example) ? example['value'] : undefined);

const HEADER_SET_BY_SERVER = 'x-correlation-id';
const ALLOW_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE'];

/** A documented example value for a header: header example(s), then schema examples/example/default/const/enum. */
function headerExample(header: unknown): string | undefined {
  const schema = objectAt(header, 'schema');
  const fromExamples = Object.values(objectAt(header, 'examples')).map(valueOf);
  const schemaExamples = Array.isArray(schema['examples']) ? (schema['examples'] as unknown[]) : [];
  const enumValues = Array.isArray(schema['enum']) ? (schema['enum'] as unknown[]) : [];
  const candidates = [
    isObject(header) ? header['example'] : undefined,
    ...fromExamples,
    ...schemaExamples,
    schema['example'],
    schema['default'],
    schema['const'],
    enumValues[0],
  ];
  const value = candidates.find(
    (candidate) => typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean',
  );
  return value === undefined ? undefined : String(value);
}

function headersOf(response: JsonObject): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(objectAt(response, 'headers'))) {
    if (name.toLowerCase() === HEADER_SET_BY_SERVER) continue;
    const value = headerExample(header);
    if (value !== undefined) headers[name] = value;
  }
  return headers;
}

function variantsOf(responses: JsonObject): StubVariant[] {
  const variants: StubVariant[] = [];
  for (const [statusKey, response] of Object.entries(responses)) {
    const status = Number(statusKey);
    if (!Number.isInteger(status) || !isObject(response)) continue;
    const headers = headersOf(response);
    const content = Object.entries(objectAt(response, 'content'));
    if (content.length === 0) variants.push({ status, contentType: undefined, exampleName: undefined, body: undefined, headers });
    for (const [contentType, media] of content) {
      const examples = Object.entries(objectAt(media, 'examples')).map(([name, example]) => ({ name, value: valueOf(example) }));
      if (isObject(media) && media['example'] !== undefined) examples.unshift({ name: 'example', value: media['example'] });
      if (examples.length === 0) variants.push({ status, contentType, exampleName: undefined, body: undefined, headers });
      for (const { name, value } of examples) variants.push({ status, contentType, exampleName: name, body: value, headers });
    }
  }
  return variants;
}

const codeOf = (variant: StubVariant): unknown => (isObject(variant.body) ? variant.body['code'] : undefined);

/** One stub per operation; the default variant is the first 2xx response (else the first one) and its first example. */
export function buildStubs(doc: OpenApiDocument): ContractStub[] {
  return listOperations(doc).map((contractOperation) => {
    const { operationId, method, fullPath, operation } = contractOperation;
    // The SEC-TC-29 predicate the contract validator uses (cache-control.ts): every response of an operation whose
    // security has no anonymous alternative is private, no-store; the server adds it for a request that presented a
    // credential of a declared kind (D-ARCH-109).
    const auth = declaredKinds(contractOperation, doc);
    const authenticated = !auth.includes('anonymous');
    const variants = variantsOf(operation.responses ?? {}).map((variant) =>
      authenticated ? { ...variant, headers: { ...variant.headers, 'Cache-Control': PRIVATE_CACHE_CONTROL } } : variant,
    );
    const fallback: StubVariant = { status: 501, contentType: undefined, exampleName: undefined, body: undefined, headers: {} };
    const primary = variants.find((variant) => variant.status >= 200 && variant.status < 300) ?? variants[0] ?? fallback;
    const template = compilePathTemplate(fullPath, undefined);
    const codes = operation['x-error-codes'];
    return {
      ...primary,
      operationId,
      method,
      fullPath,
      matcher: (path: string) => matchAll([template], path).length > 0,
      errorCodes: Array.isArray(codes) ? codes.filter((code): code is string => typeof code === 'string') : [],
      auth,
      variants,
    };
  });
}

function selectVariant(stub: ContractStub, selection: StubSelection): StubVariant | string {
  const { status, exampleName } = selection;
  if (status === undefined && exampleName === undefined) return stub;
  const ofStatus = status === undefined ? stub.variants : stub.variants.filter((variant) => variant.status === status);
  if (ofStatus.length === 0) return `${stub.operationId} documents no ${String(status)} response`;
  if (exampleName !== undefined) {
    return ofStatus.find((variant) => variant.exampleName === exampleName) ?? `${stub.operationId} documents no example "${exampleName}"`;
  }
  // A shared problem response lists every code of its status; prefer one this operation can return.
  return ofStatus.find((variant) => stub.errorCodes.includes(String(codeOf(variant)))) ?? ofStatus[0] ?? `${stub.operationId}: no variant`;
}

/** The stub answering `method` + `url`, or why none does (unknown route, wrong method, unknown example/status). */
export function resolveStub(stubs: readonly ContractStub[], method: string, url: string, selection: StubSelection = {}): StubResolution {
  const wanted = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  let stub: ContractStub | undefined;
  if (selection.operationId === undefined) {
    const templates: PathTemplate<ContractStub>[] = stubs.map((candidate) => compilePathTemplate(candidate.fullPath, candidate));
    const matching = matchAll(templates, url).map((template) => template.value);
    if (matching.length === 0) return { kind: 'not-found' };
    stub = matching.find((candidate) => candidate.method === wanted);
    if (stub === undefined) {
      // The API answers OPTIONS on every known path, so it is always allowed (RFC 9110 §15.5.6, fallback.ts).
      const allow = new Set([...matching.map((candidate) => candidate.method as string), 'OPTIONS']);
      if (allow.has('GET')) allow.add('HEAD');
      const allowed = ALLOW_ORDER.filter((name) => allow.has(name));
      return wanted === 'OPTIONS' ? { kind: 'options', allow: allowed } : { kind: 'method-not-allowed', allow: allowed };
    }
  } else {
    stub = stubs.find((candidate) => candidate.operationId === selection.operationId);
    if (stub === undefined) return { kind: 'not-found' };
  }
  const variant = selectVariant(stub, selection);
  return typeof variant === 'string' ? { kind: 'no-variant', stub, reason: variant } : { kind: 'stub', stub, variant };
}
