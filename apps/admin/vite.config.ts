import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite';

/**
 * `@platform/source` makes workspace packages resolve to their TypeScript sources in dev, in the production bundle and
 * in the build-time (server) render alike (D-ARCH-036, ADR-0026 am. 12). Vite's own default conditions are kept.
 */
export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: { conditions: ['@platform/source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['@platform/source', ...defaultServerConditions] } },
});
