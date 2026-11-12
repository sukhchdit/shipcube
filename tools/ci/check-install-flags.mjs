// @ts-check
/**
 * Install-flag, npx and raw-Prisma gate (lane A; ADR-0023 amendments F item 1, I items 1-3 and 6, J items 1 (a)/(c),
 * 2 (d) and 6; D-ARCH-040, D-ARCH-041; SEC-TC-32, SEC-TC-45, SEC-TC-64; review item PR-0005 n8).
 *
 * Rules:
 *   npmrc                 root `.npmrc` and every `tools/isolated/<tool>/.npmrc` hold `ignore-scripts=true`,
 *                         `engine-strict=true`, `min-release-age=7` (last value wins) and the exact line
 *                         `@platform:registry=https://registry.invalid/`; an isolated tool lockfile without its `.npmrc` fails.
 *   install-flags         every npm install in workflows, Dockerfiles, compose files and package.json scripts, under
 *                         any npm alias or abbreviation (`ci`, `clean-install`, `ic`, `cit`, `it`, `sit`, `ins`,
 *                         `isnt`, `add`, camelCase forms; npm-command.mjs), carries a canonical `--ignore-scripts`;
 *                         no npm invocation re-enables scripts (`--ignore-scripts false`, `=false`, `--no-ignore-scripts`,
 *                         `--ig false`, `-ig false`, npm_config_ignore_scripts=…, `npm config set ignore-scripts …`) and
 *                         no command writes ignore-scripts config other than true.
 *   docker-install-order  a Dockerfile `npm ci`/`npm install` runs only in a stage that has COPY-ed `package-lock.json`
 *                         and `.npmrc` (directly or through its base stage).
 *   docker-omit-optional  a Dockerfile install with `--omit=dev` also carries `--omit=optional`.
 *   docker-npm-rebuild    no `npm rebuild` in Dockerfiles (am. J item 6: a failing prebuild is a build failure).
 *   npx                   no `npx`; `npm exec` only as `npm exec --no -- <bin>` (check-no-npx, am. I item 3).
 *   raw-prisma            no bare Prisma CLI invocation (check-no-raw-prisma, am. J item 2 (d)): Prisma runs through
 *                         `node tools/deps/prisma-cli.mjs <args>`.
 *   prisma-migrations-write  no INSERT/UPDATE/DELETE/TRUNCATE on `_prisma_migrations` outside prisma/tests/** (n8).
 *
 * Scope: the repository tree without node_modules, build output, docs, agent files and the anchored fixture trees in
 * SKIP_ROOTED (the seeded negative examples of these very rules).
 *
 * CLI: node tools/ci/check-install-flags.mjs [--root <dir>] [--summary <file>] [--json]
 * Exit 0 pass, 1 findings, 2 usage/internal error.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { npmInvocations, writesIgnoreScriptsConfig } from './npm-command.mjs';

/** @typedef {{ rule: string, message: string, location: string }} Finding */

export const REQUIRED_NPMRC = Object.freeze({ 'ignore-scripts': 'true', 'engine-strict': 'true', 'min-release-age': '7' });
export const PLATFORM_PIN_LINE = '@platform:registry=https://registry.invalid/';

/** Directory names skipped at any depth: dependencies, VCS data and build output. */
const SKIP_ANY = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.react-router']);
/**
 * Repository-relative directories skipped exactly (review n2: anchored, so a `fixtures/` or `generated/` folder anywhere
 * else is scanned): documentation, agent files, and the fixture trees that seed negative examples of these rules.
 */
const SKIP_ROOTED = new Set([
  'docs',
  '.claude',
  'tests/fixtures',
  'tests/generated',
  'tools/ci/fixtures',
  'tools/db/fixtures',
  'tools/deps/fixtures',
  'prisma/tests/fixtures',
  'packages/config/src/fixtures',
]);
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|sql)$/;
const MIGRATIONS_WRITE = /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:"?public"?\s*\.\s*)?"?_prisma_migrations\b/i;

/**
 * @param {string} text `.npmrc` content
 * @param {string} label
 * @returns {Finding[]}
 */
