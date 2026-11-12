/**
 * PR9-SEC-02: the Prisma child is npm (`node <npm-cli.js> exec … -- prisma`), and npm copies its `node-options`
 * setting into `NODE_OPTIONS` for the bin it runs. `prismaChildEnv` dropping `NODE_OPTIONS` is therefore not enough;
 * `PRISMA_NPM_EXEC_OPTIONS` (`--node-options=`) must neutralise every source npm reads the setting from.
 *
 * This proof runs the REAL npm of the running Node with exactly the production options, but against a tiny local bin
 * in a scratch directory instead of the Prisma CLI, so it needs no engine, no network and no install: the bin only
 * reports the `NODE_OPTIONS` it received, and a `--require` probe writes a marker file if it was ever preloaded. Every
 * source is paired with a positive control (the same run without `--node-options=`) that must show the preload, so a
 * green negative case cannot come from a probe that never worked.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { npmCli } from './npm-cli.mjs';
import { PRISMA_NPM_EXEC_OPTIONS, prismaExecArgs } from './prisma-engines.mjs';

const BIN = 'show-node-options';
const NPM_TIMEOUT_MS = 30_000;

interface Scratch {
  dir: string;
  marker: string;
  /** `--require "<probe.cjs>"`; forward slashes keep `.npmrc` (ini) escaping out of the way on Windows. */
  preload: string;
}

const scratches: string[] = [];
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A scratch npm project with one local bin, a preload probe and empty user/global npmrc files. */
function scratch(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), 'npm-node-options-'));
  scratches.push(dir);
  const marker = join(dir, 'preloaded.marker');
  const probe = join(dir, 'probe.cjs');
  writeFileSync(probe, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'preloaded');\n`);
  writeFileSync(join(dir, 'show.cjs'), "process.stdout.write(JSON.stringify({ nodeOptions: process.env.NODE_OPTIONS ?? '' }));\n");
  const bin = join(dir, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, BIN), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/../../show.cjs"\n`, { mode: 0o755 });
  writeFileSync(join(bin, `${BIN}.cmd`), `@"${process.execPath}" "%~dp0..\\..\\show.cjs"\r\n`);
  writeFileSync(join(dir, 'empty-user.npmrc'), '');
  writeFileSync(join(dir, 'empty-global.npmrc'), '');
  return { dir, marker, preload: `--require "${probe.replaceAll('\\', '/')}"` };
}

/**
 * The inherited environment without NODE_OPTIONS and without any npm_* variable (a run under `npm run` exports its
 * own config), pointed at the scratch user/global npmrc files, with the update notifier off and a scratch cache, so
 * npm stays offline and reads only what each case plants.
 */
function hermeticEnv(box: Scratch, extra: Record<string, string>): NodeJS.ProcessEnv {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key) && key.toUpperCase() !== 'NODE_OPTIONS'),
  );
  return {
    ...base,
    npm_config_userconfig: join(box.dir, 'empty-user.npmrc'),
    npm_config_globalconfig: join(box.dir, 'empty-global.npmrc'),
    npm_config_cache: join(box.dir, 'npm-cache'),
    npm_config_update_notifier: 'false',
    ...extra,
  };
}

function npmExec(box: Scratch, npmOptions: readonly string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [npmCli(), 'exec', ...npmOptions, '--', BIN], {
    cwd: box.dir,
    env,
    encoding: 'utf8',
    timeout: NPM_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: expect.any(String) });
  const { nodeOptions } = JSON.parse(result.stdout) as { nodeOptions: string };
  return { nodeOptions, preloaded: existsSync(box.marker) };
}

/** Each source plants `node-options=<probe>` its own way; values are the env additions for the run. */
const SOURCES: readonly [name: string, plant: (box: Scratch) => Record<string, string>][] = [
  ['env npm_config_node_options', (box) => ({ npm_config_node_options: box.preload })],
  ['env NPM_CONFIG_NODE_OPTIONS', (box) => ({ NPM_CONFIG_NODE_OPTIONS: box.preload })],
  [
    'user .npmrc named by npm_config_userconfig',
    (box) => {
      const rc = join(box.dir, 'attacker-user.npmrc');
      writeFileSync(rc, `node-options=${box.preload}\n`);
      return { npm_config_userconfig: rc };
    },
  ],
  [
    'project .npmrc',
    (box) => {
      writeFileSync(join(box.dir, '.npmrc'), `node-options=${box.preload}\n`);
      return {};
    },
  ],
];

describe('[PR9-SEC-02] npm exec with the Prisma npm options never hands a node-options preload to the bin', () => {
  it('the proof runs exactly the npm options the Prisma argv uses', () => {
    expect(prismaExecArgs([])).toEqual(['exec', ...PRISMA_NPM_EXEC_OPTIONS, '--', 'prisma']);
  });

  it.each(SOURCES)(
    '%s: positive control preloads without --node-options=, and the Prisma options neutralise it',
    (_name, plant) => {
      const box = scratch();
      const env = hermeticEnv(box, plant(box));

      const control = npmExec(box, ['--no'], env);
      expect(control.nodeOptions).toContain('probe.cjs');
      expect(control.preloaded).toBe(true);

      rmSync(box.marker, { force: true });
      const guarded = npmExec(box, PRISMA_NPM_EXEC_OPTIONS, env);
      expect(guarded).toEqual({ nodeOptions: '', preloaded: false });
    },
    NPM_TIMEOUT_MS * 2,
  );
});
