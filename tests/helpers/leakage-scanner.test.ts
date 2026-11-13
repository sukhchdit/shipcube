import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { createLogger } from '@platform/shared/logging';

import { createLogCapture, expectNoLeaks, LeakageError, scanForLeaks, useLeakageGuard } from './leakage-scanner.js';
import { isLuhnValid, luhnCheckDigit, SENTINELS, sentinel } from './sentinels.js';

const NAME = sentinel('SENTINEL_NAME').value;
const TOKEN = sentinel('SENTINEL_TOKEN').value;
const PAN = sentinel('SENTINEL_PAN').value;

describe('[NT-PRIV-001-a] sentinel set', () => {
  it('is deterministic, unique and made of the documented kinds', () => {
    expect(new Set(SENTINELS.map((s) => s.id)).size).toBe(SENTINELS.length);
    expect(new Set(SENTINELS.map((s) => s.value)).size).toBe(SENTINELS.length);
    expect(NAME).toMatch(/^SENTINEL_NAME_[0-9A-F]{16}$/);
    expect(sentinel('SENTINEL_EMAIL').value).toMatch(/^sentinel-[0-9a-f]{16}@sentinel\.test\.invalid$/);
    expect(() => sentinel('NOPE')).toThrow('unknown sentinel id');
  });

  it('the PAN sentinel is a 16-digit, Luhn-valid, 4242-style number', () => {
    expect(PAN).toMatch(/^424242[0-9]{10}$/);
    expect(isLuhnValid(PAN)).toBe(true);
    expect(isLuhnValid(`${PAN.slice(0, 15)}${(Number(PAN.slice(15)) + 1) % 10}`)).toBe(false);
    expect(luhnCheckDigit('7992739871')).toBe('3'); // the textbook example 79927398713
    expect(isLuhnValid('79927398713')).toBe(true);
  });

  it('no sentinel value is written out in the source file (nothing credential-shaped for the secret scanners)', () => {
    const source = readFileSync(join(__dirname, 'sentinels.ts'), 'utf8');
    for (const { value } of SENTINELS) expect(source.includes(value)).toBe(false);
  });
});

describe('[NT-PRIV-001-a] scanForLeaks', () => {
  it('finds a raw sentinel in a string, nested object, array, Map, Set, Buffer and Error', () => {
    expect(scanForLeaks(`prefix ${NAME} suffix`).map((f) => f.sentinelId)).toEqual(['SENTINEL_NAME']);
    const graph = {
      a: { b: [1, { c: NAME }] },
      m: new Map([['k', TOKEN]]),
      s: new Set([NAME]),
      buf: Buffer.from(`x${TOKEN}`),
      err: new Error(`failed for ${NAME}`),
    };
    const paths = scanForLeaks(graph).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['$.a.b[1].c', '$.m.<value 0>', '$.s[0]', '$.buf', '$.err.message']));
  });

  it('finds a sentinel used as an object key', () => {
    expect(scanForLeaks({ [NAME]: 1 }).map((f) => f.path)).toEqual(['$ (key)']);
  });

  it('finds the encodings a leak passes through: lower case, percent, JSON-escaped, base64, hex', () => {
    const encodings = new Map<string, string>([
      ['lowercase', NAME.toLowerCase()],
      ['base64', Buffer.from(TOKEN).toString('base64').replace(/=+$/, '')],
      ['hex', Buffer.from(TOKEN).toString('hex')],
    ]);
    for (const [encoding, text] of encodings) expect(scanForLeaks(`x ${text} y`).map((f) => f.encoding)).toContain(encoding);
    const email = sentinel('SENTINEL_EMAIL').value;
    expect(scanForLeaks(`?q=${encodeURIComponent(email)}`).map((f) => f.encoding)).toContain('percent');
  });

  it('finds a grouped PAN; flags other Luhn-valid PANs only with anyPan (epoch timestamps stay clean)', () => {
    const grouped = `${PAN.slice(0, 4)} ${PAN.slice(4, 8)}-${PAN.slice(8, 12)} ${PAN.slice(12)}`;
    expect(scanForLeaks(`card ${grouped}`).map((f) => f.encoding)).toEqual(['grouped-pan']);
    expect(scanForLeaks(`card ${PAN}`).map((f) => f.encoding)).toEqual(['raw']);
    const other = `4111111111111111`;
    expect(scanForLeaks(other)).toEqual([]);
    expect(scanForLeaks(other, { anyPan: true }).map((f) => f.sentinelId)).toEqual(['ANY_PAN']);
    expect(scanForLeaks({ ts: 1_768_478_400_000 }, { anyPan: true })).toEqual([]);
  });

  it('is clean for ordinary data and survives cycles and deep nesting', () => {
    const cyclic: Record<string, unknown> = { name: 'Asha' };
    cyclic['self'] = cyclic;
    expect(scanForLeaks(cyclic)).toEqual([]);
    let deep: unknown = NAME;
    for (let i = 0; i < 40; i += 1) deep = { next: deep };
    expect(scanForLeaks(deep)).toEqual([]);
    expect(scanForLeaks(deep, { maxDepth: 60 }).length).toBe(1);
  });

  it('never puts the leaked value into a finding or the error message (NFR-PRIV-001)', () => {
    const findings = scanForLeaks({ detail: `${NAME}/${TOKEN}` });
    const text = JSON.stringify(findings);
    expect(text.includes(NAME)).toBe(false);
    expect(text.includes(TOKEN)).toBe(false);
    let thrown: unknown;
    try {
      expectNoLeaks({ detail: NAME });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LeakageError);
    expect((thrown as LeakageError).message).toContain('SENTINEL_NAME at $.detail');
    expect((thrown as LeakageError).message.includes(NAME)).toBe(false);
  });
});

