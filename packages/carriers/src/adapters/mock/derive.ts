/**
 * Identifiers of the Mock carrier, derived from the request (AT-US-122-03): the same client reference always gives the
 * same tracking number, which is how "one shipment per client reference" holds without any stored state. SHA-256 is
 * used as a plain deterministic mixing function, not for secrecy.
 */
import { createHash } from 'node:crypto';

const TRACKING_PATTERN = /^MOCK\d{12}$/u;
const PICKUP_PATTERN = /^MOCKPU\d{10}$/u;

/** `digits` decimal digits derived from the parts (a 64-bit prefix of the digest, reduced modulo 10^digits). */
function digitsOf(digits: number, parts: readonly string[]): string {
  const digest = createHash('sha256').update(parts.join('\u0000'), 'utf8').digest();
  const value = digest.readBigUInt64BE(0) % 10n ** BigInt(digits);
  return value.toString().padStart(digits, '0');
}

/** `MOCK` plus 12 digits, a pure function of the client reference (and of the package position beyond the first). */
export function trackingNumberFor(clientReference: string, seq = 1): string {
  return `MOCK${digitsOf(12, seq === 1 ? ['tracking', clientReference] : ['tracking', clientReference, String(seq)])}`;
}

export const isMockTrackingNumber = (value: unknown): value is string => typeof value === 'string' && TRACKING_PATTERN.test(value);

/** `MOCKPU` plus 10 digits, a pure function of the pickup details. */
export function pickupConfirmationFor(parts: readonly string[]): string {
  return `MOCKPU${digitsOf(10, ['pickup', ...parts])}`;
}

export const isMockPickupConfirmation = (value: unknown): value is string => typeof value === 'string' && PICKUP_PATTERN.test(value);

/** A service point id, `MOCKSP` plus 6 digits, from the search address and the point position. */
export function servicePointIdFor(countryCode: string, postalCode: string, position: number): string {
  return `MOCKSP${digitsOf(6, ['servicepoint', countryCode, postalCode, String(position)])}`;
}
