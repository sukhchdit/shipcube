/**
 * tools/docker/entrypoint.sh (TASK-014; PR3-SEC-13, PR3-SEC-11 R3.4 item 2; ADR-0018 am. 8, D-ARCH-061; PR39-SEC-02,
 * R1-m1): the preflight runs WITHOUT NODE_OPTIONS (original value in PREFLIGHT_NODE_OPTIONS) and with the container
 * argv after `--`, a refusal stops the container with the preflight's exit code before the application starts, and
 * the application is exec'd with the original NODE_OPTIONS, --disable-sigusr1 and the same argv. A fake `node` on PATH
 * records each invocation; with REAL_PREFLIGHT set it runs the real preflight CLI (through tsx) for the preflight
 * call. The preflight decision table is unit-tested in packages/config/src/entry-preflight.test.ts and the container
 * behaviour in the TASK-014 stack suite.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';

const ROOT = findRepoRoot();
const ENTRYPOINT = join(ROOT, 'tools', 'docker', 'entrypoint.sh');
const PREFLIGHT_CLI = join(ROOT, 'packages', 'config', 'src', 'entry-preflight-cli.ts');
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const PREFLIGHT_CALL = '--disable-sigusr1 /app/packages/config/dist/entry-preflight-cli.js --';

// Records "<args>|NODE_OPTIONS=<set?value>|PREFLIGHT=<value>" per call. The preflight call runs the real CLI when
// REAL_PREFLIGHT is set (dropping `--disable-sigusr1 <image path>`), else exits FAKE_PREFLIGHT_EXIT.
const FAKE_NODE = [
  '#!/bin/sh',
  'printf \'%s|NODE_OPTIONS=%s|PREFLIGHT=%s\\n\' "$*" "${NODE_OPTIONS-<unset>}" "${PREFLIGHT_NODE_OPTIONS-<unset>}" >> "$FAKE_NODE_LOG"',
  'case "$*" in *entry-preflight-cli.js*)',
  '  if [ -n "${REAL_PREFLIGHT-}" ]; then shift 2; exec "$REAL_NODE" "$TSX_CLI" "$REAL_PREFLIGHT" "$@"; fi',
  '  exit "${FAKE_PREFLIGHT_EXIT:-0}";;',
  'esac',
  'exit 0',
  '',
].join('\n');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 't014-entrypoint-'));
  writeFileSync(join(dir, 'node'), FAKE_NODE);
  chmodSync(join(dir, 'node'), 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(env: Record<string, string>, args: readonly string[] = ['dist/main.js']): { status: number | null; calls: string[] } {
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  const result = spawnSync('sh', [ENTRYPOINT, ...args], {
    env: { ...process.env, ...env, PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`, FAKE_NODE_LOG: log },
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    calls: readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line !== ''),
  };
}

/** Runs the entrypoint with the REAL preflight in a minimal, otherwise clean environment (no inherited PG*, NODE_ENV). */
function runReal(env: Record<string, string>, args: readonly string[]): { status: number | null; stderr: string; calls: string[] } {
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  const base: Record<string, string> = {
    PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`,
    FAKE_NODE_LOG: log,
    REAL_NODE: process.execPath,
    TSX_CLI: TSX,
    REAL_PREFLIGHT: PREFLIGHT_CLI,
    // Git for Windows: no path conversion of the arguments handed to the native node.exe.
    MSYS_NO_PATHCONV: '1',
    MSYS2_ARG_CONV_EXCL: '*',
  };
  for (const name of ['SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP']) {
    const value = process.env[name];
    if (value !== undefined) base[name] = value;
  }
  const result = spawnSync('sh', [ENTRYPOINT, ...args], { env: { ...base, ...env }, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    stderr: result.stderr,
    calls: readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line !== ''),
  };
}

describe('tools/docker/entrypoint.sh', () => {
  it('[PR3-SEC-13] runs the preflight without NODE_OPTIONS, then execs the app with it and --disable-sigusr1', () => {
    const { status, calls } = run({ NODE_OPTIONS: '--max-old-space-size=512', FAKE_PREFLIGHT_EXIT: '0' });
    expect(status).toBe(0);
    expect(calls).toEqual([
      `${PREFLIGHT_CALL} dist/main.js|NODE_OPTIONS=<unset>|PREFLIGHT=--max-old-space-size=512`,
      '--disable-sigusr1 --enable-source-maps dist/main.js|NODE_OPTIONS=--max-old-space-size=512|PREFLIGHT=<unset>',
    ]);
  });

  it('[PR3-SEC-13] a refused preflight stops with its exit code and never starts the app', () => {
    const { status, calls } = run({ NODE_OPTIONS: '--inspect-wait=0.0.0.0:9229', FAKE_PREFLIGHT_EXIT: '78' });
    expect(status).toBe(78);
    expect(calls).toEqual([`${PREFLIGHT_CALL} dist/main.js|NODE_OPTIONS=<unset>|PREFLIGHT=--inspect-wait=0.0.0.0:9229`]);
  });

  it('[R1-m1] hands the preflight every container argument after `--`', () => {
    const { calls } = run({ FAKE_PREFLIGHT_EXIT: '78' }, ['--inspect=0.0.0.0:9229', 'dist/main.js']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(
      /^--disable-sigusr1 \/app\/packages\/config\/dist\/entry-preflight-cli\.js -- --inspect=0\.0\.0\.0:9229 dist\/main\.js\|/,
    );
  });

  it('passes an empty PREFLIGHT_NODE_OPTIONS when NODE_OPTIONS is unset, and an inherited one is overwritten', () => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const log = join(dir, 'calls.log');
    writeFileSync(log, '');
    const result = spawnSync('sh', [ENTRYPOINT, 'dist/main.js'], {
      env: { ...env, PREFLIGHT_NODE_OPTIONS: '--inspect', PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`, FAKE_NODE_LOG: log },
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    expect(readFileSync(log, 'utf8').split('\n').slice(0, 2)).toEqual([
      `${PREFLIGHT_CALL} dist/main.js|NODE_OPTIONS=<unset>|PREFLIGHT=`,
      '--disable-sigusr1 --enable-source-maps dist/main.js|NODE_OPTIONS=<unset>|PREFLIGHT=<unset>',
    ]);
  });
});

describe('tools/docker/entrypoint.sh with the real preflight (PR39-SEC-02 (a), R1-m1)', () => {
  const staging = { APP_ENV: 'staging', NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=512' };

  it('APP_ENV=staging with argv `--inspect=0.0.0.0:9229 dist/main.js` exits 78, names CMD only, and never execs the app', () => {
    const { status, stderr, calls } = runReal(staging, ['--inspect=0.0.0.0:9229', 'dist/main.js']);
    expect(status).toBe(78);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('entry-preflight-cli.js --');
    expect(stderr).toContain('entrypoint preflight refused (exit 78)');
    expect(stderr.split('\n').filter((line) => line.startsWith('  - '))).toEqual(['  - CMD: forbidden-in-environment: argv.entryOnly']);
    expect(stderr).not.toContain('--inspect');
    expect(stderr).not.toContain('9229');
  }, 60_000);

  it('APP_ENV=staging with argv `dist/main.js` execs the app with exactly that argument', () => {
    const { status, stderr, calls } = runReal(staging, ['dist/main.js']);
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe('--disable-sigusr1 --enable-source-maps dist/main.js|NODE_OPTIONS=--max-old-space-size=512|PREFLIGHT=<unset>');
  }, 60_000);
});
