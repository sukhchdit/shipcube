/**
 * PR3-SEC-14 (TASK-014): `checkToolingEnv` applies the DATABASE_URL rules to a tooling one-shot's URL, value-free;
 * PR39-SEC-02 / R1-n9: the ECS second signal and the PG* refusal of a hardened environment.
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { checkToolingEnv, formatToolingIssues } from './tooling-env.js';

const KEY = 'DATABASE_MIGRATOR_URL';
/** Generated at run time: no credential-shaped literal is committed. */
const PASSWORD = randomBytes(12).toString('hex');
const VERIFIED = `postgresql://platform_migrator:${PASSWORD}@db.internal:5432/platform?sslmode=verify-full`;
const PLAIN = `postgresql://platform_migrator:${PASSWORD}@postgres:5432/platform`;

const check = (env: Record<string, string | undefined>): unknown => checkToolingEnv(env, KEY);

describe('checkToolingEnv (PR3-SEC-14)', () => {
  it.each(['local', 'test'])('APP_ENV=%s accepts a plain URL, sslmode=disable and a local-only password', (appEnv) => {
    expect(check({ APP_ENV: appEnv, [KEY]: PLAIN })).toEqual([]);
    expect(check({ APP_ENV: appEnv, [KEY]: `${PLAIN}?sslmode=disable` })).toEqual([]);
    expect(check({ APP_ENV: appEnv, [KEY]: 'postgresql://u:local-only-pw@postgres/platform', NODE_TLS_REJECT_UNAUTHORIZED: '0' })).toEqual(
      [],
    );
  });

  it.each(['staging', 'production'])('APP_ENV=%s accepts exactly one sslmode=verify-full on a TCP host', (appEnv) => {
    expect(check({ APP_ENV: appEnv, [KEY]: VERIFIED })).toEqual([]);
    expect(check({ APP_ENV: appEnv, [KEY]: `${VERIFIED}&sslnegotiation=direct`, NODE_TLS_REJECT_UNAUTHORIZED: '1' })).toEqual([]);
    expect(check({ APP_ENV: appEnv, [KEY]: VERIFIED.replace('postgresql:', 'postgres:'), NODE_TLS_REJECT_UNAUTHORIZED: '' })).toEqual([]);
  });

  it.each([
    ['no sslmode', PLAIN, [{ key: KEY, code: 'insecure-transport' }]],
    ['sslmode=disable', `${PLAIN}?sslmode=disable`, [{ key: KEY, code: 'insecure-transport' }]],
    ['sslmode=require', `${PLAIN}?sslmode=require`, [{ key: KEY, code: 'insecure-transport' }]],
    [
      'a percent-encoded socket host',
      `postgresql://u:${PASSWORD}@%2Ftmp/platform?sslmode=verify-full`,
      [{ key: KEY, code: 'insecure-transport' }],
    ],
    [
      'a repeated sslmode',
      `${VERIFIED}&sslmode=verify-full`,
      [
        { key: KEY, code: 'invalid', rule: 'databaseUrl.queryParameter' },
        { key: KEY, code: 'insecure-transport' },
      ],
    ],
    ['a placeholder password', VERIFIED.replace(PASSWORD, 'CHANGE_ME'), [{ key: KEY, code: 'placeholder' }]],
    ['a local-only password', VERIFIED.replace(PASSWORD, 'local-only-migrator'), [{ key: KEY, code: 'placeholder' }]],
  ])('APP_ENV=staging refuses %s', (_label, url, expected) => {
    expect(check({ APP_ENV: 'staging', [KEY]: url })).toEqual(expected);
    expect(check({ APP_ENV: 'production', [KEY]: url })).toEqual(expected);
  });

  it.each(['0', 'false', 'yes'])('APP_ENV=production refuses NODE_TLS_REJECT_UNAUTHORIZED=%s, naming the variable', (value) => {
    expect(check({ APP_ENV: 'production', [KEY]: VERIFIED, NODE_TLS_REJECT_UNAUTHORIZED: value })).toEqual([
      { key: 'NODE_TLS_REJECT_UNAUTHORIZED', code: 'forbidden-in-environment', rule: 'tls.rejectUnauthorized' },
    ]);
  });

  it.each([
    ['sslmode=no-verify', `${PLAIN}?sslmode=no-verify`, 'databaseUrl.parameterValue'],
    ['sslmode=bogus', `${PLAIN}?sslmode=bogus`, 'databaseUrl.parameterValue'],
    ['sslrootcert=system', `${PLAIN}?sslmode=verify-full&sslrootcert=system`, 'databaseUrl.parameterValue'],
    ['a relative sslrootcert', `${PLAIN}?sslmode=verify-full&sslrootcert=root.pem`, 'databaseUrl.parameterValue'],
    ['options', `${PLAIN}?options=-c%20search_path%3Dpublic`, 'databaseUrl.queryParameter'],
    ['a non-postgres scheme', `mysql://u:${PASSWORD}@postgres/platform`, 'databaseUrl.protocol'],
  ])('refuses %s in every APP_ENV (the runtime parameter rules)', (_label, url, rule) => {
    for (const appEnv of ['local', 'test']) expect(check({ APP_ENV: appEnv, [KEY]: url })).toEqual([{ key: KEY, code: 'invalid', rule }]);
    expect(check({ APP_ENV: 'staging', [KEY]: url })).toContainEqual({ key: KEY, code: 'invalid', rule });
  });

  it('refuses a value the WHATWG parser cannot read (protocol rule locally; insecure in staging too)', () => {
    const dsn = `host=db.internal user=platform_migrator password=${PASSWORD}`;
    expect(check({ APP_ENV: 'local', [KEY]: dsn })).toEqual([{ key: KEY, code: 'invalid', rule: 'databaseUrl.protocol' }]);
    expect(check({ APP_ENV: 'staging', [KEY]: dsn })).toEqual([
      { key: KEY, code: 'invalid', rule: 'databaseUrl.protocol' },
      { key: KEY, code: 'insecure-transport' },
    ]);
  });

  it('reports a missing or empty URL, and a missing or unknown APP_ENV (fail closed)', () => {
    expect(check({ APP_ENV: 'local' })).toEqual([{ key: KEY, code: 'missing' }]);
    expect(check({ APP_ENV: 'staging', [KEY]: '' })).toEqual([{ key: KEY, code: 'missing' }]);
    expect(check({ [KEY]: PLAIN })).toEqual([{ key: 'APP_ENV', code: 'missing' }]);
    expect(check({ APP_ENV: '', [KEY]: PLAIN })).toEqual([{ key: 'APP_ENV', code: 'missing' }]);
    expect(check({ APP_ENV: 'prod', [KEY]: PLAIN })).toEqual([{ key: 'APP_ENV', code: 'invalid' }]);
    expect(check({})).toEqual([
      { key: 'APP_ENV', code: 'missing' },
      { key: KEY, code: 'missing' },
    ]);
  });

  it('checks the variable it is given and leaves DATABASE_URL alone', () => {
    expect(
      checkToolingEnv({ APP_ENV: 'staging', DATABASE_BOOTSTRAP_URL: PLAIN, DATABASE_URL: VERIFIED }, 'DATABASE_BOOTSTRAP_URL'),
    ).toEqual([{ key: 'DATABASE_BOOTSTRAP_URL', code: 'insecure-transport' }]);
    expect(
      checkToolingEnv({ APP_ENV: 'staging', DATABASE_BOOTSTRAP_URL: VERIFIED, DATABASE_URL: PLAIN }, 'DATABASE_BOOTSTRAP_URL'),
    ).toEqual([]);
  });

  it('never carries the value in an issue or the formatted line', () => {
    const url = `${PLAIN.replace(PASSWORD, 'CHANGE_ME')}?sslmode=no-verify&options=x`;
    const issues = checkToolingEnv({ APP_ENV: 'production', [KEY]: url, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, KEY);
    const line = formatToolingIssues(issues);
    expect(line).toBe(
      `${KEY} (invalid: databaseUrl.queryParameter), ${KEY} (insecure-transport), ${KEY} (placeholder), NODE_TLS_REJECT_UNAUTHORIZED (forbidden-in-environment: tls.rejectUnauthorized)`,
    );
    expect(JSON.stringify(issues)).not.toContain('CHANGE_ME');
    expect(line).not.toContain('no-verify');
  });
});

describe('checkToolingEnv: the ECS signal and PG* variables (PR39-SEC-02, R1-n9)', () => {
  it.each(['ECS_CONTAINER_METADATA_URI', 'ECS_CONTAINER_METADATA_URI_V4'])(
    'APP_ENV=local with %s set refuses APP_ENV (appEnv.ecsTask) even with a plain URL',
    (ecsKey) => {
      expect(check({ APP_ENV: 'local', [ecsKey]: 'x', [KEY]: PLAIN })).toEqual([
        { key: 'APP_ENV', code: 'forbidden-in-environment', rule: 'appEnv.ecsTask' },
      ]);
    },
  );

  it('APP_ENV=test inside ECS also refuses every PG* variable', () => {
    expect(check({ APP_ENV: 'test', ECS_CONTAINER_METADATA_URI_V4: 'x', [KEY]: PLAIN, PGHOST: 'h' })).toEqual([
      { key: 'APP_ENV', code: 'forbidden-in-environment', rule: 'appEnv.ecsTask' },
      { key: 'PGHOST', code: 'forbidden-in-environment', rule: 'pg.environment' },
    ]);
  });

  it('an empty ECS variable is no signal', () => {
    expect(check({ APP_ENV: 'local', ECS_CONTAINER_METADATA_URI_V4: '', [KEY]: PLAIN, PGHOST: 'h' })).toEqual([]);
  });

  it.each([
    ['PGOPTIONS', ''],
    ['PGOPTIONS', '-c statement_timeout=0'],
    ['PGSSLMODE', 'disable'],
    ['PGHOST', 'db.internal'],
    ['PGPASSWORD', PASSWORD],
  ])('APP_ENV=staging refuses %s=%p by name (even empty)', (name, value) => {
    expect(check({ APP_ENV: 'staging', [KEY]: VERIFIED, [name]: value })).toEqual([
      { key: name, code: 'forbidden-in-environment', rule: 'pg.environment' },
    ]);
    expect(check({ APP_ENV: 'production', [KEY]: VERIFIED, [name]: value })).toEqual([
      { key: name, code: 'forbidden-in-environment', rule: 'pg.environment' },
    ]);
  });

  it('a missing or unknown APP_ENV is hardened for PG* too (fail closed), and a missing URL does not hide them', () => {
    expect(check({ [KEY]: PLAIN, PGHOST: 'h' })).toEqual([
      { key: 'APP_ENV', code: 'missing' },
      { key: 'PGHOST', code: 'forbidden-in-environment', rule: 'pg.environment' },
    ]);
    expect(check({ APP_ENV: 'staging', PGOPTIONS: '' })).toEqual([
      { key: KEY, code: 'missing' },
      { key: 'PGOPTIONS', code: 'forbidden-in-environment', rule: 'pg.environment' },
    ]);
  });

  it.each(['local', 'test'])('APP_ENV=%s outside ECS accepts PG* variables', (appEnv) => {
    expect(check({ APP_ENV: appEnv, [KEY]: PLAIN, PGHOST: 'postgres', PGOPTIONS: '' })).toEqual([]);
  });

  it('names PG* variables only, never their values', () => {
    const line = formatToolingIssues(checkToolingEnv({ APP_ENV: 'staging', [KEY]: VERIFIED, PGPASSWORD: PASSWORD }, KEY));
    expect(line).toBe('PGPASSWORD (forbidden-in-environment: pg.environment)');
    expect(line).not.toContain(PASSWORD);
  });
});
