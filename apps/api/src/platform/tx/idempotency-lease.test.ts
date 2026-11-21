// The idempotency lease (ADR-0014 amendment 10 as corrected by amendment 18; D-ARCH-200, D-ARCH-232; PR040-SEC-04 =
// TASK-040 code review R2-n1, PR040-SEC-10 = part 040-B code review R1-m1):
// lease = max(30 s, timeout + max(D + T, 3 × T) + FAILED entry wait + 5 s), T = admission wait + maxWait + timeout.
import { describe, expect, it } from '@jest/globals';
import { DB_TENANT_ADMISSION_WAIT_MS_DEFAULT, DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT, DB_TX_TIMEOUT_BOUNDS } from '@platform/config';
import fc from 'fast-check';

import { DEFAULT_MAX_WAIT_MS } from '../db/index.js';
import { IDEMPOTENCY_LEASE_MS } from '../idempotency/store.js';
import { CALL_DEADLINE_MS, FAILED_ENTRY_WAIT_MS, idempotencyLeaseMs, LEASE_SKEW_MARGIN_MS } from './execute.js';

const SECOND = 1_000;

/**
 * The six stretches of ADR-0014 amendment 18, each counted from the clock reading of a write of `lease_until`: the rest
 * of the writing transaction (`timeout`), then every later transaction with its full bound T, the one that ends the
 * stretch included, the call deadline D where there is a `call`, and the FAILED entry wait F where a failure comes
 * before the completion.
 */
const stretches = (timeout: number, oneTransaction: number, callDeadline: number) => ({
  // claim or renewal -> `load` transaction -> the renewal that follows it.
  load: timeout + 2 * oneTransaction,
  // renewal -> `call` (at most D) -> the renewal before the handler transaction.
  call: timeout + callDeadline + oneTransaction,
  // renewal -> `call` failing with a stored 4xx -> FAILED entry wait -> the completion of its 4xx.
  failedCall: timeout + callDeadline + FAILED_ENTRY_WAIT_MS + oneTransaction,
  // renewal -> the handler transaction of a writing route, which completes the key inside it.
  handler: timeout + oneTransaction,
  // renewal -> `load` or handler transaction failing with a stored 4xx -> FAILED entry wait -> the completion.
  failure: timeout + 2 * oneTransaction + FAILED_ENTRY_WAIT_MS,
  // renewal -> read-only handler transaction -> fail-closed VIEW / DOWNLOAD entry -> the completion.
  readOnly: timeout + 3 * oneTransaction,
});

/** The stretches whose margin (lease minus stretch) is below {@link LEASE_SKEW_MARGIN_MS}; empty when the lease holds. */
const shortStretches = (maxWait: number, timeout: number, callDeadline: number, admissionWait: number): string[] => {
  const lease = idempotencyLeaseMs({ maxWait, timeout }, callDeadline, admissionWait);
  const oneTransaction = admissionWait + maxWait + timeout;
  return Object.entries(stretches(timeout, oneTransaction, callDeadline))
    .filter(([, stretch]) => lease - stretch < LEASE_SKEW_MARGIN_MS)
    .map(([path]) => path);
};

