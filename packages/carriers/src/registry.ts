/**
 * The adapter registry (REQ-CARR-001/002, ADR-0010 §Interface). Built once at start-up from the adapters the
 * composition root enables (the Mock only when `MOCK_CARRIER_ENABLED`, REQ-CARR-006, decided by the caller); every
 * adapter passes `guardAdapter`, so a missing required operation or a malformed capability declaration stops start-up
 * with a message naming each defect (AT-US-121-06), and every adapter handed out is the guarded facade. Canonical
 * service codes are unique across carriers too (`DHL` + `EXPRESS_P` would equal `DHL_EXPRESS` + `P`).
 */
import type { CarrierAdapter, GuardedCarrierAdapter } from './adapter.js';
import { isCarrierCode } from './canonical/codes.js';
import { CarrierContractError } from './errors.js';
import { guardAdapter, type GuardOptions } from './guard.js';

export interface CarrierRegistry {
  /** Registered carrier codes, in registration order. */
  readonly codes: readonly string[];
  has(code: string): boolean;
  /** The guarded adapter of `code`; throws `CarrierContractError` for an unregistered code. */
  get(code: string): GuardedCarrierAdapter;
}

/** Registers every adapter or none: all defects of all adapters are reported in one `CarrierContractError`. */
export function createCarrierRegistry(adapters: Iterable<CarrierAdapter>, options: GuardOptions = {}): CarrierRegistry {
  const byCode = new Map<string, GuardedCarrierAdapter>();
  const serviceOwner = new Map<string, string>();
  const issues: string[] = [];
  for (const adapter of adapters) {
    try {
      const guarded = guardAdapter(adapter, options);
      if (byCode.has(guarded.code)) {
        issues.push(`carrier ${guarded.code} is registered twice`);
        continue;
      }
      byCode.set(guarded.code, guarded);
      for (const { canonicalCode } of guarded.capabilities().services) {
        const owner = serviceOwner.get(canonicalCode);
        if (owner === undefined) serviceOwner.set(canonicalCode, guarded.code);
        else issues.push(`canonical service code ${canonicalCode} is declared by ${owner} and ${guarded.code}`);
      }
    } catch (error) {
      if (!(error instanceof CarrierContractError)) throw error;
      issues.push(error.message);
    }
  }
  if (issues.length > 0) throw new CarrierContractError('carrier registration failed', issues);

  const codes = Object.freeze([...byCode.keys()]);
  return Object.freeze({
    codes,
    has: (code: string) => byCode.has(code),
    get: (code: string) => {
      const adapter = byCode.get(code);
      if (adapter === undefined) {
        // The requested code may come from a request: it is echoed only in the carrier-code shape (PR075-SEC-08).
        throw new CarrierContractError('unknown carrier', [
          `no adapter is registered for ${isCarrierCode(code) ? code : '(invalid code)'}`,
        ]);
      }
      return adapter;
    },
  });
}
