/**
 * Credential presence (D-ARCH-107 (5), D-ARCH-109, ADR-0008 am. 4/5; TASK-020). Which credential kinds a request
 * PRESENTS: `session` (a non-blank `Authorization` header), `refresh-cookie` (a cookie named `__Host-rt_web` or
 * `__Host-rt_admin`; openapi.yaml `refreshCookieWeb`, `refreshCookieAdmin`) and `quote-token` (a non-blank
 * `X-Quote-Token` header). Presence only, never validity: verifying a credential is the job of the authenticators
 * (TASK-052, 055, 091). A `signature` is never presented through a header the stub reads, and `anonymous` is the
 * absence of a credential, so neither is a presentable kind. Pure; header names lower-case, as Node delivers them.
 *
 * D-ARCH-109: a route reads only the kinds its `auth` set declares; a foreign credential is ignored and changes no
 * header. `presentedKinds(headers, declared)` reads the headers of the declared kinds and no others (the authn slot,
 * the SEC-TC-29 helper for a known operation). `presentsCredential` is the generic test for the two cases where no
 * route has read the request: a problem raised before a route is known and an error raised before the authn slot ran.
 */

/** Request headers as Node's `IncomingHttpHeaders` delivers them (lower-case names). */
export type CredentialHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

export const REFRESH_COOKIE_NAMES: readonly string[] = Object.freeze(['__Host-rt_web', '__Host-rt_admin']);

/** The credential kinds a request can present in a header the stub reads, in canonical (`ROUTE_AUTHS`) order. */
export const PRESENTABLE_KINDS = Object.freeze(['session', 'refresh-cookie', 'quote-token'] as const);
/** A subset of `@platform/authz` `RouteAuth` (checked where both meet, apps/api authenticate.ts). */
export type PresentableKind = (typeof PRESENTABLE_KINDS)[number];

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

/** One reader per kind; each reads its own header only. */
const READERS: Readonly<Record<PresentableKind, (headers: CredentialHeaders) => boolean>> = Object.freeze({
  session: (headers) => present(headers['authorization']),
  'refresh-cookie': (headers) => cookieNames(headers['cookie']).some((name) => REFRESH_COOKIE_NAMES.includes(name)),
  'quote-token': (headers) => present(headers['x-quote-token']),
});

/**
 * The kinds among `declared` (default: every presentable kind) the request presents, frozen, in canonical order. Only
 * the headers of the declared kinds are read: a credential of another kind is not parsed and not counted (D-ARCH-109).
 * `declared` may hold kinds that are not presentable (`anonymous`, `signature`); they are skipped.
 */
export function presentedKinds(headers: CredentialHeaders, declared: readonly string[] = PRESENTABLE_KINDS): readonly PresentableKind[] {
  return Object.freeze(PRESENTABLE_KINDS.filter((kind) => declared.includes(kind) && READERS[kind](headers)));
}

/** True when the request carries an Authorization header, a refresh cookie or an X-Quote-Token header (any kind). */
export function presentsCredential(headers: CredentialHeaders): boolean {
  return presentedKinds(headers).length > 0;
}
