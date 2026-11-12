import { describe, expect, it } from '@jest/globals';

import { DB_RETRY_AFTER_SECONDS, DbError, dbErrorMapping, isDatabaseError, mapDbError, toDbError } from './map-db-error.js';

/** A Prisma error as `@prisma/adapter-pg` surfaces it (spike F-06 shape): default kind keeps `code`, mapped kinds do not. */
function prismaError(
  prismaCode: string,
  originalCode: string,
  cause: Record<string, unknown> = {},
  message = `Invalid prisma call: ${originalCode}`,
): Error & Record<string, unknown> {
  const error = new Error(message) as Error & Record<string, unknown>;
  error.name = 'PrismaClientKnownRequestError';
  error['code'] = prismaCode;
  error['meta'] = { driverAdapterError: { name: 'DriverAdapterError', cause: { originalCode, ...cause } } };
  return error;
}

const RLS_MESSAGE = 'new row violates row-level security policy for table "shipments"';

describe('mapDbError (ADR-0005 am.10 item 6)', () => {
  it('ADR-0005 am.10 item 6: 42501 from an RLS WITH CHECK maps to 403 AUTHZ_DENIED with security event rls_write_rejected', () => {
    for (const prismaCode of ['P2010', 'P2039']) {
      const error = prismaError(prismaCode, '42501', { kind: 'postgres', code: '42501', originalMessage: RLS_MESSAGE });
      expect(mapDbError(error)).toEqual({
        status: 403,
        code: 'AUTHZ_DENIED',
        reason: 'RLS_WRITE_REJECTED',
        retryable: false,
        securityEvent: 'rls_write_rejected',
        sqlState: '42501',
        prismaCode,
      });
    }
    // the adapter's `message` is used when `originalMessage` is absent
    expect(mapDbError(prismaError('P2010', '42501', { message: RLS_MESSAGE })).status).toBe(403);
  });

  it('ADR-0005 am.10 item 6: any other 42501 (privilege) maps to 500 with security event db_privilege_denied', () => {
    const privilege = prismaError('P2010', '42501', { originalMessage: 'permission denied for table shipments' });
    expect(mapDbError(privilege)).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      reason: 'DB_PRIVILEGE_DENIED',
      securityEvent: 'db_privilege_denied',
    });
    expect(mapDbError(prismaError('P2010', '42501'))).toMatchObject({ status: 500, reason: 'DB_PRIVILEGE_DENIED' });
  });

  it.each([
    ['55P03', 'LOCK_TIMEOUT'],
    ['40001', 'SERIALIZATION_FAILURE'],
    ['40P01', 'DEADLOCK_DETECTED'],
    ['57014', 'STATEMENT_TIMEOUT'],
  ])('ADR-0005 am.10 item 6: SQLSTATE %s maps to a retryable 503 with Retry-After (%s), keyed on originalCode', (sqlState, reason) => {
    // mapped adapter kinds (TransactionWriteConflict) carry originalCode only, no cause.code (PR7-SEC-03)
    expect(mapDbError(prismaError('P2039', sqlState, { kind: 'TransactionWriteConflict' }))).toEqual({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      reason,
      retryable: true,
      retryAfterSeconds: DB_RETRY_AFTER_SECONDS,
      sqlState,
      prismaCode: 'P2039',
    });
  });

  it('ADR-0005 am.10 item 3: P2028 (maxWait exceeded / expired transaction) maps to a retryable 503, never 500', () => {
    const error = Object.assign(new Error('Transaction API error: Unable to start a transaction in the given time.'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2028',
      meta: { error: 'timeout' },
    });
    expect(mapDbError(error)).toEqual({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      reason: 'TRANSACTION_UNAVAILABLE',
      retryable: true,
      retryAfterSeconds: 1,
      prismaCode: 'P2028',
    });
    expect(mapDbError({ code: 'P2034' })).toMatchObject({ status: 503, reason: 'SERIALIZATION_FAILURE', retryable: true });
  });

  it('ADR-0005 am.10 item 6: anything else maps to a non-retryable 500', () => {
    const internal = { status: 500, code: 'INTERNAL_ERROR', reason: 'DB_ERROR', retryable: false };
    expect(mapDbError(prismaError('P2010', '23505'))).toEqual({ ...internal, sqlState: '23505', prismaCode: 'P2010' });
    expect(mapDbError(prismaError('P2010', 'not-a-state'))).toEqual({ ...internal, prismaCode: 'P2010' });
    expect(mapDbError({ code: 'P2002' })).toEqual({ ...internal, prismaCode: 'P2002' });
    expect(mapDbError({ code: 'ECONNRESET' })).toEqual(internal);
    for (const value of [new Error('boom'), 'text', 42, null, undefined]) expect(mapDbError(value)).toEqual(internal);
  });

  it('ADR-0005 am.10 item 6: the mapping never carries message, originalMessage, detail, hint or meta (table names and input values)', () => {
    const table = 'shipments_secret_table';
    const input = `input-${Math.random().toString(36).slice(2)}`;
    const text = `new row violates row-level security policy for table "${table}" value ${input}`;
    const cause = {
      kind: 'postgres',
      code: '42501',
      message: text,
      originalMessage: text,
      detail: `Key (ref)=(${input})`,
      hint: table,
      column: 'ref',
    };
    for (const prismaCode of ['P2010', 'P2039']) {
      for (const error of [
        prismaError(prismaCode, '42501', cause, `${table} ${input}`),
        prismaError(prismaCode, '23505', cause, `${table} ${input}`),
      ]) {
        const serialised = JSON.stringify(mapDbError(error));
        const thrown = toDbError(error);
        const rendered = `${JSON.stringify(thrown)} ${thrown.message} ${String(thrown.stack)} ${JSON.stringify(Object.entries(thrown))}`;
        for (const output of [serialised, rendered]) {
          expect(output).not.toContain(table);
          expect(output).not.toContain(input);
          for (const key of ['message', 'originalMessage', 'detail', 'hint', 'meta']) expect(output).not.toContain(`"${key}"`);
        }
        expect(thrown.cause).toBeUndefined();
      }
    }
  });
});

