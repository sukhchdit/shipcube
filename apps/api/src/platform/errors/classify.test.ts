import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';

import { CORRELATION_ID_PATTERN, resolveCorrelationId } from '../context/request-context.js';
import { DbError, type DbErrorStatus } from '../db/index.js';
import { dbErrorMapping } from '../db/map-db-error.js';
import { classifyThrown, ownDataProperty, thrownClassName } from './classify.js';
import { buildProblem, GENERIC_SERVER_DETAIL, instanceOf } from './problem.js';

const throwing = (): never => {
  throw new Error('trap');
};

describe('classifyThrown: DbError (PR11-SEC-09 item 6)', () => {
  it.each([
    [403, 'AUTHZ_DENIED'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [500, 'INTERNAL_ERROR'],
  ] as const)('a %i DbError answers its catalogue code %s, without Retry-After', (status: DbErrorStatus, code) => {
    expect(classifyThrown(new DbError(dbErrorMapping(status, 'DB_ERROR')))).toEqual({ kind: 'db', code });
  });

  it('a retryable 503 DbError keeps SERVICE_UNAVAILABLE and its Retry-After seconds, and nothing else', () => {
    const error = new DbError({ ...dbErrorMapping(503, 'LOCK_TIMEOUT', { retryable: true }), sqlState: '55P03', prismaCode: 'P2010' });
    expect(classifyThrown(error)).toEqual({ kind: 'db', code: 'SERVICE_UNAVAILABLE', retryAfterSeconds: 1 });
  });

  it('an RLS write rejection answers AUTHZ_DENIED; reason, SQLSTATE and security event are not classified', () => {
    const error = new DbError({ ...dbErrorMapping(403, 'RLS_WRITE_REJECTED', { securityEvent: 'rls_write_rejected' }), sqlState: '42501' });
    expect(classifyThrown(error)).toStrictEqual({ kind: 'db', code: 'AUTHZ_DENIED' });
  });

  it('fails safe to INTERNAL_ERROR for a code outside the catalogue or a status that differs from the catalogue', () => {
    const forge = (fields: Record<string, unknown>) => Object.assign(new DbError(dbErrorMapping(403, 'DB_ERROR')), fields);
    for (const value of [
      forge({ code: 'NOT_A_CODE' }),
      forge({ code: 'toString' }),
      forge({ code: 42 }),
      forge({ status: 200 }),
      forge({ status: '403' }),
      forge({ code: 'NOT_FOUND', status: 403 }),
      forge({ code: 'CONFLICT', status: 500 }),
      forge({ code: 'SERVICE_UNAVAILABLE', status: 500, retryable: true, retryAfterSeconds: 1 }),
    ]) {
      expect(classifyThrown(value)).toEqual({ kind: 'db', code: 'INTERNAL_ERROR' });
    }
  });

  it('never invokes getters: accessor-backed code/status fail safe, an accessor-backed Retry-After is dropped', () => {
    const base = () => new DbError(dbErrorMapping(503, 'LOCK_TIMEOUT', { retryable: true }));
    const getterCode = Object.defineProperty(base(), 'code', { get: throwing });
    const getterStatus = Object.defineProperty(base(), 'status', { get: () => 503 });
    expect(classifyThrown(getterCode)).toEqual({ kind: 'db', code: 'INTERNAL_ERROR' });
    expect(classifyThrown(getterStatus)).toEqual({ kind: 'db', code: 'INTERNAL_ERROR' });
    for (const retry of [
      Object.defineProperty(base(), 'retryAfterSeconds', { get: () => 1 }),
      Object.defineProperty(base(), 'retryable', { get: throwing }),
    ]) {
      expect(classifyThrown(retry)).toEqual({ kind: 'db', code: 'SERVICE_UNAVAILABLE' });
    }
    expect(classifyThrown(new Proxy(base(), { getOwnPropertyDescriptor: throwing }))).toEqual({ kind: 'db', code: 'INTERNAL_ERROR' });
    expect(classifyThrown(new Proxy(base(), { getPrototypeOf: throwing }))).toEqual({ kind: 'unexpected' });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 3601, '1'])('drops an out-of-range Retry-After %p', (seconds) => {
    const error = Object.assign(new DbError(dbErrorMapping(503, 'LOCK_TIMEOUT', { retryable: true })), { retryAfterSeconds: seconds });
    expect(classifyThrown(error)).toEqual({ kind: 'db', code: 'SERVICE_UNAVAILABLE' });
  });

  it('sends no Retry-After for a DbError that is not retryable, whatever its retryAfterSeconds', () => {
    const error = Object.assign(new DbError(dbErrorMapping(503, 'DB_ERROR')), { retryAfterSeconds: 1 });
    expect(classifyThrown(error)).toEqual({ kind: 'db', code: 'SERVICE_UNAVAILABLE' });
  });

  it('does not treat a DbError look-alike (plain object or Error with the same fields) as a DbError', () => {
    const fields = { name: 'DbError', status: 403, code: 'AUTHZ_DENIED', reason: 'RLS_WRITE_REJECTED', retryable: false };
    expect(classifyThrown(fields)).toEqual({ kind: 'unexpected' });
    expect(classifyThrown(Object.assign(new Error('Database error: RLS_WRITE_REJECTED'), fields))).toEqual({ kind: 'unexpected' });
  });

  it('names the class DbError for the server log', () => {
    expect(thrownClassName(new DbError(dbErrorMapping(500, 'DB_ERROR')))).toBe('DbError');
  });
});

describe('classifyThrown: AppError Retry-After (PR #44 R1-M1)', () => {
  it('a 503 AppError with retryAfterSeconds keeps its Retry-After seconds', () => {
    const error = new AppError('SERVICE_UNAVAILABLE', { retryAfterSeconds: 1 });
    expect(classifyThrown(error)).toEqual({ kind: 'app', error, retryAfterSeconds: 1 });
  });

  it('a 503 AppError without retryAfterSeconds and a non-503 AppError with one get no Retry-After', () => {
    const plain = new AppError('SERVICE_UNAVAILABLE');
    const client = new AppError('CONFLICT', { retryAfterSeconds: 1 });
    expect([classifyThrown(plain), classifyThrown(client)]).toStrictEqual([
      { kind: 'app', error: plain },
      { kind: 'app', error: client },
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN, 3601])('drops an out-of-range AppError Retry-After %p', (seconds) => {
    const error = new AppError('SERVICE_UNAVAILABLE', { retryAfterSeconds: seconds });
    expect(classifyThrown(error)).toStrictEqual({ kind: 'app', error });
  });

  it('never invokes a retryAfterSeconds getter', () => {
    const error = Object.defineProperty(new AppError('SERVICE_UNAVAILABLE'), 'retryAfterSeconds', { get: throwing });
    expect(classifyThrown(error)).toStrictEqual({ kind: 'app', error });
  });
});

describe('classifyThrown', () => {
  it('keeps AppError and maps known body-parser and router failures', () => {
    const app = new AppError('NOT_FOUND');
    expect(classifyThrown(app)).toEqual({ kind: 'app', error: app });
    const parse = Object.assign(new Error('Unexpected token'), { type: 'entity.parse.failed', status: 400 });
    expect(classifyThrown(parse)).toEqual({ kind: 'framework', code: 'MALFORMED_REQUEST' });
    const large = Object.assign(new Error('too large'), { type: 'entity.too.large' });
    expect(classifyThrown(large)).toEqual({ kind: 'framework', code: 'PAYLOAD_TOO_LARGE' });
    const charset = Object.assign(new Error('charset'), { type: 'charset.unsupported' });
    expect(classifyThrown(charset)).toEqual({ kind: 'framework', code: 'UNSUPPORTED_MEDIA_TYPE' });
    const uri = Object.assign(new URIError('Failed to decode param'), { status: 400 });
    expect(classifyThrown(uri)).toEqual({ kind: 'framework', code: 'MALFORMED_REQUEST' });
  });

  it('treats everything else as unexpected, including look-alikes and hostile values', () => {
    for (const value of [
      { type: 'entity.parse.failed' },
      new URIError('no status'),
      Object.assign(new Error('x'), { type: 'toString' }),
      Object.defineProperty(new Error('x'), 'type', { get: throwing }),
      new Proxy(new Error('x'), { getPrototypeOf: throwing }),
      new Proxy(new Error('x'), { getOwnPropertyDescriptor: throwing }),
      'text',
      undefined,
    ]) {
      expect(classifyThrown(value)).toEqual({ kind: 'unexpected' });
    }
  });
});

describe('ownDataProperty and thrownClassName', () => {
  it('reads data properties only and never invokes getters', () => {
    expect(ownDataProperty({ a: 1 }, 'a')).toBe(1);
    expect(ownDataProperty(Object.defineProperty({}, 'a', { get: throwing }), 'a')).toBeUndefined();
    expect(ownDataProperty(new Proxy({}, { getOwnPropertyDescriptor: throwing }), 'a')).toBeUndefined();
    expect(ownDataProperty('text', 'length')).toBeUndefined();
  });

  it('names the class without reading the message', () => {
    class DatabaseError extends Error {}
    expect(thrownClassName(new DatabaseError('x'))).toBe('DatabaseError');
    expect(thrownClassName('x')).toBe('string');
    expect(thrownClassName(null)).toBe('null');
    expect(thrownClassName(Object.create(null))).toBe('object');
    expect(thrownClassName(new Proxy({}, { getPrototypeOf: throwing }))).toBe('unknown');
  });
});

describe('buildProblem', () => {
  it('drops the query string, caps instance and never returns a 5xx detail or errors', () => {
    expect(instanceOf('/a/b?token=1')).toBe('/a/b');
    expect(instanceOf(`/${'x'.repeat(5000)}`)).toHaveLength(2048);
    const problem = buildProblem({
      code: 'INTERNAL_ERROR',
      correlationId: 'abc-12345678',
      url: '/x',
      detail: 'secret',
      errors: [{ pointer: '/body/a', code: 'REQUIRED', message: 'Required.' }],
      typeBase: 'https://docs.example.test/problems/',
    });
    expect(problem).toEqual({
      type: 'https://docs.example.test/problems/INTERNAL_ERROR',
      title: 'Internal error',
      status: 500,
      detail: GENERIC_SERVER_DETAIL,
      instance: '/x',
      code: 'INTERNAL_ERROR',
      correlation_id: 'abc-12345678',
    });
  });

  it('carries errors[] for a 4xx validation failure', () => {
    const errors = [{ pointer: '/body/a', code: 'REQUIRED', message: 'Required.' }];
    expect(buildProblem({ code: 'VALIDATION_ERROR', correlationId: 'abc-12345678', url: '/x', errors })).toMatchObject({
      status: 400,
      detail: 'Validation failed.',
      errors,
    });
  });
});

describe('resolveCorrelationId (ADR-0016 §15)', () => {
  const generate = () => 'generated-0001';

  it.each([
    ['abc-12345678', 'abc-12345678'],
    ['A'.repeat(64), 'A'.repeat(64)],
    ['A'.repeat(65), 'generated-0001'],
    ['short', 'generated-0001'],
    ['bad id!', 'generated-0001'],
    ['abc-12345678\n', 'generated-0001'],
  ])('%j -> %j', (inbound, expected) => {
    expect(resolveCorrelationId(inbound, generate)).toBe(expected);
  });

  it('generates when the header is absent or repeated, and the default generator matches the pattern', () => {
    expect(resolveCorrelationId(undefined, generate)).toBe('generated-0001');
    expect(resolveCorrelationId(['abc-12345678', 'abc-12345679'], generate)).toBe('generated-0001');
    expect(resolveCorrelationId(undefined)).toMatch(CORRELATION_ID_PATTERN);
  });
});
