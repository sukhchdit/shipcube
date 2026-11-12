import { describe, expect, it } from '@jest/globals';

import { isAllowListedPostgresUrl, isInspectorOption, localAppEnvOnEcsGuard, nodeOptionTokens, toolingKeyGuard } from './guards.js';

describe('APP_ENV=local|test on ECS (PR3-SEC-03 option (b), D-ORCH-007)', () => {
  it.each(['local', 'test'] as const)('refuses APP_ENV=%s when an ECS task-metadata variable is present', (appEnv) => {
    expect(localAppEnvOnEcsGuard({ raw: {}, values: {}, appEnv, ecsMetadataKeys: ['ECS_CONTAINER_METADATA_URI_V4'] })).toEqual([
      { key: 'APP_ENV', code: 'forbidden-in-environment', rule: 'appEnv.ecsTask' },
    ]);
  });

  it('accepts local without the signal, and hardened or unknown environments with it', () => {
    expect(localAppEnvOnEcsGuard({ raw: {}, values: {}, appEnv: 'local' })).toEqual([]);
    for (const appEnv of ['staging', 'production', undefined] as const) {
      expect(localAppEnvOnEcsGuard({ raw: {}, values: {}, appEnv, ecsMetadataKeys: ['ECS_CONTAINER_METADATA_URI'] })).toEqual([]);
    }
  });
});

describe('NODE_OPTIONS tokenizer (PR3-SEC-01, m2)', () => {
  it.each([
    ['plain tokens', '--a  --b=1', ['--a', '--b=1']],
    ['tabs and newlines separate tokens', '--a\t--b\n--c', ['--a', '--b', '--c']],
    ['double quotes group and are removed', '"--a b" --c', ['--a b', '--c']],
    ['quotes inside a token', '--inspect"_brk=0"', ['--inspect_brk=0']],
    ['backslash escapes inside quotes', String.raw`"--a=\"x y\"" --b`, ['--a="x y"', '--b']],
    ['backslash is literal outside quotes', String.raw`--a\b`, [String.raw`--a\b`]],
    ['an empty quoted token', '"" --a', ['', '--a']],
    ['single quotes are kept (Node does not strip them)', "'--a'", ["'--a'"]],
    ['empty input', '   ', []],
  ])('%s', (_label, input, tokens) => {
    expect(nodeOptionTokens(input)).toEqual(tokens);
  });

  it.each([
    '--inspect',
    '--inspect-brk=0',
    '--inspect_wait',
    "'--inspect'",
    '--debug-port=1',
    '--Inspect-Port=1',
    '--inspect-publish-uid=http',
  ])('%s is an inspector option', (token) => {
    expect(isInspectorOption(token)).toBe(true);
  });

  it.each(['--max-old-space-size=512', '--enable-source-maps', '--conditions=inspect', '', '-i'])(
    '%s is not an inspector option',
    (token) => {
      expect(isInspectorOption(token)).toBe(false);
    },
  );
});

describe('tooling key guard (PR-0003 §4, PR-0005 §4)', () => {
  it('refuses tooling keys by name in hardened environments only', () => {
    expect(toolingKeyGuard({ raw: {}, values: {}, appEnv: 'production', toolingKeys: ['DATABASE_BOOTSTRAP_URL'] })).toEqual([
      { key: 'DATABASE_BOOTSTRAP_URL', code: 'forbidden-in-environment', rule: 'toolingKey' },
    ]);
    expect(toolingKeyGuard({ raw: {}, values: {}, appEnv: 'local', toolingKeys: ['DATABASE_BOOTSTRAP_URL'] })).toEqual([]);
    expect(toolingKeyGuard({ raw: {}, values: {}, appEnv: 'staging' })).toEqual([]);
  });
});

describe('PostgreSQL URL allow-list shared with the seed CLI (PR3-SEC-12, PR13-SEC-03)', () => {
  const base = 'postgresql://platform_migrator:pw@db.internal:5432/platform';

  it.each(['', '?sslmode=verify-full', '?sslmode=require&application_name=seed&connect_timeout=5'])('accepts %p', (query) => {
    expect(isAllowListedPostgresUrl(new URL(`${base}${query}`))).toBe(true);
  });

  it.each([
    '?options=-c%20search_path%3Dpublic',
    '?statement_timeout=0',
    '?idle_in_transaction_session_timeout=0',
    '?host=/tmp',
    '?hostaddr=10.0.0.1',
    '?search_path=public',
    '?ssl=0',
    '?sslmode=verify-full&sslmode=disable',
  ])('refuses %p', (query) => {
    expect(isAllowListedPostgresUrl(new URL(`${base}${query}`))).toBe(false);
  });

  it('refuses an empty or percent-encoded host (Unix socket)', () => {
    expect(isAllowListedPostgresUrl(new URL('postgresql:///platform'))).toBe(false);
    expect(isAllowListedPostgresUrl(new URL('postgresql://u:pw@%2Ftmp/platform'))).toBe(false);
  });
});
