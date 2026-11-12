import { describe, expect, it } from '@jest/globals';

import { isInspectorOption, nodeOptionTokens, toolingKeyGuard } from './guards.js';

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
