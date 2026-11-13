/**
 * Released migrations are immutable (PR8-SEC-01 generic backstop, PR-0008 security review §3; data-model §8 expand →
 * migrate → contract). A database that already applied a migration never re-runs it, so editing a released
 * `migration.sql`/`down.sql` silently forks the schema (existing databases keep the old grants, fresh ones get the new).
 *
 * Rule: relative to the merge base, every change under `prisma/migrations/` is an ADDED file inside a migration
 * directory that did not exist on the base; `migration_lock.toml` is allow-listed. Anything else —
 * modify, delete, rename, type change, or a file added to an existing directory — fails.
 *
 * Bootstrap lane (PR #24 R1-m3, PR24-SEC-06): `tools/db/bootstrap.ts` applies the direct `prisma/bootstrap/*.sql` files
 * in byte order of their names and records each file's sha256 in its ledger, so an edited released file fails only at
 * the first deploy against an existing database, which CI never runs (it always bootstraps fresh). The same base-vs-head
 * rule applies: a released file (one that exists on the merge base) may not be modified, deleted, renamed or have its
 * type changed, and an added file must sort after every released one (the runtime ledger refuses a new file that sorts
 * before the last applied one). Other files in the folder (a README, nested folders) are not part of the lane.
 *
 * Usage: node tools/ci/check-migration-immutability.mjs [--root <dir>] --base <git-ref> [--head <git-ref>]
 *        [--summary <file>] [--json]
 * Exit 0 = pass, 1 = finding(s), 2 = usage or internal error.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const MIGRATIONS_DIR = 'prisma/migrations';
/** Prisma's provider lock may be rewritten by `migrate`; it carries no schema (allow-listed, WAVE-00 TASK-007). */
export const LOCK_FILE = `${MIGRATIONS_DIR}/migration_lock.toml`;
const IMMUTABLE = 'applied migrations are immutable (D-SEC-PR8-01/02)';
export const BOOTSTRAP_DIR = 'prisma/bootstrap';
const BOOTSTRAP_IMMUTABLE = 'released bootstrap files are immutable (PR #24 R1-m3, PR24-SEC-06)';
/** The files the bootstrap runner applies: direct children of prisma/bootstrap ending in .sql. */
const BOOTSTRAP_FILE = /^prisma\/bootstrap\/[^/]+\.sql$/u;

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
    if (!path.startsWith(`${MIGRATIONS_DIR}/`) || path === LOCK_FILE) continue;
    const rest = path.slice(MIGRATIONS_DIR.length + 1);
    const dir = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : undefined;
    if (status !== 'A') {
      findings.push({
        rule: 'migrations/released-changed',
        message: `${IMMUTABLE}: a released migration file was ${status === 'D' ? 'deleted' : 'changed'} (status ${status}); ship a new migration instead`,
        location: path,
      });
    } else if (dir !== undefined && baseDirs.has(dir)) {
      findings.push({
        rule: 'migrations/released-dir-extended',
        message: `${IMMUTABLE}: a file was added to a migration directory that already exists on the base`,
        location: path,
      });
    }
  }
  return findings;
}

/**
 * Pure policy for the bootstrap lane over the name-status list and the released bootstrap file names on the base.
 * @param {readonly Change[]} changes
 * @param {readonly string[]} baseFiles `.sql` file names directly under prisma/bootstrap on the base
 * @returns {Finding[]}
 */
export function checkBootstrapChanges(changes, baseFiles) {
  /** @type {Finding[]} */
  const findings = [];
  const lastReleased = [...baseFiles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).at(-1);
  for (const { status, path } of changes) {
    if (!BOOTSTRAP_FILE.test(path)) continue;
    const name = path.slice(BOOTSTRAP_DIR.length + 1);
    if (status !== 'A') {
      findings.push({
        rule: 'bootstrap/released-changed',
        message: `${BOOTSTRAP_IMMUTABLE}: a released bootstrap file was ${status === 'D' ? 'deleted' : 'changed'} (status ${status}); its ledger sha256 no longer matches on existing databases, add a new file that sorts last instead`,
        location: path,
      });
    } else if (lastReleased !== undefined && name < lastReleased) {
      findings.push({
        rule: 'bootstrap/added-out-of-order',
        message: `${BOOTSTRAP_IMMUTABLE}: an added bootstrap file sorts before the released ${lastReleased}; the runner refuses it on existing databases, give it a name that sorts last`,
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
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });

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
  const hasBootstrap = git(root, ['ls-tree', '--name-only', mergeBase, '--', BOOTSTRAP_DIR]).trim() !== '';
  const baseBootstrap = hasBootstrap
    ? git(root, ['ls-tree', '--name-only', `${mergeBase}:${BOOTSTRAP_DIR}`])
        .split('\n')
        .filter((name) => name.endsWith('.sql'))
    : [];
  const bootstrapChanges = parseNameStatus(
    git(root, ['diff', '--name-status', '-z', '--no-renames', mergeBase, head, '--', BOOTSTRAP_DIR]),
  );
  return {
    findings: [...checkMigrationChanges(changes, baseDirs), ...checkBootstrapChanges(bootstrapChanges, baseBootstrap)],
    changes: changes.length + bootstrapChanges.length,
  };
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
    process.stdout.write(`check-migration-immutability: ${verdict} (${changes} change(s) under ${MIGRATIONS_DIR} and ${BOOTSTRAP_DIR})\n`);
    if (options.summary !== undefined) {
      appendFileSync(
        options.summary,
        `\n### Released migrations and bootstrap files immutable (PR8-SEC-01, PR #24 R1-m3): ${verdict}\n\n${findings.map((f) => `- \`${f.location}\`: ${f.message}`).join('\n')}\n`,
      );
    }
    process.exitCode = findings.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`check-migration-immutability: error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
