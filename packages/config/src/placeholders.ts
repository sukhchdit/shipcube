/**
 * Placeholder detection (ADR-0018 §3 and amendment item 3; SEC-P3-08 item 5; SEC-TC-51; PR3-SEC-10).
 *
 * `.env.example` holds placeholders only and `compose.env` holds `local-only-*` values only. With
 * `APP_ENV ∈ {staging, production}` any value detected here is refused. The env-example parity test asserts that
 * every secret value in `.env.example` is detected, so "equals a value from `.env.example`" is covered.
 *
 * Placeholders are whole values or whole components of a value (URL userinfo, host or path segment, a key-id
 * suffix, a JSON string), never arbitrary substrings: resolved secrets such as generated passwords may contain
 * `<`, `>` or words like `exchangemerchant`, and must not be refused at the next rotation. Matching runs on the
 * NFKC form, and on the percent-decoded form of each component, so `%5F` or full-width variants are still caught.
 */

/** Patterns tested against the whole value only. */
export const WHOLE_VALUE_PLACEHOLDER_PATTERNS: readonly RegExp[] = Object.freeze([
  /^<[A-Za-z0-9_. -]+>$/,
  /^(?:x{3,}|\*{3,}|todo|tbd|dummy|example|secret|password)$/i,
]);

/** Marker words tested against the whole value and against each component; all are anchored at the start. */
export const PLACEHOLDER_PATTERNS: readonly RegExp[] = Object.freeze([
  /^(?:change|replace)[-_ ]?me(?![a-z])/i,
  /^placeholder(?![a-z])/i,
  /^local-only-/i,
]);

/**
 * Tested against each component of a structured value only: a URL (`postgresql://user:<password>@host/db`) or a
 * key variable (`<key_id>-v<n>:<material>`). A `<…>` component elsewhere is not a placeholder, because generated
 * passwords may contain `:<abc>:` by chance.
 */
export const STRUCTURED_COMPONENT_PLACEHOLDER_PATTERNS: readonly RegExp[] = Object.freeze([/^<[A-Za-z0-9_.-]+>$/]);

/** The placeholder written for secrets in `.env.example`. */
export const ENV_EXAMPLE_PLACEHOLDER = 'CHANGE_ME';

/** Prefix that marks every secret value in `compose.env` (platform.md §1, D-022). */
export const LOCAL_ONLY_PREFIX = 'local-only-';

/** Characters that delimit components: URL syntax, query and list separators, JSON punctuation, whitespace. */
const COMPONENT_SEPARATORS = /[\s:@/?#&=,;"'{}[\]]+/;
const PERCENT_ESCAPE = /%([0-9A-Fa-f]{2})/g;
/** A URL with a scheme, a key variable `<key_id>-v<n>:` (keys.ts grammar) or a secret reference `<provider>:`. */
const STRUCTURED = /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|[a-z][a-z0-9-]*-v\d+:|(?:env|file|aws-secrets-manager):)/;

const percentDecode = (component: string): string =>
  component.replace(PERCENT_ESCAPE, (_escape, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));

const matchesAny = (patterns: readonly RegExp[], candidates: readonly string[]): boolean =>
  candidates.some((candidate) => patterns.some((pattern) => pattern.test(candidate)));

export function isPlaceholder(value: string): boolean {
  const normalised = value.normalize('NFKC');
  if (matchesAny(WHOLE_VALUE_PLACEHOLDER_PATTERNS, [normalised])) return true;
  const raw = normalised.split(COMPONENT_SEPARATORS).filter((component) => component !== '');
  const components = [...raw, ...raw.map(percentDecode)];
  if (matchesAny(PLACEHOLDER_PATTERNS, [normalised, ...components])) return true;
  return STRUCTURED.test(normalised) && matchesAny(STRUCTURED_COMPONENT_PLACEHOLDER_PATTERNS, components);
}
