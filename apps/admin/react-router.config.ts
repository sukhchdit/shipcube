import type { Config } from '@react-router/dev/config';

/**
 * Pure SPA (ADR-0026 §1, REQ-ADMIN-001): `ssr: false` and no `prerender`, so the build emits only the SPA fallback
 * `index.html` (the root route's HydrateFallback) and the hashed assets. Nothing in the admin app is ever indexed.
 */
export default {
  appDirectory: 'app',
  // APP_BUILD_DIR lets tests build into a temporary directory; the default is the git-ignored ./build.
  buildDirectory: process.env['APP_BUILD_DIR'] ?? 'build',
  ssr: false,
} satisfies Config;
