/**
 * Test helpers of the T-83 runtime twin (D-ARCH-106 (6); TASK-020 part 020-C (e)). Never imported by production code.
 *
 * The API test lanes build every tenant-transaction runner with `TEST_LANE_TX_IDLE_TIMEOUT_MS` as
 * `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS` (the configuration minimum; production keeps 15 000), so a transaction held
 * open across an external call that the lexical lint cannot see (a service in another file, dynamic dispatch) fails a
 * test instead of passing quietly. `tools/repo/test-lane-idle-timeout.test.ts` pins that no API-lane suite sets another
 * value.
 */
import { setTimeout as delay } from 'node:timers/promises';

/** `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS` of the API test lanes (D-ARCH-106 (6)). */
export const TEST_LANE_TX_IDLE_TIMEOUT_MS = 1_000;

/**
 * Stand-in for the Mock carrier's `latency` scenario (TASK-079 replaces it with the real Mock adapter): a rate call
 * that answers after `latencyMs`, honouring the caller's AbortSignal like every external client must.
 */
export function mockLatencyCarrier(latencyMs: number): { rate(shipmentId: string, signal?: AbortSignal): Promise<{ amount: number }> } {
  return {
    async rate(shipmentId, signal) {
      await delay(latencyMs, undefined, signal === undefined ? {} : { signal });
      return { amount: shipmentId.length * 100 };
    },
  };
}
