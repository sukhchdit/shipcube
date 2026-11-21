/**
 * The in-flight half of the failed-authentication gate (R1-M1 of the part-B review; D-TASK041-18; ADR-0016 amendment 13
 * item 2; TASK-041 part 041-B). Step 0 reads the IP's settled failures from the store, but a refusal is spent only once
 * the authentication slot has answered, so a parallel burst would all read the same count. This per-instance ledger
 * holds one unit per credentialed request of an IP from its admission at step 0 until the slot's outcome is known (or
 * the response closes), and step 0 admits a request only while `settled + held < limit`. No store call is added.
 *
 * - The check and the hold are one synchronous step (called by the limiter right after the store reply), so on one
 *   instance at most `limit` authentications of an IP can be in flight or failed in one window.
 * - Several instances each admit up to the limit before the others' spends land: the bound per IP and window is
 *   replicas x `RATE_LIMIT_PUBLIC_PER_MIN` refused authentications (D-TASK041-18, R-ARCH-36 (d)).
 * - Memory: one entry per IP with a request in flight, deleted when its last hold is released; one weak entry per held
 *   response. Nothing outlives the requests.
 */

export interface InFlightLedger {
  /**
   * Admits one gated request of `key` when `settled + held(key) < limit`, and then holds one unit for `holder` until
   * {@link InFlightLedger.release}. A holder holds at most one unit; admitting it again holds nothing more.
   */
  admit(key: string, settled: number, limit: number, holder: object): boolean;
  /** Releases the unit `holder` holds, if any (idempotent). */
  release(holder: object): void;
  /** The units held for `key` (0 when none). */
  held(key: string): number;
}

export function createInFlightLedger(): InFlightLedger {
  const counts = new Map<string, number>();
  const holders = new WeakMap<object, string>();
  const held = (key: string): number => counts.get(key) ?? 0;
  return {
    held,
    admit(key, settled, limit, holder) {
      if (settled + held(key) >= limit) return false;
      if (holders.has(holder)) return true;
      holders.set(holder, key);
      counts.set(key, held(key) + 1);
      return true;
    },
    release(holder) {
      const key = holders.get(holder);
      if (key === undefined) return;
      holders.delete(holder);
      const remaining = held(key) - 1;
      if (remaining > 0) counts.set(key, remaining);
      else counts.delete(key);
    },
  };
}
