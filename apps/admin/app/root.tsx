import type { ReactNode } from 'react';
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';

import './app.css';
import { ERROR_KIND, ErrorView, NOT_FOUND_KIND } from './components/error-view';
import { NoIndex } from './components/no-index';
import { LocaleProvider, useDetectedLocale, useT } from './i18n/locale-context';
import { browserLocale } from './i18n/locales';
import { translate } from './i18n/messages';
import type { Route } from './+types/root';

/** Document shell. `<html lang>` follows the locale detected in the browser (US-106); the build-time shell says `en`. */
export function Layout({ children }: { children: ReactNode }) {
  const locale = useDetectedLocale();

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <NoIndex />
        <Meta />
        <Links />
      </head>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** Title of the shell and of error states; page routes export their own title. The robots tag lives in `Layout`. */
export function meta({ error }: Route.MetaArgs) {
  const locale = browserLocale();
  // `error` is null (not undefined) when the route has not failed.
  if (!error) return [{ title: translate(locale, 'home.title') }];
  return [{ title: translate(locale, isRouteErrorResponse(error) && error.status === 404 ? 'notFound.title' : 'error.title') }];
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
  return <ErrorView kind={isRouteErrorResponse(error) && error.status === 404 ? NOT_FOUND_KIND : ERROR_KIND} />;
}
