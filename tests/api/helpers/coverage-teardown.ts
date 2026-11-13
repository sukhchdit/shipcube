// Jest global teardown of the api project (api/README.md §16 item 6): runs the contract-coverage report CLI
// (coverage-report.ts) under tsx. Jest loads global hooks outside its module registry, where the repository's `.js`
// specifiers of TypeScript sources do not resolve, so this file imports Node built-ins only. A report, not a gate: any
// failure is printed and swallowed so that it never changes the Jest exit code.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPORT_TIMEOUT_MS = 60_000;

export default function contractCoverageTeardown(globalConfig: { readonly rootDir: string }): void {
  const root = globalConfig.rootDir;
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      resolve(root, 'tests', 'api', 'helpers', 'coverage-report.ts'),
      String(process.pid),
    ],
    { cwd: root, encoding: 'utf8', timeout: REPORT_TIMEOUT_MS },
  );
  process.stdout.write(result.stdout);
  if (result.status !== 0) {
    process.stderr.write(`API contract coverage report could not be produced (exit ${String(result.status)}):\n${result.stderr}`);
  }
}
