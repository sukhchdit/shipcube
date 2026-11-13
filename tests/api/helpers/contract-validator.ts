// Response validation against openapi.yaml for API tests (US-034 AT-US-034-04/05, REQ-API-004, ADR-0016 §1,
// api/README.md §16). Ajv 2020 in strict mode with `allErrors`; the OpenAPI-only schema keywords are declared as an
// annotation vocabulary instead of switching strict mode off. Pure: `validateResponse` returns the deviations (empty =
// valid) and `describeFailure` formats them with a redacted body excerpt; the Supertest wrapper throws (expect-contract.ts).
import { ERROR_CATALOGUE, isErrorCode } from '@platform/shared';
import { isOmittedKey, isPiiKey, isSensitiveKey } from '@platform/shared/logging';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';

import { type ContractOperation, listOperations, type OpenApiDocument } from '../../../tools/openapi/contract.js';
import { assertKnownFormats, registerContractFormats } from './formats.js';
import { compilePathTemplate, matchAll, type PathTemplate, requestPathOf } from './path-match.js';

/** X-Correlation-Id syntax (REQ-PLAT-011, components/parameters/CorrelationId). */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
/** Framework errors valid on every path, whatever the operation's `x-error-codes` (api/README.md §3). */
export const FRAMEWORK_ERROR_CODES: Readonly<Record<string, number>> = Object.freeze({ NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405 });
export const PROBLEM_MEDIA_TYPE = 'application/problem+json';
/**
 * Keys whose values never appear in a failure message: the log redaction classes are the single source (PR21-SEC-07
 * (b)). Credentials (`reauth_proof`, `recovery_codes`, `manual_key`, signatures), personal data (`display_name`,
 * `email`) and URLs (`provisioning_uri`, which carries the TOTP secret).
 */
const isExcerptRedactedKey = (key: string): boolean => isSensitiveKey(key) || isPiiKey(key) || isOmittedKey(key);
/** `code` is a TOTP code in auth bodies but the catalogue code in problem bodies, which the excerpt keeps readable. */
const CODE_KEY = 'code';
/** OpenAPI 3.0 keywords that 3.1 dropped; Ajv would still apply `nullable` natively, unlike the 3.1 semantics. */
const OPENAPI_30_KEYWORDS = ['nullable'];
const EXCERPT_LENGTH = 500;
const MAX_EXCERPT_DEPTH = 8;
/** OpenAPI 3.1 schema keywords JSON Schema 2020-12 does not define; annotations only. */
const OPENAPI_SCHEMA_KEYWORDS = ['discriminator', 'xml', 'externalDocs', 'example'];
const SCHEMA_MAP_KEYWORDS = ['properties', 'patternProperties', '$defs', 'dependentSchemas'];
const SCHEMA_KEYWORDS = ['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames'];
const SCHEMA_KEYWORDS_MORE = ['unevaluatedProperties', 'unevaluatedItems', 'contentSchema'];
const SCHEMA_ARRAY_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];

export type HeaderValue = string | readonly string[] | undefined;

/** What the validator needs from a response; Supertest responses map onto it in expect-contract.ts. */
export interface ResponseUnderTest {
  readonly method: string;
  /** Request target as sent; the query string is ignored. */
  readonly path: string;
  readonly status: number;
  /** Header names in any case. */
  readonly headers: Readonly<Record<string, HeaderValue>>;
  /** Parsed body (JSON media types), or `undefined`. */
  readonly body: unknown;
  /** Raw body text where available; decides "has a body" for 204/304 and media types without a schema. */
  readonly text?: string | undefined;
}

