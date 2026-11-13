/**
 * Leakage scanner (NFR-PRIV-001; TEST-STRATEGY §10.1 rule 4; T-QA-03).
 *
 * Finds sentinel PII/secret values (sentinels.ts) in anything a test can observe: captured log lines, audit values,
 * response bodies, raw payload objects, errors. A finding names the sentinel id, the place (an object path) and the
 * encoding that matched, NEVER the value, so a failing test does not itself write the leaked value into a report.
 *
 * Matching covers the raw value plus the encodings a leak usually passes through: lower case, percent-encoding,
 * JSON-escaped text, base64 and hex. Digits of a PAN are also found when grouped with spaces or dashes.
 */
import { Buffer } from 'node:buffer';
import { Writable } from 'node:stream';

import { afterEach } from '@jest/globals';

import { isLuhnValid, type Sentinel, SENTINELS } from './sentinels.js';

export type LeakEncoding = 'raw' | 'lowercase' | 'percent' | 'json' | 'base64' | 'hex' | 'grouped-pan' | 'luhn-pan';

export interface LeakFinding {
  readonly sentinelId: string;
  /** Where it was found: `$.a.b[0]`, `$.a (key)`, `line 3` for captured log lines. */
  readonly path: string;
  readonly encoding: LeakEncoding;
}

export interface ScanOptions {
  /** Sentinels to look for (default: the whole fixed set). */
  readonly sentinels?: readonly Sentinel[];
  /** Also flag ANY Luhn-valid 16-digit run, not only the sentinel PAN (default false: epoch timestamps collide). */
  readonly anyPan?: boolean;
  /** Maximum object depth (default 24); deeper values are scanned as `String(value)` is NOT attempted, they are skipped. */
  readonly maxDepth?: number;
}

interface Needle {
  readonly sentinelId: string;
  readonly encoding: LeakEncoding;
  readonly text: string;
}

function needlesFor(sentinel: Sentinel): Needle[] {
  const value = sentinel.value;
  const list: Needle[] = [
    { sentinelId: sentinel.id, encoding: 'raw', text: value },
    { sentinelId: sentinel.id, encoding: 'lowercase', text: value.toLowerCase() },
    { sentinelId: sentinel.id, encoding: 'percent', text: encodeURIComponent(value) },
    { sentinelId: sentinel.id, encoding: 'json', text: JSON.stringify(value).slice(1, -1) },
    { sentinelId: sentinel.id, encoding: 'base64', text: Buffer.from(value, 'utf8').toString('base64').replace(/=+$/, '') },
    { sentinelId: sentinel.id, encoding: 'hex', text: Buffer.from(value, 'utf8').toString('hex') },
  ];
  // Keep the first (most specific) encoding for an identical needle text, drop texts equal to an earlier one.
  const seen = new Set<string>();
  return list.filter((needle) => (seen.has(needle.text) ? false : (seen.add(needle.text), true)));
}

const DIGIT_RUN = /(?:[0-9][ -]?){12,18}[0-9]/g;

function panFindings(text: string, sentinels: readonly Sentinel[], anyPan: boolean, path: string): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const pans = sentinels.filter((candidate) => candidate.kind === 'pan');
  for (const match of text.matchAll(DIGIT_RUN)) {
    const digits = match[0].replace(/[ -]/g, '');
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
  const hit = new Set<string>();
  for (const needle of needles) {
    if (text.includes(needle.text) && !hit.has(needle.sentinelId)) {
      hit.add(needle.sentinelId);
      findings.push({ sentinelId: needle.sentinelId, path, encoding: needle.encoding });
    }
  }
  return [...findings, ...panFindings(text, sentinels, anyPan, path)];
}

/** Scans any value (string, object graph, Buffer, Error, Map/Set). Cycle-safe and depth-bounded. */
export function scanForLeaks(subject: unknown, options: ScanOptions = {}): LeakFinding[] {
  const sentinels = options.sentinels ?? SENTINELS;
  const anyPan = options.anyPan ?? false;
  const maxDepth = options.maxDepth ?? 24;
  const needles = sentinels.flatMap(needlesFor);
  const seen = new WeakSet<object>();
  const findings: LeakFinding[] = [];

  const visit = (value: unknown, path: string, depth: number): void => {
    if (typeof value === 'string') {
      findings.push(...scanText(value, needles, sentinels, anyPan, path));
      return;
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      findings.push(...scanText(String(value), needles, sentinels, anyPan, path));
      return;
    }
    if (typeof value !== 'object' || value === null || depth > maxDepth || seen.has(value)) return;
    seen.add(value);
    if (Buffer.isBuffer(value)) {
      findings.push(...scanText(value.toString('utf8'), needles, sentinels, anyPan, path));
      return;
    }
    if (value instanceof Error) {
      visit(value.message, `${path}.message`, depth + 1);
      if (value.stack !== undefined) visit(value.stack, `${path}.stack`, depth + 1);
    }
    if (value instanceof Map) {
      let index = 0;
      for (const [key, entry] of value) {
        visit(key, `${path}.<key ${index}>`, depth + 1);
        visit(entry, `${path}.<value ${index}>`, depth + 1);
        index += 1;
      }
      return;
    }
    if (value instanceof Set || Array.isArray(value)) {
      let index = 0;
      for (const entry of value as Iterable<unknown>) {
        visit(entry, `${path}[${index}]`, depth + 1);
        index += 1;
      }
      return;
    }
    for (const key of Object.keys(value)) {
      findings.push(...scanText(key, needles, sentinels, anyPan, `${path} (key)`));
      visit((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
    }
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
  /** Complete captured lines so far (a trailing partial line is not included). */
  lines(): string[];
  clear(): void;
}

/** Collects what a logger writes; one entry per newline-terminated line. */
export function createLogCapture(): LogCapture {
  let pending = '';
  const complete: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const parts = pending.split('\n');
      pending = parts.pop() ?? '';
      complete.push(...parts.filter((line) => line.length > 0));
      callback();
    },
  });
  return {
    stream,
    destination: { write: (line: string) => void stream.write(line) },
    lines: () => [...complete],
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
 * One guard per test file: logs written to `guard.capture.stream` are scanned after EVERY test (registered
 * `afterEach`), so a test whose logs contain a sentinel fails by itself. Call it at describe/module level.
 */
export function useLeakageGuard(options: ScanOptions = {}): LeakageGuard {
  const capture = createLogCapture();
  const assertClean = (...extra: unknown[]): void => {
    const lines = capture.lines();
    const findings = [
      ...lines.flatMap((line, index) => scanForLeaks(line, options).map((finding) => ({ ...finding, path: `log line ${index + 1}` }))),
      ...scanForLeaks(extra, options),
    ];
    if (findings.length > 0) throw new LeakageError(findings);
  };
  afterEach(() => {
    try {
      assertClean();
    } finally {
      capture.clear();
    }
  });
  return { capture, assertClean };
}
