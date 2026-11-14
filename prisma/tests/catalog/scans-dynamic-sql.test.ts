/**
 * Unit tests for the dynamic-SQL review keying of the catalog suite (PR43-SEC-06 d; scans.ts): the reviewed list binds
 * the signature AND the SHA-256 of the normalised body.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { bodySha256, dynamicSqlFindings, normaliseBody, type ReviewedBody } from './scans.js';

describe('catalog scans: dynamic-SQL review keying (PR43-SEC-06 d)', () => {
  it('normaliseBody collapses every whitespace run (CR/LF, tabs) to one space and trims', () => {
    expect(normaliseBody('\r\n  BEGIN\r\n\tEXECUTE   p;\nEND \n')).toBe('BEGIN EXECUTE p; END');
    expect(bodySha256('BEGIN EXECUTE p; END')).toBe(createHash('sha256').update('BEGIN EXECUTE p; END', 'utf8').digest('hex'));
    expect(bodySha256(' BEGIN\n EXECUTE p; END')).toBe(bodySha256('BEGIN EXECUTE p; END'));
  });

  it('names an unreviewed signature and a reviewed signature whose body changed; a reviewed, unchanged body is clean', () => {
    const reviewed = new Map<string, ReviewedBody>([['public.f(text)', { sha256: bodySha256('BEGIN EXECUTE p; END'), reason: 'unit' }]]);
    expect(dynamicSqlFindings([{ fn: 'public.f(text)', body: '\nBEGIN  EXECUTE p;\nEND\n' }], reviewed)).toEqual([]);
    expect(dynamicSqlFindings([{ fn: 'public.g(text)', body: 'BEGIN EXECUTE p; END' }], reviewed)).toEqual([
      'public.g(text): not reviewed',
    ]);
    expect(dynamicSqlFindings([{ fn: 'public.f(text)', body: 'BEGIN EXECUTE p || q; END' }], reviewed)).toEqual([
      `public.f(text): body sha256 ${bodySha256('BEGIN EXECUTE p || q; END')} is not the reviewed ${bodySha256('BEGIN EXECUTE p; END')}`,
    ]);
  });
});
