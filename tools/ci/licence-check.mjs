// @ts-check
/**
 * Lane A licence gate over the lockfile (TASK-007).
 *
 * Controls: CLAUDE.md section 3 LICENSE_ALLOWLIST; D-ARCH-003 rev 2 items 1-3 (production closure = allow-list plus
 * MIT-0, 0BSD, BlueOak-1.0.0, PSF-2.0, Python-2.0; dev/build closure additionally CC-BY-3.0 / CC-BY-4.0 build-time data
 * with attribution; `OR` passes when any branch passes, `AND` needs all; UNKNOWN, UNLICENSED or missing fails except
 * `"private": true` workspaces); D-ARCH-003 rev 3/rev 4 and ADR-0023 am. J item 3 / PR1-SEC-05 (EPL-2.0 only as the
 * named exception `elkjs@0.11.1` in `tools/ci/licence-exceptions.json`, dev closure, reached via prisma ->
 * @prisma/studio-core; any other EPL-2.0 package fails; the exception fails in the production closure or outside its
 * chain); ADR-0023 am. I item 7 / PR1-SEC-10 / PR2-SEC-07 (legacy `licenses: [{type}]` arrays read from the installed
 * package.json, case-insensitive SPDX operators, explicit LICENSE-file metadata overrides such as `png-js@2.0.0` -> MIT
 * with evidence); US-048 / AT-US-048-06 (a GPL-3.0 dependency fails, MIT passes).
 *
 * Closures come from the lockfile flags (`--omit=dev --omit=optional` semantics, SEC-FU-PR1 note 1). Run after
 * `npm ci --ignore-scripts`: entries whose lockfile record has no `license` are resolved from the installed manifest.
 *
 *   node tools/ci/licence-check.mjs [--root <dir>] [--summary <file>] [--json]
 *
 * Exit 0 pass, 1 policy finding(s), 2 usage/internal error. No network.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import {
  cell,
  dependentsIndex,
  entryName,
  formatFinding,
  inProductionClosure,
  isFolderKey,
  matchesWorkspace,
  readJsonFile,
  readLockfile,
  RegisterError,
  runCli,
  validateRegister,
  workspaceGlobs,
} from './dep-gates-lib.mjs';

/** @typedef {import('./dep-gates-lib.mjs').Lockfile} Lockfile */
/** @typedef {import('./dep-gates-lib.mjs').LockEntry} LockEntry */
/** @typedef {import('./dep-gates-lib.mjs').Finding} Finding */
/** @typedef {{ name: string, version: string, licence: string, via: string[], closure: 'dev', decision: string, reason: string }} LicenceException */
/** @typedef {{ name: string, version: string, licence: string, evidence: string, decision: string }} MetadataOverride */
/** @typedef {(key: string) => { license?: unknown, licenses?: unknown, private?: unknown } | undefined} ManifestReader */

/** CLAUDE.md section 3 defaults plus the D-ARCH-003 rev 2 item 1 permissive equivalents. */
export const PRODUCTION_ALLOWED = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'Unlicense',
  'CC0-1.0',
  'MIT-0',
  '0BSD',
  'BlueOak-1.0.0',
  'PSF-2.0',
  'Python-2.0',
];
/** D-ARCH-003 rev 2 item 2: build-time data licences, dev closure only, attribution in THIRD_PARTY_NOTICES.md. */
export const DEV_ONLY_ALLOWED = ['CC-BY-3.0', 'CC-BY-4.0'];

/**
 * @param {unknown} data
 * @returns {{ exceptions: LicenceException[], metadataOverrides: MetadataOverride[] }}
 */
export function loadLicenceRegister(data) {
  const exceptions = validateRegister(data, 'exceptions', ['name', 'version', 'licence', 'via', 'closure', 'decision', 'reason'], []).map(
    (entry, index) => {
      if (entry.closure !== 'dev')
        throw new RegisterError(`exceptions[${index}].closure must be "dev" (D-ARCH-003 rev 3: never the production closure)`);
      if (!Array.isArray(entry.via)) throw new RegisterError(`exceptions[${index}].via must be the parent chain array`);
      return /** @type {LicenceException} */ (/** @type {unknown} */ (entry));
    },
  );
  const metadataOverrides = validateRegister(data, 'metadataOverrides', ['name', 'version', 'licence', 'evidence', 'decision'], []).map(
    (entry) => /** @type {MetadataOverride} */ (/** @type {unknown} */ (entry)),
  );
  return { exceptions, metadataOverrides };
}

/**
 * SPDX expression -> AST. Operators are case-insensitive (`MIT and ISC`); `X WITH exception` evaluates as `X`
 * (an exception only adds permissions); a trailing `+` is dropped. Malformed input throws.
 * @typedef {{ op: 'id', id: string } | { op: 'and' | 'or', left: Spdx, right: Spdx }} Spdx
 * @param {string} expression @returns {Spdx}
 */
