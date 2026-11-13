/**
 * tools/docker/entrypoint.sh (TASK-014; PR3-SEC-13, PR3-SEC-11 R3.4 item 2; ADR-0018 am. 8, D-ARCH-061): the preflight
 * runs WITHOUT NODE_OPTIONS (original value in PREFLIGHT_NODE_OPTIONS), a refusal stops the container with the
 * preflight's exit code before the application starts, and the application is exec'd with the original NODE_OPTIONS
 * and --disable-sigusr1. A fake `node` on PATH records each invocation; the real preflight logic is unit-tested in
 * packages/config/src/entry-preflight.test.ts and the container behaviour in the TASK-014 stack suite.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';

const ENTRYPOINT = join(findRepoRoot(), 'tools', 'docker', 'entrypoint.sh');

// Records "<args>|NODE_OPTIONS=<set?value>|PREFLIGHT=<value>" per call; the preflight call exits FAKE_PREFLIGHT_EXIT.
const FAKE_NODE = [
  '#!/bin/sh',
  'printf \'%s|NODE_OPTIONS=%s|PREFLIGHT=%s\\n\' "$*" "${NODE_OPTIONS-<unset>}" "${PREFLIGHT_NODE_OPTIONS-<unset>}" >> "$FAKE_NODE_LOG"',
  'case "$*" in *entry-preflight-cli.js*) exit "${FAKE_PREFLIGHT_EXIT:-0}";; esac',
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

function run(env: Record<string, string>): { status: number | null; calls: string[] } {
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  const result = spawnSync('sh', [ENTRYPOINT, 'dist/main.js'], {
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

describe('tools/docker/entrypoint.sh', () => {
  it('[PR3-SEC-13] runs the preflight without NODE_OPTIONS, then execs the app with it and --disable-sigusr1', () => {
    const { status, calls } = run({ NODE_OPTIONS: '--max-old-space-size=512', FAKE_PREFLIGHT_EXIT: '0' });
    expect(status).toBe(0);
    expect(calls).toEqual([
      '--disable-sigusr1 /app/packages/config/dist/entry-preflight-cli.js|NODE_OPTIONS=<unset>|PREFLIGHT=--max-old-space-size=512',
      '--disable-sigusr1 --enable-source-maps dist/main.js|NODE_OPTIONS=--max-old-space-size=512|PREFLIGHT=<unset>',
    ]);
  });

  it('[PR3-SEC-13] a refused preflight stops with its exit code and never starts the app', () => {
    const { status, calls } = run({ NODE_OPTIONS: '--inspect-wait=0.0.0.0:9229', FAKE_PREFLIGHT_EXIT: '78' });
    expect(status).toBe(78);
    expect(calls).toEqual([
      '--disable-sigusr1 /app/packages/config/dist/entry-preflight-cli.js|NODE_OPTIONS=<unset>|PREFLIGHT=--inspect-wait=0.0.0.0:9229',
    ]);
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
      '--disable-sigusr1 /app/packages/config/dist/entry-preflight-cli.js|NODE_OPTIONS=<unset>|PREFLIGHT=',
      '--disable-sigusr1 --enable-source-maps dist/main.js|NODE_OPTIONS=<unset>|PREFLIGHT=<unset>',
    ]);
  });
});
