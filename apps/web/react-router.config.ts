import type { Config } from '@react-router/dev/config';

import { LOCALES } from './app/i18n/locales';

/**
 * Framework mode without a server (ADR-0026 §1): the public locale pages are pre-rendered to static HTML, every other
 * URL is served the SPA fallback `index.html` by Nginx. `/` is deliberately not pre-rendered: Nginx answers it with a
 * 302 to `/{lng}/` (ADR-0026 am. 4), so React Router emits `index.html` as the fallback.
 */
export default {
  appDirectory: 'app',
  // APP_BUILD_DIR lets tests build into a temporary directory; the default is the git-ignored ./build.
  buildDirectory: process.env['APP_BUILD_DIR'] ?? 'build',
  ssr: false,
  prerender: LOCALES.map((locale) => `/${locale}`),
} satisfies Config;
