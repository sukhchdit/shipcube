import { redirect } from 'react-router';

import { detectLocale } from '../i18n/locales';

/**
 * `/` is answered by an Nginx 302 in the images (ADR-0026 am. 4). This loader gives the dev server and the SPA
 * fallback the same behaviour with the same rules: cookie `lng`, then browser languages, then `en` (DR-A18).
 */
export function clientLoader() {
  return redirect(`/${detectLocale({ cookie: document.cookie, languages: navigator.languages })}/`);
}

export default function RootRedirect() {
  return null;
}
