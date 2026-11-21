/**
 * Writes (or with `--check` verifies) the generated Tailwind theme from the DTCG tokens (US-101, TASK-038):
 *   node tools/ui/compile-tokens.mjs           writes packages/ui/src/theme/tokens.generated.css
 *   node tools/ui/compile-tokens.mjs --check   exits 1 when the committed file differs from the compiled output
 * The output is Prettier-stable by construction; the drift test (tools/ui/tokens-core.test.ts) runs the same check.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GENERATED_THEME_PATH, compileThemeCss, loadTokens } from './tokens-core.mjs';

const target = join(fileURLToPath(new URL('../..', import.meta.url)), GENERATED_THEME_PATH);
const css = compileThemeCss(loadTokens());

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== css) {
    process.stderr.write(`${GENERATED_THEME_PATH} is out of date with packages/ui/tokens/tokens.json: run npm run tokens:build\n`);
    process.exit(1);
  }
} else {
  writeFileSync(target, css);
  process.stdout.write(`wrote ${GENERATED_THEME_PATH}\n`);
}
