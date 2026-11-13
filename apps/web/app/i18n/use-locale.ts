import { useMemo, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';

import { DEFAULT_LOCALE, isLocale, localeFromPathname, type Locale } from './locales';
import { createTranslator, type Translate } from './messages';

/** The rendered document does not change its locale on its own, so there is nothing to subscribe to. */
const subscribeToNothing = () => () => undefined;

/**
 * The locale the HTML being hydrated was rendered in. At build time (no `document`) that is the URL locale itself. In
 * the browser it is the `<html lang>` of the served file: a pre-rendered page says its own locale, while the SPA
 * fallback `index.html` (rendered once at `/`, then served for every other URL) says the default locale.
 */
function renderedLocale(urlLocale: Locale): Locale {
  if (typeof document === 'undefined') return urlLocale;
  const lang = document.documentElement.lang;
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

/**
 * The active locale is the first path segment (ADR-0026 am. 4). Reading the location instead of the `:lng` param
 * also covers the not-found and error views, which render outside the locale route; unknown prefixes use `en`.
 *
 * While React hydrates, the hook returns the locale the HTML was rendered in (the server snapshot), so the first
 * client render matches it even when the SPA fallback is served for `/es/...`; React then re-renders in the URL locale
 * and patches `<html lang>` and the text. Without this, hydration fails with a text mismatch (React #418) and
 * `<html lang>` keeps the fallback's value (PR #4 m2; the same pattern as the admin's `useDetectedLocale`).
 */
export function useLocale(): Locale {
  const urlLocale = localeFromPathname(useLocation().pathname);
  return useSyncExternalStore(
    subscribeToNothing,
    () => urlLocale,
    () => renderedLocale(urlLocale),
  );
}

export function useT(): Translate {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}
