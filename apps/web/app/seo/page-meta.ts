import type { MetaDescriptor } from 'react-router';

import { DEFAULT_LOCALE, LOCALES, type Locale } from '../i18n/locales';

export interface PageMetaInput {
  locale: Locale;
  /** Path below the locale prefix, without slashes: `''` for the home page, `'track'` for `/{lng}/track/`. */
  path: string;
  title: string;
  description: string;
  /** Absolute origin, e.g. `https://example.test`; see `publicOrigin`. */
  origin: string;
}

/** Locale-prefixed public URL with the trailing slash that the Nginx image serves (`/en/` -> `en/index.html`). */
export function localisedUrl(origin: string, locale: Locale, path: string): string {
  return `${origin}/${locale}/${path === '' ? '' : `${path}/`}`;
}

/**
 * Head tags every pre-rendered public page carries (US-112, NFR-WEB-005): unique title and description, a canonical
 * URL, and `hreflang` alternates for all supported locales plus `x-default` (the default locale).
 */
export function localisedPageMeta({ locale, path, title, description, origin }: PageMetaInput): MetaDescriptor[] {
  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: localisedUrl(origin, locale, path) },
    ...LOCALES.map((alternate): MetaDescriptor => ({
      tagName: 'link',
      rel: 'alternate',
      hrefLang: alternate,
      href: localisedUrl(origin, alternate, path),
    })),
    { tagName: 'link', rel: 'alternate', hrefLang: 'x-default', href: localisedUrl(origin, DEFAULT_LOCALE, path) },
  ];
}
