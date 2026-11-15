// @ts-check
/**
 * In-house Docker-compatible `.dockerignore` matcher (TASK-014; WAVE-00 sheet line 543, D-ARCH-100 item 3; no new
 * dependency). Mirrors moby/patternmatcher: a pattern is cleaned and anchored at the context root, `*` and `?` never
 * cross `/`, `**` matches any number of directories (zero included), a pattern that matches a parent directory
 * matches everything below it, `!` re-includes, the last match wins; `\` is a separator (Windows client reading).
 *
 *   node tools/ci/check-dockerignore.mjs   exit 1 when a REQUIRED_IGNORED path is visible or a REQUIRED_VISIBLE one is not
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** @typedef {{ negate: boolean, re: RegExp, source: string }} Rule */

/** @param {string} body pattern without `!` @returns {RegExp} */
export function compile(body) {
  let re = '';
  for (let i = 0; i < body.length; i += 1) {
    const c = body.charAt(i);
    if (c === '*' && body.charAt(i + 1) === '*') {
      i += 1;
      if (body.charAt(i + 1) === '/') i += 1;
      re += i + 1 >= body.length ? '.*' : '(?:.*/)?';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[' && body.includes(']', i + 1)) {
      const end = body.indexOf(']', i + 1);
      re += `[${body.slice(i + 1, end).replace(/^!/, '^')}]`;
      i = end;
    } else re += c.replace(/[.+^${}()|[\]]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** @param {string} pattern a path or pattern: separators normalised, `.` segments and leading/trailing `/` dropped */
export const clean = (pattern) =>
  pattern
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/');

/** @param {string} text `.dockerignore` content @returns {Rule[]} */
export function parse(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const negate = line.startsWith('!');
      const body = clean(negate ? line.slice(1).trim() : line);
      return { negate, re: compile(body), source: line };
    });
}

/** True when `path` (or one of its parent directories) is excluded from the build context. @param {Rule[]} rules @param {string} path */
export function isIgnored(rules, path) {
  const parts = clean(path).split('/');
  const prefixes = parts.map((_part, index) => parts.slice(0, index + 1).join('/'));
  let ignored = false;
  for (const rule of rules) if (prefixes.some((prefix) => rule.re.test(prefix))) ignored = !rule.negate;
  return ignored;
}

/** Paths the context must hide (sheet line 543) and paths it must keep (openapi.yaml, .npmrc, D-ARCH-105). */
export const REQUIRED_IGNORED = Object.freeze([
  'prisma/tests/spikes/spk04/server.ts',
  'prisma/tests/spikes/spk08/10-audit.sql',
  'tests/load/spikes/spk04-audit.js',
  'apps/api/src/platform/storage/tests/rustfs.ts',
  '.claude/settings.json',
]);
export const REQUIRED_VISIBLE = Object.freeze(['docs/03-architecture/api/openapi.yaml', '.npmrc', 'prisma/client/tsconfig.json']);

if (import.meta.main === true) {
  const rules = parse(readFileSync(join(resolve(process.argv[2] ?? '.'), '.dockerignore'), 'utf8'));
  const bad = [...REQUIRED_IGNORED.filter((p) => !isIgnored(rules, p)), ...REQUIRED_VISIBLE.filter((p) => isIgnored(rules, p))];
  for (const path of bad) process.stderr.write(`[check-dockerignore] wrong visibility: ${path}\n`);
  process.exitCode = bad.length === 0 ? 0 : 1;
}
