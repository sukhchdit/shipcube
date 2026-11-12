/**
 * Value rules shared by the backend Joi schema (`schema.ts`) and the web-build Zod schema (`web/web-schema.ts`):
 * "Zod on the frontend, Joi on the backend; limits, enums and patterns shared by both live in one module so the
 * two validators cannot drift" (brief §3.3, ADR-0001, AT-US-002-04). Both validators call the same predicates
 * (`isBrandName`, `isBrandUrl`); `brand-rules.test.ts` asserts identical verdicts on curated, adversarial and
 * generated vectors.
 *
 * Dependency-free on purpose: importing this module pulls in neither Joi nor Zod nor any `node:*` module.
 */

/** UI and e-mail locales (tokens.md §11). */
export const LOCALES = ['en', 'es', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * `BRAND_NAME` trim rule: both validators trim surrounding whitespace first (Joi `.trim()`, Zod `.trim()`), and
 * the trimmed value must have 1..40 characters (tokens.md §11) counted in code points (`isBrandName`), so a
 * whitespace-only name is rejected.
 */
export const BRAND_NAME_MIN_LENGTH = 1;
export const BRAND_NAME_MAX_LENGTH = 40;

/** Absolute brand URLs are http(s) only (no `javascript:`, `data:` or `file:`). */
export const BRAND_URL_PROTOCOLS = ['http', 'https'] as const;
/** The protocol list as an anchored pattern over `URL#protocol` without the trailing colon. */
export const BRAND_URL_PROTOCOL_PATTERN = new RegExp(`^(?:${BRAND_URL_PROTOCOLS.join('|')})$`);
/** Upper bound of a brand URL or path (defence against oversized build-time values). */
export const BRAND_URL_MAX_LENGTH = 2048;

/** Root-relative path (same origin through the edge); protocol-relative `//host` is not a path. */
export const ROOT_PATH_PATTERN = /^\/(?!\/)[A-Za-z0-9._~\-/]*$/;

/** Brand keys whose value is an absolute http(s) URL or a root-relative path. */
export const BRAND_URL_KEYS = ['BRAND_LOGO_URL', 'BRAND_LOGO_DARK_URL', 'BRAND_FAVICON_URL'] as const;
export type BrandUrlKey = (typeof BRAND_URL_KEYS)[number];

/** Every `BRAND_*` key, in schema order. */
export const BRAND_KEYS = ['BRAND_NAME', ...BRAND_URL_KEYS] as const;
export type BrandKey = (typeof BRAND_KEYS)[number];

/*
 * Shared PREDICATES (code-review R2-m1). Joi `.uri()` (an RFC 3986 regex, UTF-16 lengths) and Zod `z.url()` (the
 * WHATWG parser: trims, lower-cases the scheme, percent-encodes spaces; code-point lengths) disagree on ordinary
 * typos, so neither library decides a brand value: both call these functions (Joi `.custom`, Zod `.refine`).
 */

/** Length of a brand name in Unicode code points (`'😀'` is 1): the unit tokens.md §11 means by "characters". */
export const brandNameLength = (value: string): number => [...value].length;

/** An already-trimmed `BRAND_NAME` has 1..40 code points. */
export const isBrandName = (trimmed: string): boolean => {
  const length = brandNameLength(trimmed);
  return length >= BRAND_NAME_MIN_LENGTH && length <= BRAND_NAME_MAX_LENGTH;
};

/**
 * Raw absolute URL grammar, checked before the WHATWG parser can normalise anything: a lower-case http(s) scheme,
 * `//` and a non-empty authority, then RFC 3986 characters only (unreserved, reserved, `%XX`). So no whitespace,
 * `"`, `<`, `>`, `` ` ``, `{`, `|`, `^` or `\`, and an IDN host must be written in punycode (`xn--`).
 */
const ABSOLUTE_BRAND_URL = new RegExp(
  `^(?:${BRAND_URL_PROTOCOLS.join('|')})://(?![/?#])(?:[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=]|%[0-9A-Fa-f]{2})+$`,
);

const parsesWithHost = (value: string): boolean => {
  try {
    const url = new URL(value);
    return BRAND_URL_PROTOCOL_PATTERN.test(url.protocol.slice(0, -1)) && url.hostname !== '' && url.username === '' && url.password === '';
  } catch {
    // An out-of-range port or a malformed IPv4/IPv6 host.
    return false;
  }
};

/**
 * `BRAND_*_URL`, `VITE_API_BASE_URL`, `VITE_FEATURE_FLAGS_ENDPOINT`: 1..2048 UTF-16 units, and either a
 * root-relative path (`ROOT_PATH_PATTERN`) or an absolute http(s) URL in raw RFC 3986 form that the global `URL`
 * (browser and Node, no import) parses with a non-empty host and no credentials.
 */
export const isBrandUrl = (value: string): boolean =>
  value.length > 0 &&
  value.length <= BRAND_URL_MAX_LENGTH &&
  (ROOT_PATH_PATTERN.test(value) || (ABSOLUTE_BRAND_URL.test(value) && parsesWithHost(value)));
