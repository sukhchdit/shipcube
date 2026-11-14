/**
 * T-83 runtime twin, lane setting (D-ARCH-106 (6); TASK-020 part 020-C (e)): every suite of the API test lanes
 * (`*.int.test.ts`, `*.api.test.ts`) that serves requests through `createApp` and builds a configuration with
 * `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS` uses the shared `TEST_LANE_TX_IDLE_TIMEOUT_MS` (1 000 ms,
 * apps/api/src/platform/tx/tests/runtime-twin.ts), so a route that holds a transaction open across an external call
 * fails a test. The lanes load no configuration from the environment: each suite builds its own, which is why the value
 * is pinned here rather than in a lane environment variable. Runner-level suites that do not serve routes (admission,
 * session integrity) keep the value their scenario needs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { listRepositoryFiles } from '../lint/check-suppressions.mjs';
import { findRepoRoot } from '../test-support/process.js';

/** The helper that defines the lane value (read as text: tools/ does not import apps/ sources). */
const TWIN_HELPER = 'apps/api/src/platform/tx/tests/runtime-twin.ts';
const LANE_SUITE = /\.(?:int|api)\.test\.tsx?$/u;
/** `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: <value>` as a property or `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS=<value>` in a string. */
const SETTING = /DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS\s*[:=]\s*['"]?([^,\s'"}]+)/gu;

/** `path: value` for every setting of the key in `text` that is not the shared constant. */
function otherValues(text: string, path: string): string[] {
  return [...text.matchAll(SETTING)]
    .map((match) => match[1] ?? '')
    .filter((value) => value !== 'TEST_LANE_TX_IDLE_TIMEOUT_MS')
    .map((value) => `${path}: ${value}`);
}

describe('[D-ARCH-106 (6)] the API test lanes run with the low idle-in-transaction timeout', () => {
  it('the lane value is the configuration minimum, far below production (15 000)', () => {
    const helper = readFileSync(join(findRepoRoot(), TWIN_HELPER), 'utf8');
    expect(helper).toMatch(/^export const TEST_LANE_TX_IDLE_TIMEOUT_MS = 1_000;$/mu);
  });

  it('seeded defects are caught; the constant is not', () => {
    expect(otherValues('const c = { DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000 };', 'x.int.test.ts')).toEqual(['x.int.test.ts: 15_000']);
    expect(otherValues("env: 'DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS=15000'", 'x.api.test.ts')).toEqual(['x.api.test.ts: 15000']);
    expect(otherValues('{ DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: TEST_LANE_TX_IDLE_TIMEOUT_MS }', 'x.int.test.ts')).toEqual([]);
  });

  it('no API-lane suite sets another DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS', () => {
    const root = findRepoRoot();
    const suites = listRepositoryFiles(root).filter(
      (path) => LANE_SUITE.test(path) && existsSync(join(root, path)) && readFileSync(join(root, path), 'utf8').includes('createApp('),
    );
    expect(suites.length).toBeGreaterThan(0);
    const found = suites.flatMap((path) => otherValues(readFileSync(join(root, path), 'utf8'), path));
    expect(found).toEqual([]);
    // At least the runner suites use it (the guard is not vacuous).
    const users = suites.filter((path) =>
      readFileSync(join(root, path), 'utf8').includes('DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: TEST_LANE_TX_IDLE_TIMEOUT_MS'),
    );
    expect(users).toEqual(
      expect.arrayContaining([
        'apps/api/src/platform/tx/route-phases.int.test.ts',
        'apps/api/src/platform/tx/runner-activation.int.test.ts',
      ]),
    );
  });
});
