// The idempotency lease covers the longest phase between two renewals (TASK-040 fix cycle 1, code review m4).
import { describe, expect, it } from '@jest/globals';
import { DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT, DB_TX_TIMEOUT_BOUNDS } from '@platform/config';

import { DEFAULT_MAX_WAIT_MS } from '../db/index.js';
import { IDEMPOTENCY_LEASE_MS } from '../idempotency/store.js';
import { CALL_DEADLINE_MS, FAILED_ENTRY_WAIT_MS, idempotencyLeaseMs, LEASE_SKEW_MARGIN_MS } from './execute.js';

describe('[m4] idempotency lease sizing', () => {
  it('with the default budgets the lease outlives the 20 s call deadline plus the skew margin', () => {
    const lease = idempotencyLeaseMs({ maxWait: DEFAULT_MAX_WAIT_MS, timeout: DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT }, CALL_DEADLINE_MS);
    expect(lease).toBeGreaterThanOrEqual(IDEMPOTENCY_LEASE_MS);
    expect(lease).toBeGreaterThan(CALL_DEADLINE_MS + LEASE_SKEW_MARGIN_MS - 1);
    // The handler stretch: its transaction, the FAILED entry wait and the completion transaction.
    expect(lease).toBeGreaterThan(2 * (DEFAULT_MAX_WAIT_MS + DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT) + FAILED_ENTRY_WAIT_MS);
  });

  it('grows with the configured transaction budget, up to the largest the configuration accepts', () => {
    const timeout = DB_TX_TIMEOUT_BOUNDS.DB_TX_STATEMENT_TIMEOUT_MS.max;
    const lease = idempotencyLeaseMs({ maxWait: 10_000, timeout }, CALL_DEADLINE_MS);
    expect(lease).toBe(2 * (10_000 + timeout) + FAILED_ENTRY_WAIT_MS + LEASE_SKEW_MARGIN_MS);
    expect(idempotencyLeaseMs({ maxWait: 1, timeout: 1 }, 90_000)).toBe(90_000 + LEASE_SKEW_MARGIN_MS);
    expect(idempotencyLeaseMs({ maxWait: 1, timeout: 1 }, 1)).toBe(IDEMPOTENCY_LEASE_MS);
  });
});
