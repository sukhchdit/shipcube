// @ts-check
/**
 * Lane A dependency-advisory gate over `npm audit --json` (report v2, npm 11) and osv-scanner v2 JSON (TASK-007).
 *
 * Controls: US-048 / AT-US-048-06 (a High vulnerability fails the pipeline; Critical/High in any closure, prod or dev,
 * fail) and AT-US-048-07 (a finding is waived only through an entry in `tools/ci/advisory-watchlist.json` with an
 * expiry; once the expiry passes the finding fails again; a Critical/High without an upstream fix passes only while
 * tracked by such an entry, whose `expires` is the due date; code review m7 / PR10-SEC-12: a waiver also needs a
 * `granted` date not in the future, `expires` at most 90 days after it and a DECISIONS.md ID, else the register is
 * malformed and the gate exits 2); PR2-SEC-06 (watchlist GHSA-g3hv-75wg-m249,
 * GHSA-3g3m-2fjr-6pw4, GHSA-gcqx-w48m-w2h4 reported as "watched"); D-ARCH-003 rev 4 item 4 / ADR-0023 am. J item 4
 * (a package in `maintenance-exceptions.json` with a High/Critical advisory fails regardless of any waiver);
 * PR1-SEC-07 / D-ARCH-043 (`npm audit --omit=dev` stays 0: production-closure moderates are highlighted).
 * Closures come from the lockfile flags (SEC-FU-PR1 note 1).
 *
 *   node tools/ci/check-audit.mjs --npm-audit <npm-audit.json> [--osv <osv.json>] [--now <iso>]
 *                                 [--root <dir>] [--summary <file>] [--json]
 *
 * Exit 0 pass, 1 policy finding(s), 2 usage/internal error. No network.
 */
import { join } from 'node:path';
import process from 'node:process';

import {
  cell,
  daysUntil,
  formatFinding,
  inProductionClosure,
  isExpired,
  parseDate,
  readJsonFile,
  readLockfile,
  RegisterError,
  runCli,
  tuplesOf,
  validateRegister,
} from './dep-gates-lib.mjs';
import { loadMaintenance } from './check-dep-age.mjs';

/** @typedef {import('./dep-gates-lib.mjs').Lockfile} Lockfile */
/** @typedef {import('./dep-gates-lib.mjs').Finding} Finding */
/** @typedef {import('./check-dep-age.mjs').MaintenanceException} MaintenanceException */
/** @typedef {'info' | 'low' | 'moderate' | 'high' | 'critical'} Severity */
/** @typedef {{ id: string, package: string, severity: Severity, title: string, fixAvailable: boolean, production: boolean, sources: string[] }} Advisory */
/** @typedef {{ id: string, package: string, reason: string, review_by: string, source?: string }} WatchEntry */
/** @typedef {{ id: string, package: string, reason: string, decision: string, granted: string, expires: string }} Waiver */

const RANK = /** @type {const} */ ({ info: 0, low: 1, moderate: 2, high: 3, critical: 4 });
const SEVERITIES = /** @type {Severity[]} */ (Object.keys(RANK));

/** Longest waiver horizon, `granted` to `expires` (code review m7, PR10-SEC-12). */
export const MAX_WAIVER_DAYS = 90;
/** A DECISIONS.md ID such as `D-ORCH-013` or `D-TASK007-01`. */
export const DECISION_ID = /^D-[A-Z0-9]+-\d+$/;
const DAY_MS = 86_400_000;

/**
 * Waiver dating rules: `granted` is a YYYY-MM-DD date, not in the future (when `now` is given), `expires` is after it and
 * at most MAX_WAIVER_DAYS later, and `decision` is a DECISIONS.md ID. A violation is a malformed register (exit 2).
 * @param {Waiver} waiver @param {number} index @param {Date | undefined} now
 */
