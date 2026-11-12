// @ts-check
/**
 * Lane A release-cooldown and freshness/maintenance gate (TASK-007).
 *
 * Controls: ADR-0023 am. F item 2 / D-ARCH-020 / SEC-TC-32 / SEC-TC-45 (`DEP_MIN_AGE_DAYS=7`: a lockfile
 * name@version published fewer than 7 days before the reference time fails, unless a `cooldown` override in
 * `tools/ci/dependency-overrides.json` is unexpired; PRs check the lockfile delta, lane C the whole lockfile);
 * D-ARCH-003 rev 2 item 6 and rev 4 items 3-4 / ADR-0023 am. J item 4 (18-month maintenance rule: gating for direct
 * dependencies in both closures and for deprecated transitives in the production closure; stale or deprecated
 * dev-only transitives are report-only; `tools/ci/maintenance-exceptions.json` passes an unexpired entry and fails an
 * expired one); D-ARCH-042 (`bcrypt@6.0.0`), D-ARCH-043 (`node-abort-controller@3.1.1`); PR1-SEC-12 freshness half
 * (lockfile-driven, `link: true` entries skipped, never `npm outdated`); PR2-SEC-07 item 3 and PR4-SEC-09 (the
 * freshness report lists stale dev transitives, `nanospinner` 1.2.2 included).
 *
 * Registry data never comes from the network during a check: `--times <file>` is produced beforehand by `--fetch`
 * (CI only), a bounded-concurrency read of `https://registry.npmjs.org/<name>` (full packument: the abbreviated
 * `application/vnd.npm.install-v1+json` document carries no per-version `time`), 30 s timeout, 3 attempts with
 * backoff and jitter on GET (idempotent).
 *
 *   node tools/ci/check-dep-age.mjs --fetch --out <times.json> [--base <git-ref>] [--concurrency 8]
 *   node tools/ci/check-dep-age.mjs --times <times.json> [--base <git-ref>] [--now <iso>] [--report <file.md>]
 *                                   [--root <dir>] [--summary <file>] [--json]
 *
 * With `--base` only the new name@version tuples are fetched and checked (the register expiry check always runs).
 * Exit 0 pass, 1 policy finding(s), 2 usage/internal error.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  NPM_REGISTRY,
  cell,
  daysUntil,
  directDependencyNames,
  formatFinding,
  isExpired,
  newTupleIds,
  parseDate,
  readBaseLockfile,
  readJsonFile,
  readLockfile,
  RegisterError,
  runCli,
  tuplesOf,
  validateRegister,
} from './dep-gates-lib.mjs';
import { loadOverrides } from './check-lockfile.mjs';

/** @typedef {import('./dep-gates-lib.mjs').Lockfile} Lockfile */
/** @typedef {import('./dep-gates-lib.mjs').Finding} Finding */
/** @typedef {import('./check-lockfile.mjs').Override} Override */
/** @typedef {{ published: string, deprecated?: string }} VersionTime */
/** @typedef {{ latest?: string, latestPublished: string }} PackageTime */
/** @typedef {{ schema: string, fetchedAt: string, versions: Record<string, VersionTime>, packages: Record<string, PackageTime> }} RegistryTimes */
/** @typedef {{ name: string, version: string, kind: 'direct-stale' | 'deprecated-transitive', via: string[], reason: string, decision: string, review_by: string, expires: string, exit_criteria: string | string[] }} MaintenanceException */
/** @typedef {{ id: string, production: boolean, direct: boolean, latest: string, latestPublished: string, deprecated?: string }} ReportRow */

export const TIMES_SCHEMA = 'shipqube.registry-times/1';
export const MIN_AGE_DAYS = 7;
export const STALE_MONTHS = 18;
const DAY_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;

/** @param {unknown} data @returns {MaintenanceException[]} */
export function loadMaintenance(data) {
  const entries = validateRegister(
    data,
    'exceptions',
    ['name', 'version', 'kind', 'via', 'reason', 'decision', 'review_by', 'expires', 'exit_criteria'],
    ['expires'],
  );
  return entries.map((entry, index) => {
    if (entry.kind !== 'direct-stale' && entry.kind !== 'deprecated-transitive')
      throw new RegisterError(`exceptions[${index}].kind must be direct-stale or deprecated-transitive`);
    if (!Array.isArray(entry.via)) throw new RegisterError(`exceptions[${index}].via must be an array`);
    if (!/^D-[A-Z]+-\d+/.test(String(entry.decision))) throw new RegisterError(`exceptions[${index}].decision must be a DECISIONS.md ID`);
    return /** @type {MaintenanceException} */ (/** @type {unknown} */ (entry));
  });
}

