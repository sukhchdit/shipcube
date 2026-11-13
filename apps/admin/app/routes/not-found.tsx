import { ErrorView, NOT_FOUND_KIND } from '../components/error-view';
import { browserLocale } from '../i18n/locales';
import { translate } from '../i18n/messages';

/** The catch-all renders a component rather than throwing, so the root `meta` would title it as the home page (WCAG 2.4.2). */
export function meta() {
  return [{ title: translate(browserLocale(), 'notFound.title') }];
}

/** Catch-all for URLs that are not an admin page. */
export default function NotFound() {
  return <ErrorView kind={NOT_FOUND_KIND} />;
}
