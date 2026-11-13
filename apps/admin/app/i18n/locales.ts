/**
 * Supported locales and the locale fallback order of DR-A18 (cookie `lng`, then browser languages, then `en`). The
 * admin app has no locale prefix in its URLs (ADR-0026 §8), so the locale is detected in the browser; it shares the
 * `lng` cookie name with the web app (ADR-0026 am. 4). Dependency-free on purpose; replaced by the react-i18next
 * setup in TASK-042.
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

const COOKIE_PATTERN = /(?:^|;\s*)lng=([^;]*)/;

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

/** Locale of the running browser; the default locale where there is no browser (the build-time render). */
export function browserLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  return detectLocale({ cookie: document.cookie, languages: navigator.languages });
}