export function checkNpmrc(text, label) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Map<string, string>} */
  const values = new Map();
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  for (const [key, expected] of Object.entries(REQUIRED_NPMRC)) {
    if (values.get(key) !== expected)
      findings.push({ rule: 'npmrc', message: `${key}=${expected} is required (found ${values.get(key) ?? 'none'})`, location: label });
  }
  if (!lines.includes(PLATFORM_PIN_LINE) || values.get('@platform:registry') !== 'https://registry.invalid/') {
    findings.push({ rule: 'npmrc', message: `the exact line "${PLATFORM_PIN_LINE}" is required (D-ARCH-040)`, location: label });
  }
  return findings;
}

/**
 * Splits shell text into command segments (continuations joined, `#` comments dropped, split on && || ; |).
 * @param {string} text
 * @returns {{ text: string, line: number }[]}
 */
export function commandSegments(text) {
  /** @type {{ text: string, line: number }[]} */
  const out = [];
  const physical = text.split(/\r?\n/);
  for (let i = 0; i < physical.length; i += 1) {
    const start = i;
    let logical = physical[i] ?? '';
    while (/\\\s*$/.test(logical) && i + 1 < physical.length) {
      i += 1;
      logical = `${logical.replace(/\\\s*$/, ' ')}${physical[i] ?? ''}`;
    }
    let current = '';
    /** @type {string | null} */
    let quote = null;
    for (let k = 0; k < logical.length; k += 1) {
      const c = logical.charAt(k);
      if (quote !== null) {
        if (c === quote) quote = null;
        current += c;
      } else if (c === '"' || c === "'") {
        quote = c;
        current += c;
      } else if (c === '#' && (k === 0 || /\s/.test(logical.charAt(k - 1)))) break;
      else if (c === ';' || c === '|' || c === '&') {
        if (current.trim() !== '') out.push({ text: current.trim(), line: start + 1 });
        current = '';
      } else current += c;
    }
    if (current.trim() !== '') out.push({ text: current.trim(), line: start + 1 });
  }
  return out;
}