/** @param {unknown} data @returns {RegistryTimes} */
export function loadTimes(data) {
  const times = /** @type {Partial<RegistryTimes>} */ (data);
  if (times?.schema !== TIMES_SCHEMA || typeof times.versions !== 'object' || typeof times.packages !== 'object') {
    throw new RegisterError(`--times: expected a ${TIMES_SCHEMA} document with "versions" and "packages"`);
  }
  return /** @type {RegistryTimes} */ (times);
}

/** `now` minus whole calendar months (UTC). */
function monthsBefore(/** @type {Date} */ now, /** @type {number} */ months) {
  const date = new Date(now.getTime());
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
}

/**
 * Pure core.
 * @param {Lockfile} lock
 * @param {{ times: RegistryTimes, now: Date, cooldownReference?: Date, scope?: Set<string>, maintenance?: MaintenanceException[], overrides?: Override[], minAgeDays?: number, staleMonths?: number }} options
 */
export function checkDepAge(lock, options) {
  const { times, now } = options;
  const reference = options.cooldownReference ?? now;
  const maintenance = options.maintenance ?? [];
  const overrides = options.overrides ?? [];
  const minAgeMs = (options.minAgeDays ?? MIN_AGE_DAYS) * DAY_MS;
  const staleBefore = monthsBefore(now, options.staleMonths ?? STALE_MONTHS);
  const direct = directDependencyNames(lock);
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Finding[]} */
  const notes = [];
  /** @type {{ stale: ReportRow[], deprecatedDev: ReportRow[], excepted: ReportRow[] }} */
  const report = { stale: [], deprecatedDev: [], excepted: [] };
  const tuples = tuplesOf(lock);

  // The register is evaluated in full on every run: an expired entry fails even when its package is untouched.
  const REGISTER = 'tools/ci/maintenance-exceptions.json';
  for (const entry of maintenance) {
    const id = `${entry.name}@${entry.version}`;
    if (isExpired(entry.expires, now))
      findings.push({
        rule: 'maintenance/expired',
        message: `exception ${id} (${entry.decision}) expired on ${entry.expires}; a new decision is required`,
        location: REGISTER,
      });
    if (!tuples.has(id))
      notes.push({ rule: 'maintenance/unused', message: `exception ${id} matches no lockfile entry; remove it`, location: REGISTER });
  }

  for (const [id, tuple] of tuples) {
    if (options.scope !== undefined && !options.scope.has(id)) continue;
    if (tuple.name.startsWith('@platform/')) continue; // never a registry package (check-lockfile fails it)
    const location = tuple.keys[0] ?? id;
    const version = times.versions[id];
    const pkg = times.packages[tuple.name];
    if (version === undefined || pkg === undefined) {
      findings.push({
        rule: 'dep-age/no-data',
        message: `no registry publish time for ${id} in --times; run the --fetch step over this set`,
        location,
      });
      continue;
    }
    const published = parseDate(version.published, `${id}.published`);
    if (reference.getTime() - published.getTime() < minAgeMs) {
      const override = overrides.find((o) => o.kind === 'cooldown' && o.package === id);
      if (override === undefined || isExpired(override.expires, now)) {
        const extra = override === undefined ? '' : ` (override ${override.decision} expired on ${override.expires})`;
        findings.push({
          rule: 'dep-age/cooldown',
          message: `${id} was published ${version.published}, fewer than ${options.minAgeDays ?? MIN_AGE_DAYS} days before ${reference.toISOString()}${extra}`,
          location,
        });
      } else {
        notes.push({
          rule: 'dep-age/cooldown-override',
          message: `${id} younger than the cooldown, allowed by ${override.decision} until ${override.expires}`,
          location,
        });
      }
    }

    const isDirect = direct.has(tuple.name);
    const deprecated = typeof version.deprecated === 'string' && version.deprecated !== '' ? version.deprecated : undefined;
    const stale = parseDate(pkg.latestPublished, `${tuple.name}.latestPublished`).getTime() < staleBefore.getTime();
    /** @type {ReportRow} */
    const row = {
      id,
      production: tuple.production,
      direct: isDirect,
      latest: pkg.latest ?? '?',
      latestPublished: pkg.latestPublished,
      ...(deprecated === undefined ? {} : { deprecated }),
    };
    if (!stale && deprecated === undefined) continue;

    const exception = maintenance.find((e) => e.name === tuple.name && e.version === tuple.version);
    if (exception !== undefined) {
      report.excepted.push(row); // expiry already gated above
      continue;
    }
    if (isDirect) {
      const why =
        deprecated === undefined ? `no release since ${pkg.latestPublished} (> ${STALE_MONTHS} months)` : `deprecated: ${deprecated}`;
      findings.push({
        rule: 'freshness/direct',
        message: `direct dependency ${id}: ${why}; needs a maintenance exception or an upgrade`,
        location,
      });
    } else if (deprecated !== undefined && tuple.production) {
      findings.push({
        rule: 'freshness/deprecated-production',
        message: `deprecated transitive ${id} in the production closure: ${deprecated}`,
        location,
      });
    } else if (deprecated !== undefined) {
      report.deprecatedDev.push(row);
    } else {
      report.stale.push(row);
    }
  }
  return { findings, notes, report };
}

