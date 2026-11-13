/**
 * Credential presence (D-ARCH-107 (5), ADR-0008 am. 4; TASK-020). Whether a request PRESENTS a credential: an
 * `Authorization` header, a refresh cookie (`__Host-rt_web`, `__Host-rt_admin`; openapi.yaml `refreshCookieWeb`,
 * `refreshCookieAdmin`) or an `X-Quote-Token` header. Presence only, never validity: verifying a credential is the job
 * of the authenticators (TASK-052, 055, 091). One predicate for the API (the authn stub never silently ignores a
 * credential on an anonymous-capable route; the problem handler answers `private, no-store` to any request that
 * presented one, errors raised before the route is known included) and for the SEC-TC-29 contract helper and stubs
 * (PR32-SEC-06 (a)). Pure; header names lower-case, as Node delivers them.
 *
 * Pending ruling (code review R2-m4, PR32-SEC-16): counting refresh-cookie presence as a credential on EVERY route is
 * the TASK-020 stub reading of D-ARCH-107 (5). ADR-0006 R-06 says the `Path=/` refresh cookie is read only by
 * `/auth/refresh` and `/auth/logout` and ignored elsewhere. principal-architect reconciles the two before TASK-052/055;
 * until then the real authenticators must not inherit "cookie present, so refuse" on routes whose set lacks
 * `refresh-cookie` (marking such responses `private, no-store` stays harmless).
 */

/** Request headers as Node's `IncomingHttpHeaders` delivers them (lower-case names). */
export type CredentialHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

export const REFRESH_COOKIE_NAMES: readonly string[] = Object.freeze(['__Host-rt_web', '__Host-rt_admin']);

const valuesOf = (value: string | readonly string[] | undefined): readonly string[] =>
  value === undefined ? [] : typeof value === 'string' ? [value] : value;

function cookieNames(header: string | readonly string[] | undefined): string[] {
  return valuesOf(header)
    .join(';')
    .split(';')
    .map((part) => {
      const eq = part.indexOf('=');
      return (eq === -1 ? part : part.slice(0, eq)).trim();
    })
    .filter((name) => name !== '');
}

const present = (value: string | readonly string[] | undefined): boolean => valuesOf(value).some((item) => item.trim() !== '');

/** True when the request carries an Authorization header, a refresh cookie or an X-Quote-Token header. */
export function presentsCredential(headers: CredentialHeaders): boolean {
  if (present(headers['authorization']) || present(headers['x-quote-token'])) return true;
  return cookieNames(headers['cookie']).some((name) => REFRESH_COOKIE_NAMES.includes(name));
}
