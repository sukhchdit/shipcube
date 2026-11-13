import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { errorName, isDatabaseError, serializeDatabaseError } from './prisma-error.js';
import { serializeThrown } from './error.js';

const sentinel = (): string => `sentinel-${randomBytes(8).toString('hex')}`;

/** Shape of Prisma 7's known request error (built here; the real class is not imported by shared code). */
class PrismaClientKnownRequestError extends Error {
  override readonly name = 'PrismaClientKnownRequestError';
  constructor(
    message: string,
    readonly code: string,
    readonly clientVersion: string,
    readonly meta: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** pg-protocol's DatabaseError: `name` is the protocol message type (`error`), plus severity/routine/where/file. */
class DatabaseError extends Error {
  override readonly name = 'error';
  readonly severity = 'ERROR';
  readonly routine = 'parserOpenTable';
  constructor(
    message: string,
    readonly code: string,
    readonly where: string,
    readonly file: string,
  ) {
    super(message);
  }
}

describe('database error serializer', () => {
  it('[PR7-SEC-03 item 3] a P2039 whose message carries a table name and an input value logs neither', () => {
    const value = sentinel();
    const error = new PrismaClientKnownRequestError(
      `Database error. Code: 42501. Message: new row violates row-level security policy for table "users" (${value})`,
      'P2039',
      '7.10.1',
      {
        modelName: 'users',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            kind: 'postgres',
            originalCode: '42501',
            originalMessage: `new row violates row-level security policy for table "users" (${value})`,
            detail: `Failing row contains (${value})`,
            hint: `check ${value}`,
          },
        },
      },
    );
    const serialized = serializeThrown(error);
    expect(serialized).toEqual({ name: 'PrismaClientKnownRequestError', code: 'P2039', originalCode: '42501', kind: 'postgres' });
    const line = JSON.stringify(serialized);
    expect(line).not.toContain(value);
    expect(line).not.toContain('users');
  });

  it('a raw-query P2010 keeps the driver code, never the query', () => {
    const value = sentinel();
    const error = new PrismaClientKnownRequestError(`Raw query failed. SELECT * FROM x WHERE v = '${value}'`, 'P2010', '7.10.1', {
      driverAdapterError: { name: 'DriverAdapterError', cause: { kind: 'postgres', code: '42P01', message: value } },
    });
    expect(serializeThrown(error)).toEqual({
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      originalCode: '42P01',
      kind: 'postgres',
    });
  });

  it('a pg DatabaseError keeps its SQLSTATE, never where or file', () => {
    const value = sentinel();
    const error = new DatabaseError(`relation "${value}" does not exist`, '42P01', `SQL statement "SELECT ${value}"`, '/src/parse.c');
    expect(isDatabaseError(error)).toBe(true);
    const serialized = serializeThrown(error);
    expect(serialized).toEqual({ name: 'DatabaseError', code: '42P01' });
    expect(JSON.stringify(serialized)).not.toContain(value);
  });

  it.each([
    ['clientVersion', { clientVersion: '7' }],
    ['meta', { meta: {} }],
    ['originalCode', { originalCode: '23505' }],
    ['originalMessage', { originalMessage: 'm' }],
    ['sqlState', { sqlState: '23505' }],
    ['severity + routine', { severity: 'ERROR', routine: 'r' }],
  ])('detects a driver error by its %s property', (_label, properties) => {
    expect(isDatabaseError(Object.assign(new Error('m'), properties))).toBe(true);
  });

  it.each(['PrismaClientValidationError', 'PrismaClientInitializationError', 'DriverAdapterError', 'DbError'])(
    'detects %s by name',
    (name) => {
      const error = Object.assign(new Error('m'), { name });
      expect(isDatabaseError(error)).toBe(true);
      expect(serializeThrown(error)).toEqual({ name });
    },
  );

  it('does not treat ordinary errors as database errors', () => {
    expect(isDatabaseError(new TypeError('x'))).toBe(false);
    expect(isDatabaseError(Object.assign(new Error('x'), { severity: 'high' }))).toBe(false);
  });

  it('drops codes, kinds and names that are not identifiers', () => {
    const error = Object.assign(new Error('m'), {
      name: 'Bad name; DROP',
      code: 'not a code',
      sqlState: '23505',
      cause: { originalCode: 'nope', kind: 'has space' },
    });
    expect(serializeDatabaseError(error)).toEqual({ name: 'Error', code: '23505' });
  });

  it('takes originalCode and kind from a driver cause', () => {
    const error = Object.assign(new Error('m'), { name: 'DriverAdapterError', cause: { originalCode: '40001', kind: 'postgres' } });
    expect(serializeDatabaseError(error)).toEqual({ name: 'DriverAdapterError', originalCode: '40001', kind: 'postgres' });
  });

  it('names errors from the constructor when the own name is not a class name', () => {
    class CustomFailure extends Error {}
    expect(errorName(new CustomFailure('x'))).toBe('CustomFailure');
    expect(errorName({})).toBe('Error');
    expect(errorName(Object.create(null))).toBe('Error');
  });
});
