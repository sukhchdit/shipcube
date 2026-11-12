import { Link } from 'react-router';

import { useLocale, useT } from '../i18n/use-locale';

export type ErrorViewKind = 'error' | 'not-found';

/** Named so call sites pass expressions: a bare string prop in JSX reads as untranslated copy to the i18n lint rule. */
export const ERROR_KIND: ErrorViewKind = 'error';
export const NOT_FOUND_KIND: ErrorViewKind = 'not-found';

/** A render error leaves no state worth keeping, so retrying is a reload. */
const reloadPage = () => window.location.reload();

/**
 * Full-page error states (ADR-0026 §3 `ScreenState`): not found, and unexpected error with a retry. Rendered by the
 * root error boundary, so it brings its own `main` landmark and the page's single `h1`.
 */
export function ErrorView({ kind, onRetry = reloadPage }: { kind: ErrorViewKind; onRetry?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const isError = kind === 'error';

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-reading flex-col items-start justify-center gap-4 px-4 md:px-6">
      <h1 className="text-2xl font-semibold text-primary lg:text-3xl">{t(isError ? 'error.title' : 'notFound.title')}</h1>
      <p className="text-base text-secondary">{t(isError ? 'error.description' : 'notFound.description')}</p>
      <div className="flex flex-wrap items-center gap-4">
        {isError ? (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-9 rounded-md bg-action-primary px-4 py-2 font-medium text-on-action-primary pointer-coarse:min-h-11"
          >
            {t('error.retry')}
          </button>
        ) : null}
        <Link to={`/${locale}/`} className="inline-flex min-h-9 items-center text-link underline pointer-coarse:min-h-11">
          {t('goHome')}
        </Link>
      </div>
    </main>
  );
}
