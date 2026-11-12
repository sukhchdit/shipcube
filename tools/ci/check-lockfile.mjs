// @ts-check
/**
 * Lane A lockfile provenance gate (TASK-007).
 *
 * Controls: ADR-0023 am. F item 3 (D-ARCH-020, SEC-P3-04: every package from `https://registry.npmjs.org/` with a
 * `sha512-` integrity; no git/file/http(s)-tarball/foreign-registry source unless registered in
 * `tools/ci/dependency-overrides.json`); am. I item 7 (`inBundle` entries are covered by the parent tarball's
 * integrity); am. J item 1 (b) / D-ARCH-040 / PR1-SEC-01 / PR1-SEC-13 / R2-n4 (`@platform/*` entries are workspace
 * links only: every key under `node_modules/@platform/` is `link: true` whose `resolved` is a workspace directory and
 * which carries no `integrity`; any non-link entry whose `name` starts with `@platform/`, whose key contains
 * `node_modules/@platform/` or whose `resolved` contains `/@platform/` fails); SEC-TC-45 / AT-US-048 (non-registry
 * entry fails lane A); the PR1-SEC-13 lockfile delta summary (`--base`): new name@version tuples, integrity changes
 * for the same tuple and moves into the production closure.
 *
 *   node tools/ci/check-lockfile.mjs [--root <dir>] [--base <git-ref>] [--summary <file>] [--json]
 *
 * Exit 0 pass, 1 policy finding(s), 2 usage/internal error. No network.
 */
import { join } from 'node:path';
import process from 'node:process';

import {
  NPM_REGISTRY,
  cell,
  entryName,
  formatFinding,
  isExpired,
  isFolderKey,
  matchesWorkspace,
  parseDate,
  readBaseLockfile,
  readJsonFile,
  readLockfile,
  RegisterError,
  runCli,
  tuplesOf,
  validateRegister,
  workspaceGlobs,
} from './dep-gates-lib.mjs';

/** @typedef {import('./dep-gates-lib.mjs').Lockfile} Lockfile */
/** @typedef {import('./dep-gates-lib.mjs').LockEntry} LockEntry */
/** @typedef {import('./dep-gates-lib.mjs').Finding} Finding */
/** @typedef {{ package: string, kind: string, resolved?: string, decision: string, reason: string, granted: string, expires: string }} Override */

const SHA512 = /^sha512-[A-Za-z0-9+/]{86}==$/;
const PLATFORM_KEY = /(^|\/)node_modules\/@platform\//;
const MAX_OVERRIDE_DAYS = 30;

/**
 * Validates `dependency-overrides.json` (ADR-0023 am. F item 2: `pkg@version`, DECISIONS.md ID, expiry <= 30 days).
 * @param {unknown} data @returns {Override[]}
 */
export function loadOverrides(data) {
  const entries = validateRegister(
    data,
    'overrides',
    ['package', 'kind', 'decision', 'reason', 'granted', 'expires'],
    ['granted', 'expires'],
  );
  return entries.map((entry, index) => {
    const override = /** @type {Override} */ (/** @type {unknown} */ (entry));
    if (!/^(@[^/@\s]+\/)?[^/@\s]+@[^@\s]+$/.test(override.package))
      throw new RegisterError(`overrides[${index}].package must be name@version`);
    if (override.kind !== 'source' && override.kind !== 'cooldown')
      throw new RegisterError(`overrides[${index}].kind must be "source" or "cooldown"`);
    if (override.kind === 'source' && typeof override.resolved !== 'string')
      throw new RegisterError(`overrides[${index}].resolved is required for kind "source"`);
    const span = (parseDate(override.expires, 'expires').getTime() - parseDate(override.granted, 'granted').getTime()) / 86_400_000;
    if (span <= 0 || span > MAX_OVERRIDE_DAYS)
      throw new RegisterError(`overrides[${index}]: expires must lie within ${MAX_OVERRIDE_DAYS} days after granted`);
    return override;
  });
}

