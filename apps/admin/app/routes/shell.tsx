import { SkipLink } from '@platform/ui';
import { Outlet } from 'react-router';

import { useT } from '../i18n/locale-context';

/** Id of the `main` landmark, the target of the skip link. */
const MAIN_CONTENT_ID = 'main';

/**
 * Admin page frame: skip link first, then the banner and `main` (accessibility.md §2). The sidebar, breadcrumb and
 * session guard of the admin shell (ADR-0026 §8, D-008) are added by their own tasks.
 */
export default function Shell() {
  const t = useT();

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink targetId={MAIN_CONTENT_ID}>{t('skipToContent')}</SkipLink>
      <header className="border-b border-hairline bg-surface">
        <p className="mx-auto max-w-page px-4 py-4 font-semibold text-secondary md:px-6 lg:px-8">{t('shell.name')}</p>
      </header>
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="mx-auto w-full max-w-page flex-1 px-4 py-10 md:px-6 lg:px-8 lg:py-12">
        <Outlet />
      </main>
    </div>
  );
}