function validateWaiver(waiver, index, now) {
  const at = `waivers[${index}]`;
  if (!DECISION_ID.test(String(waiver.decision)))
    throw new RegisterError(`${at}.decision must be a DECISIONS.md ID (${String(DECISION_ID)}), got ${JSON.stringify(waiver.decision)}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(waiver.granted)))
    throw new RegisterError(`${at}.granted: expected YYYY-MM-DD, got ${JSON.stringify(waiver.granted)}`);
  const granted = parseDate(waiver.granted, `${at}.granted`).getTime();
  const expires = parseDate(waiver.expires, `${at}.expires`).getTime();
  if (expires <= granted) throw new RegisterError(`${at}.expires (${waiver.expires}) must be after granted (${waiver.granted})`);
  if (expires - granted > MAX_WAIVER_DAYS * DAY_MS)
    throw new RegisterError(
      `${at}: a waiver may span at most ${MAX_WAIVER_DAYS} days (granted ${waiver.granted}, expires ${waiver.expires}); renew it with a new decision`,
    );
  if (now !== undefined && granted > now.getTime())
    throw new RegisterError(`${at}.granted (${waiver.granted}) is in the future; a waiver cannot be pre-dated to extend its horizon`);
}

/**
 * @param {unknown} data
 * @param {Date} [now] when given, a waiver granted after `now` is rejected (otherwise a future `granted` would move the
 *   90-day horizon arbitrarily far out)
 * @returns {{ watch: WatchEntry[], waivers: Waiver[] }}
 */
export function loadWatchlist(data, now) {
  const watch = validateRegister(data, 'watch', ['id', 'package', 'reason', 'review_by'], ['review_by']).map(
    (e) => /** @type {WatchEntry} */ (/** @type {unknown} */ (e)),
  );
  const waivers = validateRegister(
    data,
    'waivers',
    ['id', 'package', 'reason', 'decision', 'granted', 'expires'],
    ['granted', 'expires'],
  ).map((e) => /** @type {Waiver} */ (/** @type {unknown} */ (e)));
  waivers.forEach((waiver, index) => validateWaiver(waiver, index, now));
  return { watch, waivers };
}

const ghsaOf = (/** @type {unknown} */ text) =>
  typeof text === 'string' ? /GHSA(-[23456789cfghjmpqrvwx]{4}){3}/i.exec(text)?.[0] : undefined;
const asSeverity = (/** @type {unknown} */ value) => {
  const normal = String(value).toLowerCase() === 'medium' ? 'moderate' : String(value).toLowerCase();
  return SEVERITIES.includes(/** @type {Severity} */ (normal)) ? /** @type {Severity} */ (normal) : undefined;
};
/** CVSS base score -> qualitative rating (CVSS v3/v4 table). */
const fromScore = (/** @type {number} */ score) =>
  score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'moderate' : score > 0 ? 'low' : 'info';

/**
 * npm audit report v2: `vulnerabilities[name].via[]` objects are advisories (strings are effects of other entries);
 * `nodes` are lockfile keys; `fixAvailable` is `false` or `true`/`{ name, version, isSemVerMajor }`.
 * @param {unknown} report @param {Lockfile} lock @returns {Advisory[]}
 */
export function fromNpmAudit(report, lock) {
  const doc =
    /** @type {{ auditReportVersion?: unknown, vulnerabilities?: Record<string, { nodes?: string[], fixAvailable?: unknown, via?: unknown[] }> }} */ (
      report
    );
  if (doc?.auditReportVersion !== 2 || typeof doc.vulnerabilities !== 'object')
    throw new RegisterError('--npm-audit: expected an npm audit --json report with auditReportVersion 2');
  const packages = lock.packages ?? {};
  /** @type {Advisory[]} */
  const out = [];
  for (const [name, vulnerability] of Object.entries(doc.vulnerabilities)) {
    const production = (vulnerability.nodes ?? []).some((key) => packages[key] !== undefined && inProductionClosure(packages[key]));
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const advisory = /** @type {{ source?: unknown, name?: unknown, title?: unknown, url?: unknown, severity?: unknown }} */ (via);
      const severity = asSeverity(advisory.severity);
      if (severity === undefined) throw new RegisterError(`--npm-audit: ${name}: unknown severity ${JSON.stringify(advisory.severity)}`);
      out.push({
        id: ghsaOf(advisory.url) ?? `npm-${String(advisory.source)}`,
        package: typeof advisory.name === 'string' ? advisory.name : name,
        severity,
        title: String(advisory.title ?? ''),
        fixAvailable: vulnerability.fixAvailable !== false,
        production,
        sources: ['npm audit'],
      });
    }
  }
  return out;
}

/**
 * osv-scanner v2 `--format json`: `results[].packages[].{ package: { name, version, ecosystem }, vulnerabilities[], groups[] }`.
 * Severity: GHSA `database_specific.severity`, else the group's `max_severity` CVSS score.
 * @param {unknown} report @param {Lockfile} lock @returns {Advisory[]}
 */
export function fromOsv(report, lock) {
  const doc =
    /** @type {{ results?: Array<{ packages?: Array<{ package?: { name?: string, version?: string, ecosystem?: string }, vulnerabilities?: Array<Record<string, unknown>>, groups?: Array<{ ids?: string[], max_severity?: string }> }> }> }} */ (
      report
    );
  if (!Array.isArray(doc?.results)) throw new RegisterError('--osv: expected osv-scanner JSON with a "results" array');
  const tuples = tuplesOf(lock);
  /** @type {Advisory[]} */
  const out = [];
  for (const result of doc.results) {
    for (const entry of result.packages ?? []) {
      const name = entry.package?.name ?? '?';
      if (entry.package?.ecosystem !== undefined && entry.package.ecosystem !== 'npm') continue;
      const production = tuples.get(`${name}@${entry.package?.version ?? '?'}`)?.production ?? false;
      for (const vulnerability of entry.vulnerabilities ?? []) {
        const id = String(vulnerability.id ?? '?');
        const aliases = Array.isArray(vulnerability.aliases) ? vulnerability.aliases : [];
        const ghsa = ghsaOf(id) ?? aliases.map(ghsaOf).find((a) => a !== undefined) ?? id;
        const group = (entry.groups ?? []).find((g) => g.ids?.includes(id));
        const databaseSeverity = asSeverity(/** @type {{ severity?: unknown } | undefined} */ (vulnerability.database_specific)?.severity);
        const score = Number.parseFloat(group?.max_severity ?? '');
        const severity = databaseSeverity ?? (Number.isFinite(score) ? fromScore(score) : 'high'); // unrated: fail closed as high
        const affected = Array.isArray(vulnerability.affected)
          ? /** @type {Array<{ ranges?: Array<{ events?: Array<Record<string, string>> }> }>} */ (vulnerability.affected)
          : [];
        const fixAvailable = affected.some((a) => (a.ranges ?? []).some((r) => (r.events ?? []).some((e) => typeof e.fixed === 'string')));
        out.push({
          id: ghsa,
          package: name,
          severity,
          title: String(vulnerability.summary ?? ''),
          fixAvailable,
          production,
          sources: ['osv-scanner'],
        });
      }
    }
  }
  return out;
}

/** Merges advisories from both scanners by (id, package): highest severity, any production, any fix. */
export function mergeAdvisories(/** @type {Advisory[]} */ advisories) {
  /** @type {Map<string, Advisory>} */
  const merged = new Map();
  for (const advisory of advisories) {
    const key = `${advisory.id.toUpperCase()}|${advisory.package}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, { ...advisory, sources: [...advisory.sources] });
      continue;
    }
    if (RANK[advisory.severity] > RANK[existing.severity]) existing.severity = advisory.severity;
    existing.production ||= advisory.production;
    existing.fixAvailable ||= advisory.fixAvailable;
    for (const source of advisory.sources) if (!existing.sources.includes(source)) existing.sources.push(source);
  }
  return [...merged.values()].sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.id.localeCompare(b.id));
}

