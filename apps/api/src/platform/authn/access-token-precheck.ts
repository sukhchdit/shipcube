/**
 * The `exp` pre-check of a bearer access token (ADR-0016 amendment 13 item 3, conditions E1 to E5; D-ARCH-182,
 * D-SECPR041-02, PR041-SEC-02; built by TASK-041 part 041-B for the session authenticator of TASK-052). The session
 * authenticator may refuse an expired token before it verifies the signature only through this function:
 * - E3, bounded: at most {@link ACCESS_TOKEN_MAX_LENGTH} characters, three non-empty base64url segments, and the
 *   protected header's `alg` equal to `ES256`, all checked before the payload is decoded;
 * - E2: only a well-formed token whose `exp` is a finite number in the past (with the same clock tolerance as the
 *   verification) is `expired`; a missing, non-numeric, non-finite or out-of-range `exp`, or a malformed structure, is
 *   `malformed`, which the authenticator answers 401 `AUTH_REQUIRED` and which spends the failed-authentication budget;
 * - E1: the unverified payload serves this one decision; nothing else of it is read, returned or logged. `verify` means
 *   the caller verifies the token in full (algorithms `ES256` only, issuer, audience, the same tolerance);
 * - E4: `expired` is answered 401 `ACCESS_TOKEN_EXPIRED` with no security event; the wrapper's exemption keys on that
 *   code alone (rate-limit/authn-failed.ts).
 * Pure: no I/O and no clock of its own. An early refusal can only reject, never accept, so it is no signature oracle.
 */

/** Longest token the pre-check decodes (a compact ES256 access token of this platform is well under 1 KiB). */
export const ACCESS_TOKEN_MAX_LENGTH = 4096;

/** The largest `exp` in range: 9999-12-31T23:59:59Z in seconds. */
export const MAX_NUMERIC_DATE = 253_402_300_799;

export type AccessTokenPrecheck = 'expired' | 'verify' | 'malformed';

/** One compact-serialisation segment: base64url without padding, never empty. */
const SEGMENT = /^[A-Za-z0-9_-]+$/u;

/** The JSON object a segment encodes, or undefined (not JSON, or not a plain object). */
function decodeObject(segment: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Classifies `token` (the bearer value, without the scheme) at `nowSeconds` with `toleranceSeconds` of clock skew, as
 * the verification would: expired when `exp <= now - tolerance`. `nowSeconds` is whole seconds, as jose's `epoch()`
 * (`Math.floor(Date.now() / 1000)`); a fractional clock would move the expired boundary against the verification.
 */
export function precheckAccessToken(token: string, nowSeconds: number, toleranceSeconds: number): AccessTokenPrecheck {
  if (token.length === 0 || token.length > ACCESS_TOKEN_MAX_LENGTH) return 'malformed';
  const segments = token.split('.');
  if (segments.length !== 3 || !segments.every((segment) => SEGMENT.test(segment))) return 'malformed';
  const [header = '', payload = ''] = segments;
  if (decodeObject(header)?.['alg'] !== 'ES256') return 'malformed';
  const exp = decodeObject(payload)?.['exp'];
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp < 0 || exp > MAX_NUMERIC_DATE) return 'malformed';
  return exp <= nowSeconds - toleranceSeconds ? 'expired' : 'verify';
}
