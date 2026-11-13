/**
 * Leakage scanner (NFR-PRIV-001; TEST-STRATEGY §10.1 rule 4; T-QA-03).
 *
 * Finds sentinel PII/secret values (sentinels.ts) in anything a test can observe: captured log lines (including a
 * trailing line with no newline), audit values, response bodies, raw payload objects, errors. A finding names the
 * sentinel id, the place (an object path) and the encoding that matched, NEVER the value: an object key is written into
 * a path only when it is a short identifier that carries no sentinel, otherwise as `<key N>`.
 *
 * Text matching: the value in any letter case (raw, `case-folded`), percent-encoded, JSON-escaped and hex (any case),
 * plus base64 and base64url (case-sensitive) at all three byte alignments, so a value embedded in a larger encoded
 * payload (a JWT segment, a `Basic` header, base64 JSON) is found. A PAN is also found when its digits are grouped by
 * one or two of: space, NBSP, '.', '-'.
 *
 * Object graph: own properties including non-enumerable and symbol-keyed ones (so Error `message`, `stack`, `cause` and
 * AggregateError `errors`), arrays, Map, Set, Headers, URLSearchParams, Buffer/typed arrays/DataView/ArrayBuffer
 * (decoded as UTF-8), and the `toJSON()` output of objects that have one (URL, Date). Prototype getters and `#private`
 * fields are not read. A throwing getter is skipped. Cycles are skipped; going deeper than `maxDepth` is a finding.
 */
import { Buffer } from 'node:buffer';
import { Writable } from 'node:stream';

import { afterEach } from '@jest/globals';

import { isLuhnValid, type Sentinel, SENTINELS } from './sentinels.js';

export type LeakEncoding =
  'raw' | 'case-folded' | 'percent' | 'json' | 'hex' | 'base64' | 'base64url' | 'grouped-pan' | 'luhn-pan' | 'depth-limit';

export interface LeakFinding {
  /** A sentinel id, `ANY_PAN` (option `anyPan`) or `DEPTH_LIMIT` (the walk stopped at `maxDepth`). */
  readonly sentinelId: string;
  /** Where it was found: `$.a.b[0]`, `$.<key 2> (key)`, `log line 3` for captured log lines. */
  readonly path: string;
  readonly encoding: LeakEncoding;
}

export interface ScanOptions {
  /** Sentinels to look for (default: the whole fixed set). */
  readonly sentinels?: readonly Sentinel[];
  /** Also flag ANY Luhn-valid 16-digit run, not only the sentinel PAN (default false: epoch timestamps collide). */
  readonly anyPan?: boolean;
  /** Maximum object depth (default 24). An object deeper than this is not walked and yields a `DEPTH_LIMIT` finding. */
  readonly maxDepth?: number;
}

interface Needle {
  readonly sentinelId: string;
  readonly encoding: LeakEncoding;
  /** Lower-cased when `folded`. */
  readonly text: string;
  /** Compared against a lower-cased copy of the text (letter case carries no information in these encodings). */
  readonly folded: boolean;
}

/** The base64 characters fully determined by `value` when it starts at byte offset k (mod 3) of an encoded payload. */
function base64Needles(value: string): string[] {
  const bytes = Buffer.from(value, 'utf8');
  const needles: string[] = [];
  for (const k of [0, 1, 2]) {
    const encoded = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64');
    const needle = encoded.slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + bytes.length)) / 6));
    if (needle.length >= 16) needles.push(needle);
  }
  return needles;
}

