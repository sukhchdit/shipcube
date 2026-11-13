/**
 * Sentinel PII and secret values (TEST-STRATEGY §10.1 rule 4; NFR-PRIV-001; T-QA-03).
 *
 * A fixed set of recognisable strings that redaction, log-scan and PAN-scanner tests inject on purpose. Their presence
 * anywhere in logs, audit values, notification logs or raw payload objects fails the test (leakage-scanner.ts).
 *
 * The values are DERIVED at load time from a label with SHA-256, never written out as literals: the source tree holds
 * no credential-shaped string for the secret scanners to flag, and the values are still identical in every process
 * (workers, reruns), which is what makes a leak reproducible. They are synthetic by construction.
 */
import { createHash } from 'node:crypto';

export type SentinelKind = 'name' | 'email' | 'taxid' | 'token' | 'secret' | 'pan';

export interface Sentinel {
  /** Stable identifier used in findings and failure messages (the value itself is never reported). */
  readonly id: string;
  readonly kind: SentinelKind;
  readonly value: string;
}

/** Domain of every synthetic e-mail address; `.invalid` never resolves (RFC 6761). */
export const SENTINEL_EMAIL_DOMAIN = 'sentinel.test.invalid';

const digest = (label: string): string => createHash('sha256').update(`sentinel:${label}`, 'utf8').digest('hex');

/** Luhn check digit for a numeric payload (all digits except the final check digit). */
export function luhnCheckDigit(payload: string): string {
  let sum = 0;
  // Walk right to left over the payload; the first payload digit from the right is doubled (the check digit is not there yet).
  for (let i = payload.length - 1, double = true; i >= 0; i -= 1, double = !double) {
    let digit = Number(payload[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return String((10 - (sum % 10)) % 10);
}

/** True when `digits` (only 0-9) passes the Luhn check. */
export function isLuhnValid(digits: string): boolean {
  if (!/^[0-9]{2,}$/.test(digits)) return false;
  return luhnCheckDigit(digits.slice(0, -1)) === digits.slice(-1);
}

/** A 16-digit, Luhn-valid, `4242` style PAN derived from the label (negative tests only). */
function derivedPan(label: string): string {
  const hex = digest(label);
  let middle = '';
  for (let i = 0; middle.length < 9; i += 1) middle += String(parseInt(hex.charAt(i), 16) % 10);
  const payload = `424242${middle}`;
  return `${payload}${luhnCheckDigit(payload)}`;
}

const make = (id: string, kind: SentinelKind, value: string): Sentinel => Object.freeze({ id, kind, value });
const tag = (label: string): string => digest(label).slice(0, 16).toUpperCase();

/** The fixed sentinel set. Order is stable; ids are unique. */
export const SENTINELS: readonly Sentinel[] = Object.freeze([
  make('SENTINEL_NAME', 'name', `SENTINEL_NAME_${tag('name')}`),
  make('SENTINEL_EMAIL', 'email', `sentinel-${tag('email').toLowerCase()}@${SENTINEL_EMAIL_DOMAIN}`),
  make('SENTINEL_TAXID', 'taxid', `SENTINEL_TAXID_${tag('taxid')}`),
  make('SENTINEL_TOKEN', 'token', `SENTINEL_TOKEN_${tag('token')}`),
  make('SENTINEL_SECRET', 'secret', `SENTINEL_SECRET_${tag('secret')}`),
  make('SENTINEL_PAN', 'pan', derivedPan('pan')),
]);

/** Looks a sentinel up by id; throws on an unknown id so a typo cannot silently scan for nothing. */
export function sentinel(id: string): Sentinel {
  const found = SENTINELS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`unknown sentinel id: ${id}`);
  return found;
}