/**
 * Freshness report (D-ARCH-003 rev 4 item 4: every exception with its days to expiry; PR2-SEC-07 item 3 and
 * PR4-SEC-09: stale dev transitives).
 * @param {ReturnType<typeof checkDepAge>} result @param {MaintenanceException[]} maintenance @param {Date} now @param {string} scope
 */
export function freshnessReport(result, maintenance, now, scope) {
  const months = (/** @type {string} */ iso) => Math.floor((now.getTime() - new Date(iso).getTime()) / (30.44 * DAY_MS));
  const rows = (/** @type {ReportRow[]} */ list) => [
    '| Package | Closure | Latest | Last release | Months |',
    '|---|---|---|---|---|',
    ...[...list]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(
        (r) =>
          `| \`${cell(r.id)}\` | ${r.production ? '**production**' : 'dev'} | ${cell(r.latest)} | ${cell(r.latestPublished.slice(0, 10))} | ${months(r.latestPublished)} |`,
      ),
  ];
  const lines = [`## Dependency freshness report (${now.toISOString().slice(0, 10)}, scope: ${cell(scope)})`, ''];
  lines.push(
    `Gate: ${result.findings.length === 0 ? 'PASS' : `FAIL (${result.findings.length})`}`,
    '',
    ...result.findings.map((f) => `- ${cell(formatFinding(f))}`),
    '',
  );
  lines.push(
    '### Maintenance exceptions (tools/ci/maintenance-exceptions.json)',
    '',
    '| Package | Kind | Decision | Review by | Expires | Days to expiry |',
    '|---|---|---|---|---|---|',
  );
  lines.push(
    ...maintenance.map(
      (e) =>
        `| \`${cell(`${e.name}@${e.version}`)}\` | ${e.kind} | ${cell(e.decision)} | ${cell(e.review_by)} | ${e.expires} | ${daysUntil(e.expires, now)} |`,
    ),
    '',
  );
  lines.push(
    `### Stale transitives, report-only (no release in more than ${STALE_MONTHS} months; D-ARCH-003 rev 2 item 6)`,
    '',
    ...rows(result.report.stale),
    '',
  );
  lines.push('### Deprecated dev-only transitives, report-only (D-ARCH-003 rev 4 item 3)', '', ...rows(result.report.deprecatedDev), '');
  return lines.join('\n');
}

/**
 * Registry read for `--fetch` (CI only). One GET per package name, bounded concurrency, timeout and retries.
 * @param {Array<{ name: string, version: string }>} tuples
 * @param {{ fetchImpl?: typeof fetch, concurrency?: number, timeoutMs?: number, now?: Date, retryDelayMs?: number }} [options]
 * @returns {Promise<RegistryTimes>}
 */
