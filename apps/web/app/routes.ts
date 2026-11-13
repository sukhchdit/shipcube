import { index, route, type RouteConfig } from '@react-router/dev/routes';

import { LOCALES } from './i18n/locales';

/**
 * Public URLs carry the locale prefix `/{en|es|fr}/...` (ADR-0026 am. 4): one static route subtree per supported
 * locale, so `/de/` is not a page and falls through to the not-found route. The prerender list in
 * react-router.config.ts is derived from the same LOCALES. `/` is not a page either: Nginx redirects it to `/{lng}/`
 * and the index route below does the same for the dev server.
 */
export default [
  index('routes/root-redirect.tsx'),
  ...LOCALES.map((locale) =>
    route(locale, 'routes/locale-layout.tsx', { id: `locale-${locale}` }, [index('routes/home.tsx', { id: `home-${locale}` })]),
  ),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
