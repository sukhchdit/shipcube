import { useT } from '../i18n/locale-context';
import { browserLocale } from '../i18n/locales';
import { translate } from '../i18n/messages';

export function meta() {
  return [{ title: translate(browserLocale(), 'home.title') }];
}

export default function Home() {
  const t = useT();

  return (
    <section className="flex max-w-reading flex-col gap-4">
      <h1 className="text-2xl font-semibold text-primary lg:text-3xl">{t('home.title')}</h1>
      <p className="text-base text-secondary">{t('home.lead')}</p>
    </section>
  );
}