/** Describes a non-registry source for the finding message. */
function sourceKind(/** @type {string | undefined} */ resolved) {
  if (resolved === undefined) return 'no resolved URL';
  if (/^git(\+|:)|^github:|\.git(#|$)/.test(resolved)) return 'git source';
  if (resolved.startsWith('file:')) return 'file source';
  if (resolved.startsWith('http:')) return 'plain-http source';
  if (resolved.startsWith('https:')) return 'foreign registry or tarball URL';
  return 'unrecognised source';
}

/** `https://registry.npmjs.org/<name>/-/<basename>-<version>.tgz` for a registry tarball. */
function expectedTarball(/** @type {string} */ name, /** @type {string} */ version) {
  const basename = name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
  return `${NPM_REGISTRY}${name}/-/${basename}-${version}.tgz`;
}

/**
 * Pure core: provenance and `@platform/*` rules over a parsed lockfile.
 * @param {Lockfile} lock
 * @param {{ overrides?: Override[], now?: Date }} [options]
 * @returns {{ findings: Finding[], notes: Finding[] }}
 */
export function checkLockfile(lock, options = {}) {
  const overrides = options.overrides ?? [];
  const now = options.now ?? new Date();
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Finding[]} */
  const notes = [];
  const fail = (/** @type {string} */ rule, /** @type {string} */ message, /** @type {string} */ location) =>
    findings.push({ rule, message, location });

  if (lock.lockfileVersion !== 3)
    fail('lockfile/version', `lockfileVersion must be 3, got ${JSON.stringify(lock.lockfileVersion)}`, 'package-lock.json');
  const packages = lock.packages;
  if (typeof packages !== 'object' || packages === null) {
    fail('lockfile/packages', 'the "packages" map is missing', 'package-lock.json');
    return { findings, notes };
  }
  const globs = workspaceGlobs(lock);
  if (globs.length === 0) fail('lockfile/workspaces', 'packages[""].workspaces is empty', 'package-lock.json');
  const isWorkspaceDir = (/** @type {unknown} */ dir) =>
    typeof dir === 'string' && matchesWorkspace(dir, globs) && packages[dir] !== undefined && isFolderKey(dir);

  /** @type {Set<Override>} */
  const used = new Set();
  /** A registered `source` override that is unexpired; an expired one is itself a finding. */
  const sourceOverride = (/** @type {string} */ id, /** @type {string | undefined} */ resolved, /** @type {string} */ key) => {
    const match = overrides.find((o) => o.kind === 'source' && o.package === id && o.resolved === resolved);
    if (match === undefined) return false;
    used.add(match);
    if (isExpired(match.expires, now)) {
      fail('overrides/expired', `override for ${id} (${match.decision}) expired on ${match.expires}`, key);
      return true;
    }
    notes.push({
      rule: 'overrides/applied',
      message: `${id} from ${resolved ?? '?'} allowed by ${match.decision} until ${match.expires}`,
      location: key,
    });
    return true;
  };

  for (const [key, entry] of Object.entries(packages)) {
    if (key === '') continue;
    const name = entryName(key, entry);
    const id = `${name}@${entry.version ?? '(no version)'}`;
    const platformKey = PLATFORM_KEY.test(key);

    if (entry.link === true) {
      if (platformKey && !isWorkspaceDir(entry.resolved)) {
        fail(
          'platform/link-target',
          `@platform link must resolve to a workspace directory (${globs.join(', ')}), got ${JSON.stringify(entry.resolved)}`,
          key,
        );
      } else if (!platformKey && !isWorkspaceDir(entry.resolved)) {
        if (!sourceOverride(id, entry.resolved, key))
          fail('lockfile/non-registry', `link to a non-workspace directory ${JSON.stringify(entry.resolved)}`, key);
      }
      if (entry.integrity !== undefined) fail('platform/link-integrity', 'a workspace link must not carry an integrity', key);
      continue;
    }

    // Non-link entries from here on.
    if (platformKey) fail('platform/non-link', 'an entry under node_modules/@platform/ must be a workspace link (link: true)', key);
    if (name.startsWith('@platform/') && !(isFolderKey(key) && isWorkspaceDir(key))) {
      if (!platformKey) fail('platform/alias', `non-link entry named ${name} (npm alias or registry copy of a workspace name)`, key);
    }
    if (typeof entry.resolved === 'string' && entry.resolved.includes('/@platform/')) {
      fail('platform/resolved', `resolved URL points into the third-party @platform scope: ${entry.resolved}`, key);
    }

    if (isFolderKey(key)) {
      if (!isWorkspaceDir(key) && !sourceOverride(id, key, key))
        fail('lockfile/non-registry', 'directory (file:) dependency outside the workspaces', key);
      continue;
    }
    if (entry.inBundle === true) continue; // covered by the parent tarball's sha512 (am. I item 7)

    const resolved = entry.resolved;
    if (typeof resolved !== 'string' || !resolved.startsWith(NPM_REGISTRY)) {
      if (!sourceOverride(id, resolved, key))
        fail('lockfile/non-registry', `${sourceKind(resolved)}: ${resolved ?? '(none)'}; only ${NPM_REGISTRY} is allowed`, key);
    } else if (entry.version !== undefined && resolved !== expectedTarball(name, entry.version)) {
      fail('lockfile/resolved-mismatch', `resolved ${resolved} is not the registry tarball of ${id}`, key);
    }
    if (typeof entry.integrity !== 'string' || !SHA512.test(entry.integrity)) {
      fail('lockfile/integrity', `integrity must be a single sha512- digest, got ${JSON.stringify(entry.integrity ?? null)}`, key);
    }
  }

  for (const override of overrides) {
    if (override.kind === 'source' && !used.has(override)) {
      notes.push({
        rule: 'overrides/unused',
        message: `override ${override.package} (${override.decision}) matches no lockfile entry; remove it`,
        location: 'tools/ci/dependency-overrides.json',
      });
    }
  }
  return { findings, notes };
}

/**
 * Delta between two lockfiles (PR1-SEC-13 remediation, lane A job summary).
 * @param {Lockfile} base @param {Lockfile} head
 */
export function lockfileDelta(base, head) {
  const before = tuplesOf(base);
  const after = tuplesOf(head);
  const added = [...after.entries()].filter(([id]) => !before.has(id)).map(([id, t]) => ({ id, production: t.production }));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const integrityChanged = [...after.entries()]
    .filter(([id, t]) => {
      const old = before.get(id);
      return old !== undefined && [...t.integrities].some((digest) => !old.integrities.has(digest));
    })
    .map(([id, t]) => ({ id, before: [...(before.get(id)?.integrities ?? [])], after: [...t.integrities] }));
  const movedToProduction = [...after.entries()]
    .filter(([id, t]) => t.production && before.get(id)?.production === false)
    .map(([id]) => id);
  return { added, removed, integrityChanged, movedToProduction };
}

/** @param {ReturnType<typeof lockfileDelta>} delta @param {string} ref */
export function deltaMarkdown(delta, ref) {
  const lines = [`### Lockfile delta vs \`${cell(ref)}\``, ''];
  lines.push(
    `New name@version tuples: **${delta.added.length}** · removed: ${delta.removed.length} · integrity changes: **${delta.integrityChanged.length}** · moved into the production closure: **${delta.movedToProduction.length}**`,
    '',
  );
  if (delta.added.length > 0) {
    lines.push(
      '| New tuple | Closure |',
      '|---|---|',
      ...delta.added.map((a) => `| \`${cell(a.id)}\` | ${a.production ? '**production**' : 'dev/optional'} |`),
      '',
    );
  }
  if (delta.integrityChanged.length > 0) {
    lines.push(
      '| Integrity changed (same name@version) | Before | After |',
      '|---|---|---|',
      ...delta.integrityChanged.map((c) => `| \`${cell(c.id)}\` | ${cell(c.before.join(' '))} | ${cell(c.after.join(' '))} |`),
      '',
    );
  }
  if (delta.movedToProduction.length > 0)
    lines.push('Moved dev/optional -> production:', '', ...delta.movedToProduction.map((id) => `- \`${cell(id)}\``), '');
  return lines.join('\n');
}

/** @param {{ findings: Finding[], notes: Finding[] }} result */
function resultMarkdown(result) {
  const head = `### check-lockfile: ${result.findings.length === 0 ? 'PASS' : `FAIL (${result.findings.length})`}`;
  return [head, '', ...result.findings.map((f) => `- ${cell(formatFinding(f))}`), ''].join('\n');
}

async function main(/** @type {string[]} */ argv) {
  return runCli(
    'check-lockfile',
    { base: { type: 'string' } },
    (flags) => {
      const root = /** @type {string} */ (flags.root);
      const lock = readLockfile(root);
      const overrides = loadOverrides(readJsonFile(join(root, 'tools', 'ci', 'dependency-overrides.json')));
      const result = checkLockfile(lock, { overrides });
      let markdown = resultMarkdown(result);
      /** @type {unknown} */
      let json;
      if (typeof flags.base === 'string') {
        const delta = lockfileDelta(readBaseLockfile(root, flags.base), lock);
        markdown += `\n${deltaMarkdown(delta, flags.base)}`;
        json = delta;
      }
      return { ...result, markdown, json };
    },
    argv,
  );
}

if (typeof import.meta.main !== 'boolean') throw new Error('check-lockfile needs Node >= 24.2 (import.meta.main)');
if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
