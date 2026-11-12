// @ts-check
/**
 * Baseline ESLint 10 flat config from TASK-001 so `npm run lint` gates from the first merge.
 * TASK-002 replaces it with the full rule set (type-aware typescript-eslint, boundaries,
 * import-x, i18next, jsx-a11y, custom rules and negative fixtures; ADR-0002 §5).
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.react-router/**',
      'prisma/generated/**',
      'docs/**',
      'tools/deps/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
