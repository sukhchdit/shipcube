/**
 * Entrypoint preflight (TASK-014; D-ORCH-007 item 2; PR3-SEC-13; PR3-SEC-11 R3.4 item 2; ADR-0018 am. 8; PR20-SEC-04
 * item 2; PR39-SEC-02; PR9-SEC-04 item 3). The container behaviour (`docker run -e APP_ENV=staging -e
 * NODE_OPTIONS=--inspect-wait=…` exits 78 and nothing listens on 9229) is proven by the TASK-014 stack suite; here
 * the decision table and the CLI.
 */
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { ECS_METADATA_KEYS } from './environment.js';
import {
  ALLOWED_NODE_OPTION_NAMES,
  argvAfterSeparator,
  entryPreflightIssues,
  isAllowedNodeOptions,
  isHardenedPreflightEnv,
  PREFLIGHT_EXIT_CODE,
  PREFLIGHT_NODE_OPTIONS_KEY,
  RDS_CA_BUNDLE_PATH,
  runEntryPreflight,
} from './entry-preflight.js';

const hardened = { APP_ENV: 'staging', NODE_ENV: 'production', APP_LOG_LEVEL: 'info' } as const;
/** The image CMD: the only argv a hardened environment accepts. */
const ARGV: readonly string[] = ['dist/main.js'];
const keysOf = (env: Record<string, string | undefined>, argv: readonly string[] = ARGV): string[] =>
  entryPreflightIssues(env, argv).map((issue) => issue.key);
const forbidden = (key: string, rule: string): unknown => ({ key, code: 'forbidden-in-environment', rule });

describe('entryPreflightIssues', () => {
  it.each(['local', 'test'])('refuses nothing with APP_ENV=%s outside ECS (argv ignored too)', (appEnv) => {
    const env = { APP_ENV: appEnv, NODE_ENV: 'development', NODE_OPTIONS: '--inspect=0.0.0.0:9229', PGOPTIONS: '-c x=y' };
    expect(entryPreflightIssues(env, ARGV)).toEqual([]);
    expect(entryPreflightIssues(env, ['--inspect=0.0.0.0:9229', 'dist/main.js'])).toEqual([]);
    expect(entryPreflightIssues({ ...env, SSL_CERT_FILE: '/tmp/x.pem', NODE_TLS_REJECT_UNAUTHORIZED: '0' }, [])).toEqual([]);
  });

  it.each(['staging', 'production'])('accepts a clean %s environment', (appEnv) => {
    expect(entryPreflightIssues({ ...hardened, APP_ENV: appEnv, [PREFLIGHT_NODE_OPTIONS_KEY]: '' }, ARGV)).toEqual([]);
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
    expect(entryPreflightIssues({ ...hardened, [PREFLIGHT_NODE_OPTIONS_KEY]: value }, ARGV)).toEqual([
      forbidden('NODE_OPTIONS', 'nodeOptions.allowList'),
    ]);
  });

  it.each([
    ['', true],
    ['--max-old-space-size=512', true],
    ['--max-old-space-size=512 --enable-source-maps', true],
    ['--dns-result-order=ipv4first', true],
    ['--use-bundled-ca', true],
    ['--unhandled-rejections=strict', true],
    ['--unhandled-rejections=throw --enable-source-maps', true],
    ['--max_old_space_size=256', false],
    // Architect R4 / R1-n6: no system CA store in the runtime image, so --use-openssl-ca has no legitimate use.
    ['--use-openssl-ca', false],
    ['--use-openssl-ca=1', false],
    // R1-n6: --unhandled-rejections may only make a rejection fatal.
    ['--unhandled-rejections=none', false],
    ['--unhandled-rejections=warn', false],
    ['--unhandled-rejections=warn-with-error-code', false],
    ['--unhandled-rejections', false],
    ['--unhandled-rejections=', false],
    ['--unhandled-rejections=STRICT', false],
  ])('[R4/R1-n6] NODE_OPTIONS %p allowed: %p', (value, allowed) => {
    expect(isAllowedNodeOptions(value)).toBe(allowed);
    expect(keysOf({ ...hardened, [PREFLIGHT_NODE_OPTIONS_KEY]: value })).toEqual(allowed ? [] : ['NODE_OPTIONS']);
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
    expect(entryPreflightIssues({ ...hardened, NODE_ENV: nodeEnv }, ARGV)).toEqual([forbidden('NODE_ENV', 'nodeEnv.production')]);
  });

  it.each(['error', 'fatal', 'silent'])('[PR20-SEC-04] refuses APP_LOG_LEVEL=%s', (level) => {
    expect(entryPreflightIssues({ ...hardened, APP_LOG_LEVEL: level }, ARGV)).toEqual([forbidden('APP_LOG_LEVEL', 'logLevel.floor')]);
  });

  it('the allow-list holds no preload, inspector, policy, condition or OpenSSL CA-store switch', () => {
    const forbiddenName = /require|import|loader|inspect|debug|policy|permission|config|condition|eval|snapshot|openssl/;
    expect([...ALLOWED_NODE_OPTION_NAMES].filter((name) => forbiddenName.test(name))).toEqual([]);
  });
});

