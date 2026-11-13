/**
 * Credential presence (D-ARCH-107 (5), ADR-0008 am. 4; TASK-020). Whether a request PRESENTS a credential: an
 * `Authorization` header, a refresh cookie (`__Host-rt_web`, `__Host-rt_admin`; openapi.yaml `refreshCookieWeb`,
 * `refreshCookieAdmin`) or an `X-Quote-Token` header. Presence only, never validity: verifying a credential is the job
 * of the authenticators (TASK-052, 055, 091). One predicate for the API (the authn stub never silently ignores a
 * credential on an anonymous-capable route; the problem handler answers `private, no-store` to any request that
 * presented one, errors raised before the route is known included) and for the SEC-TC-29 contract helper and stubs
 * (PR32-SEC-06 (a)). Pure; header names lower-case, as Node delivers them.
 *
 * Superseded rule, still in force until part 020-B (code review R2-m4, PR32-SEC-16): counting any credential, the
 * `Path=/` refresh cookie included, as presented on EVERY route is the stub reading of D-ARCH-107 (5). D-ARCH-109
 * replaces it: a route reads only the kinds its `auth` set declares, and a foreign credential neither authenticates,
 * fails nor marks the response. TASK-020 part 020-B makes this predicate route-aware (`presentedKinds`) before TASK-027
 * merges and TASK-052 starts; the real authenticators (TASK-052/055/091) never inherit "present means refuse".
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
