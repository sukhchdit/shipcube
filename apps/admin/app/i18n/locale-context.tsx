import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { browserLocale, DEFAULT_LOCALE, type Locale } from './locales';
import { createTranslator, type Translate } from './messages';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/**
 * Starts in the default locale so the first client render matches the build-time HTML of the SPA fallback, then
 * switches to the detected locale after mount. Mirrors the choice on `<html lang>` (US-106) through the `lang` prop.
 */
export function useDetectedLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => setLocale(browserLocale()), []);
  return locale;
}

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}
