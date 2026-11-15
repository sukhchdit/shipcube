/**
 * PR9-SEC-02 / PR9-SEC-15: npm copies its `node-options` setting (env, any `.npmrc` layer) into `NODE_OPTIONS` for the
 * bin it runs, and an `.npmrc` `script-shell` chooses the shell that starts it. Since TASK-014 the Prisma CLI is no
 * longer started through npm at all (`prismaArgv`: `process.execPath <prisma CLI entry>`), and `npmCli()` no longer
 * trusts `npm_execpath`.
 *
 * This proof runs the REAL npm of the running Node against a tiny local bin in a scratch directory (no engine, no
 * network, no install): the bin reports the `NODE_OPTIONS` it received, and a `--require` probe writes a marker file
 * if it was ever preloaded. Every source has a positive control (`npm exec`) that must show the preload, so the green
 * direct-start case cannot come from a probe that never worked. The same proof against the real Prisma CLI through
 * `runPrisma` is `prisma-cli-npm-free.int.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { npmCli } from './npm-cli.mjs';
import { prismaArgv } from './prisma-engines.mjs';

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

/** The scratch bin started the way `prismaArgv` starts the Prisma CLI: `process.execPath <entry>`, no npm. */
function direct(box: Scratch, env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [join(box.dir, 'show.cjs')], {
    cwd: box.dir,
    env,
    encoding: 'utf8',
    timeout: NPM_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  expect(result.status).toBe(0);
  const { nodeOptions } = JSON.parse(result.stdout) as { nodeOptions: string };
  return { nodeOptions, preloaded: existsSync(box.marker) };
}

describe('[PR9-SEC-02, PR9-SEC-15] npm hands its node-options to the bin it runs, so Prisma never runs through npm', () => {
  it('[PR9-SEC-15] the Prisma argv is the CLI entry for process.execPath: no npm-cli.js, no exec', () => {
    const argv = prismaArgv(['--version']);
    expect(argv.at(-1)).toBe('--version');
    expect(argv.some((arg) => arg.endsWith('npm-cli.js') || arg === 'exec')).toBe(false);
  });

  it.each(SOURCES)(
    '%s: positive control preloads under npm exec; the direct start used for Prisma does not',
    (_name, plant) => {
      const box = scratch();
      const env = hermeticEnv(box, plant(box));

      const control = npmExec(box, ['--no'], env);
      expect(control.nodeOptions).toContain('probe.cjs');
      expect(control.preloaded).toBe(true);

      rmSync(box.marker, { force: true });
      expect(direct(box, env)).toEqual({ nodeOptions: '', preloaded: false });
    },
    NPM_TIMEOUT_MS * 2,
  );

  it('[PR9-SEC-15] npmCli ignores npm_execpath and returns the npm installed with the running Node', () => {
    const box = scratch();
    const planted = join(box.dir, 'npm-cli.js');
    writeFileSync(planted, "require('node:fs').writeFileSync(process.argv[1] + '.ran', 'x');\n");
    const previous = process.env.npm_execpath;
    process.env.npm_execpath = planted;
    try {
      expect(npmCli()).not.toBe(planted);
      expect(npmCli()).toBe(npmCli(process.execPath));
      expect(npmCli().startsWith(join(process.execPath, '..', '..'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.npm_execpath;
      else process.env.npm_execpath = previous;
    }
  });
});