function needlesFor(sentinel: Sentinel): Needle[] {
  const { id, value } = sentinel;
  const folded = (encoding: LeakEncoding, text: string): Needle => ({ sentinelId: id, encoding, text: text.toLowerCase(), folded: true });
  const exact = (encoding: LeakEncoding, text: string): Needle => ({ sentinelId: id, encoding, text, folded: false });
  const base64 = base64Needles(value);
  const list: Needle[] = [
    exact('raw', value),
    folded('case-folded', value),
    folded('percent', encodeURIComponent(value)),
    folded('json', JSON.stringify(value).slice(1, -1)),
    folded('hex', Buffer.from(value, 'utf8').toString('hex')),
    ...base64.map((text) => exact('base64', text)),
    ...base64.map((text) => exact('base64url', text.replaceAll('+', '-').replaceAll('/', '_'))),
  ];
  // Keep the first (most specific) encoding for an identical needle, drop later duplicates.
  const seen = new Set<string>();
  return list.filter((needle) => {
    const key = `${needle.folded ? 'f' : 'x'}:${needle.text}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

/** 13 to 19 digits, each optionally followed by one or two separators (space, NBSP, '.', '-'). Linear: no overlap. */
const DIGIT_RUN = /(?:[0-9][ \u00A0.-]{0,2}){12,18}[0-9]/g;
const PAN_SEPARATORS = /[ \u00A0.-]/g;

function panFindings(text: string, sentinels: readonly Sentinel[], anyPan: boolean, path: string): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const pans = sentinels.filter((candidate) => candidate.kind === 'pan');
  for (const match of text.matchAll(DIGIT_RUN)) {
    const digits = match[0].replace(PAN_SEPARATORS, '');
    const grouped = match[0] !== digits;
    const known = pans.find((candidate) => candidate.value === digits);
    if (known !== undefined) {
      // A contiguous sentinel PAN is already reported by the raw needle; only grouped spellings are new here.
      if (grouped) findings.push({ sentinelId: known.id, path, encoding: 'grouped-pan' });
    } else if (anyPan && digits.length === 16 && isLuhnValid(digits)) {
      findings.push({ sentinelId: 'ANY_PAN', path, encoding: 'luhn-pan' });
    }
  }
  return findings;
}

function scanText(text: string, needles: readonly Needle[], sentinels: readonly Sentinel[], anyPan: boolean, path: string): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const lower = text.toLowerCase();
  const hit = new Set<string>();
  for (const needle of needles) {
    if (!hit.has(needle.sentinelId) && (needle.folded ? lower : text).includes(needle.text)) {
      hit.add(needle.sentinelId);
      findings.push({ sentinelId: needle.sentinelId, path, encoding: needle.encoding });
    }
  }
  return [...findings, ...panFindings(text, sentinels, anyPan, path)];
}

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

/** Scans any value (string, number, object graph, Buffer, Error, Map/Set, URL, Headers). Cycle-safe and depth-bounded. */
export function scanForLeaks(subject: unknown, options: ScanOptions = {}): LeakFinding[] {
  const sentinels = options.sentinels ?? SENTINELS;
  const anyPan = options.anyPan ?? false;
  const maxDepth = options.maxDepth ?? 24;
  const needles = sentinels.flatMap(needlesFor);
  const seen = new WeakSet<object>();
  const findings: LeakFinding[] = [];
  const scan = (text: string, path: string): void => void findings.push(...scanText(text, needles, sentinels, anyPan, path));

  const visitEntries = (entries: Iterable<[unknown, unknown]>, path: string, depth: number): void => {
    let index = 0;
    for (const [key, entry] of entries) {
      visit(key, `${path}.<key ${index}>`, depth + 1);
      visit(entry, `${path}.<value ${index}>`, depth + 1);
      index += 1;
    }
  };

  const visitOwnProperties = (value: object, path: string, depth: number): void => {
    Reflect.ownKeys(value).forEach((key, index) => {
      const keyText = typeof key === 'symbol' ? (key.description ?? '') : key;
      const before = findings.length;
      scan(keyText, `${path}.<key ${index}> (key)`);
      const segment = typeof key === 'string' && findings.length === before && SAFE_KEY.test(key) ? key : `<key ${index}>`;
      let child: unknown;
      try {
        child = Reflect.get(value, key);
      } catch {
        return; // A throwing getter holds nothing we can read; keep scanning the siblings.
      }
      visit(child, `${path}.${segment}`, depth + 1);
    });
  };

  const visit = (value: unknown, path: string, depth: number): void => {
    if (typeof value === 'string') return scan(value, path);
    if (typeof value === 'number' || typeof value === 'bigint') return scan(String(value), path);
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    if (depth > maxDepth) return void findings.push({ sentinelId: 'DEPTH_LIMIT', path, encoding: 'depth-limit' });
    seen.add(value);
    if (ArrayBuffer.isView(value)) return scan(Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8'), path);
    if (value instanceof ArrayBuffer) return scan(Buffer.from(value).toString('utf8'), path);
    if (value instanceof URLSearchParams) return scan(value.toString(), path);
    if (value instanceof Map || value instanceof Headers) return visitEntries(value.entries(), path, depth);
    if (value instanceof Set || Array.isArray(value)) {
      let index = 0;
      for (const entry of value as Iterable<unknown>) {
        visit(entry, `${path}[${index}]`, depth + 1);
        index += 1;
      }
      return;
    }
    const toJSON: unknown = Reflect.get(value, 'toJSON');
    if (typeof toJSON === 'function') {
      try {
        visit(toJSON.call(value), `${path}.toJSON()`, depth + 1);
      } catch {
        // A throwing toJSON: the own properties below are still scanned.
      }
    }
    visitOwnProperties(value, path, depth);
  };

  visit(subject, '$', 0);
  return findings;
}

export class LeakageError extends Error {
  readonly findings: readonly LeakFinding[];
  constructor(findings: readonly LeakFinding[]) {
    // Ids, places and encodings only: the leaked value is never echoed (NFR-PRIV-001).
    super(
      `leakage scanner: ${findings.length} sentinel value(s) found - ` +
        findings.map((finding) => `${finding.sentinelId} at ${finding.path} (${finding.encoding})`).join('; '),
    );
    this.name = 'LeakageError';
    this.findings = findings;
  }
}

/** Throws a {@link LeakageError} when `subject` carries any sentinel value. */
export function expectNoLeaks(subject: unknown, options: ScanOptions = {}): void {
  const findings = scanForLeaks(subject, options);
  if (findings.length > 0) throw new LeakageError(findings);
}

export interface LogCapture {
  /** A destination for Pino (`pino(options, capture.stream)`) or any `write(chunk)` sink. */
  readonly stream: Writable;
  /** The `LogDestination` of the platform logger (`createLogger({ destination: capture.destination })`). */
  readonly destination: { write(line: string): void };
  /** Captured lines so far, without the line break (`\n` or `\r\n`); a trailing line with no newline is included. */
  lines(): string[];
  clear(): void;
}

/** Collects what a logger writes; one entry per line, empty lines dropped. */
export function createLogCapture(): LogCapture {
  let pending = '';
  const complete: string[] = [];
  const stripCr = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line);
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const parts = pending.split('\n');
      pending = parts.pop() ?? '';
      complete.push(...parts.map(stripCr).filter((line) => line.length > 0));
      callback();
    },
  });
  return {
    stream,
    destination: { write: (line: string) => void stream.write(line) },
    lines: () => {
      const tail = stripCr(pending);
      return tail.length > 0 ? [...complete, tail] : [...complete];
    },
    clear: () => {
      complete.length = 0;
      pending = '';
    },
  };
}

export interface LeakageGuard {
  readonly capture: LogCapture;
  /** Fails with a {@link LeakageError} when a captured line (or any extra value) carries a sentinel. */
  assertClean(...extra: unknown[]): void;
}

/**
 * One guard per test file: logs written to `guard.capture.stream` are scanned after EVERY test (a hook registered with
 * `register`, Jest's `afterEach` by default), so a test whose logs contain a sentinel fails by itself; the capture is
 * cleared after each test either way. Call it at describe/module level.
 */
export function useLeakageGuard(options: ScanOptions = {}, register: (hook: () => void) => void = afterEach): LeakageGuard {
  const capture = createLogCapture();
  const assertClean = (...extra: unknown[]): void => {
    const lines = capture.lines();
    const findings = [
      ...lines.flatMap((line, index) => scanForLeaks(line, options).map((finding) => ({ ...finding, path: `log line ${index + 1}` }))),
      ...scanForLeaks(extra, options),
    ];
    if (findings.length > 0) throw new LeakageError(findings);
  };
  register(() => {
    try {
      assertClean();
    } finally {
      capture.clear();
    }
  });
  return { capture, assertClean };
}