/**
 * Pure core.
 * @param {Advisory[]} advisories merged advisories
 * @param {{ watch?: WatchEntry[], waivers?: Waiver[], maintenance?: MaintenanceException[], now: Date }} options
 */
export function checkAudit(advisories, options) {
  const { now } = options;
  const watch = options.watch ?? [];
  const waivers = options.waivers ?? [];
  const maintained = new Set((options.maintenance ?? []).map((e) => e.name));
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Finding[]} */
  const notes = [];
  const same = (/** @type {{ id: string, package: string }} */ a, /** @type {Advisory} */ b) =>
    a.id.toUpperCase() === b.id.toUpperCase() && a.package === b.package;

  for (const advisory of advisories) {
    const label = `${advisory.id} ${advisory.package} (${advisory.severity}${advisory.production ? ', production closure' : ', dev closure'}${advisory.fixAvailable ? ', fix available' : ', no fix'})`;
    const location = advisory.sources.join(' + ');
    const watched = watch.find((w) => same(w, advisory));
    if (watched !== undefined)
      notes.push({ rule: 'audit/watched', message: `${label} watched until review ${watched.review_by}: ${watched.reason}`, location });
    if (RANK[advisory.severity] < RANK.high) {
      if (watched === undefined)
        notes.push({
          rule: advisory.production ? 'audit/production-moderate' : 'audit/reported',
          message: `${label}: ${advisory.title}`,
          location,
        });
      continue;
    }
    if (maintained.has(advisory.package)) {
      findings.push({
        rule: 'audit/maintenance-exception',
        message: `${label}: package holds a maintenance exception, which a High/Critical advisory voids (D-ARCH-003 rev 4 item 4); no waiver applies`,
        location,
      });
      continue;
    }
    const waiver = waivers.find((w) => same(w, advisory));
    if (waiver === undefined) {
      findings.push({
        rule: 'audit/high',
        message: `${label}: ${advisory.title}${advisory.fixAvailable ? '' : '; no upstream fix: track it with a dated waiver in tools/ci/advisory-watchlist.json'}`,
        location,
      });
    } else if (isExpired(waiver.expires, now)) {
      findings.push({
        rule: 'audit/waiver-expired',
        message: `${label}: waiver ${waiver.decision} expired on ${waiver.expires}`,
        location,
      });
    } else {
      notes.push({
        rule: 'audit/waived',
        message: `${label}: tracked by ${waiver.decision}, due ${waiver.expires} (${daysUntil(waiver.expires, now)} days)`,
        location,
      });
    }
  }
  for (const entry of watch) {
    if (!isExpired(entry.review_by, now)) continue;
    notes.push({
      rule: 'audit/watch-review-due',
      message: `watch entry ${entry.id} ${entry.package} passed its review date ${entry.review_by}`,
      location: 'tools/ci/advisory-watchlist.json',
    });
  }
  return { findings, notes };
}

