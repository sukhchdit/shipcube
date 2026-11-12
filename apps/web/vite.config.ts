import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite';

/**
 * `@platform/source` makes workspace packages resolve to their TypeScript sources in dev, in the production bundle and
 * in the pre-render (server) build alike (D-ARCH-036, ADR-0026 am. 12). Vite's own default conditions are kept.
 */
export default defineConfig({
  // Only explicitly public build-time values can reach the bundle: Vite inlines `import.meta.env` as a whole object, so
  // any other `VITE_*` variable in the build environment would be published (ADR-0018 item 1, PR4-SEC-01).
  envPrefix: 'VITE_PUBLIC_',
  plugins: [tailwindcss(), reactRouter()],
  resolve: { conditions: ['@platform/source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['@platform/source', ...defaultServerConditions] } },
});
