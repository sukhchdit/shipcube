import type { ReactNode } from 'react';
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';

import './app.css';
import { ErrorView } from './components/error-view';
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

/** The admin app is never indexed (ADR-0026 am. 5; Nginx also sends X-Robots-Tag). Page routes export their own title. */
export function meta({ error }: Route.MetaArgs) {
  const locale = browserLocale();
  const robots = { name: 'robots', content: 'noindex, nofollow' };
  // `error` is null (not undefined) when the route has not failed.
  if (!error) return [{ title: translate(locale, 'home.title') }, robots];
  return [{ title: translate(locale, isRouteErrorResponse(error) && error.status === 404 ? 'notFound.title' : 'error.title') }, robots];
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
