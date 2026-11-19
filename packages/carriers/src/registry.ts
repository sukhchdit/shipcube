/**
 * The adapter registry (REQ-CARR-001/002, ADR-0010 §Interface). Built once at start-up from the adapters the
 * composition root enables (the Mock only when `MOCK_CARRIER_ENABLED`, REQ-CARR-006, decided by the caller); every
 * adapter passes `guardAdapter`, so a missing required operation or a malformed capability declaration stops start-up
 * with a message naming each defect (AT-US-121-06), and every adapter handed out is the guarded facade.
 */
import type { CarrierAdapter, GuardedCarrierAdapter } from './adapter.js';
import { CarrierContractError } from './errors.js';
import { guardAdapter } from './guard.js';

export interface CarrierRegistry {
  /** Registered carrier codes, in registration order. */
  readonly codes: readonly string[];
  has(code: string): boolean;
  /** The guarded adapter of `code`; throws `CarrierContractError` for an unregistered code. */
  get(code: string): GuardedCarrierAdapter;
}

/** Registers every adapter or none: all defects of all adapters are reported in one `CarrierContractError`. */
export function createCarrierRegistry(adapters: Iterable<CarrierAdapter>): CarrierRegistry {
  const byCode = new Map<string, GuardedCarrierAdapter>();
  const issues: string[] = [];
  for (const adapter of adapters) {
    try {
      const guarded = guardAdapter(adapter);
      if (byCode.has(guarded.code)) issues.push(`carrier ${guarded.code} is registered twice`);
      else byCode.set(guarded.code, guarded);
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
      if (adapter === undefined) throw new CarrierContractError('unknown carrier', [`no adapter is registered for ${code}`]);
      return adapter;
    },
  });
}
