import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { AppError, isAppError, MAX_VALIDATION_ISSUES } from './app-error.js';
import { CATALOGUE_MODULES, ERROR_CATALOGUE, isErrorCode, mergeCatalogues } from './catalogue/index.js';

const CATALOGUE_DIR = ['packages', 'shared', 'src', 'errors', 'catalogue'];

/** The catalogue folder, found from the Jest working directory (the repository root or below it). */
function catalogueDir(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, ...CATALOGUE_DIR);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('catalogue folder not found above the working directory');
    dir = parent;
  }
}

describe('error catalogue discovery (PLAN.md §5 rule 2, ADR-0016 §3)', () => {
  it('aggregates every catalogue/<module>.ts file, and nothing else', () => {
    const files = readdirSync(catalogueDir())
      .filter((name) => name.endsWith('.ts') && name !== 'index.ts' && !name.endsWith('.test.ts'))
      .map((name) => name.slice(0, -'.ts'.length))
      .sort();
    expect(Object.keys(CATALOGUE_MODULES).sort()).toEqual(files);
  });

  it('declares SCREAMING_SNAKE codes (openapi Problem.code pattern) with a 4xx/5xx status and a title', () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOGUE)) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThanOrEqual(599);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });

  it('declares each code in exactly one module', () => {
    const codes = Object.values(CATALOGUE_MODULES).flatMap((entries) => Object.keys(entries));
    expect(new Set(codes).size).toBe(codes.length);
    expect(Object.keys(ERROR_CATALOGUE)).toHaveLength(codes.length);
  });

  it('refuses a code declared by two modules at load time', () => {
    const entry = { status: 404, title: 'Not found' } as const;
    expect(() => mergeCatalogues({ a: { DUP_CODE: entry }, b: { DUP_CODE: entry } })).toThrow(
      'Error code DUP_CODE is declared by both a and b',
    );
  });

  it('carries the framework codes US-007 names', () => {
    for (const code of [
      'NOT_FOUND',
      'METHOD_NOT_ALLOWED',
      'MALFORMED_REQUEST',
      'PAYLOAD_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'INTERNAL_ERROR',
      'AUTH_REQUIRED',
      'VALIDATION_ERROR',
    ]) {
      expect(isErrorCode(code)).toBe(true);
    }
    expect(isErrorCode('NOT_A_CODE')).toBe(false);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });

  it('carries the data-layer codes a DbError answers with, at the openapi Forbidden/Conflict status and title (PR11-SEC-09)', () => {
    expect(ERROR_CATALOGUE.AUTHZ_DENIED).toEqual({ status: 403, title: 'Permission denied' });
    expect(ERROR_CATALOGUE.CONFLICT).toEqual({ status: 409, title: 'Conflict' });
    for (const code of ['NOT_FOUND', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR']) expect(isErrorCode(code)).toBe(true);
  });
});

describe('AppError', () => {
  it('takes its status and default detail from the catalogue', () => {
    const error = new AppError('NOT_FOUND');
    expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404, title: 'Not found', detail: 'Not found.' });
    expect(error.message).toBe('NOT_FOUND');
    expect(isAppError(error)).toBe(true);
    expect(isAppError(new Error('NOT_FOUND'))).toBe(false);
  });

  it('keeps the cause for the log but never serialises it', () => {
    const cause = new Error('SELECT * FROM users WHERE token = secret-token-123');
    const error = new AppError('INTERNAL_ERROR', { cause, detail: 'custom' });
    expect(error.cause).toBe(cause);
    expect(Object.keys(error)).not.toContain('cause');
    const json = JSON.stringify(error);
    expect(json).not.toContain('secret-token-123');
    expect(JSON.parse(json)).toEqual({ code: 'INTERNAL_ERROR', status: 500, detail: 'custom' });
  });

  it('carries retryAfterSeconds as an own property only when given, and never serialises it', () => {
    const retryable = new AppError('SERVICE_UNAVAILABLE', { retryAfterSeconds: 1 });
    expect(retryable.retryAfterSeconds).toBe(1);
    expect(JSON.parse(JSON.stringify(retryable))).toEqual({ code: 'SERVICE_UNAVAILABLE', status: 503, detail: 'Service unavailable.' });
    expect(Object.hasOwn(new AppError('SERVICE_UNAVAILABLE'), 'retryAfterSeconds')).toBe(false);
  });

  it('carries at most MAX_VALIDATION_ISSUES field issues', () => {
    const issues = Array.from({ length: MAX_VALIDATION_ISSUES + 5 }, (_, index) => ({
      pointer: `/body/items/${String(index)}`,
      code: 'REQUIRED',
      message: 'Required.',
    }));
    const error = new AppError('VALIDATION_ERROR', { errors: issues });
    expect(error.errors).toHaveLength(MAX_VALIDATION_ISSUES);
    expect(error.toJSON().errors).toHaveLength(MAX_VALIDATION_ISSUES);
  });
});

/**
 * DR-A26 (REQUIREMENTS.md): the core catalogue with its statuses, copied here verbatim so a change of a published
 * status, or the loss of a core code, fails this suite (AT-US-036-05). Never edit an entry: add new codes only.
 */