export function parseSpdx(expression) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;
  const peek = () => tokens[position]?.toUpperCase();
  /** @returns {Spdx} */
  const primary = () => {
    const token = tokens[position++];
    if (token === undefined) throw new Error(`unexpected end of "${expression}"`);
    if (token === '(') {
      const inner = orExpr();
      if (tokens[position++] !== ')') throw new Error(`missing ")" in "${expression}"`);
      return inner;
    }
    if (/^(AND|OR|WITH|\))$/i.test(token)) throw new Error(`unexpected "${token}" in "${expression}"`);
    const node = /** @type {Spdx} */ ({ op: 'id', id: token.replace(/\+$/, '') });
    if (peek() === 'WITH') position += 2;
    return node;
  };
  /** @returns {Spdx} */
  const andExpr = () => {
    let left = primary();
    while (peek() === 'AND') {
      position += 1;
      left = { op: 'and', left, right: primary() };
    }
    return left;
  };
  /** @returns {Spdx} */
  const orExpr = () => {
    let left = andExpr();
    while (peek() === 'OR') {
      position += 1;
      left = { op: 'or', left, right: andExpr() };
    }
    return left;
  };
  const tree = orExpr();
  if (position !== tokens.length) throw new Error(`trailing tokens in "${expression}"`);
  return tree;
}

/** @param {Spdx} node @param {(id: string) => boolean} allowed @returns {boolean} */
export function satisfies(node, allowed) {
  if (node.op === 'id') return allowed(node.id);
  return node.op === 'and'
    ? satisfies(node.left, allowed) && satisfies(node.right, allowed)
    : satisfies(node.left, allowed) || satisfies(node.right, allowed);
}

/** Licence string from `license` (string or legacy `{type}`) or a legacy `licenses` array (alternatives -> OR). */
export function declaredLicence(/** @type {{ license?: unknown, licenses?: unknown } | undefined} */ record) {
  if (record === undefined) return undefined;
  const typeOf = (/** @type {unknown} */ value) =>
    typeof value === 'string'
      ? value
      : typeof value === 'object' && value !== null && typeof (/** @type {{type?: unknown}} */ (value).type) === 'string'
        ? /** @type {{type: string}} */ (value).type
        : undefined;
  const single = typeOf(record.license);
  if (single !== undefined && single.trim() !== '') return single.trim();
  if (Array.isArray(record.licenses)) {
    const types = record.licenses.map(typeOf).filter((t) => t !== undefined && t.trim() !== '');
    if (types.length > 0) return types.length === 1 ? String(types[0]) : `(${types.join(' OR ')})`;
  }
  return undefined;
}

const lower = (/** @type {readonly string[]} */ ids) => new Set(ids.map((id) => id.toLowerCase()));
const PROD_SET = lower(PRODUCTION_ALLOWED);
const DEV_SET = lower([...PRODUCTION_ALLOWED, ...DEV_ONLY_ALLOWED]);

/**
 * Pure core.
 * @param {Lockfile} lock
 * @param {{ exceptions?: LicenceException[], metadataOverrides?: MetadataOverride[], readManifest?: ManifestReader }} [options]
 */