/** @param {string} segment */
const installs = (segment) => npmInvocations(segment).some((invocation) => invocation.install);
const RAW_PRISMA = [
  /(?:^|[\s"'(=`:])prisma\s+(?:generate|migrate|db|validate|format|version|init|studio|debug|introspect|-v\b|--version\b)/,
  /["']prisma["']\s*,/,
  /\.bin[/\\]prisma\b/,
  /prisma[/\\]build[/\\]index\.js/,
  /\bnpm\s+exec\b[^\n]*?\s--\s+prisma\b/,
];

/**
 * Rules shared by every command-bearing file.
 * @param {string} segment
 * @returns {{ rule: string, message: string }[]}
 */
export function segmentFindings(segment) {
  /** @type {{ rule: string, message: string }[]} */
  const out = [];
  const short = segment.slice(0, 100);
  for (const npm of npmInvocations(segment)) {
    if (npm.overrides.length > 0) {
      out.push({
        rule: 'install-flags',
        message: `a command re-enables lifecycle scripts or spells ignore-scripts non-canonically (${npm.overrides.join(', ')}): "${short}"`,
      });
    } else if (npm.install && !npm.scriptsOff) {
      out.push({ rule: 'install-flags', message: `npm install/ci (any alias) without --ignore-scripts: "${short}"` });
    }
  }
  if (writesIgnoreScriptsConfig(segment)) {
    out.push({ rule: 'install-flags', message: `a command sets ignore-scripts to something other than true: "${short}"` });
  }
  if (/(?:^|[\s(`$"'])(?:npx|bunx)(?:\s|$|["'])|\b(?:pnpm|yarn)\s+dlx\b/.test(segment)) {
    out.push({ rule: 'npx', message: `use \`npm exec --no -- <bin>\` instead of npx: "${short}"` });
  }
  if (/\bnpm\s+(?:exec|x|exe)\b/.test(segment) && !/\bnpm\s+exec\s+--no\s+--\s/.test(segment)) {
    out.push({ rule: 'npx', message: `\`npm exec\` must be \`npm exec --no -- <bin>\`: "${short}"` });
  }
  if (RAW_PRISMA.some((pattern) => pattern.test(segment))) {
    out.push({ rule: 'raw-prisma', message: `run Prisma through \`node tools/deps/prisma-cli.mjs <args>\`: "${short}"` });
  }
  return out;
}

/**
 * @param {string} text Dockerfile content
 * @param {string} label
 * @returns {Finding[]}
 */
export function checkDockerfile(text, label) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Map<string, { lock: boolean, npmrc: boolean }>} */
  const stages = new Map();
  let state = { lock: false, npmrc: false };
  const physical = text.split(/\r?\n/);
  for (let i = 0; i < physical.length; i += 1) {
    const lineNo = i + 1;
    let logical = physical[i] ?? '';
    while (/\\\s*$/.test(logical) && i + 1 < physical.length) {
      i += 1;
      const next = physical[i] ?? '';
      if (/^\s*#/.test(next)) continue;
      logical = `${logical.replace(/\\\s*$/, ' ')}${next}`;
    }
    const match = /^\s*([A-Za-z]+)\s+(.*)$/.exec(logical);
    if (!match || logical.trimStart().startsWith('#')) continue;
    const instruction = (match[1] ?? '').toUpperCase();
    const args = (match[2] ?? '').trim();
    const where = `${label}:${lineNo}`;
    if (instruction === 'FROM') {
      const from = /^(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(args);
      const base = stages.get((from?.[1] ?? '').toLowerCase());
      state = base ? { ...base } : { lock: false, npmrc: false };
      if (from?.[2]) stages.set(from[2].toLowerCase(), state);
      else stages.set(`#${stages.size}`, state);
    } else if (instruction === 'COPY' || instruction === 'ADD') {
      /** @type {string[]} */
      let tokens;
      if (args.replace(/^(?:--\S+\s+)*/, '').startsWith('[')) {
        try {
          const parsed = /** @type {unknown} */ (JSON.parse(args.replace(/^(?:--\S+\s+)*/, '')));
          tokens = Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          tokens = [];
        }
      } else tokens = args.split(/\s+/).filter((token) => !token.startsWith('--'));
      const sources = tokens.slice(0, -1);
      for (const source of sources) {
        const name = basename(source.replace(/\/+$/, ''));
        if (source === '.' || source === './' || name === '*') {
          state.lock = true;
          state.npmrc = true;
        }
        if (name === 'package-lock.json') state.lock = true;
        if (name === '.npmrc') state.npmrc = true;
      }
    } else if (instruction === 'RUN') {
      for (const segment of commandSegments(args)) {
        for (const f of segmentFindings(segment.text)) findings.push({ ...f, location: where });
        if (installs(segment.text)) {
          if (!state.lock || !state.npmrc) {
            findings.push({
              rule: 'docker-install-order',
              message: 'npm ci/install in a stage that has not copied package-lock.json and .npmrc (D-ARCH-040 (c))',
              location: where,
            });
          }
          if (/--omit[= ]dev\b/.test(segment.text) && !/--omit[= ]optional\b/.test(segment.text)) {
            findings.push({
              rule: 'docker-omit-optional',
              message: '--omit=dev requires --omit=optional (ADR-0023 am. I item 2)',
              location: where,
            });
          }
        }
        if (npmInvocations(segment.text).some((invocation) => invocation.rebuild)) {
          findings.push({
            rule: 'docker-npm-rebuild',
            message: 'npm rebuild is not allowed in Dockerfiles (ADR-0023 am. J item 6)',
            location: where,
          });
        }
      }
    }
  }
  return findings;
}

/**
 * @param {string} text
 * @param {string} label
 * @returns {Finding[]}
 */
export function checkCommandText(text, label) {
  return commandSegments(text).flatMap((segment) =>
    segmentFindings(segment.text).map((f) => ({ ...f, location: `${label}:${segment.line}` })),
  );
}

/**
 * @param {string} text package.json content
 * @param {string} label
 * @returns {Finding[]}
 */
export function checkPackageJson(text, label) {
  const manifest = /** @type {{ scripts?: Record<string, unknown> }} */ (JSON.parse(text));
  /** @type {Finding[]} */
  const findings = [];
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (typeof command !== 'string') continue;
    for (const segment of commandSegments(command)) {
      for (const f of segmentFindings(segment.text)) findings.push({ ...f, location: `${label} scripts.${name}` });
    }
  }
  return findings;
}

/**
 * @param {string} text source file content
 * @param {string} label repository-relative path
 * @returns {Finding[]}
 */
export function checkMigrationsWrite(text, label) {
  if (/^prisma\/tests\//.test(label)) return [];
  const lines = text.split(/\r?\n/);
  /** @type {Finding[]} */
  const findings = [];
  for (const [index, line] of lines.entries()) {
    if (MIGRATIONS_WRITE.test(line)) {
      findings.push({
        rule: 'prisma-migrations-write',
        message: '_prisma_migrations is written outside prisma/tests/** (PR-0005 n8)',
        location: `${label}:${index + 1}`,
      });
    }
  }
  return findings;
}

/**
 * @param {string} root
 * @returns {string[]} repository-relative paths (forward slashes)
 */
function walk(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const rel = relative(root, join(dir, entry.name)).replaceAll('\\', '/');
        if (!SKIP_ANY.has(entry.name) && !SKIP_ROOTED.has(rel)) visit(join(dir, entry.name));
      } else if (entry.isFile()) out.push(relative(root, join(dir, entry.name)).replaceAll('\\', '/'));
    }
  };
  visit(root);
  return out.sort();
}

/**
 * @param {string} root
 * @returns {{ findings: Finding[], checked: number }}
 */
export function checkInstallFlags(root) {
  /** @type {Finding[]} */
  const findings = [];
  const files = walk(root);
  const read = (/** @type {string} */ rel) => readFileSync(join(root, rel), 'utf8');

  if (existsSync(join(root, '.npmrc'))) findings.push(...checkNpmrc(read('.npmrc'), '.npmrc'));
  else findings.push({ rule: 'npmrc', message: 'the root .npmrc is missing', location: '.npmrc' });
  const isolated = join(root, 'tools', 'isolated');
  if (existsSync(isolated) && statSync(isolated).isDirectory()) {
    for (const tool of readdirSync(isolated, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const rel = `tools/isolated/${tool.name}/.npmrc`;
      if (existsSync(join(root, rel))) findings.push(...checkNpmrc(read(rel), rel));
      else if (existsSync(join(isolated, tool.name, 'package-lock.json')))
        findings.push({ rule: 'npmrc', message: 'isolated tool lockfile without its .npmrc copy', location: rel });
    }
  }

  let checked = 0;
  for (const rel of files) {
    const name = basename(rel);
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(rel) || /^(?:docker-)?compose[^/]*\.ya?ml$/.test(name)) {
      findings.push(...checkCommandText(read(rel), rel));
      checked += 1;
    } else if (/^Dockerfile/.test(name) || /\.Dockerfile$/.test(name)) {
      findings.push(...checkDockerfile(read(rel), rel));
      checked += 1;
    } else if (name === 'package.json') {
      findings.push(...checkPackageJson(read(rel), rel));
      checked += 1;
    }
    if (SOURCE_EXT.test(name) && !/^tools\/ci\/check-install-flags\./.test(rel)) findings.push(...checkMigrationsWrite(read(rel), rel));
  }
  return { findings, checked };
}

/** @param {string[]} argv */
export function main(argv) {
  let root = process.cwd();
  /** @type {string | undefined} */
  let summary;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root' || arg === '--summary') {
      const value = argv[i + 1];
      if (value === undefined) {
        console.error(`check-install-flags: ${arg} needs a value`);
        return 2;
      }
      if (arg === '--root') root = resolve(value);
      else summary = value;
      i += 1;
    } else if (arg === '--json') json = true;
    else {
      console.error(`check-install-flags: unknown argument ${String(arg)}`);
      return 2;
    }
  }
  const { findings, checked } = checkInstallFlags(root);
  if (json) console.log(JSON.stringify({ checked, findings }, null, 2));
  else for (const f of findings) console.log(`${f.rule}: ${f.message} (${f.location})`);
  if (summary) {
    appendFileSync(
      summary,
      `\n### Install flags, npx, raw prisma: ${findings.length === 0 ? 'pass' : `**${findings.length} finding(s)**`} (${checked} files)\n`,
    );
  }
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-install-flags: internal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
