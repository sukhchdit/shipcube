// Validation slot (REQ-SEC-007, REQ-API-005/006, PR20-SEC-12; TASK-020): sub-codes, pointers, value-free messages.
import { describe, expect, it } from '@jest/globals';
import { AppError, MAX_VALIDATION_ISSUES } from '@platform/shared';
import Joi from 'joi';

import { prepareSchema, prepareSchemas, SAFE_MESSAGES, subCodeOf, validateRequest, VALUE_REFERENCE } from './validate.js';

const raw = (overrides: Partial<Parameters<typeof validateRequest>[1]> = {}) => ({
  params: {},
  query: {},
  body: undefined,
  headers: {},
  ...overrides,
});

function issuesOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, errors: error.errors };
    throw error;
  }
  return 'no error';
}

describe('validation sub-codes (api/README.md §3)', () => {
  it.each([
    ['any.required', 'REQUIRED'],
    ['object.unknown', 'UNKNOWN_FIELD'],
    ['any.only', 'INVALID_ENUM'],
    ['string.base', 'INVALID_TYPE'],
    ['number.base', 'INVALID_TYPE'],
    ['string.pattern.base', 'INVALID_FORMAT'],
    ['string.email', 'INVALID_FORMAT'],
    ['number.max', 'OUT_OF_RANGE'],
    ['date.min', 'OUT_OF_RANGE'],
    ['string.min', 'TOO_SHORT'],
    ['string.empty', 'TOO_SHORT'],
    ['array.max', 'TOO_LONG'],
    ['custom.unheard', 'INVALID_FORMAT'],
  ])('%s -> %s', (type, code) => {
    expect(subCodeOf(type)).toBe(code);
  });
});

describe('validateRequest', () => {
  const schemas = prepareSchemas({
    params: Joi.object({ id: Joi.string().guid().required() }),
    query: Joi.object({ limit: Joi.number().integer().max(100) }),
    body: Joi.object({ name: Joi.string().min(2).required(), kind: Joi.string().valid('a', 'b') }),
    headers: Joi.object({ 'x-thing': Joi.string().required() }),
  });
  const id = '0193a5b2-7c1e-7d4a-9f3b-000000000f01';

  it('returns the converted parts and projects only the declared headers', () => {
    const input = validateRequest(
      schemas,
      raw({ params: { id }, query: { limit: '5' }, body: { name: 'ok' }, headers: { 'x-thing': 't', host: 'h' } }),
    );
    expect(input).toEqual({ params: { id }, query: { limit: 5 }, body: { name: 'ok' }, headers: { 'x-thing': 't' } });
  });

  it('[AT-US-067-04] names every issue with an RFC 6901 pointer, a sub-code and the fixed sub-code text', () => {
    const result = issuesOf(() =>
      validateRequest(
        schemas,
        raw({ params: { id: 'zzSentinelValue' }, query: { limit: '500', debug: '1' }, body: { kind: 'c', 'a/b~c': 1 } }),
      ),
    );
    expect(result).toEqual({
      code: 'VALIDATION_ERROR',
      errors: [
        { pointer: '/params/id', code: 'INVALID_FORMAT', message: 'Field has an invalid format.' },
        { pointer: '/query/limit', code: 'OUT_OF_RANGE', message: 'Field is out of range.' },
        { pointer: '/query/debug', code: 'UNKNOWN_FIELD', message: 'Field is not allowed.' },
        { pointer: '/headers/x-thing', code: 'REQUIRED', message: 'Field is required.' },
        { pointer: '/body/name', code: 'REQUIRED', message: 'Field is required.' },
        { pointer: '/body/kind', code: 'INVALID_ENUM', message: 'Field is not one of the allowed values.' },
        { pointer: '/body/a~1b~0c', code: 'UNKNOWN_FIELD', message: 'Field is not allowed.' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('zzSentinelValue');
  });

  it('a route without a body schema accepts no body; without a query schema no query parameter', () => {
    const none = prepareSchemas({});
    expect(validateRequest(none, raw())).toEqual({ params: {}, query: {}, body: undefined, headers: {} });
    expect(issuesOf(() => validateRequest(none, raw({ body: { a: 1 }, query: { q: 'x' } })))).toEqual({
      code: 'VALIDATION_ERROR',
      errors: [
        { pointer: '/query/q', code: 'UNKNOWN_FIELD', message: 'Field is not allowed.' },
        { pointer: '/body/a', code: 'UNKNOWN_FIELD', message: 'Field is not allowed.' },
      ],
    });
  });

  it('caps the issues at MAX_VALIDATION_ISSUES', () => {
    const query = Object.fromEntries(Array.from({ length: 80 }, (_unused, index) => [`k${String(index)}`, 'x']));
    const result = issuesOf(() => validateRequest(prepareSchemas({}), raw({ query }))) as { errors: unknown[] };
    expect(result.errors).toHaveLength(MAX_VALIDATION_ISSUES);
  });
});

describe('value-free messages (PR20-SEC-12, PR #20 L-13)', () => {
  it('covers every Joi error code with a template that never interpolates the value', () => {
    expect(Object.keys(SAFE_MESSAGES)).toEqual(expect.arrayContaining(['string.pattern.base', 'any.only', 'object.unknown', 'number.max']));
    expect(Object.entries(SAFE_MESSAGES).filter(([, template]) => VALUE_REFERENCE.test(template))).toEqual([]);
  });

  it('a prepared schema renders no value even where Joi would (pattern, enum)', () => {
    const schema = prepareSchema(Joi.object({ a: Joi.string().pattern(/^x$/), b: Joi.string().valid('y') }));
    const result = schema.validate({ a: 'zzSentinelValue', b: 'zzOtherSentinel' }, { abortEarly: false });
    expect(result.error?.details.map((detail) => detail.message)).toEqual(['a failed string.pattern.base', 'b failed any.only']);
    expect(Joi.object({ a: Joi.string().pattern(/^x$/) }).validate({ a: 'zzSentinelValue' }).error?.message).toContain('zzSentinelValue');
  });

  it('VALUE_REFERENCE recognises every value interpolation form', () => {
    for (const template of ['{#value}', '{{#value}}', '{[.]}', '{:[.]}', '{{:#value}}']) expect(VALUE_REFERENCE.test(template)).toBe(true);
    expect(VALUE_REFERENCE.test('{{#label}} failed string.min')).toBe(false);
  });
});
