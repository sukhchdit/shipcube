/**
 * Stylelint 17.16 configuration (ADR-0002 §5 and SPK-01 amendment item 5; D-ARCH-037; TASK-002).
 *  - `csstools/use-logical` (stylelint-use-logical 2.1.3): logical properties only, no physical directions (NFR-I18N-003).
 *  - `platform/hover-in-media` (tools/stylelint-rules): `:hover` only inside `@media (hover: hover)` (NFR-A11Y-006).
 * Stylelint 18 waits for a `stylelint-use-logical` release whose peer range admits it. Ignored paths are in
 * .stylelintignore; seeded negative fixtures are linted explicitly by tools/lint/negative-fixtures.test.ts.
 */
import hoverInMedia from './tools/stylelint-rules/hover-in-media.mjs';

/** @type {import('stylelint').Config} */
export default {
  plugins: ['stylelint-use-logical', hoverInMedia],
  rules: {
    'csstools/use-logical': 'always',
    'platform/hover-in-media': true,
  },
};
