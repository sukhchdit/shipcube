/**
 * Stylelint 17.16 configuration (ADR-0002 §5 and SPK-01 amendment item 5; D-ARCH-037; TASK-002).
 *  - `csstools/use-logical` (stylelint-use-logical 2.1.3): logical properties only, no physical directions (NFR-I18N-003).
 *  - `platform/hover-in-media` (tools/stylelint-rules): `:hover` only inside `@media (hover: hover)` (NFR-A11Y-006).
 *  - `platform/token-lint` (tools/stylelint-rules, US-101, TASK-038): no hard-coded colour, no off-grid spacing, no unknown
 *    token. Off for the generated theme only: it is the single stylesheet that holds the raw values (tokens.md §1).
 *  - Disable comments are policed (PR2-SEC-03): a `stylelint-disable` must name a configured rule, must suppress a real
 *    problem and must carry a `-- description`; otherwise `--max-warnings 0` fails the run.
 * Stylelint 18 waits for a `stylelint-use-logical` release whose peer range admits it. Ignored paths are in
 * .stylelintignore; seeded negative fixtures are linted explicitly by tools/lint/negative-fixtures.test.ts.
 */
import hoverInMedia from './tools/stylelint-rules/hover-in-media.mjs';
import tokenLint from './tools/stylelint-rules/token-lint.mjs';

/** @type {import('stylelint').Config} */
export default {
  plugins: ['stylelint-use-logical', hoverInMedia, tokenLint],
  reportNeedlessDisables: true,
  reportInvalidScopeDisables: true,
  reportDescriptionlessDisables: true,
  rules: {
    'csstools/use-logical': 'always',
    'platform/hover-in-media': true,
    'platform/token-lint': true,
  },
  overrides: [{ files: ['packages/ui/src/theme/tokens.generated.css'], rules: { 'platform/token-lint': null } }],
};
