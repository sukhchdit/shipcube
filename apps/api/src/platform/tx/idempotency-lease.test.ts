// The idempotency lease (ADR-0014 amendment 10, D-ARCH-200; PR040-SEC-04 = TASK-040 code review R2-n1; part 040-B):
// lease = max(30 s, max(D + T, 3 × T + FAILED entry wait) + 5 s), T = admission wait + maxWait + timeout.
import { describe, expect, it } from '@jest/globals';
import { DB_TENANT_ADMISSION_WAIT_MS_DEFAULT, DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT, DB_TX_TIMEOUT_BOUNDS } from '@platform/config';

import { DEFAULT_MAX_WAIT_MS } from '../db/index.js';
import { IDEMPOTENCY_LEASE_MS } from '../idempotency/store.js';
import { CALL_DEADLINE_MS, FAILED_ENTRY_WAIT_MS, idempotencyLeaseMs, LEASE_SKEW_MARGIN_MS } from './execute.js';

const SECOND = 1_000;

/** The stretches of ADR-0014 amendment 10 for one transaction bound T. */
const stretches = (oneTransaction: number) => ({
  // renewal (or claim) -> `call` (at most D) -> the renewal that ends the stretch.
  call: CALL_DEADLINE_MS + oneTransaction,
  // last renewal -> rolled-back handler transaction -> FAILED entry wait -> completion or release.
  failure: 2 * oneTransaction + FAILED_ENTRY_WAIT_MS,
  // last renewal -> read-only handler transaction -> VIEW / DOWNLOAD entry -> completion or release.
  readOnly: 3 * oneTransaction,
  // claim -> `load` transaction -> renewal (or the handler transaction of a route without `call`).
  load: 3 * oneTransaction,
});

describe('[PR040-SEC-04] [R2-n1] idempotency lease sizing (ADR-0014 amendment 10)', () => {
  it('is 32.25 s at the defaults (D = 20 s, T = 0.25 + 2 + 5 s)', () => {
    const lease = idempotencyLeaseMs(
      { maxWait: DEFAULT_MAX_WAIT_MS, timeout: DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT },
      CALL_DEADLINE_MS,
      DB_TENANT_ADMISSION_WAIT_MS_DEFAULT,
    );
    expect([DEFAULT_MAX_WAIT_MS, DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT, DB_TENANT_ADMISSION_WAIT_MS_DEFAULT, CALL_DEADLINE_MS]).toEqual([
      2_000, 5_000, 250, 20_000,
    ]);
    expect(lease).toBe(32_250);
  });

  // The table of PR040-SEC-04: statement timeouts of 5, 8, 9, 12 and 120 s (the transaction timeout defaults to it).
  it.each([5, 8, 9, 12, 120])('statement timeout %i s: lease minus every stretch is at least the 5 s margin', (seconds) => {
    const timeout = seconds * SECOND;
    for (const admissionWait of [DB_TENANT_ADMISSION_WAIT_MS_DEFAULT, DEFAULT_MAX_WAIT_MS]) {
      const lease = idempotencyLeaseMs({ maxWait: DEFAULT_MAX_WAIT_MS, timeout }, CALL_DEADLINE_MS, admissionWait);
      const oneTransaction = admissionWait + DEFAULT_MAX_WAIT_MS + timeout;
      for (const [path, stretch] of Object.entries(stretches(oneTransaction))) {
        expect([path, lease - stretch >= LEASE_SKEW_MARGIN_MS]).toEqual([path, true]);
      }
      expect(lease).toBeGreaterThanOrEqual(IDEMPOTENCY_LEASE_MS);
    }
  });

  it('pins the formula on both branches and the 30 s floor', () => {
    // Call path decides: 20 + (0.25 + 2 + 5) + 5 = 32.25 s (3T + 1 s = 22.75 s).
    expect(idempotencyLeaseMs({ maxWait: 2_000, timeout: 5_000 }, 20_000, 250)).toBe(32_250);
    // Transaction path decides: 3 × (0.25 + 2 + 12) + 1 + 5 = 48.75 s (D + T = 34.25 s).
    expect(idempotencyLeaseMs({ maxWait: 2_000, timeout: 12_000 }, 20_000, 250)).toBe(48_750);
    // The largest budget the configuration accepts.
    const timeout = DB_TX_TIMEOUT_BOUNDS.DB_TX_STATEMENT_TIMEOUT_MS.max;
    expect(idempotencyLeaseMs({ maxWait: 10_000, timeout }, CALL_DEADLINE_MS, 10_000)).toBe(
      3 * (20_000 + timeout) + FAILED_ENTRY_WAIT_MS + LEASE_SKEW_MARGIN_MS,
    );
    expect(idempotencyLeaseMs({ maxWait: 1, timeout: 1 }, 90_000, 1)).toBe(90_003 + LEASE_SKEW_MARGIN_MS);
    expect(idempotencyLeaseMs({ maxWait: 1, timeout: 1 }, 1, 1)).toBe(IDEMPOTENCY_LEASE_MS);
  });

  it('without the configured admission wait, its validated upper bound maxWait is counted (a longer lease, never shorter)', () => {
    const options = { maxWait: DEFAULT_MAX_WAIT_MS, timeout: 12_000 };
    expect(idempotencyLeaseMs(options, CALL_DEADLINE_MS)).toBe(idempotencyLeaseMs(options, CALL_DEADLINE_MS, DEFAULT_MAX_WAIT_MS));
    expect(idempotencyLeaseMs(options, CALL_DEADLINE_MS)).toBeGreaterThan(
      idempotencyLeaseMs(options, CALL_DEADLINE_MS, DB_TENANT_ADMISSION_WAIT_MS_DEFAULT),
    );
  });
});