describe('container argv (PR39-SEC-02 (a), R1-m1)', () => {
  it.each([[['dist/main.js']], [['dist/worker/main.js']], [['dist/main-1.0_x.js']]])('accepts argv %j', (argv) => {
    expect(entryPreflightIssues(hardened, argv)).toEqual([]);
  });

  it.each([
    [['--inspect=0.0.0.0:9229', 'dist/main.js']],
    [['--import=data:text/javascript,x', 'dist/main.js']],
    [['dist/main.js', '--inspect']],
    [[]],
    [['dist/../x.js']],
    [['dist/a/../../x.js']],
    [['/tmp/x.js']],
    [['-e', '1']],
    [['dist/main.js', 'dist/main.js']],
    [['dist/.js']],
    [['dist/main.mjs']],
    [['./dist/main.js']],
    [['dist/main.js ']],
    [['']],
  ])('refuses argv %j, naming CMD only', (argv) => {
    expect(entryPreflightIssues(hardened, argv)).toEqual([forbidden('CMD', 'argv.entryOnly')]);
  });

  it('the CLI takes the arguments after the first `--`, and none without one', () => {
    expect(argvAfterSeparator(['--', 'dist/main.js'])).toEqual(['dist/main.js']);
    expect(argvAfterSeparator(['--', '--inspect', 'dist/main.js'])).toEqual(['--inspect', 'dist/main.js']);
    expect(argvAfterSeparator(['--', 'dist/main.js', '--', 'x'])).toEqual(['dist/main.js', '--', 'x']);
    expect(argvAfterSeparator(['--'])).toEqual([]);
    expect(argvAfterSeparator(['dist/main.js'])).toEqual([]);
  });
});

describe('ECS second signal (PR39-SEC-02 (b))', () => {
  it.each([...ECS_METADATA_KEYS])('APP_ENV=local with %s set is hardened: an --import NODE_OPTIONS is refused', (ecsKey) => {
    const env = {
      APP_ENV: 'local',
      NODE_ENV: 'production',
      [ecsKey]: 'x',
      [PREFLIGHT_NODE_OPTIONS_KEY]: '--import=data:text/javascript,1',
    };
    expect(isHardenedPreflightEnv(env)).toBe(true);
    expect(entryPreflightIssues(env, ARGV)).toEqual([forbidden('NODE_OPTIONS', 'nodeOptions.allowList')]);
  });

  it('APP_ENV=test inside ECS refuses the argv and every hardened rule', () => {
    expect(
      keysOf({ APP_ENV: 'test', ECS_CONTAINER_METADATA_URI_V4: 'x', NODE_ENV: 'test', PGHOST: 'h' }, ['--inspect', 'dist/main.js']),
    ).toEqual(['CMD', 'PGHOST', 'NODE_ENV']);
  });

  it('an empty ECS variable does not harden APP_ENV=local', () => {
    const env = {
      APP_ENV: 'local',
      ECS_CONTAINER_METADATA_URI_V4: '',
      ECS_CONTAINER_METADATA_URI: '',
      NODE_OPTIONS: '--import=data:text/javascript,1',
    };
    expect(isHardenedPreflightEnv(env)).toBe(false);
    expect(entryPreflightIssues(env, [])).toEqual([]);
  });
});

describe('trust store and TLS verification (PR39-SEC-02 (c), PR9-SEC-04 item 3)', () => {
  it('accepts NODE_EXTRA_CA_CERTS only at the RDS bundle path', () => {
    expect(RDS_CA_BUNDLE_PATH).toBe('/etc/ssl/platform/rds-global-bundle.pem');
    expect(entryPreflightIssues({ ...hardened, NODE_EXTRA_CA_CERTS: RDS_CA_BUNDLE_PATH }, ARGV)).toEqual([]);
  });

  it.each([
    '/tmp/x.pem',
    '',
    '/etc/ssl/platform/../platform/rds-global-bundle.pem',
    '/etc/ssl/platform/rds-global-bundle.pem ',
    '/etc/ssl/platform/RDS-global-bundle.pem',
  ])('refuses NODE_EXTRA_CA_CERTS=%p', (value) => {
    expect(entryPreflightIssues({ ...hardened, NODE_EXTRA_CA_CERTS: value }, ARGV)).toEqual([
      forbidden('NODE_EXTRA_CA_CERTS', 'caBundle.allowList'),
    ]);
  });

  it.each([
    ['SSL_CERT_FILE', '/tmp/x.pem'],
    ['SSL_CERT_FILE', ''],
    ['SSL_CERT_DIR', '/tmp'],
    ['SSL_CERT_DIR', ''],
  ])('refuses %s=%p (present at all, even empty)', (key, value) => {
    expect(entryPreflightIssues({ ...hardened, [key]: value }, ARGV)).toEqual([forbidden(key, 'caStore.fixed')]);
  });

  it.each(['0', '', 'false', '01'])('refuses NODE_TLS_REJECT_UNAUTHORIZED=%p', (value) => {
    expect(entryPreflightIssues({ ...hardened, NODE_TLS_REJECT_UNAUTHORIZED: value }, ARGV)).toEqual([
      forbidden('NODE_TLS_REJECT_UNAUTHORIZED', 'tls.verify'),
    ]);
  });

  it('accepts NODE_TLS_REJECT_UNAUTHORIZED=1', () => {
    expect(entryPreflightIssues({ ...hardened, NODE_TLS_REJECT_UNAUTHORIZED: '1' }, ARGV)).toEqual([]);
  });
});