describe('[NT-PRIV-001-a] [NFR-PRIV-001] a test whose logs contain a sentinel fails', () => {
  const guard = useLeakageGuard();

  function logger() {
    return createLogger({
      service: 'api',
      version: '0.0.0',
      destination: guard.capture.destination,
      now: () => new Date('2026-01-15T12:00:00.000Z'),
    });
  }

  it('passes when the platform logger wrote no sentinel', () => {
    logger().info('order.created', { order_ref: 'ORD-1', status: 'PAID' });
    expect(guard.capture.lines()).toHaveLength(1);
    expect(() => guard.assertClean()).not.toThrow();
  });

  it('stays clean when the logger redacts the value itself (token, secret and e-mail sentinels)', () => {
    for (const id of ['SENTINEL_TOKEN', 'SENTINEL_SECRET', 'SENTINEL_EMAIL']) logger().info('auth.attempt', { detail: sentinel(id).value });
    expect(guard.capture.lines()).toHaveLength(3);
    expect(() => guard.assertClean()).not.toThrow();
  });

  it('fails with a LeakageError naming the log line when a log line carries a sentinel', () => {
    logger().info('order.created', { note: `hello ${NAME}` });
    expect(() => guard.assertClean()).toThrow(LeakageError);
    expect(() => guard.assertClean()).toThrow(/SENTINEL_NAME at log line 1/);
    // The registered afterEach would fail THIS test too; the leak was asserted above, so drop it to end the test cleanly.
    guard.capture.clear();
  });

  it('also scans extra values handed to assertClean (an audit value, a response body)', () => {
    expect(() => guard.assertClean({ body: { tax: sentinel('SENTINEL_TAXID').value } })).toThrow(/SENTINEL_TAXID/);
  });

  it('expectNoLeaks scans a capture written by the platform logger', () => {
    const capture = createLogCapture();
    createLogger({ service: 'api', version: '0.0.0', destination: capture.destination }).info('x', { note: NAME });
    expect(() => expectNoLeaks(capture.lines())).toThrow(LeakageError);
  });
});

describe('createLogCapture', () => {
  it('splits chunks into lines, keeps a trailing partial line pending, and clears', () => {
    const capture = createLogCapture();
    capture.stream.write('one\ntw');
    capture.stream.write('o\n\nthree');
    expect(capture.lines()).toEqual(['one', 'two']);
    capture.clear();
    expect(capture.lines()).toEqual([]);
  });
});
