/**
 * Value rules shared by the backend Joi schema (`schema.ts`) and the web-build Zod schema (`web/web-schema.ts`):
 * "Zod on the frontend, Joi on the backend; limits, enums and patterns shared by both live in one module so the
 * two validators cannot drift" (brief §3.3, ADR-0001, AT-US-002-04). `brand-rules.test.ts` runs one set of
 * accept/reject vectors through both validators and asserts identical verdicts.
 *
 * Dependency-free on purpose: importing this module pulls in neither Joi nor Zod nor any `node:*` module.
 */

/** UI and e-mail locales (tokens.md §11). */
export const LOCALES = ['en', 'es', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * `BRAND_NAME` trim rule: both validators trim surrounding whitespace first (Joi `.trim()`, Zod `.trim()`), and
 * the trimmed value must have 1..40 characters (tokens.md §11), so a whitespace-only name is rejected.
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