describe('runEntryPreflight', () => {
  it('returns 0 and writes nothing when clean', () => {
    const written: string[] = [];
    expect(runEntryPreflight(hardened, { stderr: { write: (chunk: string) => written.push(chunk) } }, ARGV)).toBe(0);
    expect(written).toEqual([]);
  });

  it('returns 78 and names variables (and CMD), never values or argument text', () => {
    const written: string[] = [];
    const secretish = 'local-only-should-never-print';
    const code = runEntryPreflight(
      {
        ...hardened,
        [PREFLIGHT_NODE_OPTIONS_KEY]: `--require=${secretish}`,
        PGPASSWORD: secretish,
        NODE_EXTRA_CA_CERTS: `/tmp/${secretish}.pem`,
        SSL_CERT_DIR: `/tmp/${secretish}`,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      },
      { stderr: { write: (chunk: string) => written.push(chunk) } },
      [`--import=data:text/javascript,${secretish}`, '--inspect=0.0.0.0:9229', 'dist/main.js'],
    );
    expect(code).toBe(PREFLIGHT_EXIT_CODE);
    const out = written.join('');
    expect(out).toContain('entrypoint preflight refused (exit 78)');
    for (const line of [
      'CMD: forbidden-in-environment: argv.entryOnly',
      'NODE_OPTIONS: forbidden-in-environment: nodeOptions.allowList',
      'NODE_EXTRA_CA_CERTS: forbidden-in-environment: caBundle.allowList',
      'SSL_CERT_DIR: forbidden-in-environment: caStore.fixed',
      'NODE_TLS_REJECT_UNAUTHORIZED: forbidden-in-environment: tls.verify',
      'PGPASSWORD: forbidden-in-environment: pg.environment',
    ]) {
      expect(out).toContain(line);
    }
    for (const leaked of [secretish, '--import', '--inspect', '9229', 'dist/main.js', '/tmp']) expect(out).not.toContain(leaked);
  });
});

describe('entry-preflight-cli', () => {
  const root = resolve(process.cwd());
  const cli = join(root, 'packages', 'config', 'src', 'entry-preflight-cli.ts');
  const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const run = (env: Record<string, string>, args: readonly string[]) => {
    const base: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
    const result = spawnSync(process.execPath, [tsx, cli, ...args], {
      env: { ...base, ...env },
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    });
    if (result.error !== undefined) throw result.error;
    return result;
  };

  it('exits 78 on a refused environment or argv and 0 on a clean one', () => {
    const refused = run({ ...hardened, [PREFLIGHT_NODE_OPTIONS_KEY]: '--inspect-wait=0.0.0.0:9229' }, ['--', 'dist/main.js']);
    expect(refused.status).toBe(78);
    expect(refused.stderr).toContain('NODE_OPTIONS: forbidden-in-environment: nodeOptions.allowList');
    const argv = run({ ...hardened }, ['--', '--inspect=0.0.0.0:9229', 'dist/main.js']);
    expect(argv.status).toBe(78);
    expect(argv.stderr).toContain('CMD: forbidden-in-environment: argv.entryOnly');
    expect(argv.stderr).not.toContain('9229');
    expect(run({ ...hardened }, []).status).toBe(78);
    expect(run({ ...hardened }, ['--', 'dist/main.js']).status).toBe(0);
  }, 60_000);

  it('in process: reads process.env and the argv after the first --, and sets process.exitCode', async () => {
    // The spawned runs above prove the exit codes; this one measures the module itself (the diff-coverage gate counts
    // only in-process coverage). A hardened environment accepts exactly the entry argv, so 0 proves the `--` split.
    const saved = { env: process.env, argv: process.argv, exitCode: process.exitCode };
    process.env = { ...hardened };
    process.argv = [process.execPath, 'entry-preflight-cli.js', '--', 'dist/main.js'];
    try {
      await import('./entry-preflight-cli.js');
      expect(process.exitCode).toBe(0);
    } finally {
      process.env = saved.env;
      process.argv = saved.argv;
      process.exitCode = saved.exitCode;
    }
  });
});
