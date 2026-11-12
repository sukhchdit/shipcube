import { randomBytes } from 'node:crypto';
import vm from 'node:vm';

import { describe, expect, it } from '@jest/globals';

import { REDACTED } from '../string-redaction.js';
import { isErrorLike, MAX_CAUSE_DEPTH, MAX_STACK_FRAMES, serializeThrown } from './error.js';

const sentinel = (): string => `sentinel-${randomBytes(8).toString('hex')}`;

describe('serializeThrown', () => {
  it('[AT-US-007-03] the full error is logged with its message and stack, secrets redacted', () => {
    const error = new Error('relation "x" failed for secret-token-123');
    const serialized = serializeThrown(error);
    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe(`relation "x" failed for ${REDACTED}`);
    expect(serialized.stack).toContain(`Error: relation "x" failed for ${REDACTED}`);
    expect(serialized.stack).toMatch(/\n\s+at /);
    expect(JSON.stringify(serialized)).not.toContain('secret-token-123');
  });

  it('keeps a short code and masks e-mail addresses in the message', () => {
    const error = Object.assign(new TypeError('no user alice@example.com'), { code: 'ERR_INVALID_ARG' });
    expect(serializeThrown(error)).toMatchObject({ name: 'TypeError', message: 'no user a***@example.com', code: 'ERR_INVALID_ARG' });
  });

  it('drops a code that is not a short identifier', () => {
    const value = sentinel();
    const error = Object.assign(new Error('m'), { code: `has spaces ${value}` });
    expect(serializeThrown(error)).not.toHaveProperty('code');
  });

  it('serialises causes recursively up to MAX_CAUSE_DEPTH, a database cause with the database shape', () => {
    const value = sentinel();
    const database = Object.assign(new Error(`row (${value})`), { name: 'DriverAdapterError', code: '23505' });
    let error: Error = new Error('level 0', { cause: database });
    expect(serializeThrown(error).cause).toEqual({ name: 'DriverAdapterError', code: '23505' });
    for (let level = 1; level <= MAX_CAUSE_DEPTH + 2; level += 1) error = new Error(`level ${String(level)}`, { cause: error });
    let cursor = serializeThrown(error);
    let depth = 0;
    while (cursor.cause !== undefined) {
      cursor = cursor.cause;
      depth += 1;
    }
    expect(depth).toBe(MAX_CAUSE_DEPTH);
    expect(JSON.stringify(serializeThrown(new Error('top', { cause: database })))).not.toContain(value);
  });

  it('caps the stack at MAX_STACK_FRAMES frames', () => {
    const frames = Array.from({ length: MAX_STACK_FRAMES + 7 }, (_, index) => `    at f${String(index)} (file.js:1:1)`);
    const error = { message: 'deep', stack: ['Error: deep', ...frames].join('\n') };
    const stack = serializeThrown(error).stack ?? '';
    expect(stack.split('\n').filter((line) => line.startsWith('    at '))).toHaveLength(MAX_STACK_FRAMES);
    expect(stack).toContain('... 7 more frames');
  });

  it('serialises errors from another realm', () => {
    const foreign: unknown = vm.runInNewContext('new RangeError("out of range for secret-token-9")');
    const serialized = serializeThrown(foreign);
    expect(serialized.name).toBe('RangeError');
    expect(serialized.message).toBe(`out of range for ${REDACTED}`);
    expect(serialized.stack).toContain('RangeError');
  });

  it('never invokes a user-defined stack getter', () => {
    let calls = 0;
    const error = new Error('m');
    Object.defineProperty(error, 'stack', {
      get: () => {
        calls += 1;
        return 'x';
      },
    });
    expect(serializeThrown(error)).toEqual({ name: 'Error', message: 'm' });
    expect(calls).toBe(0);
  });

  it('survives hostile proxies and throwing getters', () => {
    const trap = (): never => {
      throw new Error('trap');
    };
    const hostile = new Proxy(new Error('x'), { getOwnPropertyDescriptor: trap, getPrototypeOf: trap });
    expect(() => serializeThrown(hostile)).not.toThrow();
    expect(serializeThrown(hostile)).toEqual({ name: 'object', value: '[object unknown]' });
    const getter = Object.defineProperty(new Error('m'), 'message', { get: trap });
    expect(serializeThrown(getter)).not.toHaveProperty('message');
  });

  it.each([
    ['secret-token-123', { name: 'string', value: REDACTED }],
    [42, { name: 'number', value: '42' }],
    [undefined, { name: 'undefined', value: 'undefined' }],
    [null, { name: 'null', value: 'null' }],
    [10n, { name: 'bigint', value: '10' }],
  ])('serialises the non-error %p', (thrown, expected) => {
    expect(serializeThrown(thrown)).toEqual(expected);
  });

  it('serialises non-error objects by type and class only', () => {
    const value = sentinel();
    expect(serializeThrown({ detail: value })).toEqual({ name: 'object', value: '[object Object]' });
    expect(serializeThrown(Object.create(null))).toEqual({ name: 'object', value: '[object unknown]' });
    expect(serializeThrown(() => value)).toEqual({ name: 'function', value: '[function Function]' });
    expect(serializeThrown(Symbol('s'))).toEqual({ name: 'symbol', value: 'Symbol(s)' });
  });

  it('recognises error-like values', () => {
    expect(isErrorLike(new Error('x'))).toBe(true);
    expect(isErrorLike({ message: 'x' })).toBe(true);
    expect(isErrorLike({ status: 1 })).toBe(false);
    expect(isErrorLike('x')).toBe(false);
  });
});
