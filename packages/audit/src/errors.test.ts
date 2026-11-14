import { describe, expect, it } from '@jest/globals';

import { AUDIT_RETRY_AFTER_SECONDS, auditErrorCause, AuditWriteError, isAuditWriteError, toAuditWriteError } from './errors.js';
import { driverError } from './tests/fake-sql.js';

describe('[US-088] audit write error model (ADR-0007 am. 10 item 2; data-model §5.4 "Error model")', () => {
  it('a lock timeout is 503 AUDIT_LOCK_TIMEOUT, retryable with Retry-After 1', () => {
    const error = new AuditWriteError('LOCK_TIMEOUT', { sqlState: '55P03' });
    expect(error).toMatchObject({ reason: 'AUDIT_LOCK_TIMEOUT', kind: 'LOCK_TIMEOUT', status: 503, retryable: true, sqlState: '55P03' });
    expect(error.retryAfterSeconds).toBe(AUDIT_RETRY_AFTER_SECONDS);
    expect(AUDIT_RETRY_AFTER_SECONDS).toBe(1);
  });

  it.each([
    'INVALID_ENTRY',
    'TOKENISER_UNAVAILABLE',
    'TOKENISER_FAILED',
    'HEAD_MOVED',
    'HEAD_MISSING',
    'PARTITION_MISSING',
    'DATABASE_ERROR',
  ] as const)('%s is 500 AUDIT_WRITE_FAILED, not retryable', (kind) => {
    const error = new AuditWriteError(kind);
    expect(error).toMatchObject({ reason: 'AUDIT_WRITE_FAILED', kind, status: 500, retryable: false });
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('carries no server text: the message and the JSON view name the reason and kind only; the cause stays outside', () => {
    const original = driverError('23514', 'no partition of relation "audit_entries" found for row DETAIL secret-value');
    const error = toAuditWriteError(original);
    expect(error.kind).toBe('PARTITION_MISSING');
    expect(error.message).toBe('Audit write failed: AUDIT_WRITE_FAILED (PARTITION_MISSING)');
    expect(JSON.stringify(error)).not.toContain('secret-value');
    expect(JSON.stringify(error)).not.toContain('no partition');
    expect(error.toJSON()).toEqual({
      name: 'AuditWriteError',
      reason: 'AUDIT_WRITE_FAILED',
      kind: 'PARTITION_MISSING',
      status: 500,
      retryable: false,
      sqlState: '23514',
    });
    expect(Object.keys(error)).not.toContain('cause');
    expect(auditErrorCause(error)).toBe(original);
  });

  it('the JSON view of a refusal names the field and of a lock timeout the Retry-After', () => {
    expect(new AuditWriteError('INVALID_ENTRY', { field: 'origin.ip' }).toJSON()).toMatchObject({ field: 'origin.ip' });
    expect(new AuditWriteError('LOCK_TIMEOUT').toJSON()).toMatchObject({ retryAfterSeconds: 1 });
  });

  it('classifies database failures by SQLSTATE (driver-adapter and plain pg shapes)', () => {
    expect(toAuditWriteError(driverError('55P03')).kind).toBe('LOCK_TIMEOUT');
    expect(toAuditWriteError(Object.assign(new Error('x'), { code: '55P03' })).kind).toBe('LOCK_TIMEOUT');
    // A plain object with a SQLSTATE and no message (no partition prefix to read).
    expect(toAuditWriteError({ code: '23514' }).kind).toBe('DATABASE_ERROR');
    expect(toAuditWriteError(driverError('23514', 'new row violates check constraint')).kind).toBe('DATABASE_ERROR');
    expect(toAuditWriteError(driverError('40P01')).kind).toBe('DATABASE_ERROR');
    expect(toAuditWriteError(Object.assign(new Error('x'), { code: '23514', message: 'no partition of relation "x"' })).kind).toBe(
      'PARTITION_MISSING',
    );
    expect(toAuditWriteError({ meta: { driverAdapterError: { cause: { originalCode: '23514' } } } }).kind).toBe('DATABASE_ERROR');
  });

  it('a failure without a SQLSTATE takes the fallback kind; an AuditWriteError passes through', () => {
    expect(toAuditWriteError(new Error('boom')).kind).toBe('DATABASE_ERROR');
    expect(toAuditWriteError('boom', 'TOKENISER_FAILED').kind).toBe('TOKENISER_FAILED');
    expect(toAuditWriteError(Object.assign(new Error('x'), { code: 'P2028' })).kind).toBe('DATABASE_ERROR');
    const existing = new AuditWriteError('HEAD_MOVED');
    expect(toAuditWriteError(existing)).toBe(existing);
    expect(isAuditWriteError(existing)).toBe(true);
    expect(isAuditWriteError(new Error('x'))).toBe(false);
    expect(auditErrorCause(existing)).toBeUndefined();
  });
});