export interface ContractValidator {
  readonly document: OpenApiDocument;
  readonly operations: readonly ContractOperation[];
  /** The 5xx `detail` the contract mandates (components/responses/InternalServerError, INTERNAL_ERROR example). */
  readonly genericServerDetail: string;
  /** The operation for `method` + concrete `path`, most specific template first. */
  resolveOperation(method: string, path: string): ContractOperation | undefined;
  /** Human-readable deviations, each led by a JSON pointer (`/status`, `/headers/<name>`, `/body/...`). */
  validateResponse(response: ResponseUnderTest): string[];
  /** Failure message: operation, method, path, status, deviations and a redacted body excerpt. */
  describeFailure(response: ResponseUnderTest, deviations: readonly string[]): string;
  /** Compiles every response schema (fails on a schema Ajv strict mode rejects); returns the count compiled. */
  compileAll(): number;
}

type JsonObject = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

const objectAt = (value: unknown, ...keys: readonly string[]): JsonObject | undefined => {
  let current: unknown = value;
  for (const key of keys) current = isObject(current) ? current[key] : undefined;
  return isObject(current) ? current : undefined;
};

const escapePointer = (segment: string): string => segment.replaceAll('~', '~0').replaceAll('/', '~1');

/** Walks every schema reachable through schema keywords, once per object (the dereferenced document shares objects). */
function walkSchema(schema: unknown, visit: (schema: JsonObject) => void, seen: Set<unknown>): void {
  if (!isObject(schema) || seen.has(schema)) return;
  seen.add(schema);
  visit(schema);
  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const children = schema[keyword];
    if (isObject(children)) for (const child of Object.values(children)) walkSchema(child, visit, seen);
  }
  for (const keyword of [...SCHEMA_KEYWORDS, ...SCHEMA_KEYWORDS_MORE]) walkSchema(schema[keyword], visit, seen);
  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    const children = schema[keyword];
    if (Array.isArray(children)) for (const child of children as unknown[]) walkSchema(child, visit, seen);
  }
}

/** Root schemas of the document: components, parameters, request bodies, responses and their headers. */
function rootSchemas(doc: OpenApiDocument): unknown[] {
  const roots: unknown[] = Object.values(objectAt(doc, 'components', 'schemas') ?? {});
  const fromContent = (content: unknown): void => {
    if (isObject(content)) for (const media of Object.values(content)) roots.push(objectAt(media)?.['schema']);
  };
  const fromParameters = (parameters: unknown): void => {
    if (Array.isArray(parameters)) for (const parameter of parameters as unknown[]) roots.push(objectAt(parameter)?.['schema']);
  };
  for (const operation of listOperations(doc)) {
    fromParameters(operation.operation['parameters']);
    fromParameters(doc.paths[operation.path]?.parameters);
    fromContent(operation.operation.requestBody?.['content']);
    for (const response of Object.values(operation.operation.responses ?? {})) {
      fromContent(objectAt(response)?.['content']);
      for (const header of Object.values(objectAt(response, 'headers') ?? {})) roots.push(objectAt(header)?.['schema']);
    }
  }
  return roots;
}

/** Formats used, vendor-extension keywords and OpenAPI 3.0-only keywords found in schema positions. */
export function scanSchemas(doc: OpenApiDocument): {
  formats: Set<string>;
  extensionKeywords: Set<string>;
  openApi30Keywords: Set<string>;
} {
  const formats = new Set<string>();
  const extensionKeywords = new Set<string>();
  const openApi30Keywords = new Set<string>();
  const seen = new Set<unknown>();
  const visit = (schema: JsonObject): void => {
    if (typeof schema['format'] === 'string') formats.add(schema['format']);
    for (const key of Object.keys(schema)) {
      if (key.startsWith('x-')) extensionKeywords.add(key);
      if (OPENAPI_30_KEYWORDS.includes(key)) openApi30Keywords.add(key);
    }
  };
  for (const root of rootSchemas(doc)) walkSchema(root, visit, seen);
  return { formats, extensionKeywords, openApi30Keywords };
}

