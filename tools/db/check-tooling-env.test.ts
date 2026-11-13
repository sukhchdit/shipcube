/**
 * PR3-SEC-14 (TASK-014): the tooling environment CLI the Compose migrate one-shot calls. Exit 0 or exit 1, variable
 * names only; the subprocess case runs the file the way the tooling image does (`node <tsx cli> <file> <VAR>`).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { main } from './check-tooling-env.js';
import { REPO_ROOT } from './lint-migrations.js';

const PASSWORD = randomBytes(12).toString('hex');
const PLAIN = `postgresql://platform_migrator:${PASSWORD}@postgres:5432/platform`;
const VERIFIED = `${PLAIN.replace('@postgres:', '@db.internal:')}?sslmode=verify-full`;

function run(argv: readonly string[], env: Record<string, string>): { code: number; lines: string[] } {
  const lines: string[] = [];
  const code = main(argv, env, (line) => lines.push(line));
  return { code, lines };
}

describe('check-tooling-env CLI (PR3-SEC-14)', () => {
  it('exits 0 silently for an acceptable URL', () => {
    expect(run(['DATABASE_MIGRATOR_URL'], { APP_ENV: 'local', DATABASE_MIGRATOR_URL: PLAIN })).toEqual({ code: 0, lines: [] });
    expect(run(['DATABASE_MIGRATOR_URL'], { APP_ENV: 'production', DATABASE_MIGRATOR_URL: VERIFIED })).toEqual({ code: 0, lines: [] });
  });

  it.each([
    ['plain TCP in staging', { APP_ENV: 'staging', DATABASE_MIGRATOR_URL: PLAIN }, 'DATABASE_MIGRATOR_URL (insecure-transport)'],
    [
      'a placeholder in production',
      { APP_ENV: 'production', DATABASE_MIGRATOR_URL: VERIFIED.replace(PASSWORD, 'local-only-pw') },
      'DATABASE_MIGRATOR_URL (placeholder)',
    ],
    [
      'NODE_TLS_REJECT_UNAUTHORIZED=0 in staging',
      { APP_ENV: 'staging', DATABASE_MIGRATOR_URL: VERIFIED, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      'NODE_TLS_REJECT_UNAUTHORIZED (forbidden-in-environment: tls.rejectUnauthorized)',
    ],
    [
      'sslmode=no-verify locally',
      { APP_ENV: 'local', DATABASE_MIGRATOR_URL: `${PLAIN}?sslmode=no-verify` },
      'DATABASE_MIGRATOR_URL (invalid: databaseUrl.parameterValue)',
    ],
    ['an unset variable', { APP_ENV: 'local' }, 'DATABASE_MIGRATOR_URL (missing)'],
  ])('exits 1 on %s, naming variables only', (_label, env, named) => {
    const { code, lines } = run(['DATABASE_MIGRATOR_URL'], env);
    expect(code).toBe(1);
    expect(lines).toEqual([`[check-tooling-env] DATABASE_MIGRATOR_URL refused: ${named}`]);
    expect(lines.join('')).not.toContain(PASSWORD);
    expect(lines.join('')).not.toContain('local-only-pw');
  });

  it.each([[[]], [['database_url']], [['DATABASE_URL', 'EXTRA']], [[`postgresql://u:${PASSWORD}@h/db`]]])(
    'exits 1 with a usage line for argv %j, never echoing it',
    (argv) => {
      const { code, lines } = run(argv, { APP_ENV: 'local', DATABASE_URL: PLAIN });
      expect(code).toBe(1);
      expect(lines).toEqual(['[check-tooling-env] usage: check-tooling-env.ts <VARIABLE_NAME>']);
    },
  );

  it('runs as the tooling image runs it: exit code and stderr only', () => {
    const tsx = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const file = join(REPO_ROOT, 'tools', 'db', 'check-tooling-env.ts');
    const base = { PATH: process.env['PATH'] ?? '', SYSTEMROOT: process.env['SYSTEMROOT'] ?? '' };
    const spawn = (env: Record<string, string>): { status: number | null; stdout: string; stderr: string } =>
      // tsx's own --conditions flag, as the seed line of tools/docker/tooling-entrypoint.sh passes it.
      spawnSync(process.execPath, [tsx, '--conditions=@platform/source', file, 'DATABASE_MIGRATOR_URL'], {
        cwd: REPO_ROOT,
        env: { ...base, ...env },
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
      });
    const ok = spawn({ APP_ENV: 'staging', DATABASE_MIGRATOR_URL: VERIFIED });
    expect(ok.status).toBe(0);
    expect(ok.stdout + ok.stderr).toBe('');
    const refused = spawn({ APP_ENV: 'staging', DATABASE_MIGRATOR_URL: PLAIN });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toBe('[check-tooling-env] DATABASE_MIGRATOR_URL refused: DATABASE_MIGRATOR_URL (insecure-transport)\n');
  }, 60_000);
});