describe('DbError and helpers', () => {
  it('DbError carries the mapping, a reason-only message and round-trips through toJSON', () => {
    const mapping = mapDbError(prismaError('P2010', '55P03'));
    const error = new DbError(mapping);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DbError');
    expect(error.message).toBe('Database error: LOCK_TIMEOUT');
    expect(error.toJSON()).toEqual(mapping);
    expect(mapDbError(error)).toEqual(mapping);
    expect(toDbError(error)).toBe(error);
    expect(new DbError(dbErrorMapping(404, 'NOT_FOUND')).toJSON()).toEqual({
      status: 404,
      code: 'NOT_FOUND',
      reason: 'NOT_FOUND',
      retryable: false,
    });
  });

  it('isDatabaseError distinguishes Prisma/driver errors from application errors', () => {
    expect(isDatabaseError(prismaError('P2010', '42501'))).toBe(true);
    expect(isDatabaseError({ code: 'P2028' })).toBe(true);
    expect(isDatabaseError(Object.assign(new Error('x'), { name: 'PrismaClientUnknownRequestError' }))).toBe(true);
    expect(isDatabaseError(Object.assign(new Error('x'), { name: 'DriverAdapterError' }))).toBe(true);
    expect(isDatabaseError(new DbError(dbErrorMapping(409, 'CONFLICT')))).toBe(true);
    expect(isDatabaseError(new Error('domain'))).toBe(false);
    expect(isDatabaseError({ code: 'E_DOMAIN' })).toBe(false);
    expect(isDatabaseError(null)).toBe(false);
    expect(isDatabaseError('P2028')).toBe(false);
  });
});
