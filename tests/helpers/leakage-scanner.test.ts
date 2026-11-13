import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { createLogger } from '@platform/shared/logging';

import { createLogCapture, expectNoLeaks, type LeakFinding, LeakageError, scanForLeaks, useLeakageGuard } from './leakage-scanner.js';
import { isLuhnValid, luhnCheckDigit, type Sentinel, SENTINELS, sentinel } from './sentinels.js';

const NAME = sentinel('SENTINEL_NAME').value;
const TOKEN = sentinel('SENTINEL_TOKEN').value;
const EMAIL = sentinel('SENTINEL_EMAIL').value;
const PAN = sentinel('SENTINEL_PAN').value;
const NBSP = String.fromCharCode(0xa0);

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');
const b64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');
/** Byte offset of `value` inside `payload`, modulo 3 (the base64 alignment the test exercises). */
const alignment = (payload: string, value: string): number => Buffer.from(payload, 'utf8').indexOf(Buffer.from(value, 'utf8')) % 3;
const idsOf = (findings: readonly LeakFinding[]): string[] => findings.map((f) => f.sentinelId);

/** Deterministic mulberry32 stream (no Math.random). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function recordingGuard() {
  const hooks: (() => void)[] = [];
  const guard = useLeakageGuard({}, (hook) => {
    hooks.push(hook);
  });
  return { guard, hooks };
}

describe('[NT-PRIV-001-a] sentinel set', () => {
  it('is deterministic, unique and made of the documented kinds', () => {
    expect(new Set(SENTINELS.map((s) => s.id)).size).toBe(SENTINELS.length);
    expect(new Set(SENTINELS.map((s) => s.value)).size).toBe(SENTINELS.length);
    expect(NAME).toMatch(/^SENTINEL_NAME_[0-9A-F]{16}$/);
    expect(EMAIL).toMatch(/^sentinel-[0-9a-f]{16}@sentinel\.test\.invalid$/);
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

  it('finds a sentinel used as an object key without writing the key into the path', () => {
    expect(scanForLeaks({ [NAME]: 1 })).toEqual([{ sentinelId: 'SENTINEL_NAME', path: '$.<key 0> (key)', encoding: 'raw' }]);
  });

  it('writes a short identifier key into the path but an unusual key only as its index', () => {
    expect(scanForLeaks({ note: NAME }).map((f) => f.path)).toEqual(['$.note']);
    expect(scanForLeaks({ ok: 1, 'content-type': NAME }).map((f) => f.path)).toEqual(['$.<key 1>']);
    expect(scanForLeaks({ [`k${'x'.repeat(40)}`]: NAME }).map((f) => f.path)).toEqual(['$.<key 0>']);
  });

  it('finds the encodings a leak passes through: case-folded, percent, JSON-escaped, base64, hex', () => {
    const encodings = new Map<string, string>([
      ['case-folded', NAME.toLowerCase()],
      ['base64', b64(TOKEN).replace(/=+$/, '')],
      ['hex', Buffer.from(TOKEN).toString('hex')],
    ]);
    for (const [encoding, text] of encodings) expect(scanForLeaks(`x ${text} y`).map((f) => f.encoding)).toContain(encoding);
    expect(scanForLeaks(`?q=${encodeURIComponent(EMAIL)}`).map((f) => f.encoding)).toContain('percent');
  });

  it('finds an upper-cased e-mail and upper-case hex', () => {
    expect(scanForLeaks(`to: ${EMAIL.toUpperCase()}`)).toEqual([{ sentinelId: 'SENTINEL_EMAIL', path: '$', encoding: 'case-folded' }]);
    expect(scanForLeaks(Buffer.from(TOKEN).toString('hex').toUpperCase())).toEqual([
      { sentinelId: 'SENTINEL_TOKEN', path: '$', encoding: 'hex' },
    ]);
  });

  it('builds no base64 needle shorter than 16 characters (a short value would match unrelated base64)', () => {
    const short: Sentinel = { id: 'SHORT', kind: 'name', value: 'abc' };
    expect(scanForLeaks(`x ${b64('abc')} y`, { sentinels: [short] })).toEqual([]);
  });

  it('matches base64 case-sensitively (a lower-cased base64 text is not a leak)', () => {
    expect(scanForLeaks(b64(`xx${TOKEN}`).toLowerCase())).toEqual([]);
  });

  describe('base64 at every byte alignment', () => {
    for (const s of SENTINELS) {
      const field = s.kind === 'email' ? 'email' : 'token';

      it(`finds ${s.id} inside a base64 JSON payload at byte offsets 0, 1 and 2`, () => {
        const payloads = [0, 1, 2].map((k) => JSON.stringify({ p: 'x'.repeat(k), v: s.value }));
        expect(new Set(payloads.map((p) => alignment(p, s.value)))).toEqual(new Set([0, 1, 2]));
        for (const payload of payloads) {
          const findings = scanForLeaks(`data=${b64(payload)};`).filter((f) => f.sentinelId === s.id);
          expect(findings.map((f) => f.encoding)).toEqual([expect.stringMatching(/^base64(url)?$/)]);
        }
      });

      it(`finds ${s.id} inside a JWT-shaped string at byte offsets 0, 1 and 2`, () => {
        const claims = [0, 1, 2].map((k) => JSON.stringify({ sub: 'x'.repeat(k), [field]: s.value }));
        expect(new Set(claims.map((c) => alignment(c, s.value)))).toEqual(new Set([0, 1, 2]));
        for (const claim of claims) {
          const jwt = `${b64url('{"alg":"none","typ":"JWT"}')}.${b64url(claim)}.c2lnbmF0dXJl`;
          expect(idsOf(scanForLeaks(`Bearer ${jwt}`))).toEqual([s.id]);
        }
      });

      it(`finds ${s.id} inside a Basic header as the password or the user, at byte offsets 0, 1 and 2`, () => {
        const credentials = [...[0, 1, 2].map((k) => `${'u'.repeat(4 + k)}:${s.value}`), `${s.value}:pw`];
        expect(new Set(credentials.map((c) => alignment(c, s.value)))).toEqual(new Set([0, 1, 2]));
        for (const credential of credentials) expect(idsOf(scanForLeaks({ authorization: `Basic ${b64(credential)}` }))).toEqual([s.id]);
      });
    }

    it('reports the base64url alphabet as base64url and the standard alphabet as base64', () => {
      // '>>>' and '???' encode to text with '+' and '/', so the two alphabets differ for this value.
      const custom: Sentinel = { id: 'CUSTOM', kind: 'token', value: '>>>???'.repeat(4) };
      for (const k of [0, 1, 2]) {
        const payload = `${'p'.repeat(k)}${custom.value}!`;
        expect(scanForLeaks(Buffer.from(payload).toString('base64url'), { sentinels: [custom] }).map((f) => f.encoding)).toEqual([
          'base64url',
        ]);
        expect(scanForLeaks(b64(payload), { sentinels: [custom] }).map((f) => f.encoding)).toEqual(['base64']);
      }
    });
  });

  it('finds no sentinel in 200 seeded pseudo-random base64, hex and ASCII strings', () => {
    const next = seeded(0x5eed);
    const alphabets = [
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=-_',
      '0123456789abcdefABCDEF',
      Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(''),
    ];
    const samples = Array.from({ length: 200 }, (_, i) => {
      const alphabet = alphabets[i % alphabets.length] ?? '';
      const length = 64 + Math.floor(next() * 448);
      return Array.from({ length }, () => alphabet.charAt(Math.floor(next() * alphabet.length))).join('');
    });
    expect(samples.flatMap((sample) => scanForLeaks(sample))).toEqual([]);
  });

  it('is clean for ordinary data', () => {
    const record = {
      id: '0190b6e2-7c1a-7d3e-9f00-1a2b3c4d5e6f',
      email: 'asha.rao@example.test',
      createdAt: new Date('2026-01-15T12:00:00.000Z'),
      amount: 1234.56,
      ts: 1_768_478_400_000,
      auth: `Basic ${b64('demo:not-a-secret')}`,
      url: new URL('https://example.test/track?ref=ORD-1'),
      tags: new Set(['express', 'dhl']),
    };
    expect(scanForLeaks(record)).toEqual([]);
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

  it('finds a PAN grouped with dots, two spaces or NBSP', () => {
    const groups = [PAN.slice(0, 4), PAN.slice(4, 8), PAN.slice(8, 12), PAN.slice(12)];
    for (const separator of ['.', '  ', NBSP, ` ${NBSP}`]) {
      expect(scanForLeaks(`card ${groups.join(separator)} end`)).toEqual([
        { sentinelId: 'SENTINEL_PAN', path: '$', encoding: 'grouped-pan' },
      ]);
    }
  });

  it('visits Error cause and AggregateError errors', () => {
    expect(scanForLeaks(new Error('outer', { cause: new Error(NAME) })).map((f) => f.path)).toContain('$.cause.message');
    expect(scanForLeaks(new AggregateError([new Error(TOKEN)], 'many')).map((f) => f.path)).toContain('$.errors[0].message');
  });

  it('decodes typed arrays, DataView and ArrayBuffer', () => {
    const bytes = new Uint8Array(Buffer.from(`x ${NAME} y`));
    expect(scanForLeaks(bytes)).toEqual([{ sentinelId: 'SENTINEL_NAME', path: '$', encoding: 'raw' }]);
    expect(idsOf(scanForLeaks(new DataView(bytes.buffer)))).toEqual(['SENTINEL_NAME']);
    expect(idsOf(scanForLeaks({ raw: bytes.buffer }))).toEqual(['SENTINEL_NAME']);
  });

  it('scans URL, URLSearchParams, Headers and toJSON output', () => {
    expect(scanForLeaks(new URL(`https://example.test/cb?e=${encodeURIComponent(EMAIL)}`))).toEqual([
      { sentinelId: 'SENTINEL_EMAIL', path: '$.toJSON()', encoding: 'percent' },
    ]);
    expect(idsOf(scanForLeaks(new URLSearchParams({ t: TOKEN })))).toEqual(['SENTINEL_TOKEN']);
    expect(scanForLeaks(new Headers({ authorization: `Bearer ${TOKEN}` })).map((f) => f.path)).toEqual(['$.<value 0>']);
    expect(scanForLeaks({ when: { toJSON: () => NAME } }).map((f) => f.path)).toEqual(['$.when.toJSON()']);
  });

  it('includes non-enumerable and symbol-keyed properties', () => {
    const hidden = Object.defineProperty({}, 'hidden', { value: NAME, enumerable: false });
    expect(scanForLeaks(hidden).map((f) => f.path)).toEqual(['$.hidden']);
    expect(scanForLeaks({ [Symbol('tag')]: TOKEN }).map((f) => f.path)).toEqual(['$.<key 0>']);
  });

  it('keeps scanning past a getter or toJSON that throws', () => {
    const subject = {
      get boom(): string {
        throw new Error('getter failed');
      },
      odd: {
        toJSON: () => {
          throw new Error('toJSON failed');
        },
        inner: NAME,
      },
      after: TOKEN,
    };
    expect(scanForLeaks(subject).map((f) => f.path)).toEqual(['$.odd.inner', '$.after']);
  });

  it('survives cycles without a finding and reports the depth limit instead of skipping deep values', () => {
    const cyclic: Record<string, unknown> = { name: 'Asha' };
    cyclic['self'] = cyclic;
    expect(scanForLeaks(cyclic)).toEqual([]);
    let deep: unknown = NAME;
    for (let i = 0; i < 40; i += 1) deep = { next: deep };
    expect(scanForLeaks(deep)).toEqual([{ sentinelId: 'DEPTH_LIMIT', path: `$${'.next'.repeat(25)}`, encoding: 'depth-limit' }]);
    expect(scanForLeaks(deep, { maxDepth: 60 })).toEqual([
      { sentinelId: 'SENTINEL_NAME', path: `$${'.next'.repeat(40)}`, encoding: 'raw' },
    ]);
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

  it('never echoes a sentinel used as a key, alone or inside a longer key', () => {
    // NAME is identifier-shaped (it would pass the key pattern), so only the sentinel check keeps it out of the path.
    const subjects = [{ [EMAIL]: { token: TOKEN } }, { [`prefix_${TOKEN}_suffix`]: { note: NAME } }, { [NAME]: { note: TOKEN } }];
    for (const subject of subjects) {
      let thrown: unknown;
      try {
        expectNoLeaks(subject);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(LeakageError);
      const message = (thrown as LeakageError).message;
      for (const value of [EMAIL, TOKEN, NAME]) expect(message.includes(value)).toBe(false);
    }
    expect(scanForLeaks(subjects[0])).toEqual([
      { sentinelId: 'SENTINEL_EMAIL', path: '$.<key 0> (key)', encoding: 'raw' },
      { sentinelId: 'SENTINEL_TOKEN', path: '$.<key 0>.token', encoding: 'raw' },
    ]);
    expect(scanForLeaks(subjects[2]).map((f) => f.path)).toEqual(['$.<key 0> (key)', '$.<key 0>.note']);
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

  it('the registered after-each hook throws on a dirty capture and still clears it', () => {
    const { guard: local, hooks } = recordingGuard();
    expect(hooks).toHaveLength(1);
    local.capture.stream.write(`{"msg":"x","note":"${NAME}"}\n`);
    expect(() => hooks[0]?.()).toThrow(LeakageError);
    expect(local.capture.lines()).toEqual([]);
  });

  it('the registered after-each hook passes on a clean capture and clears it', () => {
    const { guard: local, hooks } = recordingGuard();
    local.capture.stream.write('{"msg":"order.created"}\n');
    expect(() => hooks[0]?.()).not.toThrow();
    expect(local.capture.lines()).toEqual([]);
  });

  it('scans a trailing line written without a newline', () => {
    const { guard: local } = recordingGuard();
    local.capture.stream.write(`x ${NAME}`);
    expect(() => local.assertClean()).toThrow(/SENTINEL_NAME at log line 1/);
  });
});

describe('createLogCapture', () => {
  it('splits chunks into lines, includes a trailing partial line, and clears', () => {
    const capture = createLogCapture();
    capture.stream.write('one\ntw');
    capture.stream.write('o\n\nthree');
    expect(capture.lines()).toEqual(['one', 'two', 'three']);
    capture.clear();
    expect(capture.lines()).toEqual([]);
  });

  it('drops the CR of CRLF line breaks, also when CR and LF arrive in separate chunks', () => {
    const capture = createLogCapture();
    capture.stream.write('a\r\nb\r');
    capture.stream.write('\nc\r');
    expect(capture.lines()).toEqual(['a', 'b', 'c']);
  });
});
