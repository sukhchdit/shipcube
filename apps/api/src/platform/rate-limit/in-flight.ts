/**
 * The in-flight half of the failed-authentication gate (R1-M1 of the part-B review; D-TASK041-18; ADR-0016 amendment 13
 * items 2 and 6; D-ARCH-225, D-ARCH-226; TASK-041 part 041-B). Step 0 reads the IP's settled failures from the store,
 * but a refusal is spent only once the authentication slot has answered, so a parallel burst would all read the same
 * count. This per-instance ledger holds one unit per credentialed request of an IP from its admission at step 0 until
 * the authentication outcome, and step 0 admits a request only while `settled + held < limit`. No store call is added.
 *
 * - The check and the hold are one synchronous step (called by the limiter right after the store reply), so on one
 *   instance at most `limit` authentications of an IP can be in flight or failed in one window.
 * - Release (D-ARCH-226, R2-M1): the authentication wrapper marks the holder as entered before it calls the slot. From
 *   then on only the slot's outcome releases the unit (after the spend has landed when the slot refused), whether or not
 *   the client is still connected: Express keeps running a request whose client has gone. The close of the response
 *   releases only a holder that was never entered (a 404, a body that never arrived, a refusal before the slot), and
 *   such a holder can no longer enter (D-TASK041-20). There is no timer: every authenticator is bounded by its own
 *   timeouts, and one that never answers shows as a unit that stays held.
 * - Several instances each admit up to the limit before the others' spends land: the bound per IP and window is
 *   replicas x `RATE_LIMIT_PUBLIC_PER_MIN` refused authentications (D-TASK041-18, R-ARCH-36 (d)).
 * - Memory: one entry per IP with a request in flight, deleted when its last hold is released; one weak entry per held
 *   response. Nothing outlives the requests.
 */

export interface InFlightLedger {
  /**
   * Admits one gated request of `key` when `settled + held(key) < limit`, and then holds one unit for `holder` until
   * the outcome ({@link InFlightLedger.release}) or, when the slot is never entered, the close
   * ({@link InFlightLedger.releaseUnentered}). A holder holds at most one unit; admitting it again holds nothing more,
   * and a holder the close already released is not admitted again.
   */
  admit(key: string, settled: number, limit: number, holder: object): boolean;
  /**
   * Marks the unit of `holder` as entered into the authentication slot, so that only its outcome releases it. False
   * when the close released the unit before the slot was reached (the client has gone): the caller must not
   * authenticate the request. A holder that never held a unit (a request step 0 did not gate) may enter.
   */
  enter(holder: object): boolean;
  /** The close of the response: releases the unit of `holder` unless it has entered the slot (idempotent). */
  releaseUnentered(holder: object): void;
  /** The outcome: releases the unit `holder` holds, entered or not (idempotent). */
  release(holder: object): void;
  /** The units held for `key` (0 when none). */
  held(key: string): number;
}

interface Unit {
  readonly key: string;
  entered: boolean;
}

/** A holder whose unit the close released before the slot: it is not admitted again and never enters. */
const GONE = Symbol('gone');

export function createInFlightLedger(): InFlightLedger {
  const counts = new Map<string, number>();
  const holders = new WeakMap<object, Unit | typeof GONE>();
  const held = (key: string): number => counts.get(key) ?? 0;
  const free = (key: string): void => {
    const remaining = held(key) - 1;
    if (remaining > 0) counts.set(key, remaining);
    else counts.delete(key);
  };
  return {
    held,
    admit(key, settled, limit, holder) {
      if (settled + held(key) >= limit) return false;
      const existing = holders.get(holder);
      if (existing !== undefined) return existing !== GONE;
      holders.set(holder, { key, entered: false });
      counts.set(key, held(key) + 1);
      return true;
    },
    enter(holder) {
      const unit = holders.get(holder);
      if (unit === GONE) return false;
      if (unit !== undefined) unit.entered = true;
      return true;
    },
    releaseUnentered(holder) {
      const unit = holders.get(holder);
      if (unit === undefined || unit === GONE || unit.entered) return;
      holders.set(holder, GONE);
      free(unit.key);
    },
    release(holder) {
      const unit = holders.get(holder);
      if (unit === undefined || unit === GONE) return;
      holders.delete(holder);
      free(unit.key);
    },
  };
}
