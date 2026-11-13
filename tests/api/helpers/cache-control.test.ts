// SEC-TC-29 (T-06; US-043, US-068): the contract helper fails an authenticated operation's response that lacks
// `Cache-Control: private, no-store`, naming the operationId. A small in-memory contract; no app, no openapi.yaml.
import { describe, expect, it } from '@jest/globals';

import type { OpenApiDocument } from '../../../tools/openapi/contract.js';
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
  paths: {
    '/public-thing': { get: { operationId: 'getPublicThing', 'x-permission': 'public', responses: { '200': okResponse } } },
    '/private-thing': { get: { operationId: 'getPrivateThing', 'x-permission': 'authenticated', responses: { '200': okResponse } } },
    '/unlabelled-thing': { get: { operationId: 'getUnlabelledThing', responses: { '200': okResponse } } },
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

const validator = createContractValidator(contract);
const get = (path: string, headers: Record<string, string> = {}): ResponseUnderTest => ({
  method: 'GET',
  path,
  status: 200,
  headers: { 'content-type': 'application/json', 'x-correlation-id': CORRELATION_ID, ...headers },
  body: { ok: true },
  text: '{"ok":true}',
});

describe('[SEC-TC-29] authenticated responses carry Cache-Control: private, no-store', () => {
  it('[SEC-TC-29] a public operation without Cache-Control passes', () => {
    expect(validator.validateResponse(get('/public-thing'))).toEqual([]);
  });

  it('[SEC-TC-29] an authenticated operation without Cache-Control fails with its operationId', () => {
    expect(validator.validateResponse(get('/private-thing'))).toEqual([
      '/headers/cache-control: getPrivateThing is authenticated (x-permission authenticated); Cache-Control must include private and no-store, missing private, no-store (SEC-TC-29)',
    ]);
  });

  it('[SEC-TC-29] only one of the two directives still fails, naming the missing one', () => {
    expect(validator.validateResponse(get('/private-thing', { 'cache-control': 'no-store' }))).toEqual([
      expect.stringMatching(/getPrivateThing .* missing private \(SEC-TC-29\)$/),
    ]);
  });

  it('[SEC-TC-29] an authenticated operation with private, no-store passes (any order, case, extra directives)', () => {
    expect(validator.validateResponse(get('/private-thing', { 'cache-control': 'private, no-store' }))).toEqual([]);
    expect(validator.validateResponse(get('/private-thing', { 'Cache-Control': 'No-Store, max-age=0, PRIVATE' }))).toEqual([]);
  });

  it('[SEC-TC-29] an operation without x-permission is treated as authenticated (fail closed)', () => {
    expect(validator.validateResponse(get('/unlabelled-thing'))).toEqual([
      expect.stringContaining('getUnlabelledThing is authenticated (x-permission <none>)'),
    ]);
  });

  it('[SEC-TC-29] parses directive names from single and repeated header values', () => {
    expect(cacheDirectivesOf('private, no-store')).toEqual(['private', 'no-store']);
    expect(cacheDirectivesOf(['private', 'max-age=0'])).toEqual(['private', 'max-age']);
    expect(cacheDirectivesOf(undefined)).toEqual([]);
  });
});
