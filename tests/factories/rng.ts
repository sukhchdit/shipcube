/**
 * Seeded random numbers and run identity for the test factories (TEST-STRATEGY §10.1 rule 3; T-QA-03).
 *
 * `Math.random` is never used in tests: the same seed must give the same data on every run and machine. The generator
 * is mulberry32 (32-bit state, public domain algorithm) seeded from SHA-256 of a string, so any string is a valid seed
 * and nearby seeds are unrelated.
 */
import { createHash } from 'node:crypto';
import { relative, sep } from 'node:path';

import { expect } from '@jest/globals';

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] (both inclusive). */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** `length` lower-case hex characters. */
  hex(length: number): string;
  /** UUID-shaped identifier with the version-7 and variant bits set (valid for `isUuidV7`). */
  uuid(): string;
  /** An independent generator derived from this seed and `label` (consuming nothing from this one). */
  fork(label: string): Rng;
}

const seedOf = (seed: string): number => createHash('sha256').update(seed, 'utf8').digest().readUInt32LE(0);

export function createRng(seed: string | number): Rng {
  const root = String(seed);
  let state = seedOf(root) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new RangeError('rng.int: need integers with min <= max');
    return min + Math.floor(next() * (max - min + 1));
  };
  const hex = (length: number): string => {
    let out = '';
    while (out.length < length) out += Math.floor(next() * 16).toString(16);
    return out;
  };
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      const item = items[int(0, items.length - 1)];
      if (item === undefined) throw new RangeError('rng.pick: empty list');
      return item;
    },
    hex,
    uuid() {
      const raw = hex(32);
      const variant = (8 + int(0, 3)).toString(16);
      return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-7${raw.slice(13, 16)}-${variant}${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
    },
    fork: (label: string) => createRng(`${root}/${label}`),
  };
}

export interface RunIdentity {
  /** Short DNS-label-safe token, unique per (seed, worker, run token, test file): the `<run>` of `<run>.test.invalid`. */
  readonly run: string;
  /** `<run>.test.invalid`: every e-mail address of the factories ends in `@` + this (`.invalid` never resolves, RFC 6761). */
  readonly emailDomain: string;
}

export interface RunIdentityOptions {
  readonly seed: string | number;
  /** Jest worker id (default `JEST_WORKER_ID`, else `0`): parallel workers get different domains for the same seed. */
  readonly workerId?: string;
  /** Distinguishes separate runs sharing a database (default `TEST_RUN_ID`, else empty). */
  readonly runToken?: string;
  /**
   * Test file folded into the run (default: the current Jest test file relative to the working directory, else empty).
   * Lane B runs integration, api and generated in band, so every file has `JEST_WORKER_ID` 1: without the file, two
   * files using the same seed would create the same ids, e-mails and slugs in a shared database (PR #34 R1-m6).
   */
  readonly testFile?: string;
}

/** The running Jest test file, `/`-separated and relative to the working directory; empty outside a test file. */
function currentTestFile(): string {
  const testPath = expect.getState().testPath;
  return typeof testPath === 'string' && testPath !== '' ? relative(process.cwd(), testPath).split(sep).join('/') : '';
}

export function runIdentity(options: RunIdentityOptions): RunIdentity {
  const workerId = options.workerId ?? process.env['JEST_WORKER_ID'] ?? '0';
  const token = options.runToken ?? process.env['TEST_RUN_ID'] ?? '';
  const testFile = options.testFile ?? currentTestFile();
  const run = `r${createHash('sha256')
    .update(`${String(options.seed)}|w${workerId}|${token}|f${testFile}`, 'utf8')
    .digest('hex')
    .slice(0, 10)}`;
  return { run, emailDomain: `${run}.test.invalid` };
}