function genericServerDetailOf(doc: OpenApiDocument): string {
  const example = objectAt(doc, 'components', 'responses', 'InternalServerError', 'content', PROBLEM_MEDIA_TYPE, 'examples');
  const detail = objectAt(example?.['INTERNAL_ERROR'], 'value')?.['detail'];
  if (typeof detail !== 'string') throw new Error('openapi.yaml: InternalServerError has no INTERNAL_ERROR example detail');
  return detail;
}

/** `application/problem+json; charset=utf-8` -> `application/problem+json`. */
export function mediaTypeOf(contentType: HeaderValue): string | undefined {
  const value = typeof contentType === 'string' ? contentType : contentType?.[0];
  if (typeof value !== 'string') return undefined;
  const media = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return media === '' ? undefined : media;
}

const isJsonMediaType = (media: string): boolean => media === 'application/json' || media.endsWith('+json');

function headerOf(headers: Readonly<Record<string, HeaderValue>>, name: string): HeaderValue {
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
  return key === undefined ? undefined : headers[key];
}

/** The upper-case methods of a non-empty `Allow` header, or `undefined`. */
function allowedOf(response: ResponseUnderTest): string[] | undefined {
  const allow = headerOf(response.headers, 'allow');
  if (typeof allow !== 'string' || allow.trim() === '') return undefined;
  return allow
    .toUpperCase()
    .split(',')
    .map((method) => method.trim());
}

function hasBody(response: ResponseUnderTest): boolean {
  if (typeof response.text === 'string') return response.text.length > 0;
  const length = headerOf(response.headers, 'content-length');
  if (typeof length === 'string' && Number(length) > 0) return true;
  return response.body !== undefined && !(isObject(response.body) && Object.keys(response.body).length === 0);
}

function describeAjvError(error: ErrorObject): string {
  const pointer = `/body${error.instancePath}`;
  const params = error.params as Record<string, unknown>;
  const detail =
    error.keyword === 'additionalProperties'
      ? ` (additional property "${String(params['additionalProperty'])}")`
      : error.keyword === 'enum'
        ? ` (allowed: ${JSON.stringify(params['allowedValues'])})`
        : '';
  return `${pointer}: ${error.message ?? error.keyword}${detail}`;
}

/** Deep copy with sensitive keys replaced; bounded depth. */
export function redactForExcerpt(value: unknown, depth = 0): unknown {
  if (depth > MAX_EXCERPT_DEPTH) return '[…]';
  if (Array.isArray(value)) return value.map((item: unknown) => redactForExcerpt(item, depth + 1));
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isExcerptRedactedKey(key) || (key === CODE_KEY && !isErrorCode(item)) ? '[REDACTED]' : redactForExcerpt(item, depth + 1),
    ]),
  );
}

/** At most 500 characters of the body, sensitive members redacted. */
export function bodyExcerpt(body: unknown, text?: string): string {
  let value: unknown = body;
  if ((value === undefined || (isObject(value) && Object.keys(value).length === 0)) && typeof text === 'string' && text !== '') {
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      // Not JSON (event stream, YAML, binary as text): no key structure to redact; the text is shown truncated.
      value = text;
    }
  }
  const rendered = typeof value === 'string' ? value : (JSON.stringify(redactForExcerpt(value)) ?? '<no body>');
  return rendered.length > EXCERPT_LENGTH ? `${rendered.slice(0, EXCERPT_LENGTH)}…` : rendered;
}

const statusKeys = (operation: ContractOperation): string[] => Object.keys(operation.operation.responses ?? {});

/** The `x-permission` of anonymous operations (api/README.md); anything else is an authenticated operation. */
export const PUBLIC_PERMISSION = 'public';
const PRIVATE_NO_STORE = ['private', 'no-store'] as const;

export const requiresPrivateNoStore = (operation: ContractOperation): boolean => operation.operation['x-permission'] !== PUBLIC_PERMISSION;

