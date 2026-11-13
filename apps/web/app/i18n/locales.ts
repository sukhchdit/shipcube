/**
 * Supported locales and the locale fallback order of DR-A18 (cookie `lng`, then `Accept-Language`, then `en`).
 * The same rules run in Nginx for the `/` redirect (infra/nginx/web.conf.template); this client copy serves the
 * dev server and the SPA fallback, where Nginx is not in front. Dependency-free on purpose: react-router.config.ts
 * imports it to build the prerender list. Replaced by the react-i18next setup in TASK-042.
 */
export const LOCALES = ['en', 'es', 'fr'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** `fr-CA` -> `fr`: only the language subtag matters (DR-A18). */
export function localeFromLanguageTag(tag: string): Locale | undefined {
  const language = tag.trim().toLowerCase().split('-')[0];
  return isLocale(language) ? language : undefined;
}

/** Locale of a public URL path (`/es/track/` -> `es`); the default locale for `/`, unknown prefixes and other paths. */
export function localeFromPathname(pathname: string): Locale {
  const first = pathname.split('/')[1];
  return isLocale(first) ? first : DEFAULT_LOCALE;
}

const COOKIE_PATTERN = /(?:^|;\s*)lng=([^;]*)/;

/**
 * Value for `document.cookie` after a language switch: `lng=<locale>; Path=/; Max-Age=31536000; SameSite=Lax`, plus
 * `Secure` on https only (ADR-0026 am. 4 relaxes it for plain-HTTP local use). The cookie is read by Nginx for `/`.
 */
export function serializeLocaleCookie(locale: Locale, secure: boolean): string {
  return `lng=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export interface LocaleSignals {
  /** Raw `document.cookie` string. */
  cookie?: string | undefined;
  /** `navigator.languages`, most preferred first. */
  languages?: readonly string[] | undefined;
}

export function detectLocale({ cookie, languages }: LocaleSignals): Locale {
  const fromCookie = cookie === undefined ? undefined : COOKIE_PATTERN.exec(cookie)?.[1];
  if (isLocale(fromCookie)) return fromCookie;
  for (const tag of languages ?? []) {
    const locale = localeFromLanguageTag(tag);
    if (locale !== undefined) return locale;
  }
  return DEFAULT_LOCALE;
}
