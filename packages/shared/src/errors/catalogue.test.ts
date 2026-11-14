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
