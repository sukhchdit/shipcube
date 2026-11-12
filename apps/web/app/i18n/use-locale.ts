import { useMemo } from 'react';
import { useLocation } from 'react-router';

import { localeFromPathname, type Locale } from './locales';
import { createTranslator, type Translate } from './messages';

/**
 * The active locale is the first path segment (ADR-0026 am. 4). Reading the location instead of the `:lng` param
 * also covers the not-found and error views, which render outside the locale route; unknown prefixes use `en`.
 */
export function useLocale(): Locale {
  return localeFromPathname(useLocation().pathname);
}

export function useT(): Translate {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}
