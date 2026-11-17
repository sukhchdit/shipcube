// Content-Type grammar for JSON bodies (PR9-SEC-01, PR9-SEC-14): accepted set, charset rule, linear-time evaluation
// and the length bound. The request-level behaviour (415 before reading) is in problem-handler.api.test.ts.
// Storable text in parsed bodies (PR42-SEC-15 (c)): NUL and lone surrogates in strings and keys, at any depth; the
// request-level 400 is in json-body-text.api.test.ts.
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  containsUnstorableText,
  isStorableText,
  isUtf8JsonContentType,
  isWellFormedMediaType,
  MAX_CONTENT_TYPE_LENGTH,
} from './json-body.js';

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

describe('[PR42-SEC-15] parsed bodies hold only storable text (NUL and lone surrogates refused)', () => {
  // Built from code units, so no literal NUL or lone surrogate sits in this file.
  const NUL = String.fromCharCode(0);
  const HIGH = String.fromCharCode(0xd800);
  const HIGH_LAST = String.fromCharCode(0xdbff);
  const LOW = String.fromCharCode(0xdc00);
  const EMOJI = String.fromCharCode(0xd83d, 0xde00);

  it.each([
    ['NUL in a top-level string', { a: `x${NUL}y` }],
    ['NUL in a nested key', { a: { b: { [`k${NUL}`]: 1 } } }],
    ['a lone high surrogate in a key', { [`k${HIGH}`]: 'v' }],
    ['a lone high surrogate at the end of a string', { a: `x${HIGH}` }],
    ['a high surrogate followed by a non-surrogate', { a: `${HIGH}x` }],
    ['a lone low surrogate in an array string', { a: [1, 'ok', [`${LOW}x`]] }],
    ['a low surrogate after a complete pair', { a: `${EMOJI}${LOW}` }],
    ['the PR42-SEC-15 colliding-key pair', { [`k${HIGH}`]: 1, [`k${HIGH_LAST}`]: 2 }],
    ['a top-level array string', [`${NUL}`]],
  ])('refuses %s', (_label, body) => {
    expect(containsUnstorableText(body)).toBe(true);
  });

  it.each([
    ['a surrogate pair (emoji) in a value and a key', { [`k${EMOJI}`]: `smile ${EMOJI}${EMOJI}` }],
    ['ordinary unicode', { name: 'Zoë Łukasz 東京 नमस्ते', note: 'café ☕' }],
    ['non-string scalars', { a: 0, b: null, c: false, d: [1.5, true, null], e: {} }],
    ['an empty string and an empty key', { '': '' }],
  ])('accepts %s', (_label, body) => {
    expect(containsUnstorableText(body)).toBe(false);
  });

  it('the parsed escapes are what the check sees (JSON.parse of \\u0000, \\ud800 and the colliding keys)', () => {
    expect(containsUnstorableText(JSON.parse('{"a":"\\u0000"}'))).toBe(true);
    expect(containsUnstorableText(JSON.parse('["\\udc00"]'))).toBe(true);
    expect(containsUnstorableText(JSON.parse('{"k\\ud800":1,"k\\udbff":2}'))).toBe(true);
    expect(containsUnstorableText(JSON.parse('{"__proto__":{"\\u0000":1}}'))).toBe(true);
    expect(containsUnstorableText(JSON.parse('{"a":"\\ud83d\\ude00"}'))).toBe(false);
  });

  it('isStorableText walks code units: pairs pass, every lone half fails', () => {
    expect(isStorableText('')).toBe(true);
    expect(isStorableText(`${EMOJI}${EMOJI}`)).toBe(true);
    expect(isStorableText(HIGH)).toBe(false);
    expect(isStorableText(LOW)).toBe(false);
    expect(isStorableText(`${LOW}${HIGH}`)).toBe(false);
    expect(isStorableText(`${HIGH}${HIGH}${LOW}`)).toBe(false);
  });

  it('agrees with a reference definition on arbitrary code-unit strings (property)', () => {
    const unit = fc.constantFrom(0, 0x41, 0xe9, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xd83d, 0xde00, 0xfffd);
    fc.assert(
      fc.property(fc.array(unit, { maxLength: 12 }), (units) => {
        const text = String.fromCharCode(...units);
        // Reference: re-encoding through UTF-8 replaces exactly the lone surrogates with U+FFFD.
        const wellFormed = Buffer.from(text, 'utf8').toString('utf8') === text;
        return isStorableText(text) === (wellFormed && !text.includes(NUL));
      }),
      { numRuns: 5_000 },
    );
  });

  it('walks a 10 000-deep array and a 10 000-deep object without a stack overflow', () => {
    const depth = 10_000;
    const deepArray = (leaf: string): unknown => JSON.parse(`${'['.repeat(depth)}${leaf}${']'.repeat(depth)}`);
    const deepObject = (leaf: string): unknown => JSON.parse(`${'{"a":'.repeat(depth)}${leaf}${'}'.repeat(depth)}`);
    expect(containsUnstorableText(deepArray('"ok"'))).toBe(false);
    expect(containsUnstorableText(deepArray('"\\u0000"'))).toBe(true);
    expect(containsUnstorableText(deepObject('{"\\ud800":1}'))).toBe(true);
    expect(containsUnstorableText(deepObject('1'))).toBe(false);
  });

  it('does not mutate the body', () => {
    const body = { a: [`x${NUL}`, { [`k${HIGH}`]: 'v' }], b: EMOJI };
    const before = structuredClone(body);
    containsUnstorableText(body);
    expect(body).toEqual(before);
  });
});