export function checkLicences(lock, options = {}) {
  const exceptions = options.exceptions ?? [];
  const metadataOverrides = options.metadataOverrides ?? [];
  const readManifest = options.readManifest ?? (() => undefined);
  const packages = lock.packages ?? {};
  const globs = workspaceGlobs(lock);
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Finding[]} */
  const notes = [];
  /** @type {Map<string, Set<string>> | undefined} */
  let dependents;
  /** @type {Set<LicenceException>} */
  const usedExceptions = new Set();
  /** @type {Set<MetadataOverride>} */
  const usedOverrides = new Set();

  /** Every dependent of each `via` hop is the previous hop; the first hop's own parents are not constrained. */
  const chainHolds = (/** @type {string} */ key, /** @type {string[]} */ via) => {
    dependents ??= dependentsIndex(lock);
    /** @type {string[]} */
    let frontier = [key];
    for (let hop = via.length - 1; hop >= 0; hop -= 1) {
      /** @type {string[]} */
      const next = [];
      for (const current of frontier) {
        const parents = [...(dependents.get(current) ?? [])];
        if (parents.length === 0) return false;
        for (const parent of parents) {
          if (entryName(parent, packages[parent] ?? {}) !== via[hop]) return false;
          next.push(parent);
        }
      }
      frontier = next;
    }
    return true;
  };

  for (const [key, entry] of Object.entries(packages)) {
    if (key === '' || entry.link === true) continue;
    if (isFolderKey(key) && matchesWorkspace(key, globs)) {
      if (readManifest(key)?.private !== true)
        findings.push({
          rule: 'licence/workspace-not-private',
          message: 'workspace package must be "private": true (D-ARCH-003 rev 2 item 3)',
          location: key,
        });
      continue;
    }
    const name = entryName(key, entry);
    const id = `${name}@${entry.version ?? '?'}`;
    const production = inProductionClosure(entry);
    const closure = production ? 'production' : 'dev';

    let licence = declaredLicence(entry);
    let source = 'lockfile';
    if (licence === undefined) {
      licence = declaredLicence(readManifest(key));
      source = 'installed package.json';
    }
    const override = metadataOverrides.find((o) => o.name === name && o.version === entry.version);
    if (override !== undefined) {
      usedOverrides.add(override);
      if (licence === undefined) {
        licence = override.licence;
        source = `metadata override (${override.decision}: ${override.evidence})`;
        notes.push({
          rule: 'licence/metadata-override',
          message: `${id} has no licence metadata; ${override.licence} from ${override.evidence} (${override.decision})`,
          location: key,
        });
      } else {
        notes.push({
          rule: 'licence/override-unneeded',
          message: `${id} now declares "${licence}"; remove its metadata override`,
          location: key,
        });
      }
    }
    if (licence === undefined) {
      findings.push({
        rule: 'licence/missing',
        message: `${id} declares no licence (lockfile, installed package.json) and has no metadata override`,
        location: key,
      });
      continue;
    }

    const exception = exceptions.find((e) => e.name === name && e.version === entry.version && e.licence === licence);
    if (exception !== undefined) {
      usedExceptions.add(exception);
      if (production)
        findings.push({
          rule: 'licence/exception-in-production',
          message: `${id} (${licence}) is excepted for the dev closure only (${exception.decision}) but is in the production closure`,
          location: key,
        });
      else if (!chainHolds(key, exception.via))
        findings.push({
          rule: 'licence/exception-chain',
          message: `${id} (${licence}) is reached outside its recorded chain ${exception.via.join(' -> ')} (${exception.decision})`,
          location: key,
        });
      else
        notes.push({
          rule: 'licence/exception',
          message: `${id} ${licence} admitted in the dev closure via ${exception.via.join(' -> ')} (${exception.decision})`,
          location: key,
        });
      continue;
    }

    /** @type {Spdx} */
    let tree;
    try {
      tree = parseSpdx(licence);
    } catch (error) {
      findings.push({
        rule: 'licence/unparseable',
        message: `${id}: ${error instanceof Error ? error.message : String(error)}`,
        location: key,
      });
      continue;
    }
    const allowedSet = production ? PROD_SET : DEV_SET;
    if (!satisfies(tree, (spdx) => allowedSet.has(spdx.toLowerCase()))) {
      findings.push({
        rule: 'licence/not-allowed',
        message: `${id} licence "${licence}" (${source}) is not admitted in the ${closure} closure`,
        location: key,
      });
    } else if (!production && !satisfies(tree, (spdx) => PROD_SET.has(spdx.toLowerCase()))) {
      notes.push({
        rule: 'licence/attribution',
        message: `${id} ${licence} (build-time data, dev closure): attribute in THIRD_PARTY_NOTICES.md and never ship it`,
        location: key,
      });
    }
  }

  for (const exception of exceptions) {
    if (!usedExceptions.has(exception))
      notes.push({
        rule: 'licence/exception-unused',
        message: `exception ${exception.name}@${exception.version} matches no lockfile entry; remove it`,
        location: 'tools/ci/licence-exceptions.json',
      });
  }
  for (const override of metadataOverrides) {
    if (!usedOverrides.has(override))
      notes.push({
        rule: 'licence/override-unused',
        message: `metadata override ${override.name}@${override.version} matches no lockfile entry; remove it`,
        location: 'tools/ci/licence-exceptions.json',
      });
  }
  return { findings, notes };
}

/** Reads `<root>/<key>/package.json` when installed. */
export function installedManifestReader(/** @type {string} */ root) {
  return /** @type {ManifestReader} */ (
    (key) => {
      const path = join(root, ...key.split('/'), 'package.json');
      return existsSync(path)
        ? /** @type {{ license?: unknown, licenses?: unknown, private?: unknown }} */ (JSON.parse(readFileSync(path, 'utf8')))
        : undefined;
    }
  );
}

async function main(/** @type {string[]} */ argv) {
  return runCli(
    'licence-check',
    {},
    (flags) => {
      const root = /** @type {string} */ (flags.root);
      const register = loadLicenceRegister(readJsonFile(join(root, 'tools', 'ci', 'licence-exceptions.json')));
      const result = checkLicences(readLockfile(root), { ...register, readManifest: installedManifestReader(root) });
      const markdown = [
        `### licence-check: ${result.findings.length === 0 ? 'PASS' : `FAIL (${result.findings.length})`}`,
        '',
        ...result.findings.map((f) => `- ${cell(formatFinding(f))}`),
        ...result.notes.map((n) => `- note ${cell(formatFinding(n))}`),
        '',
      ].join('\n');
      return { ...result, markdown };
    },
    argv,
  );
}

if (typeof import.meta.main !== 'boolean') throw new Error('licence-check needs Node >= 24.2 (import.meta.main)');
if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
