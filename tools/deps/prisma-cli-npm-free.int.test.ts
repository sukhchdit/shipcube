/**
 * PR9-SEC-15 (LOW; TASK-014): npm is out of the Prisma child chain. A scratch `.npmrc` with `script-shell=<marker
 * shell>` and `node-options=--require <probe>`, the same setting in the environment, and an `npm_execpath` pointing at
 * a planted `npm-cli.js` leave no marker after `runPrisma(['--version'])`, while the positive control (plain
 * `npm exec --no -- prisma --version` from the repository root with the same environment) writes the preload marker.
 *
 * Integration project: it runs the real Prisma CLI against the verified schema engine installed by
 * `npm run deps:rebuild` (offline: cached mode), which the unit lane does not assume.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { npmCli } from './npm-cli.mjs';
import { runPrisma } from './prisma-cli.mjs';
import { REPO_ROOT } from './prisma-engines.mjs';

const dir = mkdtempSync(join(tmpdir(), 'prisma-npm-free-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const preloadMarker = join(dir, 'preloaded.marker');
const shellMarker = join(dir, 'script-shell.marker');
const execpathMarker = join(dir, 'execpath.marker');
const probe = join(dir, 'probe.cjs');
writeFileSync(probe, `require('node:fs').writeFileSync(${JSON.stringify(preloadMarker)}, 'preloaded');\n`);
const shell = join(dir, process.platform === 'win32' ? 'shell.cmd' : 'shell.sh');
writeFileSync(
  shell,
  process.platform === 'win32'
    ? `@echo x> "${shellMarker}"\r\n@cmd.exe %*\r\n`
    : `#!/bin/sh\necho x > "${shellMarker}"\nexec /bin/sh "$@"\n`,
);
chmodSync(shell, 0o755);
const plantedNpm = join(dir, 'npm-cli.js');
writeFileSync(plantedNpm, `require('node:fs').writeFileSync(${JSON.stringify(execpathMarker)}, 'ran');\n`);
const preload = `--require "${probe.replaceAll('\\', '/')}"`;
const userrc = join(dir, 'user.npmrc');
writeFileSync(userrc, `node-options=${preload}\nscript-shell=${shell.replaceAll('\\', '/')}\n`);
// The positive control plants the preload only: on Windows npm cannot start a `.cmd` script-shell at all (EINVAL), so a
// script-shell in its .npmrc would fail the control for an unrelated reason.
const controlrc = join(dir, 'control.npmrc');
writeFileSync(controlrc, `node-options=${preload}\n`);

/** The hostile environment: npm settings from a scratch user .npmrc and the env, plus a planted npm_execpath. */
const hostileEnv = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key) && key.toUpperCase() !== 'NODE_OPTIONS')),
  npm_config_userconfig: userrc,
  npm_config_node_options: preload,
  npm_config_cache: join(dir, 'npm-cache'),
  npm_config_update_notifier: 'false',
  npm_execpath: plantedNpm,
});

const clearMarkers = () => [preloadMarker, shellMarker, execpathMarker].forEach((marker) => rmSync(marker, { force: true }));

describe('[PR9-SEC-15] runPrisma never goes through npm', () => {
  it('positive control: plain npm exec of the Prisma CLI picks up the planted node-options preload', () => {
    clearMarkers();
    const result = spawnSync(process.execPath, [npmCli(), 'exec', '--no', '--', 'prisma', '--version'], {
      cwd: REPO_ROOT,
      env: { ...hostileEnv(), npm_config_userconfig: controlrc },
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
    });
    if (result.error !== undefined) throw result.error;
    expect(existsSync(preloadMarker)).toBe(true);
  }, 150_000);

  it('runPrisma([--version]) exits 0 and leaves no preload, script-shell or npm_execpath marker', async () => {
    clearMarkers();
    const code = await runPrisma(['--version'], { env: hostileEnv() });
    expect(code).toBe(0);
    expect({ preload: existsSync(preloadMarker), shell: existsSync(shellMarker), execpath: existsSync(execpathMarker) }).toEqual({
      preload: false,
      shell: false,
      execpath: false,
    });
  }, 150_000);
});
