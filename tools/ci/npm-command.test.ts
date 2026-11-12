/**
 * npm-command (TASK-007; PR #10 review M1; SEC-TC-32/45, ADR-0023 am. J item 1 (c), D-ARCH-040): the pinned npm
 * command-word table matches the installed npm, and every ignore-scripts spelling npm honours is classified.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  INSTALL_COMMANDS,
  INSTALL_WORDS,
  REBUILD_COMMANDS,
  REBUILD_WORDS,
  commandCandidates,
  isInstallWord,
  npmInvocations,
  shellWords,
  writesIgnoreScriptsConfig,
} from './npm-command.mjs';

/** The npm that runs this suite: `npm run test:unit` sets npm_execpath; otherwise the copy bundled next to node. */
function npmDir(): string {
  const candidates = [
    process.env.npm_execpath === undefined ? undefined : join(dirname(process.env.npm_execpath), '..'),
    join(dirname(process.execPath), 'node_modules', 'npm'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm'),
  ];
  const found = candidates.find((dir) => dir !== undefined && existsSync(join(dir, 'lib', 'utils', 'cmd-list.js')));
  if (found === undefined) throw new Error(`npm not found next to ${process.execPath}`);
  return found;
}

describe('npm command words (drift against the installed npm)', () => {
  const require = createRequire(join(npmDir(), 'package.json'));
  const cmdList = require('./lib/utils/cmd-list.js') as {
    commands: string[];
    aliases: Record<string, string>;
    deref: (word: string) => string | undefined;
  };
  const abbrev = require('abbrev') as (list: string[]) => Record<string, string>;
  const words = Object.keys(abbrev([...cmdList.commands, ...Object.keys(cmdList.aliases)]));

  it('INSTALL_WORDS is exactly the set of words npm derefs to ci/install/install-test/install-ci-test', () => {
    const expected = words.filter((word) => INSTALL_COMMANDS.includes(cmdList.deref(word) ?? '')).sort();
    expect([...INSTALL_WORDS].sort()).toEqual(expected);
  });

  it('REBUILD_WORDS is exactly the set of words npm derefs to rebuild', () => {
    const expected = words.filter((word) => REBUILD_COMMANDS.includes(cmdList.deref(word) ?? '')).sort();
    expect([...REBUILD_WORDS].sort()).toEqual(expected);
  });

  it.each(['cleanInstall', 'installCiTest', 'installTest', 'isntallClean'])('camelCase %s installs, as npm derefs it', (word) => {
    expect(INSTALL_COMMANDS).toContain(cmdList.deref(word));
    expect(isInstallWord(word)).toBe(true);
  });

  it('non-install commands are not install words', () => {
    for (const word of ['run', 'run-script', 'exec', 'x', 'audit', 'config', 'ls', 'test', 'pack']) {
      expect(INSTALL_COMMANDS).not.toContain(cmdList.deref(word));
      expect(isInstallWord(word)).toBe(false);
    }
  });
});

describe('npmInvocations: install classification', () => {
  it.each([
    'npm ci',
    'npm clean-install',
    'npm ic',
    'npm install-clean',
    'npm isntall-clean',
    'npm cit',
    'npm clean-install-test',
    'npm sit',
    'npm it',
    'npm install-test',
    'npm i',
    'npm in',
    'npm ins',
    'npm inst',
    'npm insta',
    'npm instal',
    'npm isnt',
    'npm isntal',
    'npm isntall',
    'npm add left-pad',
    'npm install-cl',
    'npm --prefix app ci',
    'npm -w apps/api install',
    'npm --loglevel=warn ci',
    '/usr/local/bin/npm ci',
    'x=$(npm ci)',
  ])('%s installs', (segment) => {
    expect(npmInvocations(segment).some((invocation) => invocation.install)).toBe(true);
  });

  it.each(['npm run ci', 'npm run build', 'npm exec --no -- commitlint', 'npm audit signatures', 'echo npm', 'npm test'])(
    '%s does not install',
    (segment) => {
      expect(npmInvocations(segment).some((invocation) => invocation.install)).toBe(false);
    },
  );

  it('rebuild aliases are classified as rebuild', () => {
    for (const segment of ['npm rebuild bcrypt', 'npm rb', 'npm rebu']) expect(npmInvocations(segment)[0]?.rebuild).toBe(true);
  });

  it('command candidates stop at the first word not preceded by a bare option', () => {
    expect(commandCandidates(['--prefix', 'app', 'ci', 'x'])).toEqual(['app', 'ci']);
    expect(commandCandidates(['--loglevel=warn', 'run', 'ci'])).toEqual(['run']);
  });
});

describe('npmInvocations: ignore-scripts forms (npm 11 semantics, probed)', () => {
  it.each([
    'npm ci --ignore-scripts',
    'npm ci --ignore-scripts=true',
    'npm ci --ignore-scripts true',
    'npm ci --no-audit --ignore-scripts --no-fund',
  ])('%s keeps scripts off', (segment) => {
    const [invocation] = npmInvocations(segment);
    expect(invocation?.overrides).toEqual([]);
    expect(invocation?.scriptsOff).toBe(true);
  });

  it.each([
    ['--ignore-scripts false', 'npm ci --ignore-scripts false'],
    ['--ignore-scripts FALSE', 'npm ci --ignore-scripts FALSE'],
    ['--ignore-scripts=false', 'npm ci --ignore-scripts=false'],
    ['--ignore-scripts=0', 'npm ci --ignore-scripts=0'],
    ['--ignore-scripts=', 'npm ci --ignore-scripts='],
    ['--no-ignore-scripts', 'npm ci --no-ignore-scripts'],
    ['abbreviation --ig false', 'npm ci --ig false'],
    ['abbreviation --ignore-script=false', 'npm ci --ignore-script=false'],
    ['abbreviation --no-ignore', 'npm ci --no-ignore'],
    ['single dash -ig false', 'npm ci -ig false'],
    ['later occurrence wins', 'npm ci --ignore-scripts=true --ignore-scripts false'],
    ['quoted words', `npm ci "--ignore-scripts" 'false'`],
    ['env prefix', 'npm_config_ignore_scripts=false npm ci --ignore-scripts'],
    ['env prefix, upper case', 'NPM_CONFIG_IGNORE_SCRIPTS=0 npm ci --ignore-scripts'],
    ['npm config set', 'npm config set ignore-scripts false'],
    ['npm set key=value', 'npm set ignore-scripts=false'],
  ])('%s is an override', (_name, segment) => {
    const [invocation] = npmInvocations(segment);
    expect(invocation?.overrides.length).toBeGreaterThan(0);
    expect(invocation?.scriptsOff).toBe(false);
  });

  it('an install without any ignore-scripts form is not scripts-off', () => {
    expect(npmInvocations('npm clean-install')[0]?.scriptsOff).toBe(false);
  });

  it('unrelated tools with --ignore-* options are not npm invocations', () => {
    expect(npmInvocations('eslint --ignore-pattern dist --ignore false')).toEqual([]);
  });
});

describe('writesIgnoreScriptsConfig', () => {
  it.each(['echo "ignore-scripts=false" >> .npmrc', 'export npm_config_ignore_scripts=false', "printf 'ignore_scripts = 0'"])(
    '%s sets ignore-scripts to non-true',
    (segment) => {
      expect(writesIgnoreScriptsConfig(segment)).toBe(true);
    },
  );

  it.each(['echo "ignore-scripts=true" >> .npmrc', 'export NPM_CONFIG_IGNORE_SCRIPTS=true', 'npm ci --ignore-scripts'])(
    '%s does not',
    (segment) => {
      expect(writesIgnoreScriptsConfig(segment)).toBe(false);
    },
  );
});

describe('shellWords', () => {
  it('splits on whitespace outside quotes and removes quotes and escapes', () => {
    expect(shellWords(`npm ci "--ignore-scripts" 'a b' c\\ d`)).toEqual(['npm', 'ci', '--ignore-scripts', 'a b', 'c d']);
  });
});
