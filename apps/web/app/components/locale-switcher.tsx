import { Link, useLocation } from 'react-router';

import { LOCALES, serializeLocaleCookie, type Locale } from '../i18n/locales';
import { useLocale, useT } from '../i18n/use-locale';

/** `aria-current` token of the active language link. */
const CURRENT_PAGE = 'page';

/** Replaces the locale prefix of the current path so the switcher keeps the visitor on the same page. */
function pathInLocale(pathname: string, locale: Locale): string {
  const rest = pathname.split('/').slice(2).join('/');
  return `/${locale}/${rest}`;
}

function rememberLocale(locale: Locale): void {
  document.cookie = serializeLocaleCookie(locale, window.location.protocol === 'https:');
}

/** Language links with the active one marked `aria-current` and every name set in its own language (WCAG 3.1.2). */
export function LocaleSwitcher() {
  const t = useT();
  const active = useLocale();
  const { pathname } = useLocation();

  return (
    <nav aria-label={t('nav.language')}>
      <ul className="flex flex-wrap gap-4">
        {LOCALES.map((locale) => (
          <li key={locale}>
            <Link
              to={pathInLocale(pathname, locale)}
              lang={locale}
              hrefLang={locale}
              aria-current={locale === active ? CURRENT_PAGE : undefined}
              onClick={() => rememberLocale(locale)}
              className="inline-flex min-h-9 items-center text-link underline aria-[current=page]:font-semibold aria-[current=page]:no-underline pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
            >
              {t(`languages.${locale}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
