import { ErrorView, NOT_FOUND_KIND } from '../components/error-view';
import { localeFromPathname } from '../i18n/locales';
import { translate } from '../i18n/messages';
import type { Route } from './+types/not-found';

/** The catch-all renders a component rather than throwing, so the root `meta` would title it as loading (WCAG 2.4.2). */
export function meta({ location }: Route.MetaArgs) {
  return [{ title: translate(localeFromPathname(location.pathname), 'notFound.meta.title') }];
}

/** Catch-all for URLs that are not a locale page (for example `/es/unknown/`). */
export default function NotFound() {
  return <ErrorView kind={NOT_FOUND_KIND} />;
}
