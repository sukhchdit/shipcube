/**
 * PR3-SEC-14 (TASK-014): `node node_modules/tsx/dist/cli.mjs tools/db/check-tooling-env.ts <VAR>` checks the
 * PostgreSQL URL in `<VAR>` with `checkToolingEnv` (@platform/config) before a tooling one-shot connects; the Compose
 * migrate one-shot calls it for DATABASE_MIGRATOR_URL. Exit 0 = acceptable; exit 1 = refused (or a bad argument), with
 * one stderr line naming variables, codes and rules only, never a value.
 */
import { checkToolingEnv, formatToolingIssues } from '@platform/config';

/** An environment variable name: the only argument, echoed only when it has this shape. */
const VARIABLE_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
  writeError: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): number {
  const [variable, ...extra] = argv;
  if (variable === undefined || extra.length > 0 || !VARIABLE_NAME.test(variable)) {
    writeError('[check-tooling-env] usage: check-tooling-env.ts <VARIABLE_NAME>');
    return 1;
  }
  const issues = checkToolingEnv(env, variable);
  if (issues.length === 0) return 0;
  writeError(`[check-tooling-env] ${variable} refused: ${formatToolingIssues(issues)}`);
  return 1;
}

if (import.meta.main) process.exitCode = main();