/** @param {Advisory[]} advisories @param {{ findings: Finding[], notes: Finding[] }} result */
export function auditMarkdown(advisories, result) {
  const lines = [`### check-audit: ${result.findings.length === 0 ? 'PASS' : `FAIL (${result.findings.length})`}`, ''];
  const counts = SEVERITIES.slice()
    .reverse()
    .map((s) => `${s} ${advisories.filter((a) => a.severity === s).length}`)
    .join(' · ');
  lines.push(
    `Advisories (merged npm audit + osv-scanner): ${counts}; production closure: **${advisories.filter((a) => a.production).length}**`,
    '',
  );
  lines.push(...result.findings.map((f) => `- **${cell(formatFinding(f))}**`));
  if (advisories.length > 0) {
    lines.push('', '| Advisory | Package | Severity | Closure | Fix | Source |', '|---|---|---|---|---|---|');
    lines.push(
      ...advisories.map(
        (a) =>
          `| ${cell(a.id)} | \`${cell(a.package)}\` | ${a.severity} | ${a.production ? '**production**' : 'dev'} | ${a.fixAvailable ? 'yes' : 'no'} | ${cell(a.sources.join(', '))} |`,
      ),
    );
  }
  lines.push('', ...result.notes.map((n) => `- note ${cell(formatFinding(n))}`), '');
  return lines.join('\n');
}

async function main(/** @type {string[]} */ argv) {
  return runCli(
    'check-audit',
    { 'npm-audit': { type: 'string' }, osv: { type: 'string' }, now: { type: 'string' } },
    (flags) => {
      const root = /** @type {string} */ (flags.root);
      if (typeof flags['npm-audit'] !== 'string') throw new RegisterError('--npm-audit <file> is required');
      const lock = readLockfile(root);
      const now = typeof flags.now === 'string' ? parseDate(flags.now, '--now') : new Date();
      const raw = fromNpmAudit(readJsonFile(flags['npm-audit']), lock);
      if (typeof flags.osv === 'string') raw.push(...fromOsv(readJsonFile(flags.osv), lock));
      const advisories = mergeAdvisories(raw);
      const { watch, waivers } = loadWatchlist(readJsonFile(join(root, 'tools', 'ci', 'advisory-watchlist.json')), now);
      const maintenance = loadMaintenance(readJsonFile(join(root, 'tools', 'ci', 'maintenance-exceptions.json')));
      const result = checkAudit(advisories, { watch, waivers, maintenance, now });
      return { ...result, markdown: auditMarkdown(advisories, result), json: advisories };
    },
    argv,
  );
}

if (typeof import.meta.main !== 'boolean') throw new Error('check-audit needs Node >= 24.2 (import.meta.main)');
if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
