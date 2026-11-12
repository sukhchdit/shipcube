import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';

import { CORRELATION_ID_PATTERN, resolveCorrelationId } from '../context/request-context.js';
import { classifyThrown, ownDataProperty, thrownClassName } from './classify.js';
import { buildProblem, GENERIC_SERVER_DETAIL, instanceOf } from './problem.js';

const throwing = (): never => {
  throw new Error('trap');
};

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
