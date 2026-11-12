import { describe, expect, it } from '@jest/globals';

import { isInspectorOption, localAppEnvOnEcsGuard, nodeOptionTokens, tlsVerificationGuard, toolingKeyGuard } from './guards.js';

describe('NODE_TLS_REJECT_UNAUTHORIZED guard (PR9-SEC-04)', () => {
  const refused = [{ key: 'NODE_TLS_REJECT_UNAUTHORIZED', code: 'forbidden-in-environment', rule: 'tls.rejectUnauthorized' }];

  it.each(['staging', 'production'] as const)('refuses an override in %s @security', (appEnv) => {
    expect(tlsVerificationGuard({ raw: {}, values: {}, appEnv, tlsVerificationOverridden: true })).toEqual(refused);
  });

  it('accepts hardened environments without an override (unset, empty or 1) and local/test or unknown with one', () => {
    for (const appEnv of ['staging', 'production'] as const) {
      expect(tlsVerificationGuard({ raw: {}, values: {}, appEnv })).toEqual([]);
      expect(tlsVerificationGuard({ raw: {}, values: {}, appEnv, tlsVerificationOverridden: false })).toEqual([]);
    }
    for (const appEnv of ['local', 'test', undefined] as const) {
      expect(tlsVerificationGuard({ raw: {}, values: {}, appEnv, tlsVerificationOverridden: true })).toEqual([]);
    }
  });
});

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