export async function fetchRegistryTimes(tuples, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? 500;
  /** @type {Map<string, Set<string>>} */
  const byName = new Map();
  for (const { name, version } of tuples) {
    if (name.startsWith('@platform/')) continue; // the third-party scope is never queried (PR1-SEC-01/-12)
    byName.set(name, (byName.get(name) ?? new Set()).add(version));
  }
  /** @type {RegistryTimes} */
  const out = { schema: TIMES_SCHEMA, fetchedAt: (options.now ?? new Date()).toISOString(), versions: {}, packages: {} };

  const getPackument = async (/** @type {string} */ name) => {
    const url = `${NPM_REGISTRY}${name.replace('/', '%2f')}`;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          headers: { accept: 'application/json' },
          redirect: 'error',
          signal: globalThis.AbortSignal.timeout(timeoutMs),
        });
        if (response.ok)
          return /** @type {{ time?: Record<string, string>, versions?: Record<string, { deprecated?: unknown }>, 'dist-tags'?: Record<string, string> }} */ (
            await response.json()
          );
        if (response.status !== 429 && response.status < 500) throw new RegisterError(`GET ${url}: HTTP ${response.status}`);
        if (attempt >= FETCH_ATTEMPTS) throw new Error(`GET ${url}: HTTP ${response.status} after ${attempt} attempts`);
      } catch (error) {
        if (error instanceof RegisterError || attempt >= FETCH_ATTEMPTS) throw error;
      }
      await sleep(retryDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * retryDelayMs));
    }
  };

  const names = [...byName.keys()].sort();
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < names.length; index = next++) {
      const name = /** @type {string} */ (names[index]);
      const doc = await getPackument(name);
      const time = doc.time ?? {};
      const releases = Object.entries(time)
        .filter(([key]) => key !== 'created' && key !== 'modified')
        .map(([, iso]) => iso);
      if (releases.length === 0) throw new RegisterError(`${name}: packument has no release times`);
      const latestPublished = releases.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
      const latest = doc['dist-tags']?.latest;
      out.packages[name] = { ...(latest === undefined ? {} : { latest }), latestPublished };
      for (const version of byName.get(name) ?? []) {
        const published = time[version];
        if (published === undefined) throw new RegisterError(`${name}@${version}: no publish time in the packument`);
        const deprecated = doc.versions?.[version]?.deprecated;
        out.versions[`${name}@${version}`] = { published, ...(typeof deprecated === 'string' && deprecated !== '' ? { deprecated } : {}) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 8, 16)) }, worker));
  return out;
}

/** Cooldown reference: min(now, committer time of the last commit touching package-lock.json); a forged future date cannot help. */
function lockfileCommitTime(/** @type {string} */ root, /** @type {Date} */ now) {
  // A failing `git log` (no git, not a checkout) throws: exit 2, never a silently laxer reference.
  const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', 'package-lock.json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const date = iso === '' ? now : new Date(iso);
  return Number.isNaN(date.getTime()) || date > now ? now : date;
}

async function main(/** @type {string[]} */ argv) {
  const options = /** @type {const} */ ({
    base: { type: 'string' },
    times: { type: 'string' },
    fetch: { type: 'boolean' },
    out: { type: 'string' },
    concurrency: { type: 'string' },
    now: { type: 'string' },
    report: { type: 'string' },
  });
  return runCli(
    'check-dep-age',
    options,
    async (flags) => {
      const root = /** @type {string} */ (flags.root);
      const lock = readLockfile(root);
      const scope = typeof flags.base === 'string' ? newTupleIds(readBaseLockfile(root, flags.base), lock) : undefined;
      const scopeLabel = typeof flags.base === 'string' ? `delta vs ${flags.base} (${scope?.size ?? 0} new tuples)` : 'whole lockfile';
      const now = typeof flags.now === 'string' ? parseDate(flags.now, '--now') : new Date();

      if (flags.fetch === true) {
        if (typeof flags.out !== 'string') throw new RegisterError('--fetch needs --out <file>');
        const selected = [...tuplesOf(lock).entries()].filter(([id]) => scope === undefined || scope.has(id)).map(([, t]) => t);
        const times = await fetchRegistryTimes(selected, { concurrency: Number(flags.concurrency ?? 8), now });
        writeFileSync(flags.out, `${JSON.stringify(times, null, 2)}\n`);
        return {
          findings: [],
          notes: [],
          markdown: `check-dep-age: fetched registry times for ${Object.keys(times.packages).length} packages (${scopeLabel})`,
        };
      }
      if (typeof flags.times !== 'string') throw new RegisterError('--times <file> is required (produce it with --fetch --out <file>)');
      const maintenance = loadMaintenance(readJsonFile(join(root, 'tools', 'ci', 'maintenance-exceptions.json')));
      const overrides = loadOverrides(readJsonFile(join(root, 'tools', 'ci', 'dependency-overrides.json')));
      const result = checkDepAge(lock, {
        times: loadTimes(readJsonFile(flags.times)),
        now,
        cooldownReference: typeof flags.now === 'string' ? now : lockfileCommitTime(root, now),
        maintenance,
        overrides,
        ...(scope === undefined ? {} : { scope }),
      });
      const markdown = freshnessReport(result, maintenance, now, scopeLabel);
      if (typeof flags.report === 'string') writeFileSync(flags.report, `${markdown}\n`);
      return { findings: result.findings, notes: result.notes, markdown, json: result.report };
    },
    argv,
  );
}

if (typeof import.meta.main !== 'boolean') throw new Error('check-dep-age needs Node >= 24.2 (import.meta.main)');
if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
