import { SkipLink } from '@platform/ui';
import { Outlet } from 'react-router';

import { LocaleSwitcher } from '../components/locale-switcher';
import { useT } from '../i18n/use-locale';

/** Id of the `main` landmark, the target of the skip link. */
const MAIN_CONTENT_ID = 'main';

/** Page frame of every locale: skip link first, then the banner, `main` and the content-info footer (accessibility.md §2). */
export default function LocaleLayout() {
  const t = useT();

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink targetId={MAIN_CONTENT_ID}>{t('skipToContent')}</SkipLink>
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-page items-center justify-end px-4 py-2 md:px-6 lg:px-8">
          <LocaleSwitcher />
        </div>
      </header>
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="mx-auto w-full max-w-page flex-1 px-4 py-10 md:px-6 lg:px-8 lg:py-12">
        <Outlet />
      </main>
      <footer className="border-t border-hairline bg-surface">
        <p className="mx-auto max-w-page px-4 py-4 text-muted md:px-6 lg:px-8">{t('footer.note')}</p>
      </footer>
    </div>
  );
}
