import type { ReactNode } from 'react';
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';

import './app.css';
import { ErrorView } from './components/error-view';
import { localeFromPathname } from './i18n/locales';
import { translate } from './i18n/messages';
import { useLocale, useT } from './i18n/use-locale';
import type { Route } from './+types/root';

/** Document shell: `<html lang>` follows the locale of the URL (US-106); the prerendered files carry it in raw HTML. */
export function Layout({ children }: { children: ReactNode }) {
  const locale = useLocale();

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** Title of the SPA shell and of error states; page routes export their own `meta`, which replaces this one. */
export function meta({ location, error }: Route.MetaArgs) {
  const locale = localeFromPathname(location.pathname);
  // `error` is null (not undefined) when the route has not failed.
  if (!error) return [{ title: translate(locale, 'loading') }];
  return [{ title: translate(locale, isRouteErrorResponse(error) && error.status === 404 ? 'notFound.meta.title' : 'error.title') }];
}

export default function App() {
  return <Outlet />;
}

/** Loading state: what `index.html` (the SPA fallback) shows until the client router has resolved the route. */
export function HydrateFallback() {
  const t = useT();

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-page items-center px-4 md:px-6 lg:px-8">
      <p role="status" className="text-muted">
        {t('loading')}
      </p>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorView kind={isRouteErrorResponse(error) && error.status === 404 ? 'not-found' : 'error'} />;
}
