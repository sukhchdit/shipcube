import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import { browserLocale, DEFAULT_LOCALE, type Locale } from './locales';
import { createTranslator, type Translate } from './messages';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** The locale cookie and browser languages do not change while the page is open, so there is nothing to subscribe to. */
const subscribeToNothing = () => () => undefined;
const buildTimeLocale = (): Locale => DEFAULT_LOCALE;

/**
 * The detected browser locale. While hydrating, React uses the build-time snapshot (the default locale), so the first
 * client render matches the HTML of the SPA fallback; it then re-renders in the detected locale. Mirrors the choice on
 * `<html lang>` (US-106) through the `lang` prop.
 */
export function useDetectedLocale(): Locale {
  return useSyncExternalStore(subscribeToNothing, browserLocale, buildTimeLocale);
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
