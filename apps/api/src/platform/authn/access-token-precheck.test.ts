/**
 * The `exp` pre-check of a bearer access token (ADR-0016 amendment 13 item 3, conditions E1 to E3; D-SECPR041-02;
 * TASK-041 part 041-B for TASK-052): bounded structure first, `alg` ES256 before the payload is decoded, and only a
 * finite past `exp` is expired. Tokens are built at run time; no token literal is committed.
 */
import { describe, expect, it } from '@jest/globals';

import { ACCESS_TOKEN_MAX_LENGTH, MAX_NUMERIC_DATE, precheckAccessToken } from './access-token-precheck.js';

const NOW = 1_800_000_000;
const TOLERANCE = 30;
const segment = (value: unknown): string => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const SIGNATURE = Buffer.alloc(64, 7).toString('base64url');
const token = (claims: unknown, header: unknown = { alg: 'ES256', typ: 'JWT' }): string =>
  `${segment(header)}.${segment(claims)}.${SIGNATURE}`;
const check = (value: string): string => precheckAccessToken(value, NOW, TOLERANCE);

describe('[E2] only a well-formed token with a finite past exp is expired', () => {
  it.each<[string, unknown, string]>([
    ['exp an hour ago', { exp: NOW - 3_600, sub: 'u' }, 'expired'],
    ['exp exactly now minus the tolerance', { exp: NOW - TOLERANCE }, 'expired'],
    ['exp inside the tolerance', { exp: NOW - TOLERANCE + 1 }, 'verify'],
    ['exp in the future', { exp: NOW + 600 }, 'verify'],
    ['a fractional NumericDate in the past', { exp: NOW - 100.5 }, 'expired'],
    ['exp 0', { exp: 0 }, 'expired'],
    ['no exp', { sub: 'u' }, 'malformed'],
    ['a string exp', { exp: String(NOW - 3_600) }, 'malformed'],
    ['a null exp', { exp: null }, 'malformed'],
    ['a negative exp', { exp: -1 }, 'malformed'],
    ['an exp past 9999-12-31', { exp: MAX_NUMERIC_DATE + 1 }, 'malformed'],
    ['an exp of 1e300', { exp: 1e300 }, 'malformed'],
    ['a payload that is an array', [NOW - 3_600], 'malformed'],
    ['a payload that is a number', NOW - 3_600, 'malformed'],
    ['a payload that is not JSON', 'exp=1', 'malformed'],
  ])('%s -> %s', (_label, claims, verdict) => {
    expect(check(token(claims))).toBe(verdict);
  });
});

describe('[E3] the pre-check is bounded before the payload is decoded', () => {
  const past = { exp: NOW - 3_600 };

  it.each<[string, unknown]>([
    ['alg none', { alg: 'none' }],
    ['alg HS256', { alg: 'HS256' }],
    ['alg es256 (case)', { alg: 'es256' }],
    ['no alg', { typ: 'JWT' }],
    ['a header that is not an object', 'ES256'],
  ])('a past exp under %s is malformed, never expired', (_label, header) => {
    expect(check(token(past, header))).toBe('malformed');
  });

  it.each<[string, string]>([
    ['empty', ''],
    ['two segments', `${segment({ alg: 'ES256' })}.${segment(past)}`],
    ['four segments', `${token(past)}.x`],
    ['an empty signature', `${segment({ alg: 'ES256' })}.${segment(past)}.`],
    ['padding characters', `${token(past)}==`],
    ['a standard base64 character', `${segment({ alg: 'ES256' })}.${segment(past)}.ab+c`],
    ['whitespace', ` ${token(past)}`],
  ])('%s is malformed', (_label, value) => {
    expect(check(value)).toBe('malformed');
  });

  it('a token above the length cap is malformed, one at the cap is read', () => {
    const base = token(past);
    const padded = (length: number): string => `${base}${'A'.repeat(length - base.length)}`;
    expect(check(padded(ACCESS_TOKEN_MAX_LENGTH))).toBe('expired');
    expect(check(padded(ACCESS_TOKEN_MAX_LENGTH + 1))).toBe('malformed');
  });
});
