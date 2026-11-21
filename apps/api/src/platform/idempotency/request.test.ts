// The idempotent request (TASK-040; api/README §5 "Header" and "Fingerprint"; AT-US-038-03, AT-US-038-04).
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';
import type { Response } from 'express';

import type { RouteInput } from '../routing/define-route.js';
import {
  concretePathOf,
  fingerprintOf,
  idempotencyRequestOf,
  isIdempotentMethod,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  parseIdempotencyKey,
  pathOf,
  setIdempotencyRequest,
} from './request.js';

const issueOf = (raw: string): unknown => {
  try {
    parseIdempotencyKey(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return { code: (error as AppError).code, errors: (error as AppError).errors };
  }
  return undefined;
};

const input = (body: unknown, query: Record<string, unknown> = {}): RouteInput => ({
  params: {},
  query,
  body: body as RouteInput['body'],
  headers: {},
});

describe('Idempotency-Key header (api/README §5)', () => {
  it('accepts 1 to 255 printable ASCII characters (a UUIDv4, the shortest and the longest key)', () => {
    const uuid = randomUUID();
    expect(parseIdempotencyKey(uuid)).toBe(uuid);
    expect(parseIdempotencyKey('!')).toBe('!');
    expect(parseIdempotencyKey('~'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH))).toHaveLength(255);
    expect(parseIdempotencyKey(undefined)).toBeUndefined();
  });

  it('[AT-US-038-03] a key of 256 characters is 400 VALIDATION_ERROR TOO_LONG at /headers/idempotency-key', () => {
    expect(issueOf('k'.repeat(256))).toEqual({
      code: 'VALIDATION_ERROR',
      errors: [{ pointer: '/headers/idempotency-key', code: 'TOO_LONG', message: 'Field is too long.' }],
    });
  });

  it('[AT-US-038-03] a control character, a space, a non-ASCII character or a repeated header is INVALID_FORMAT', () => {
    for (const raw of ['abc\tdef', 'abc\u0001', 'two words', 'clé', 'k1, k2']) {
      expect([raw, (issueOf(raw) as { errors: { code: string }[] }).errors[0]?.code]).toEqual([raw, 'INVALID_FORMAT']);
    }
  });

  it('[AT-US-038-03] an empty key is TOO_SHORT', () => {
    expect((issueOf('') as { errors: { code: string }[] }).errors[0]?.code).toBe('TOO_SHORT');
  });

  it('protects the unsafe methods only', () => {
    expect(['POST', 'PUT', 'PATCH', 'DELETE'].every(isIdempotentMethod)).toBe(true);
    expect(['GET', 'HEAD', 'OPTIONS', 'post'].some(isIdempotentMethod)).toBe(false);
  });
});

describe('request fingerprint (SHA-256 of the JCS canonical request)', () => {
  it('is 32 bytes and ignores the member order of the body and the query (canonical)', () => {
    const a = fingerprintOf('POST', '/api/v1/orders', input({ b: 1, a: { y: 2, x: 1 } }, { z: '1', a: '2' }));
    const b = fingerprintOf('POST', '/api/v1/orders', input({ a: { x: 1, y: 2 }, b: 1 }, { a: '2', z: '1' }));
    expect(a).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('[AT-US-038-04] changes with the body, the query, the path or the method', () => {
    const base = Buffer.from(fingerprintOf('POST', '/api/v1/orders', input({ qty: 1 })));
    for (const other of [
      fingerprintOf('POST', '/api/v1/orders', input({ qty: 2 })),
      fingerprintOf('POST', '/api/v1/orders', input({ qty: 1 }, { dry: 'true' })),
      fingerprintOf('POST', '/api/v1/orders/x', input({ qty: 1 })),
      fingerprintOf('PUT', '/api/v1/orders', input({ qty: 1 })),
    ]) {
      expect(base.equals(Buffer.from(other))).toBe(false);
    }
  });

  it('treats an absent body as null and a converted Date as its ISO text', () => {
    const absent = fingerprintOf('DELETE', '/x', input(undefined));
    expect(Buffer.from(absent).equals(Buffer.from(fingerprintOf('DELETE', '/x', input(null))))).toBe(true);
    const date = fingerprintOf('POST', '/x', input({ at: new Date('2026-11-20T00:00:00.000Z') }));
    expect(Buffer.from(date).equals(Buffer.from(fingerprintOf('POST', '/x', input({ at: '2026-11-20T00:00:00.000Z' }))))).toBe(true);
  });
});

describe('request state', () => {
  it('[n3] concretePathOf fills the route template with the validated, percent-encoded parameters', () => {
    expect(concretePathOf('/api/v1/orders/:orderId/items/:n', { orderId: 'a b/c', n: 3 })).toBe('/api/v1/orders/a%20b%2Fc/items/3');
    expect(concretePathOf('/api/v1/x/:flag/:obj/:missing', { flag: true, obj: { k: 1 } })).toBe('/api/v1/x/true/%7B%22k%22%3A1%7D/%22%22');
    expect(concretePathOf('/api/v1/orders', {})).toBe('/api/v1/orders');
  });

  it('pathOf drops the query and a fragment', () => {
    expect(pathOf('/api/v1/orders?dry=1#x')).toBe('/api/v1/orders');
    expect(pathOf('/api/v1/orders')).toBe('/api/v1/orders');
  });

  it('reads back only a request the slot recorded (a forged local is ignored)', () => {
    const res = { locals: {} } as unknown as Response;
    expect(idempotencyRequestOf(res)).toBeUndefined();
    const request = { key: 'k', method: 'POST' as const, path: '/p', fingerprint: new Uint8Array(32) };
    setIdempotencyRequest(res, request);
    expect(idempotencyRequestOf(res)).toEqual(request);
    expect(Object.isFrozen(idempotencyRequestOf(res))).toBe(true);
    (res.locals as Record<string, unknown>)['routeIdempotency'] = { ...request };
    expect(idempotencyRequestOf(res)).toBeUndefined();
  });
});
