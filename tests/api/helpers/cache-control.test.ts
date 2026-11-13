// SEC-TC-29 (T-06; US-043, US-068): the contract helper fails a response that must not be stored but lacks
// `Cache-Control: private, no-store`, naming the operationId. One predicate for helper, stubs and app (PR32-SEC-06 (a),
// PR #32 code review m1 (c), D-ARCH-107 (5)): the operation's effective `security` has no anonymous alternative, or the
// request carried a credential; problems raised before the route is known need `no-store` only. A small in-memory
// contract; no app, no openapi.yaml.
import { describe, expect, it } from '@jest/globals';

import type { OpenApiDocument } from '../../../tools/openapi/contract.js';
import { allowsAnonymous, cacheRequirement, requestCarriesCredential } from './cache-control.js';
import { cacheDirectivesOf, createContractValidator, type ResponseUnderTest } from './contract-validator.js';

const CORRELATION_ID = 'c0ffee00-1234-4abc-9def-001122334455';
const GENERIC = 'An unexpected error occurred.';
const okResponse = {
  description: 'OK',
  content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } }, additionalProperties: false } } },
};

const contract = {
  openapi: '3.1.0',
  info: { title: 'SEC-TC-29 fixture', version: '0' },
  security: [{ bearerAuth: [] }],
  paths: {
    '/public-thing': { get: { operationId: 'getPublicThing', 'x-permission': 'public', security: [], responses: { '200': okResponse } } },
    '/private-thing': { get: { operationId: 'getPrivateThing', 'x-permission': 'authenticated', responses: { '200': okResponse } } },
    // A `public` marker that is authenticated by the refresh cookie (PR32-SEC-06 (a): the old x-permission predicate
    // missed it although its body carries the access token).
    '/auth/refresh': {
      get: {
        operationId: 'refreshSession',
        'x-permission': 'public',
        security: [
          { refreshCookieWeb: [], csrfToken: [] },
          { refreshCookieAdmin: [], csrfToken: [] },
        ],
        responses: { '200': okResponse },
      },
    },
    '/dual-thing': {
      get: {
        operationId: 'createDualThing',
        'x-permission': 'public',
        security: [{}, { bearerAuth: [] }],
        responses: { '200': okResponse },
      },
    },
  },
  components: {
    schemas: { Problem: { type: 'object' } },
    responses: {
      InternalServerError: {
        description: 'Internal error',
        content: { 'application/problem+json': { examples: { INTERNAL_ERROR: { value: { detail: GENERIC } } } } },
      },
    },
  },
} as unknown as OpenApiDocument;

type Operation = Parameters<typeof allowsAnonymous>[0];

const validator = createContractValidator(contract);
const get = (path: string, headers: Record<string, string> = {}, requestHeaders?: Record<string, string>): ResponseUnderTest => ({
  method: 'GET',
  path,
  status: 200,
  headers: { 'content-type': 'application/json', 'x-correlation-id': CORRELATION_ID, ...headers },
  body: { ok: true },
  text: '{"ok":true}',
  requestHeaders,
});
const cacheFindings = (response: ResponseUnderTest): string[] =>
  validator.validateResponse(response).filter((message) => message.startsWith('/headers/cache-control'));

