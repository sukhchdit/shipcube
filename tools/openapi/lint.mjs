// @ts-check
/**
 * `npm run openapi:lint` (US-034 AT-US-034-01; REQ-API-001/002; ADR-0002): Redocly CLI 2 lint of the contract with
 * `redocly.yaml`, run through the installed CLI entry with the current Node (never npx), telemetry and the update
 * check off (no network), and a bounded run time. Exits with the CLI's code (0 = no errors; warnings do not fail).
 *
 * CLI: node tools/openapi/lint.mjs [--format=stylish|json|...] (extra arguments are passed to `redocly lint`).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SPEC = 'docs/03-architecture/api/openapi.yaml';
export const CONFIG = 'redocly.yaml';
export const LINT_TIMEOUT_MS = 120_000;
/** Bounds the captured output (the JSON report for the whole document is a few kB). */
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

/** Absolute path of the `redocly` bin script of the installed `@redocly/cli`. */
export function redoclyBin() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve('@redocly/cli/package.json');
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin = typeof manifest === 'object' && manifest !== null ? /** @type {{ bin?: unknown }} */ (manifest).bin : undefined;
  const entry =
    typeof bin === 'string'
      ? bin
      : typeof bin === 'object' && bin !== null
        ? /** @type {Record<string, unknown>} */ (bin).redocly
        : undefined;
  if (typeof entry !== 'string') throw new Error('@redocly/cli/package.json declares no `redocly` bin');
  return resolve(dirname(manifestPath), entry);
}

/** The environment for the CLI: the caller's, with telemetry and the update notice forced off. */
export function lintEnv(env = process.env) {
  return { ...env, REDOCLY_TELEMETRY: 'off', REDOCLY_SUPPRESS_UPDATE_NOTICE: 'true' };
}

/** @param {readonly string[]} extraArgs */
export function lintArgs(extraArgs = []) {
  const format = extraArgs.some((arg) => arg.startsWith('--format')) ? [] : ['--format=stylish'];
  return [redoclyBin(), 'lint', SPEC, '--config', CONFIG, ...format, ...extraArgs];
}

/**
 * Runs the lint and resolves with the exit code and captured output (`stdio: 'inherit'` when `capture` is false).
 * A run over `timeoutMs` is killed and resolves with code 1 and a note on stderr.
 * @param {{ extraArgs?: readonly string[], capture?: boolean, timeoutMs?: number, cwd?: string }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runLint({ extraArgs = [], capture = true, timeoutMs = LINT_TIMEOUT_MS, cwd = REPO_ROOT } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, lintArgs(extraArgs), {
      cwd,
      env: lintEnv(),
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      timeout: timeoutMs,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
      if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (/** @type {Buffer} */ chunk) => {
      if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === null) {
        resolvePromise({
          code: 1,
          stdout,
          stderr: `${stderr}[openapi:lint] redocly lint ended by ${signal ?? 'unknown signal'} (timeout ${timeoutMs} ms)\n`,
        });
        return;
      }
      resolvePromise({ code, stdout, stderr });
    });
  });
}

if (import.meta.main) {
  runLint({ extraArgs: process.argv.slice(2), capture: false }).then(
    ({ code, stderr }) => {
      // With inherited stdio the only captured text is the timeout note.
      if (stderr !== '') process.stderr.write(stderr);
      process.exitCode = code;
    },
    (/** @type {unknown} */ error) => {
      process.stderr.write(`[openapi:lint] ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    },
  );
}