const DR_A26: Readonly<Record<string, number>> = {
  VALIDATION_ERROR: 400,
  MALFORMED_REQUEST: 400,
  INVALID_CURSOR: 400,
  INVALID_FILTER: 400,
  INVALID_SORT: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  TOKEN_INVALID: 400,
  AUTH_REQUIRED: 401,
  ACCESS_TOKEN_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  MFA_REQUIRED: 401,
  MFA_INVALID: 401,
  SESSION_REVOKED: 401,
  REAUTH_REQUIRED: 401,
  AUTHZ_DENIED: 403,
  MFA_ENROLMENT_REQUIRED: 403,
  CSRF_REJECTED: 403,
  INVITATION_EMAIL_MISMATCH: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  ALREADY_MEMBER: 409,
  QUOTE_ALREADY_CLAIMED: 409,
  TOKEN_EXPIRED: 410,
  DOWNLOAD_EXPIRED: 410,
  CONCURRENCY_CONFLICT: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  IDEMPOTENCY_KEY_REUSED: 422,
  LAST_OWNER: 422,
  LIMIT_EXCEEDED: 422,
  REASON_REQUIRED: 422,
  ROLE_NOT_ALLOWED_FOR_ORG_TYPE: 422,
  ORG_TYPE_RESTRICTION: 422,
  COUNTRY_NOT_SUPPORTED: 422,
  PRECONDITION_REQUIRED: 428,
  RATE_LIMITED: 429,
  ACCOUNT_DELAYED: 429,
  ACCOUNT_LOCKED: 429,
  MFA_LOCKED: 429,
  INTERNAL_ERROR: 500,
  AUDIT_WRITE_FAILED: 500,
  SERVICE_UNAVAILABLE: 503,
  AUDIT_UNAVAILABLE: 503,
};

/**
 * Every code published by this catalogue, with its status (DR-A26 plus the api/README.md §11 Part B codes). A code may
 * be ADDED here together with its catalogue entry; changing or removing a line is a breaking change (REQ-API-005,
 * api/README.md §18), so the test below fails on it.
 */
const PUBLISHED: Readonly<Record<string, number>> = {
  ...DR_A26,
  CARD_DATA_NOT_ACCEPTED: 400,
  MOCK_SCENARIO_INVALID: 400,
  PAYMENT_METHOD_NOT_AVAILABLE: 400,
  WEBHOOK_SIGNATURE_INVALID: 400,
  SESSION_EXPIRED: 401,
  EMAIL_NOT_VERIFIED: 403,
  MFA_ENROLMENT_CODE_REQUIRED: 403,
  TRACKING_NOT_FOUND: 404,
  ACCOUNT_HAS_ACTIVE_SHIPMENTS: 409,
  AMOUNT_MISMATCH: 409,
  ILLEGAL_STATE_TRANSITION: 409,
  PICKUP_ALREADY_SCHEDULED: 409,
  QUOTE_EXPIRED: 409,
  SHIPMENT_NOT_CANCELLABLE: 409,
  DOCUMENT_VOIDED: 410,
  ADDRESS_COUNTRY_MISMATCH: 422,
  AMOUNT_BELOW_MINIMUM: 422,
  COMMODITY_CODE_FORMAT: 422,
  COUPON_EXHAUSTED: 422,
  COUPON_EXPIRED: 422,
  COUPON_INVALID: 422,
  COVER_VALUE_EXCEEDS_MAXIMUM: 422,
  CUSTOMS_CURRENCY_MIXED: 422,
  CUSTOMS_WEIGHT_EXCEEDS_PACKAGE: 422,
  DG_ATTESTATION_REQUIRED: 422,
  FX_RATE_UNAVAILABLE: 422,
  ITEM_PROHIBITED: 422,
  ORDER_CURRENCY_MISMATCH: 422,
  ORG_TYPE_NOT_ALLOWED: 422,
  PICKUP_DATE_INVALID: 422,
  PICKUP_WINDOW_INVALID: 422,
  PAYMENT_ATTEMPTS_EXCEEDED: 429,
  DOCUMENT_INTEGRITY_FAILURE: 500,
  GATEWAY_UNAVAILABLE: 503,
};

/** The published codes whose status differs from the catalogue, or that the catalogue lost; [] when stable. */
function publishedDrift(
  published: Readonly<Record<string, number>>,
  catalogue: Readonly<Record<string, { readonly status: number }>>,
): string[] {
  return Object.entries(published).flatMap(([code, status]) => {
    const entry = catalogue[code];
    if (entry === undefined) return [`${code} was published with ${String(status)} and is missing from the catalogue`];
    return entry.status === status ? [] : [`${code} was published with ${String(status)} and is now ${String(entry.status)}`];
  });
}

describe('catalogue completeness and stability (US-036, DR-A26, REQ-API-005)', () => {
  it('[AT-US-036-05] every DR-A26 code is present with its DR-A26 status', () => {
    expect(publishedDrift(DR_A26, ERROR_CATALOGUE)).toEqual([]);
    expect(Object.keys(DR_A26)).toHaveLength(45);
  });

  it('[AT-US-036-05] every published code keeps its status; the catalogue publishes nothing unpinned', () => {
    expect(publishedDrift(PUBLISHED, ERROR_CATALOGUE)).toEqual([]);
    expect(Object.keys(ERROR_CATALOGUE).sort()).toEqual(Object.keys(PUBLISHED).sort());
  });

  it("[AT-US-036-05] a test fails when a published code's status changes, naming the code and both statuses", () => {
    const changed = { ...ERROR_CATALOGUE, CONFLICT: { status: 422, title: 'Conflict' } };
    expect(publishedDrift(PUBLISHED, changed)).toEqual(['CONFLICT was published with 409 and is now 422']);
    const lost = Object.fromEntries(Object.entries(ERROR_CATALOGUE).filter(([code]) => code !== 'LAST_OWNER'));
    expect(publishedDrift(DR_A26, lost)).toEqual(['LAST_OWNER was published with 422 and is missing from the catalogue']);
  });
});
