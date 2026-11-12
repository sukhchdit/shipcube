/**
 * Helpers for tooling tests that run CLIs in child processes. Every CLI is started as
 * `node <script>` with `process.execPath`, so tests use the same Node 24 binary as the test
 * runner and never go through a shell (no `.cmd` shims on Windows, no quoting differences).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Walks up from `start` to the directory whose package.json declares npm workspaces. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
      if (Array.isArray(pkg.workspaces)) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No workspace root above ${start}`);
    dir = parent;
  }
}

/** Absolute path of the npm CLI entry that belongs to the running Node installation. */
export function npmCliPath(): string {
  const fromEnv = process.env['npm_execpath'];
  if (fromEnv !== undefined && /npm-cli\.js$/.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const nodeDir = dirname(process.execPath);
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows layout
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // POSIX layout
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error(`npm CLI not found next to ${process.execPath}`);
  return found;
}

export function runNode(args: readonly string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): RunResult {
  const result = spawnSync(process.execPath, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 120_000,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function runNpm(args: readonly string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): RunResult {
  return runNode([npmCliPath(), ...args], options);
}
