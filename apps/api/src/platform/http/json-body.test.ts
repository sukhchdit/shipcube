// Content-Type grammar for JSON bodies (PR9-SEC-01, PR9-SEC-14): accepted set, charset rule, linear-time evaluation
// and the length bound. The request-level behaviour (415 before reading) is in problem-handler.api.test.ts.
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { isUtf8JsonContentType, isWellFormedMediaType, MAX_CONTENT_TYPE_LENGTH } from './json-body.js';

/** Wall-clock budget for one evaluation; the round-2 grammar needed ~100 s for 77 bytes (R2-B1). */
const BUDGET_MS = 50;

function timed<T>(evaluate: () => T): { readonly result: T; readonly ms: number } {
  const start = performance.now();
  const result = evaluate();
  return { result, ms: performance.now() - start };
}

/**
 * The round-2 grammar, kept as the reference language (R2-B1: "must accept exactly the same set"). It is exponential
 * on adversarial input, so it is only ever evaluated on short strings here.
 */
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
const ROUND_2_MEDIA_TYPE = new RegExp(`^[ \\t]*${TOKEN}/${TOKEN}(?:[ \\t]*;[ \\t]*(?:${TOKEN}=(?:${TOKEN}|${QUOTED}))?)*[ \\t]*$`, 'u');

describe('[PR9-SEC-01] isUtf8JsonContentType', () => {
  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'application/json;charset=UTF-8',
    'application/json; charset="utf-8"',
    'application/json; charset="u\\tf-8"',
    'application/merge-patch+json; charset=utf-8',
    'application/json; foo=bar',
    'application/json; foo="a; charset=utf-7"',
    '  application/json ;  ; charset=utf-8 ;\t',
  ])('accepts %s', (header) => {
    expect(isUtf8JsonContentType(header)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'application/json; charset=utf-7',
    'application/json; CHARSET=UTF-16LE',
    'application/json; charset="utf-7"',
    'application/json; charset=utf-8; charset=utf-8',
    'application/json; charset',
    'application/json; charset=utf-8;;=x',
    'application/json; charset="utf-8',
    'application/json; charset = utf-8',
    'application/json, text/plain',
  ])('refuses %s', (header) => {
    expect(isUtf8JsonContentType(header)).toBe(false);
  });
});

describe('[PR9-SEC-14] the media-type grammar evaluates in linear time', () => {
  it.each([
    ['"; " empty parameters', `application/json${';  '.repeat(5_000)}!`],
    ['" ;" empty parameters', `application/json${' ;'.repeat(5_000)}!`],
    ['"; tab space tab" empty parameters', `application/json${';\t \t'.repeat(5_000)}!`],
    ['mixed separators and parameters', `application/json${'; \t;'.repeat(2_000)}; a=b; c="d;e"  ;;!`],
    ['an unterminated quoted value', `application/json; a="${'\\"'.repeat(5_000)}`],
  ])('rejects %s ×5000 + a failing character within the budget', (_label, header) => {
    const { result, ms } = timed(() => isWellFormedMediaType(header));
    expect(result).toBe(false);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('accepts a long well-formed parameter list within the budget', () => {
    const { result, ms } = timed(() => isWellFormedMediaType(`application/json${'; a=b'.repeat(2_000)}`));
    expect(result).toBe(true);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('any string over the adversarial alphabet up to 2000 characters evaluates within the budget (property)', () => {
    const header = fc.string({ unit: fc.constantFrom(' ', '\t', ';', 'a', '=', '"', '\\', '!', '/'), maxLength: 2_000 });
    fc.assert(
      fc.property(fc.constantFrom('application/json', 'a/b', ''), header, (prefix, rest) => {
        const { ms } = timed(() => isWellFormedMediaType(prefix + rest));
        return ms < BUDGET_MS;
      }),
      { numRuns: 300 },
    );
  });

  it('accepts exactly the same set as the round-2 grammar on short headers (differential)', () => {
    const piece = fc.constantFrom(';', ' ', '\t', 'charset', '=', 'utf-8', '"', '\\', 'a', '/', 'x"y', ',', '!');
    fc.assert(
      fc.property(
        fc.constantFrom('application/json', ' application/json', 'a/b', 'a'),
        fc.array(piece, { maxLength: 10 }),
        (base, parts) => {
          const header = base + parts.join('');
          return isWellFormedMediaType(header) === ROUND_2_MEDIA_TYPE.test(header);
        },
      ),
      { numRuns: 20_000 },
    );
  });
});

describe('[PR9-SEC-14] the length bound', () => {
  const header = (length: number): string => `application/json; a=${'b'.repeat(length - 'application/json; a='.length)}`;

  it(`accepts a well-formed header of exactly ${String(MAX_CONTENT_TYPE_LENGTH)} characters`, () => {
    expect(isUtf8JsonContentType(header(MAX_CONTENT_TYPE_LENGTH))).toBe(true);
  });

  it('refuses a longer one before any pattern runs', () => {
    expect(isWellFormedMediaType(header(MAX_CONTENT_TYPE_LENGTH + 1))).toBe(true);
    expect(isUtf8JsonContentType(header(MAX_CONTENT_TYPE_LENGTH + 1))).toBe(false);
  });

  it.each(['; ', ' ;', ';\t \t'])('refuses %j ×5000 + "!" at the bound within the budget', (separator) => {
    const { result, ms } = timed(() => isUtf8JsonContentType(`application/json${separator.repeat(5_000)}!`));
    expect(result).toBe(false);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
