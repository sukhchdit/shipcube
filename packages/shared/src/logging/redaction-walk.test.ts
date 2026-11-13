// Structural redaction (redaction.ts) after PR #20 fix cycle 1: live HTTP/stream objects, `[name, value]` pairs in
// arrays, the card parent rule, PII keys on general lines and the per-call character budget (PR20-SEC-01/02/07, m5).
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from '@jest/globals';

import { createLogger } from './logger.js';
import {
  MAX_LINE_CHARS,
  MAX_NODES,
  MAX_STRING_LENGTH,
  MORE_KEY,
  OMITTED,
  REDACTED,
  redactValue,
  TRUNCATED,
  TRUNCATION_SUFFIX,
  UNSUPPORTED,
} from './redaction.js';

const sentinel = (): string => `sentinel-${randomBytes(8).toString('hex')}`;
const json = (value: unknown): string => JSON.stringify(value);

describe('redactValue: live objects and raw header forms (PR20-SEC-01)', () => {
  it('never walks an EventEmitter or a stream (req, res, sockets), wherever it sits', () => {
    const value = sentinel();
    const emitter = Object.assign(new EventEmitter(), { rawHeaders: ['Cookie', value], headers: { cookie: value } });
    const stream = Object.assign(new PassThrough(), { _parsedUrl: { path: `/x?q=${value}` } });
    const output = redactValue({ req: emitter, nested: { socket: stream }, list: [emitter] });
    expect(output).toEqual({ req: UNSUPPORTED, nested: { socket: UNSUPPORTED }, list: [UNSUPPORTED] });
    expect(json(output)).not.toContain(value);
  });

  it('redacts the value that follows a sensitive name in alternating rawHeaders arrays', () => {
    const cookie = sentinel();
    const key = sentinel();
    const output = redactValue({
      list: ['Host', 'api.example', 'Cookie', `theme=dark; sid=${cookie}`, 'X-Api-Key', key, 'Accept', 'application/json'],
    });
    expect(output).toEqual({ list: ['Host', 'api.example', 'Cookie', REDACTED, 'X-Api-Key', REDACTED, 'Accept', 'application/json'] });
    expect(json(output)).not.toContain(cookie);
    expect(json(output)).not.toContain(key);
  });

  it('redacts [name, value] entry tuples and omits URL-named pairs', () => {
    const token = sentinel();
    const query = sentinel();
    const output = redactValue({
      entries: [
        ['authorization', `DPoP ${token}`],
        ['url', `/x?q=${query}`],
        ['accept', 'text/html'],
      ],
    });
    expect(output).toEqual({
      entries: [
        ['authorization', REDACTED],
        ['url', OMITTED],
        ['accept', 'text/html'],
      ],
    });
  });

  it('redacts a non-string value that follows a sensitive name (set-cookie arrays)', () => {
    const value = sentinel();
    // The name itself is a word containing a keyword, so the word rule redacts it too (fails closed).
    expect(redactValue(['set-cookie', [`a=${value}`]])).toEqual([REDACTED, REDACTED]);
  });
});

describe('redactValue: card data and PII keys (PR20-SEC-02)', () => {
  it('redacts number, expiry and security code under a card or payment-method parent', () => {
    const number = sentinel();
    const output = redactValue({ card: { number, expMonth: 12, exp_year: 2030, cvc: '1', brand: 'visa' }, page: { number: 3 } });
    expect(output).toEqual({
      card: { number: REDACTED, expMonth: REDACTED, exp_year: REDACTED, cvc: REDACTED, brand: 'visa' },
      page: { number: 3 },
    });
  });

  it('redacts PII-named keys on general lines, keeps aggregate counters', () => {
    const output = redactValue({
      response: 'x',
      data: { fullName: 'Alice Smith', phone: '+15550100', postalCode: '10001', taxId: 'T-1', email: 'alice@example.com' },
      distinct_address_count: 6,
      addressCount: 2,
      emailAccount: 'alice',
      route: '/r',
      status: 200,
    });
    expect(output).toEqual({
      response: 'x',
      data: { fullName: REDACTED, phone: REDACTED, postalCode: REDACTED, taxId: REDACTED, email: REDACTED },
      distinct_address_count: 6,
      addressCount: 2,
      emailAccount: REDACTED,
      route: '/r',
      status: 200,
    });
  });
});

describe('redactValue: per-call budget (PR #20 m5, PR20-SEC-07)', () => {
  /** The review's worst case: MAX_NODES-shaped input of 8 KiB strings (a 16 MiB, 3.9 s line before the budget). */
  function maxShaped(): Record<string, unknown> {
    const big = 'a'.repeat(MAX_STRING_LENGTH);
    const output: Record<string, unknown> = {};
    for (let outer = 0; outer < 20; outer += 1) {
      const inner: Record<string, string> = {};
      for (let index = 0; index < 99; index += 1) inner[`k${String(index)}`] = big;
      output[`o${String(outer)}`] = inner;
    }
    return output;
  }

  it('bounds the characters a call writes and the time it takes, with a truncation marker', () => {
    const started = performance.now();
    const output = redactValue(maxShaped());
    const elapsed = performance.now() - started;
    const text = json(output);
    expect(text.length).toBeLessThan(MAX_LINE_CHARS + 32 * 1024);
    expect(text).toContain(TRUNCATION_SUFFIX);
    expect(text).toContain(MORE_KEY);
    expect(elapsed).toBeLessThan(250);
  });

  it('keeps one logger line near the budget for the same input (was 16.2 MB)', () => {
    let line = '';
    const logger = createLogger({ service: 'api', version: '1', destination: { write: (text: string) => (line = text) } });
    const started = performance.now();
    logger.info('bulk', maxShaped());
    expect(performance.now() - started).toBeLessThan(250);
    expect(line.length).toBeGreaterThan(MAX_LINE_CHARS / 2);
    expect(line.length).toBeLessThan(MAX_LINE_CHARS + 32 * 1024);
  });

  it('writes values after the budget as TRUNCATED and still visits at most MAX_NODES values', () => {
    const items = Array.from({ length: 40 }, () => 'b'.repeat(1024));
    const output = redactValue({ items }) as { items: unknown[] };
    expect(output.items.slice(0, 15).every((item) => typeof item === 'string' && item.startsWith('b'))).toBe(true);
    expect(output.items.at(-1)).toBe(TRUNCATED);
    expect(MAX_NODES).toBeGreaterThan(40);
  });

  it('classifies 1 MiB keys cheaply (keys are capped before normalisation)', () => {
    const value: Record<string, number> = {};
    for (let index = 0; index < 20; index += 1) value[`${String(index)}${'k'.repeat(1024 * 1024)}`] = index;
    const started = performance.now();
    redactValue(value);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
