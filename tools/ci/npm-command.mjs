// @ts-check
/**
 * npm command-line semantics shared by check-install-flags and check-workflow-policy (PR #10 review M1;
 * SEC-TC-32/45, ADR-0023 am. J item 1 (c), D-ARCH-040).
 *
 * Lifecycle scripts must stay off for every install. Two npm behaviours make a plain `npm (ci|install)` regex unsound:
 *   1. Command words. npm resolves a command through its alias table and unique abbreviations
 *      (`lib/utils/cmd-list.js` `deref`): `clean-install`, `ic`, `cit`, `it`, `sit`, `si`, `ins`, `isnt`, `install-cl`
 *      and camelCase forms such as `cleanInstall` all install. INSTALL_WORDS / REBUILD_WORDS below are every word that
 *      npm 11.19.1 derefs to `ci`, `install`, `install-test`, `install-ci-test` or `rebuild`; `npm-command.test.ts`
 *      recomputes them from the installed npm and fails when npm's table changes.
 *   2. Flag forms. `ignore-scripts` is a boolean config: `--ignore-scripts false` consumes the bare `false`, a later
 *      occurrence wins, `--no-ignore-scripts` negates, abbreviations down to `--ig` expand, and a single dash works
 *      (`-ig false`). Any of these on the command line overrides both NPM_CONFIG_IGNORE_SCRIPTS and `.npmrc`.
 *      The only accepted forms are the bare `--ignore-scripts` (not followed by a bare `false`/`true` word that sets it
 *      false) and `--ignore-scripts=true`; every other spelling is reported as an override (fail closed).
 *
 * Pure functions, `node:` free: this module is imported by the base-ref gates before `npm ci`.
 */

/** Command words npm 11.19.1 derefs to an installing command (ci, install, install-test, install-ci-test). */
export const INSTALL_WORDS = Object.freeze([
  'add',
  'ci',
  'cit',
  'clean-install',
  'clean-install-',
  'clean-install-t',
  'clean-install-te',
  'clean-install-tes',
  'clean-install-test',
  'i',
  'ic',
  'in',
  'ins',
  'inst',
  'insta',
  'instal',
  'install',
  'install-ci',
  'install-ci-',
  'install-ci-t',
  'install-ci-te',
  'install-ci-tes',
  'install-ci-test',
  'install-cl',
  'install-cle',
  'install-clea',
  'install-clean',
  'install-t',
  'install-te',
  'install-tes',
  'install-test',
  'isnt',
  'isnta',
  'isntal',
  'isntall',
  'isntall-',
  'isntall-c',
  'isntall-cl',
  'isntall-cle',
  'isntall-clea',
  'isntall-clean',
  'it',
  'si',
  'sit',
]);

/** Command words npm 11.19.1 derefs to `rebuild`. */
export const REBUILD_WORDS = Object.freeze(['rb', 'reb', 'rebu', 'rebui', 'rebuil', 'rebuild']);

/** The npm commands INSTALL_WORDS / REBUILD_WORDS resolve to (used by the drift test). */
export const INSTALL_COMMANDS = Object.freeze(['ci', 'install', 'install-ci-test', 'install-test']);
export const REBUILD_COMMANDS = Object.freeze(['rebuild']);

const INSTALL_SET = new Set(INSTALL_WORDS);
const REBUILD_SET = new Set(REBUILD_WORDS);
const FLAG = 'ignore-scripts';

/**
 * npm's camelCase translation (`installTest` -> `install-test`), as in cmd-list.js `deref`.
 * @param {string} word
 */
