/**
 * Released migrations are immutable (PR8-SEC-01 generic backstop, PR-0008 security review §3; data-model §8 expand →
 * migrate → contract). A database that already applied a migration never re-runs it, so editing a released
 * `migration.sql`/`down.sql` silently forks the schema (existing databases keep the old grants, fresh ones get the new).
 *
 * Rule: relative to the merge base, every change under `prisma/migrations/` is an ADDED file inside a migration
 * directory that did not exist on the base. `migration_lock.toml` may change only by being added. Anything else —
 * modify, delete, rename, type change, or a file added to an existing directory — fails.
 *
 * Usage: node tools/ci/check-migration-immutability.mjs [--root <dir>] --base <git-ref> [--head <git-ref>]
 *        [--summary <file>] [--json]
 * Exit 0 = pass, 1 = finding(s), 2 = usage or internal error.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const MIGRATIONS_DIR = 'prisma/migrations';

/**
 * @typedef {{ status: string, path: string }} Change
 * @typedef {{ rule: string, message: string, location: string }} Finding
 */

/**
 * Pure policy over the name-status list and the migration directories that exist on the base.
 * @param {readonly Change[]} changes
 * @param {ReadonlySet<string>} baseDirs directory names directly under prisma/migrations on the base
 * @returns {Finding[]}
 */
export function checkMigrationChanges(changes, baseDirs) {
  /** @type {Finding[]} */
  const findings = [];
  for (const { status, path } of changes) {
    if (!path.startsWith(`${MIGRATIONS_DIR}/`)) continue;
    const rest = path.slice(MIGRATIONS_DIR.length + 1);
    const dir = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : undefined;
    if (status !== 'A') {
      findings.push({
        rule: 'migrations/released-changed',
        message: `a released migration file was ${status === 'D' ? 'deleted' : 'changed'} (status ${status}); ship a new migration instead`,
        location: path,
      });
    } else if (dir !== undefined && baseDirs.has(dir)) {
      findings.push({
        rule: 'migrations/released-dir-extended',
        message: 'a file was added to a migration directory that already exists on the base',
        location: path,
      });
    }
  }
  return findings;
}

/**
 * Parses `git diff --name-status -z --no-renames` output.
 * @param {string} raw
 * @returns {Change[]}
 */
export function parseNameStatus(raw) {
  const parts = raw.split('\0').filter((part) => part !== '');
  /** @type {Change[]} */
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) changes.push({ status: (parts[i] ?? '').charAt(0), path: parts[i + 1] ?? '' });
  return changes;
}

/** @param {string} root @param {string[]} args */
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * @param {{ root: string, base: string, head?: string }} options
 * @returns {{ findings: Finding[], changes: number }}
 */
export function checkRepository({ root, base, head = 'HEAD' }) {
  const mergeBase = git(root, ['merge-base', base, head]).trim();
  const hasDir = git(root, ['ls-tree', '--name-only', mergeBase, '--', MIGRATIONS_DIR]).trim() !== '';
  const baseDirs = new Set(
    hasDir
      ? git(root, ['ls-tree', '-d', '--name-only', `${mergeBase}:${MIGRATIONS_DIR}`])
          .split('\n')
          .filter((line) => line !== '')
      : [],
  );
  const raw = git(root, ['diff', '--name-status', '-z', '--no-renames', mergeBase, head, '--', MIGRATIONS_DIR]);
  const changes = parseNameStatus(raw);
  return { findings: checkMigrationChanges(changes, baseDirs), changes: changes.length };
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ root: string, base?: string, head?: string, summary?: string, json: boolean }} */
  const options = { root: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--root' || arg === '--base' || arg === '--head' || arg === '--summary') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      if (arg === '--root') options.root = resolve(value);
      else options[/** @type {'base' | 'head' | 'summary'} */ (arg.slice(2))] = value;
    } else throw new Error(`unknown argument: ${String(arg)}`);
  }
  if (options.base === undefined) throw new Error('--base <git-ref> is required');
  return options;
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { findings, changes } = checkRepository({
      root: options.root,
      base: /** @type {string} */ (options.base),
      ...(options.head === undefined ? {} : { head: options.head }),
    });
    if (options.json) process.stdout.write(`${JSON.stringify({ findings, changes })}\n`);
    for (const f of findings) process.stdout.write(`${f.rule}: ${f.message} (${f.location})\n`);
    const verdict = findings.length === 0 ? 'PASS' : 'FAIL';
    process.stdout.write(`check-migration-immutability: ${verdict} (${changes} change(s) under ${MIGRATIONS_DIR})\n`);
    if (options.summary !== undefined) {
      appendFileSync(
        options.summary,
        `\n### Released migrations immutable (PR8-SEC-01): ${verdict}\n\n${findings.map((f) => `- \`${f.location}\`: ${f.message}`).join('\n')}\n`,
      );
    }
    process.exitCode = findings.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`check-migration-immutability: error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