/** Lower-case directive names of a Cache-Control value (`private, no-store, max-age=0` -> private, no-store, max-age). */
export function cacheDirectivesOf(value: HeaderValue): string[] {
  const joined = typeof value === 'string' ? value : (value ?? []).join(',');
  return joined
    .split(',')
    .map((directive) => directive.split('=', 1)[0]?.trim().toLowerCase() ?? '')
    .filter((directive) => directive !== '');
}

function responseFor(operation: ContractOperation, status: number): JsonObject | undefined {
  const responses = operation.operation.responses ?? {};
  return objectAt(responses[String(status)]) ?? objectAt(responses[`${Math.floor(status / 100)}XX`]) ?? objectAt(responses['default']);
}

export function createContractValidator(doc: OpenApiDocument): ContractValidator {
  const { formats, extensionKeywords, openApi30Keywords } = scanSchemas(doc);
  assertKnownFormats(formats);
  if (openApi30Keywords.size > 0) {
    // Ajv implements `nullable` itself, so strict mode would accept it with 3.0 meaning (PR #21 N3); 3.1 uses type: [.., 'null'].
    throw new Error(`openapi.yaml: OpenAPI 3.0 schema keyword(s) ${[...openApi30Keywords].join(', ')} in a 3.1 document`);
  }
  const problemSchema = objectAt(doc, 'components', 'schemas', 'Problem');
  if (problemSchema === undefined) throw new Error('openapi.yaml: components/schemas/Problem is missing');
  const genericServerDetail = genericServerDetailOf(doc);

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  registerContractFormats(ajv);
  ajv.addVocabulary([...OPENAPI_SCHEMA_KEYWORDS, ...[...extensionKeywords].sort()]);

  const operations = listOperations(doc);
  const templates: PathTemplate<ContractOperation>[] = operations.map((operation) => compilePathTemplate(operation.fullPath, operation));
  const validators = new Map<string, ValidateFunction>();

  const validatorFor = (key: string, schema: JsonObject): ValidateFunction => {
    let validate = validators.get(key);
    if (validate === undefined) {
      validate = ajv.compile(schema);
      validators.set(key, validate);
    }
    return validate;
  };

  const resolveOperation = (method: string, path: string): ContractOperation | undefined => {
    const wanted = method.toUpperCase();
    return matchAll(templates, path).find((candidate) => candidate.value.method === wanted)?.value;
  };

  const validateBody = (key: string, schema: unknown, body: unknown, into: string[]): void => {
    if (!isObject(schema)) return;
    const validate = validatorFor(key, schema);
    if (!validate(body)) for (const error of validate.errors ?? []) into.push(describeAjvError(error));
  };

  const checkCorrelationId = (response: ResponseUnderTest, into: string[]): void => {
    const value = headerOf(response.headers, 'x-correlation-id');
    if (typeof value !== 'string') into.push('/headers/x-correlation-id: missing (required on every response, REQ-PLAT-011)');
    else if (!CORRELATION_ID_PATTERN.test(value))
      into.push(`/headers/x-correlation-id: "${value}" does not match ${CORRELATION_ID_PATTERN.source}`);
  };

  const checkProblem = (response: ResponseUnderTest, allowedCodes: readonly string[], into: string[]): void => {
    if (!isObject(response.body)) return;
    const { code, status, type, detail } = response.body;
    if (typeof code !== 'string') {
      into.push('/body/code: a problem body must carry its catalogue code');
      return;
    }
    if (!allowedCodes.includes(code) && !Object.hasOwn(FRAMEWORK_ERROR_CODES, code)) {
      into.push(`/body/code: "${code}" is not in x-error-codes (${allowedCodes.join(', ') || 'none'})`);
    }
    if (!isErrorCode(code)) into.push(`/body/code: "${code}" is not in the error catalogue`);
    else if (status !== ERROR_CATALOGUE[code].status) {
      into.push(`/body/status: ${String(status)} differs from the catalogue status ${String(ERROR_CATALOGUE[code].status)} of ${code}`);
    }
    if (status !== response.status) into.push(`/body/status: ${String(status)} differs from the HTTP status ${String(response.status)}`);
    if (typeof type !== 'string' || !type.endsWith(`/problems/${code}`)) into.push(`/body/type: must end with "/problems/${code}"`);
    if (response.status >= 500 && detail !== genericServerDetail) into.push(`/body/detail: a 5xx detail must be "${genericServerDetail}"`);
  };

  /**
   * SEC-TC-29 (T-06): every response of an authenticated operation (`x-permission` other than `public`; a missing value
   * counts as authenticated) carries `Cache-Control` with both `private` and `no-store`, errors included.
   */
  const checkCacheControl = (operation: ContractOperation, response: ResponseUnderTest, into: string[]): void => {
    if (!requiresPrivateNoStore(operation)) return;
    const directives = cacheDirectivesOf(headerOf(response.headers, 'cache-control'));
    const missing = PRIVATE_NO_STORE.filter((directive) => !directives.includes(directive));
    if (missing.length > 0) {
      const permission = operation.operation['x-permission'];
      into.push(
        `/headers/cache-control: ${operation.operationId} is authenticated (x-permission ${typeof permission === 'string' ? permission : '<none>'}); Cache-Control must include private and no-store, missing ${missing.join(', ')} (SEC-TC-29)`,
      );
    }
  };

  /** 404 on an unknown route, 405 with `Allow` when the path exists for other methods (api/README.md §3). */
  const validateFrameworkResponse = (response: ResponseUnderTest, pathKnown: boolean, into: string[]): void => {
    const expected = pathKnown ? 405 : 404;
    const code = pathKnown ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND';
    if (response.status !== expected) {
      into.push(
        pathKnown
          ? `/status: no ${response.method.toUpperCase()} operation for this path; expected 405 METHOD_NOT_ALLOWED, got ${String(response.status)}`
          : `/status: no contract operation matches the path; expected 404 NOT_FOUND, got ${String(response.status)}`,
      );
      return;
    }
    if (mediaTypeOf(headerOf(response.headers, 'content-type')) !== PROBLEM_MEDIA_TYPE) {
      into.push(`/headers/content-type: a framework ${String(expected)} must be ${PROBLEM_MEDIA_TYPE}`);
    }
    if (pathKnown) {
      const allow = allowedOf(response);
      if (allow === undefined) into.push('/headers/allow: a 405 must list the allowed methods');
      else if (allow.includes(response.method.toUpperCase())) {
        into.push(`/headers/allow: "${allow.join(', ')}" lists the refused method ${response.method.toUpperCase()}`);
      } else if (!allow.includes('OPTIONS')) {
        into.push(`/headers/allow: "${allow.join(', ')}" must include OPTIONS (answered on every known path)`);
      }
    }
    validateBody(`framework ${String(expected)}`, problemSchema, response.body, into);
    checkProblem(response, [code], into);
  };

  /** OPTIONS on a known path without an OPTIONS operation: 204, no body, `Allow` including OPTIONS (PR #21 R1-m3). */
  const validateOptionsResponse = (response: ResponseUnderTest, into: string[]): void => {
    if (response.status !== 204) {
      into.push(`/status: OPTIONS on a known path answers 204 with Allow; got ${String(response.status)}`);
      return;
    }
    if (hasBody(response)) into.push('/body: an OPTIONS 204 has no body');
    const allow = allowedOf(response);
    if (allow === undefined) into.push('/headers/allow: an OPTIONS 204 must list the allowed methods');
    else if (!allow.includes('OPTIONS')) into.push(`/headers/allow: "${allow.join(', ')}" must include OPTIONS`);
  };

  const validateOperationResponse = (operation: ContractOperation, response: ResponseUnderTest, into: string[]): void => {
    checkCacheControl(operation, response, into);
    const declared = responseFor(operation, response.status);
    if (declared === undefined) {
      into.push(
        `/status: status ${String(response.status)} is not declared for ${operation.operationId} (declared: ${statusKeys(operation).join(', ')})`,
      );
      return;
    }
    const content = objectAt(declared, 'content') ?? {};
    const declaredMedia = Object.keys(content);
    const media = mediaTypeOf(headerOf(response.headers, 'content-type'));
    const bodyPresent = hasBody(response);

    if (response.status === 204 || response.status === 304 || declaredMedia.length === 0) {
      if (bodyPresent) into.push(`/body: status ${String(response.status)} of ${operation.operationId} declares no body, but one was sent`);
    } else if (media === undefined) {
      into.push(`/headers/content-type: missing (declared: ${declaredMedia.join(', ')})`);
    } else if (!declaredMedia.includes(media)) {
      into.push(`/headers/content-type: "${media}" is not declared for ${String(response.status)} (declared: ${declaredMedia.join(', ')})`);
    } else if (isJsonMediaType(media)) {
      validateBody(
        `${operation.operationId} ${String(response.status)} ${media}`,
        objectAt(content, media)?.['schema'],
        response.body,
        into,
      );
      const codes = operation.operation['x-error-codes'];
      if (media === PROBLEM_MEDIA_TYPE)
        checkProblem(response, Array.isArray(codes) ? codes.filter((c) => typeof c === 'string') : [], into);
    }

    for (const [name, header] of Object.entries(objectAt(declared, 'headers') ?? {})) {
      if (objectAt(header)?.['required'] === true && headerOf(response.headers, name) === undefined) {
        into.push(`/headers/${escapePointer(name.toLowerCase())}: required header is missing`);
      }
    }
  };

  const validateResponse = (response: ResponseUnderTest): string[] => {
    const deviations: string[] = [];
    checkCorrelationId(response, deviations);
    const method = response.method.toUpperCase();
    // Express answers HEAD with the GET route; the body is dropped, so only status and headers are compared.
    const lookup = method === 'HEAD' && resolveOperation('HEAD', response.path) === undefined ? 'GET' : method;
    const operation = resolveOperation(lookup, response.path);
    if (operation === undefined) {
      const pathKnown = matchAll(templates, response.path).length > 0;
      if (pathKnown && method === 'OPTIONS') validateOptionsResponse(response, deviations);
      else validateFrameworkResponse(response, pathKnown, deviations);
    } else if (lookup !== method) {
      checkCacheControl(operation, response, deviations);
      if (responseFor(operation, response.status) === undefined) {
        deviations.push(`/status: status ${String(response.status)} is not declared for ${operation.operationId}`);
      }
    } else {
      validateOperationResponse(operation, response, deviations);
    }
    return deviations;
  };

  const describeFailure = (response: ResponseUnderTest, deviations: readonly string[]): string => {
    const operation = resolveOperation(response.method, response.path);
    const name = operation?.operationId ?? '<no operation>';
    return [
      `Response does not match the contract: ${name} ${response.method.toUpperCase()} ${requestPathOf(response.path)} -> ${String(response.status)}`,
      ...deviations.map((deviation) => `  - ${deviation}`),
      `Body excerpt (redacted): ${bodyExcerpt(response.body, response.text)}`,
    ].join('\n');
  };

  const compileAll = (): number => {
    for (const operation of operations) {
      for (const status of statusKeys(operation)) {
        const content = objectAt(operation.operation.responses?.[status], 'content') ?? {};
        for (const [media, entry] of Object.entries(content)) {
          const schema = objectAt(entry, 'schema');
          if (schema !== undefined && isJsonMediaType(media)) validatorFor(`${operation.operationId} ${status} ${media}`, schema);
        }
      }
    }
    return validators.size;
  };

  return { document: doc, operations, genericServerDetail, resolveOperation, validateResponse, describeFailure, compileAll };
}