export function kebabCommand(word) {
  return /[A-Z]/.test(word) ? word.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`) : word;
}

/** @param {string} word */
export const isInstallWord = (word) => INSTALL_SET.has(kebabCommand(word));
/** @param {string} word */
export const isRebuildWord = (word) => REBUILD_SET.has(kebabCommand(word));

/**
 * Splits one command segment into shell words: whitespace outside quotes separates, quotes are removed, a backslash
 * outside single quotes escapes the next character. Approximate by design (no expansion); it only has to recover the
 * words npm would see for the literal command lines this repository writes.
 * @param {string} segment
 * @returns {string[]}
 */
export function shellWords(segment) {
  /** @type {string[]} */
  const words = [];
  let current = '';
  let inWord = false;
  /** @type {string | null} */
  let quote = null;
  for (let i = 0; i < segment.length; i += 1) {
    const c = segment.charAt(i);
    if (quote !== null) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < segment.length) current += segment.charAt(++i);
      else current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      inWord = true;
    } else if (c === '\\' && i + 1 < segment.length) {
      current += segment.charAt(++i);
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) words.push(current);
      current = '';
      inWord = false;
    } else {
      current += c;
      inWord = true;
    }
  }
  if (inWord) words.push(current);
  return words;
}

/**
 * True when a shell word invokes npm: `npm`, a path ending in `/npm`, `npm.cmd`, or `npm-cli.js`, also behind a
 * command-substitution or subshell opener (`$(npm`, `` `npm ``, `(npm`).
 * @param {string} word
 */
export function isNpmWord(word) {
  const bare = word.replace(/^.*[(`]/, '');
  const name = bare.slice(bare.lastIndexOf('/') + 1);
  return name === 'npm' || name === 'npm.cmd' || name === 'npm-cli.js';
}

/**
 * Classifies one `ignore-scripts`-shaped option word.
 * @param {string} word
 * @returns {{ kind: 'canonical-bare' | 'canonical-true' | 'override', word: string } | null} null when the word is
 *   not an ignore-scripts option.
 */
function ignoreScriptsOption(word) {
  const match = /^-{1,2}(no-)?([A-Za-z][A-Za-z_-]*)(?:=(.*))?$/s.exec(word);
  if (!match) return null;
  const name = (match[2] ?? '').toLowerCase();
  if (name.length < 2 || !FLAG.startsWith(name.replace(/_/g, '-'))) return null;
  const negated = match[1] !== undefined;
  const value = match[3];
  if (!negated && word.startsWith('--') && match[2] === FLAG) {
    if (value === undefined) return { kind: 'canonical-bare', word };
    if (value === 'true') return { kind: 'canonical-true', word };
  }
  return { kind: 'override', word };
}

/**
 * @typedef {object} NpmInvocation
 * @property {string[]} args the words after the npm word (up to a `--` terminator)
 * @property {string[]} commands the candidate command words (see `commandCandidates`)
 * @property {boolean} install a candidate installs (INSTALL_WORDS)
 * @property {boolean} rebuild a candidate rebuilds (REBUILD_WORDS)
 * @property {boolean} scriptsOff the last ignore-scripts form is a canonical `true` and there is no override
 * @property {string[]} overrides every spelling that re-enables lifecycle scripts or is not canonical
 */

/**
 * Candidate command words: the non-option words up to and including the first one that does not directly follow an
 * option written without `=` (such a word may be the option's value, e.g. `npm --prefix app ci`). Over-approximates
 * on purpose (`npm --silent run ci` counts `ci`): a false positive only asks for an explicit `--ignore-scripts`.
 * @param {string[]} args
 * @returns {string[]}
 */
export function commandCandidates(args) {
  /** @type {string[]} */
  const out = [];
  let afterBareOption = false;
  for (const word of args) {
    if (word.startsWith('-') && word !== '-') {
      afterBareOption = !word.includes('=');
      continue;
    }
    out.push(word);
    if (!afterBareOption) break;
    afterBareOption = false;
  }
  return out;
}

/**
 * Every npm invocation in one command segment, with its install classification and ignore-scripts state.
 * @param {string} segment
 * @returns {NpmInvocation[]}
 */
export function npmInvocations(segment) {
  // A closing subshell / command substitution is not part of the word npm sees: `$(npm ci)`, `(npm ci --ignore-scripts)`.
  const words = shellWords(segment).map((word) => word.replace(/[)`]+$/, ''));
  /** @type {NpmInvocation[]} */
  const out = [];
  for (const [index, word] of words.entries()) {
    if (!isNpmWord(word)) continue;
    const rest = words.slice(index + 1);
    const end = rest.indexOf('--');
    const args = end === -1 ? rest : rest.slice(0, end);
    const commands = commandCandidates(args);
    /** @type {string[]} */
    const overrides = [];
    /** @type {boolean | undefined} */
    let value;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i] ?? '';
      const option = ignoreScriptsOption(arg);
      if (option === null) {
        // `npm config set ignore-scripts false`, `npm set ignore-scripts=false`: a positional key=value write.
        const positional = /^ignore[-_]scripts(?:=(.*))?$/is.exec(arg);
        if (positional && !arg.startsWith('-')) {
          const assigned = positional[1] ?? args[i + 1];
          if (assigned !== 'true') overrides.push(`${arg}${positional[1] === undefined && assigned !== undefined ? ` ${assigned}` : ''}`);
        }
        continue;
      }
      if (option.kind === 'override') {
        overrides.push(option.word);
        continue;
      }
      if (option.kind === 'canonical-bare') {
        const next = (args[i + 1] ?? '').toLowerCase();
        if (next === 'false') {
          overrides.push(`${arg} ${args[i + 1] ?? ''}`);
          i += 1;
          continue;
        }
        if (next === 'true') i += 1;
      }
      value = true;
    }
    for (const prefix of words.slice(0, index)) {
      const env = /^npm_config_ignore[-_]scripts=(.*)$/is.exec(prefix);
      if (env && (env[1] ?? '').toLowerCase() !== 'true') overrides.push(prefix);
    }
    out.push({
      args,
      commands,
      install: commands.some(isInstallWord),
      rebuild: commands.some(isRebuildWord),
      scriptsOff: value === true && overrides.length === 0,
      overrides,
    });
  }
  return out;
}

/**
 * A segment without an npm invocation that sets `ignore-scripts` to anything but true: config text
 * (`echo "ignore-scripts=false" >> .npmrc`) or an environment assignment (`export npm_config_ignore_scripts=0`).
 * npm segments report the same through `NpmInvocation.overrides`.
 * @param {string} segment
 */
export function writesIgnoreScriptsConfig(segment) {
  if (npmInvocations(segment).length > 0) return false;
  return (
    /(?<![-\w])ignore[-_]scripts\s*=\s*["']?(?!true\b)/i.test(segment) ||
    /\bnpm_config_ignore[-_]scripts\s*=\s*["']?(?!true\b)/i.test(segment)
  );
}