describe('[SEC-TC-29] responses that must not be stored carry Cache-Control: private, no-store', () => {
  it('[SEC-TC-29] an anonymous operation without Cache-Control passes', () => {
    expect(validator.validateResponse(get('/public-thing'))).toEqual([]);
  });

  it('[SEC-TC-29] an operation without an anonymous alternative fails without the header, naming its operationId', () => {
    expect(validator.validateResponse(get('/private-thing'))).toEqual([
      '/headers/cache-control: getPrivateThing must not be stored (its security has no anonymous alternative); Cache-Control must include private and no-store, missing private, no-store (SEC-TC-29)',
    ]);
  });

  it('[SEC-TC-29] [PR32-SEC-06 (a)] seeded defect: refreshSession (public marker, refresh cookie) answered without private fails', () => {
    expect(validator.validateResponse(get('/auth/refresh', { 'cache-control': 'no-store' }))).toEqual([
      expect.stringMatching(/^\/headers\/cache-control: refreshSession must not be stored .* missing private \(SEC-TC-29\)$/),
    ]);
    expect(validator.validateResponse(get('/auth/refresh', { 'cache-control': 'private, no-store' }))).toEqual([]);
  });

  it('[SEC-TC-29] only one of the two directives still fails, naming the missing one', () => {
    expect(validator.validateResponse(get('/private-thing', { 'cache-control': 'no-store' }))).toEqual([
      expect.stringMatching(/getPrivateThing .* missing private \(SEC-TC-29\)$/),
    ]);
  });

  it('[SEC-TC-29] private, no-store passes (any order, case, extra directives)', () => {
    expect(validator.validateResponse(get('/private-thing', { 'cache-control': 'private, no-store' }))).toEqual([]);
    expect(validator.validateResponse(get('/private-thing', { 'Cache-Control': 'No-Store, max-age=0, PRIVATE' }))).toEqual([]);
  });

  it('[SEC-TC-29] [D-ARCH-107 (5)] a dual-mode operation is private only when the request carried a credential', () => {
    expect(validator.validateResponse(get('/dual-thing'))).toEqual([]);
    expect(cacheFindings(get('/dual-thing', {}, { Authorization: 'Bearer opaque' }))).toEqual([
      expect.stringContaining('createDualThing must not be stored (the request carried a credential)'),
    ]);
    expect(cacheFindings(get('/public-thing', { 'cache-control': 'private, no-store' }, { 'X-Quote-Token': 'opaque' }))).toEqual([]);
  });

  it('[SEC-TC-29] an operation without its own security inherits the document requirement (fail closed)', () => {
    const op = { operationId: 'x', method: 'GET', path: '/x', fullPath: '/x', operation: {} } as unknown as Operation;
    expect(allowsAnonymous(op, contract)).toBe(false);
  });

  it('[SEC-TC-29] [PR #32 m1] a problem raised before the route is known needs no-store, and private only with a credential', () => {
    const operation = { operationId: 'getPrivateThing', method: 'GET', path: '/p', fullPath: '/p', operation: {} } as unknown as Operation;
    const directives = (credential: boolean, problemCode?: string): readonly string[] | undefined =>
      cacheRequirement({ operation, doc: contract, credential, problemCode })?.directives;
    expect(directives(false, 'MALFORMED_REQUEST')).toEqual(['no-store']);
    expect(directives(true, 'MALFORMED_REQUEST')).toEqual(['private', 'no-store']);
    expect(directives(false, 'AUTH_REQUIRED')).toEqual(['private', 'no-store']);
    expect(cacheRequirement({ operation: undefined, doc: contract, credential: false })?.directives).toEqual(['no-store']);
  });

  it('[SEC-TC-29] a credential is an Authorization header, a refresh cookie or X-Quote-Token, in any header case', () => {
    expect(requestCarriesCredential({ AUTHORIZATION: 'Bearer x' })).toBe(true);
    expect(requestCarriesCredential({ cookie: 'a=1; __Host-rt_admin=x' })).toBe(true);
    expect(requestCarriesCredential({ 'x-quote-token': 'x' })).toBe(true);
    expect(requestCarriesCredential({ cookie: 'theme=dark' })).toBe(false);
    expect(requestCarriesCredential(undefined)).toBe(false);
  });

  it('[SEC-TC-29] parses directive names from single and repeated header values', () => {
    expect(cacheDirectivesOf('private, no-store')).toEqual(['private', 'no-store']);
    expect(cacheDirectivesOf(['private', 'max-age=0'])).toEqual(['private', 'max-age']);
    expect(cacheDirectivesOf(undefined)).toEqual([]);
  });
});
