/**
 * Placeholder detection (ADR-0018 §3 and amendment item 3; SEC-P3-08 item 5; SEC-TC-51).
 *
 * `.env.example` holds placeholders only and `compose.env` holds `local-only-*` values only. With
 * `APP_ENV ∈ {staging, production}` any value matching one of these patterns is refused. The env-example parity
 * test asserts that every secret value in `.env.example` matches `isPlaceholder`, so "equals a value from
 * `.env.example`" is covered by the patterns.
 */
export const PLACEHOLDER_PATTERNS: readonly RegExp[] = Object.freeze([
  /change[-_ ]?me/i,
  /replace[-_ ]?me/i,
  /placeholder/i,
  /<[^<>]*>/,
  /local-only-/i,
  /^(?:x{3,}|\*{3,}|todo|tbd|dummy|example|secret|password)$/i,
]);

/** The placeholder written for secrets in `.env.example`. */
export const ENV_EXAMPLE_PLACEHOLDER = 'CHANGE_ME';

/** Prefix that marks every secret value in `compose.env` (platform.md §1, D-022). */
export const LOCAL_ONLY_PREFIX = 'local-only-';

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}
