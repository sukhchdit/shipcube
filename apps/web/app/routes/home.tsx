import { localeFromPathname } from '../i18n/locales';
import { translate } from '../i18n/messages';
import { useT } from '../i18n/use-locale';
import { localisedPageMeta } from '../seo/page-meta';
import { publicOrigin } from '../seo/public-origin';
import type { Route } from './+types/home';

export function meta({ location }: Route.MetaArgs) {
  const locale = localeFromPathname(location.pathname);
  return localisedPageMeta({
    locale,
    path: '',
    title: translate(locale, 'home.meta.title'),
    description: translate(locale, 'home.meta.description'),
    origin: publicOrigin(),
  });
}

/** Pre-rendered per locale: the heading is in the raw HTML, no JavaScript needed (NFR-WEB-005). */
export default function Home() {
  const t = useT();

  return (
    <section className="flex max-w-reading flex-col gap-4">
      <h1 className="text-display font-semibold text-primary lg:text-display-lg">{t('home.hero.title')}</h1>
      <p className="text-base text-secondary">{t('home.hero.lead')}</p>
    </section>
  );
}