describe('[PR040-SEC-04] [PR040-SEC-10] idempotency lease sizing (ADR-0014 amendment 18)', () => {
  it('is 38.25 s at the defaults (D = 20 s, timeout = 5 s, T = 0.25 + 2 + 5 s)', () => {
    const lease = idempotencyLeaseMs(
      { maxWait: DEFAULT_MAX_WAIT_MS, timeout: DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT },
      CALL_DEADLINE_MS,
      DB_TENANT_ADMISSION_WAIT_MS_DEFAULT,
    );
    expect([DEFAULT_MAX_WAIT_MS, DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT, DB_TENANT_ADMISSION_WAIT_MS_DEFAULT, CALL_DEADLINE_MS]).toEqual([
      2_000, 5_000, 250, 20_000,
    ]);
    expect(lease).toBe(38_250);
  });

  // Statement timeouts of 5, 6, 7, 8, 9, 12 and 120 s (the transaction timeout defaults to it), each with the configured
  // admission wait and with its upper bound maxWait.
  it.each([5, 6, 7, 8, 9, 12, 120])(
    'statement timeout %i s: lease minus each of the six stretches is at least the 5 s margin',
    (seconds) => {
      const timeout = seconds * SECOND;
      for (const admissionWait of [DB_TENANT_ADMISSION_WAIT_MS_DEFAULT, DEFAULT_MAX_WAIT_MS]) {
        expect([admissionWait, shortStretches(DEFAULT_MAX_WAIT_MS, timeout, CALL_DEADLINE_MS, admissionWait)]).toEqual([admissionWait, []]);
        const lease = idempotencyLeaseMs({ maxWait: DEFAULT_MAX_WAIT_MS, timeout }, CALL_DEADLINE_MS, admissionWait);
        expect(lease).toBeGreaterThanOrEqual(IDEMPOTENCY_LEASE_MS);
      }
    },
  );

  it('over the configuration bounds: every stretch keeps the 5 s margin, the floor holds, and the formula is exact above it', () => {
    const bounds = DB_TX_TIMEOUT_BOUNDS.DB_TX_STATEMENT_TIMEOUT_MS;
    const input = fc.integer({ min: 1, max: 120_000 }).chain((maxWait) =>
      fc.record({
        maxWait: fc.constant(maxWait),
        admissionWait: fc.integer({ min: 1, max: maxWait }),
        timeout: fc.integer({ min: bounds.min, max: bounds.max }),
        callDeadline: fc.integer({ min: 1, max: 120_000 }),
      }),
    );
    fc.assert(
      fc.property(input, ({ maxWait, admissionWait, timeout, callDeadline }) => {
        const lease = idempotencyLeaseMs({ maxWait, timeout }, callDeadline, admissionWait);
        const oneTransaction = admissionWait + maxWait + timeout;
        const formula = timeout + Math.max(callDeadline + oneTransaction, 3 * oneTransaction) + FAILED_ENTRY_WAIT_MS + LEASE_SKEW_MARGIN_MS;
        expect(shortStretches(maxWait, timeout, callDeadline, admissionWait)).toEqual([]);
        expect(lease).toBeGreaterThanOrEqual(IDEMPOTENCY_LEASE_MS);
        if (formula > IDEMPOTENCY_LEASE_MS) expect(lease).toBe(formula);
      }),
      { numRuns: 2_000 },
    );
  });

  it('pins the formula on both branches and the 30 s floor', () => {
    // Call path decides: 5 + (20 + 7.25) + 1 + 5 = 38.25 s (3T = 21.75 s).
    expect(idempotencyLeaseMs({ maxWait: 2_000, timeout: 5_000 }, 20_000, 250)).toBe(38_250);
    // Transaction path decides: 12 + 3 × (0.25 + 2 + 12) + 1 + 5 = 60.75 s (D + T = 34.25 s).
    expect(idempotencyLeaseMs({ maxWait: 2_000, timeout: 12_000 }, 20_000, 250)).toBe(60_750);
    // The largest statement timeout the configuration accepts: 120 + 3 × 140 + 1 + 5 = 546 s.
    expect(DB_TX_TIMEOUT_BOUNDS.DB_TX_STATEMENT_TIMEOUT_MS.max).toBe(120_000);
    expect(idempotencyLeaseMs({ maxWait: 10_000, timeout: 120_000 }, CALL_DEADLINE_MS, 10_000)).toBe(546_000);
    // A call deadline above every transaction term: 0.001 + 90.003 + 1 + 5 = 96.004 s.
    expect(idempotencyLeaseMs({ maxWait: 1, timeout: 1 }, 90_000, 1)).toBe(96_004);
    expect(idempotencyLeaseMs({ maxWait: 1, timeout: 1 }, 1, 1)).toBe(IDEMPOTENCY_LEASE_MS);
    expect(IDEMPOTENCY_LEASE_MS).toBe(30_000);
  });

  it('without the configured admission wait, its validated upper bound maxWait is counted (a longer lease, never shorter)', () => {
    const options = { maxWait: DEFAULT_MAX_WAIT_MS, timeout: 12_000 };
    expect(idempotencyLeaseMs(options, CALL_DEADLINE_MS)).toBe(idempotencyLeaseMs(options, CALL_DEADLINE_MS, DEFAULT_MAX_WAIT_MS));
    expect(idempotencyLeaseMs(options, CALL_DEADLINE_MS)).toBeGreaterThan(
      idempotencyLeaseMs(options, CALL_DEADLINE_MS, DB_TENANT_ADMISSION_WAIT_MS_DEFAULT),
    );
    // As part 040-B's first pull request composes it (no admission wait passed): 5 + 20 + 9 + 1 + 5 = 40 s.
    expect(idempotencyLeaseMs({ maxWait: DEFAULT_MAX_WAIT_MS, timeout: DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT }, CALL_DEADLINE_MS)).toBe(
      40_000,
    );
  });
});
