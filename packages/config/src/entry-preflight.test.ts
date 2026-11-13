/**
 * Entrypoint preflight (TASK-014; D-ORCH-007 item 2; PR3-SEC-13; PR3-SEC-11 R3.4 item 2; ADR-0018 am. 8; PR20-SEC-04
 * item 2). The container behaviour (`docker run -e APP_ENV=staging -e NODE_OPTIONS=--inspect-wait=…` exits 78 and
 * nothing listens on 9229) is proven by the TASK-014 stack suite; here the decision table and the CLI.
 */
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  ALLOWED_NODE_OPTION_NAMES,
  entryPreflightIssues,
  isAllowedNodeOptions,
  PREFLIGHT_EXIT_CODE,
  PREFLIGHT_NODE_OPTIONS_KEY,
  runEntryPreflight,
} from './entry-preflight.js';

const hardened = { APP_ENV: 'staging', NODE_ENV: 'production', APP_LOG_LEVEL: 'info' } as const;
const keysOf = (env: Record<string, string | undefined>): string[] => entryPreflightIssues(env).map((issue) => issue.key);

describe('entryPreflightIssues', () => {
  it.each(['local', 'test'])('refuses nothing with APP_ENV=%s', (appEnv) => {
    expect(
      entryPreflightIssues({ APP_ENV: appEnv, NODE_ENV: 'development', NODE_OPTIONS: '--inspect=0.0.0.0:9229', PGOPTIONS: '-c x=y' }),
    ).toEqual([]);
  });

  it.each(['staging', 'production'])('accepts a clean %s environment', (appEnv) => {
    expect(entryPreflightIssues({ ...hardened, APP_ENV: appEnv, [PREFLIGHT_NODE_OPTIONS_KEY]: '' })).toEqual([]);
  });

  it.each([undefined, '', 'prod', 'LOCAL'])('treats APP_ENV=%p as hardened (fail closed)', (appEnv) => {
    expect(keysOf({ APP_ENV: appEnv, NODE_ENV: 'development' })).toEqual(['NODE_ENV']);
  });

  it.each([
    '--inspect-wait=0.0.0.0:9229',
    '--inspect',
    '--inspect-brk=9229',
    '"--inspect"',
    '--max-old-space-size=512 --inspect',
    '--require /tmp/probe.js',
    '--require=/tmp/probe.js',
    '--import=data:text/javascript,1',
    '--experimental-config-file=/tmp/c.json',
    '--conditions=@platform/source',
    '-r /tmp/probe.js',
    '--max-old-space-size 512',
    '--MAX-OLD-SPACE-SIZE=512',
    '--max-old-space-size=512\\ --inspect',
    '--dns-result-order=ipv4first/../x',
  ])('[PR3-SEC-13] refuses NODE_OPTIONS %p', (value) => {
    expect(entryPreflightIssues({ ...hardened, [PREFLIGHT_NODE_OPTIONS_KEY]: value })).toEqual([
      { key: 'NODE_OPTIONS', code: 'forbidden-in-environment', rule: 'nodeOptions.allowList' },
    ]);
  });

  it.each([
    '',
    '--max-old-space-size=512',
    '--max-old-space-size=512 --enable-source-maps',
    '--dns-result-order=ipv4first',
    '--max_old_space_size=256',
  ])('accepts NODE_OPTIONS %p', (value) => {
    expect(isAllowedNodeOptions(value)).toBe(value !== '--max_old_space_size=256');
  });

  it('falls back to NODE_OPTIONS itself when the entrypoint did not set PREFLIGHT_NODE_OPTIONS', () => {
    expect(keysOf({ ...hardened, NODE_OPTIONS: '--inspect' })).toEqual(['NODE_OPTIONS']);
    expect(keysOf({ ...hardened, NODE_OPTIONS: '--inspect', [PREFLIGHT_NODE_OPTIONS_KEY]: '' })).toEqual([]);
  });

  it('[PR3-SEC-11] refuses every PG* variable, even empty, naming each one', () => {
    expect(keysOf({ ...hardened, PGOPTIONS: '-c statement_timeout=0', PGSSLMODE: '', PGHOST: 'x' })).toEqual([
      'PGOPTIONS',
      'PGSSLMODE',
      'PGHOST',
    ]);
  });

  it.each(['development', 'test', undefined])('[ADR-0018 am. 8] refuses NODE_ENV=%p', (nodeEnv) => {
    expect(entryPreflightIssues({ ...hardened, NODE_ENV: nodeEnv })).toEqual([
      { key: 'NODE_ENV', code: 'forbidden-in-environment', rule: 'nodeEnv.production' },
    ]);
  });

  it.each(['error', 'fatal', 'silent'])('[PR20-SEC-04] refuses APP_LOG_LEVEL=%s', (level) => {
    expect(entryPreflightIssues({ ...hardened, APP_LOG_LEVEL: level })).toEqual([
      { key: 'APP_LOG_LEVEL', code: 'forbidden-in-environment', rule: 'logLevel.floor' },
    ]);
  });

  it('the allow-list holds no preload, inspector, policy or condition switch', () => {
    const forbidden = /require|import|loader|inspect|debug|policy|permission|config|condition|eval|snapshot/;
    expect([...ALLOWED_NODE_OPTION_NAMES].filter((name) => forbidden.test(name))).toEqual([]);
  });
});

describe('runEntryPreflight', () => {
  it('returns 0 and writes nothing when clean', () => {
    const written: string[] = [];
    expect(runEntryPreflight(hardened, { stderr: { write: (chunk: string) => written.push(chunk) } })).toBe(0);
    expect(written).toEqual([]);
  });

  it('returns 78 and names variables, never values', () => {
    const written: string[] = [];
    const secretish = 'local-only-should-never-print';
    const code = runEntryPreflight(
      { ...hardened, [PREFLIGHT_NODE_OPTIONS_KEY]: `--require=${secretish}`, PGPASSWORD: secretish },
      { stderr: { write: (chunk: string) => written.push(chunk) } },
    );
    expect(code).toBe(PREFLIGHT_EXIT_CODE);
    const out = written.join('');
    expect(out).toContain('entrypoint preflight refused (exit 78)');
    expect(out).toContain('NODE_OPTIONS: forbidden-in-environment: nodeOptions.allowList');
    expect(out).toContain('PGPASSWORD: forbidden-in-environment: pg.environment');
    expect(out).not.toContain(secretish);
  });
});

describe('entry-preflight-cli', () => {
  const root = resolve(process.cwd());
  const cli = join(root, 'packages', 'config', 'src', 'entry-preflight-cli.ts');
  const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const run = (env: Record<string, string>) => {
    const base: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
    const result = spawnSync(process.execPath, [tsx, cli], {
      env: { ...base, ...env },
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    });
    if (result.error !== undefined) throw result.error;
    return result;
  };

  it('exits 78 on a refused environment and 0 on a clean one', () => {
    const refused = run({ ...hardened, [PREFLIGHT_NODE_OPTIONS_KEY]: '--inspect-wait=0.0.0.0:9229' });
    expect(refused.status).toBe(78);
    expect(refused.stderr).toContain('NODE_OPTIONS: forbidden-in-environment: nodeOptions.allowList');
    expect(run({ ...hardened }).status).toBe(0);
  });
});
