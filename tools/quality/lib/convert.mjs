// @ts-check
/**
 * Native report -> JUnit case converters for the lane B heavy run (TASK-011; ADR-0023 am. B, G item 1; TEST-STRATEGY
 * section 9.1). Every function is pure: it takes the parsed native JSON (as `unknown`), narrows it, and returns
 * `JUnitCase[]` for tools/quality/lib/junit-write.mjs. A report that does not have the expected shape yields one
 * `error` case (never an empty, vacuously green suite). The native JSON itself is kept next to the JUnit as
 * `native_report`; `sanitizeNative` strips values that must never be committed (Gitleaks secrets).
 *
 * Supported: Jest `--json`, k6 summary (`--summary-export` and `handleSummary` data), LHCI assertion results, ZAP
 * baseline `-J` report, Trivy `--format json`, Gitleaks `--report-format json`, Stryker mutation report (schema v1/v2).
 */

/** @typedef {import('./junit-write.mjs').JUnitCase} JUnitCase */

/** Most findings listed in one failure message; the remainder is summarised as a count. */
const MAX_LISTED = 50;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} value */
const str = (value) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
/** @param {unknown} value */
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
/** @param {unknown} value @returns {unknown[]} */
const arr = (value) => (Array.isArray(value) ? value : []);

/**
 * @param {string} tool
 * @param {string} reason
 * @returns {JUnitCase[]}
 */
export function malformed(tool, reason) {
  return [{ name: `${tool} report is readable`, classname: tool, status: 'error', message: `malformed ${tool} report: ${reason}` }];
}

/**
 * @param {string[]} items
 * @returns {string}
 */
function listFindings(items) {
  const shown = items.slice(0, MAX_LISTED).join('\n');
  return items.length > MAX_LISTED ? `${shown}\n... and ${items.length - MAX_LISTED} more` : shown;
}

/**
 * Replaces absolute host paths (repository root, home directory) so evidence never carries the host user name.
 * @param {string} text
 * @param {readonly string[]} prefixes absolute paths to replace, most specific first
 * @returns {string}
 */
export function scrubPaths(text, prefixes) {
  let out = text;
  for (const prefix of prefixes) {
    if (prefix.length < 3) continue;
    for (const variant of new Set([prefix, prefix.replaceAll('\\', '/'), prefix.replaceAll('/', '\\')]))
      out = out.split(variant).join('<root>');
  }
  return out;
}

// --- Jest -------------------------------------------------------------------------------------------------------

/**
 * Jest `--json` output -> cases. A test file that failed to run (syntax error, failing hook, Testcontainers start-up)
 * has no assertion results: it becomes one `error` case so the failure is counted.
 * @param {unknown} report
 * @param {{ root?: string, scrub?: readonly string[] }} [options] `root` makes file names relative
 * @returns {JUnitCase[]}
 */
export function jestToCases(report, options = {}) {
  if (!isObject(report) || !Array.isArray(report['testResults'])) return malformed('jest', 'testResults[] missing');
  const scrub = options.scrub ?? (options.root ? [options.root] : []);
  /** @param {string} file */
  const rel = (file) => {
    const normalized = file.replaceAll('\\', '/');
    const root = (options.root ?? '').replaceAll('\\', '/').replace(/\/+$/, '');
    return root !== '' && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? normalized.slice(root.length + 1) : normalized;
  };
  /** @type {JUnitCase[]} */
  const cases = [];
  for (const file of report['testResults']) {
    if (!isObject(file)) continue;
    const classname = rel(str(file['name']));
    const assertions = arr(file['assertionResults']).filter(isObject);
    for (const a of assertions) {
      const status = str(a['status']);
      const name = str(a['fullName']) || [...arr(a['ancestorTitles']).map(str), str(a['title'])].join(' ');
      const time = num(a['duration']) / 1000;
      if (status === 'passed') cases.push({ name, classname, time, status: 'passed' });
      else if (status === 'failed')
        cases.push({ name, classname, time, status: 'failed', message: scrubPaths(arr(a['failureMessages']).map(str).join('\n'), scrub) });
      else cases.push({ name, classname, time, status: 'skipped', message: `jest status ${status}` });
    }
    const fileFailed = str(file['status']) === 'failed';
    const failedAssertions = assertions.some((a) => str(a['status']) === 'failed');
    if (fileFailed && !failedAssertions)
      cases.push({
        name: `${classname} (test file failed to run)`,
        classname,
        status: 'error',
        message: scrubPaths(str(file['message']) || 'test file failed without assertion results', scrub),
      });
  }
  return cases;
}

// --- k6 ---------------------------------------------------------------------------------------------------------

/**
 * k6 summary -> one case per threshold and per check. Accepts the `--summary-export` format (threshold value = "was
 * crossed" boolean, `root_group.checks` as an object) and the `handleSummary` data format (threshold `{ ok }`,
 * checks as an array, nested `groups`).
 * @param {unknown} report
 * @param {{ scenario?: string }} [options]
 * @returns {JUnitCase[]}
 */
export function k6ToCases(report, options = {}) {
  if (!isObject(report) || !isObject(report['metrics'])) return malformed('k6', 'metrics{} missing');
  const classname = `k6.${options.scenario ?? 'summary'}`;
  /** @type {JUnitCase[]} */
  const cases = [];
  for (const [metric, body] of Object.entries(report['metrics']).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isObject(body) || !isObject(body['thresholds'])) continue;
    for (const [expression, outcome] of Object.entries(body['thresholds'])) {
      const ok = isObject(outcome) ? outcome['ok'] === true : outcome === false;
      const name = `threshold ${metric}: ${expression}`;
      cases.push(
        ok
          ? { name, classname, status: 'passed' }
          : { name, classname, status: 'failed', message: `k6 threshold crossed: ${metric} ${expression}` },
      );
    }
  }
  /** @param {unknown} group @param {string} prefix */
  const walk = (group, prefix) => {
    if (!isObject(group)) return;
    const checks = Array.isArray(group['checks']) ? group['checks'] : isObject(group['checks']) ? Object.values(group['checks']) : [];
    for (const check of checks) {
      if (!isObject(check)) continue;
      const name = `check ${prefix}${str(check['name'])}`;
      const fails = num(check['fails']);
      cases.push(
        fails === 0
          ? { name, classname, status: 'passed' }
          : { name, classname, status: 'failed', message: `${fails} of ${fails + num(check['passes'])} checks failed` },
      );
    }
    const groups = Array.isArray(group['groups']) ? group['groups'] : isObject(group['groups']) ? Object.values(group['groups']) : [];
    for (const child of groups) if (isObject(child)) walk(child, `${prefix}${str(child['name'])} > `);
  };
  walk(report['root_group'], '');
  return cases.length > 0 ? cases : malformed('k6', 'no thresholds and no checks: the scenario asserts nothing');
}

// --- Lighthouse CI ----------------------------------------------------------------------------------------------

/**
 * LHCI assertion results (`.lighthouseci/assertion-results.json`, an array that lists only the assertions that did
 * not pass) -> one case per audited URL (failed when an `error`-level assertion failed for it; `warn` is reported in
 * the message only) plus one failed case per error-level assertion on a URL outside `urls`.
 * @param {unknown} report
 * @param {{ urls: readonly string[] }} options the URLs LHCI collected (from its manifest)
 * @returns {JUnitCase[]}
 */
export function lighthouseToCases(report, options) {
  if (!Array.isArray(report)) return malformed('lighthouse', 'assertion results must be an array');
  if (options.urls.length === 0) return malformed('lighthouse', 'no collected URL');
  const results = report.filter(isObject);
  /** @param {Record<string, unknown>} r */
  const describe = (r) =>
    `${str(r['level'])} ${str(r['auditId'])}${r['auditProperty'] ? `.${str(r['auditProperty'])}` : ''}: ${str(r['name'])} expected ${str(r['operator'])} ${str(r['expected'])}, actual ${str(r['actual'])}`;
  /** @type {JUnitCase[]} */
  const cases = options.urls.map((url) => {
    const mine = results.filter((r) => str(r['url']) === url && r['passed'] !== true);
    const errors = mine.filter((r) => str(r['level']) !== 'warn');
    const name = `lighthouse assertions ${url}`;
    return errors.length === 0
      ? {
          name,
          classname: 'lighthouse',
          status: /** @type {const} */ ('passed'),
          ...(mine.length > 0 ? { message: listFindings(mine.map(describe)) } : {}),
        }
      : { name, classname: 'lighthouse', status: /** @type {const} */ ('failed'), message: listFindings(mine.map(describe)) };
  });
  const orphans = results.filter((r) => !options.urls.includes(str(r['url'])) && r['passed'] !== true && str(r['level']) !== 'warn');
  for (const r of orphans)
    cases.push({
      name: `lighthouse assertion ${str(r['url'])} ${str(r['auditId'])}`,
      classname: 'lighthouse',
      status: 'failed',
      message: describe(r),
    });
  return cases;
}

// --- OWASP ZAP baseline -----------------------------------------------------------------------------------------

/**
 * ZAP `-J` JSON -> one case per site ("scanned") plus one case per alert. An alert fails when its risk code is at or
 * above `failAtRisk` (default 2 = Medium) and its plugin id is not in `ignore` (the rules file with reasons).
 * @param {unknown} report
 * @param {{ failAtRisk?: number, ignore?: readonly string[] }} [options]
 * @returns {JUnitCase[]}
 */
export function zapToCases(report, options = {}) {
  if (!isObject(report) || !Array.isArray(report['site'])) return malformed('zap', 'site[] missing');
  const failAt = options.failAtRisk ?? 2;
  const ignore = new Set(options.ignore ?? []);
  /** @type {JUnitCase[]} */
  const cases = [];
  for (const site of report['site']) {
    if (!isObject(site)) continue;
    const siteName = str(site['@name']);
    cases.push({ name: `zap baseline scanned ${siteName}`, classname: 'zap', status: 'passed' });
    for (const alert of arr(site['alerts'])) {
      if (!isObject(alert)) continue;
      const plugin = str(alert['pluginid']);
      const risk = Number.parseInt(str(alert['riskcode']), 10);
      const name = `zap ${siteName} ${plugin} ${str(alert['name'] ?? alert['alert'])}`;
      const failing = Number.isFinite(risk) && risk >= failAt && !ignore.has(plugin);
      cases.push(
        failing
          ? {
              name,
              classname: 'zap',
              status: 'failed',
              message: `${str(alert['riskdesc'])}; instances: ${str(alert['count']) || arr(alert['instances']).length}`,
            }
          : { name, classname: 'zap', status: 'passed', ...(ignore.has(plugin) ? { message: 'ignored by the rules file' } : {}) },
      );
    }
  }
  return cases.length > 0 ? cases : malformed('zap', 'no site scanned');
}

// --- Trivy ------------------------------------------------------------------------------------------------------

const SEVERITY_ORDER = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * Trivy JSON -> one case per scan target and finding class (vulnerabilities, misconfigurations, secrets, licenses);
 * a case fails when it holds a finding at or above `failAt` (default HIGH). Secret findings are listed by rule and
 * location only, never by matched text.
 * @param {unknown} report
 * @param {{ failAt?: string }} [options]
 * @returns {JUnitCase[]}
 */
export function trivyToCases(report, options = {}) {
  if (!isObject(report)) return malformed('trivy', 'not an object');
  const threshold = SEVERITY_ORDER.indexOf((options.failAt ?? 'HIGH').toUpperCase());
  const artifact = str(report['ArtifactName']) || 'artifact';
  /** @param {unknown} severity */
  const severe = (severity) => SEVERITY_ORDER.indexOf(str(severity).toUpperCase()) >= threshold;
  /** @type {JUnitCase[]} */
  const cases = [];
  /** @type {Array<[string, string, (f: Record<string, unknown>) => string, (f: Record<string, unknown>) => boolean]>} */
  const kinds = [
    [
      'Vulnerabilities',
      'vulnerabilities',
      (f) =>
        `${str(f['Severity'])} ${str(f['VulnerabilityID'])} ${str(f['PkgName'])}@${str(f['InstalledVersion'])} fixed in ${str(f['FixedVersion']) || 'n/a'}`,
      () => true,
    ],
    [
      'Misconfigurations',
      'misconfigurations',
      (f) => `${str(f['Severity'])} ${str(f['AVDID'] ?? f['ID'])} ${str(f['Title'])}`,
      (f) => str(f['Status']) !== 'PASS',
    ],
    [
      'Secrets',
      'secrets',
      (f) => `${str(f['Severity'])} ${str(f['RuleID'])} lines ${str(f['StartLine'])}-${str(f['EndLine'])}`,
      () => true,
    ],
    ['Licenses', 'licenses', (f) => `${str(f['Severity'])} ${str(f['Name'])} (${str(f['PkgName'])})`, () => true],
  ];
  // Trivy omits `Results` entirely when an image has nothing to scan, and omits a finding class when it is empty.
  if (!('SchemaVersion' in report) && !Array.isArray(report['Results'])) return malformed('trivy', 'SchemaVersion/Results missing');
  for (const result of arr(report['Results'])) {
    if (!isObject(result)) continue;
    const target = str(result['Target']);
    const present = kinds.filter(([key]) => key in result);
    if (present.length === 0)
      cases.push({ name: `trivy ${artifact} ${target} (${str(result['Class'])}) clean`, classname: 'trivy', status: 'passed' });
    for (const [key, label, describe, counts] of present) {
      const findings = arr(result[key])
        .filter(isObject)
        .filter((f) => counts(f) && severe(f['Severity']));
      const name = `trivy ${artifact} ${target} ${label}`;
      cases.push(
        findings.length === 0
          ? { name, classname: 'trivy', status: 'passed' }
          : { name, classname: 'trivy', status: 'failed', message: listFindings(findings.map(describe)) },
      );
    }
  }
  if (cases.length === 0) cases.push({ name: `trivy ${artifact} scanned (no target)`, classname: 'trivy', status: 'passed' });
  return cases;
}

// --- Gitleaks ---------------------------------------------------------------------------------------------------

/**
 * Gitleaks JSON (array of findings) -> one case "no leaks"; findings listed by rule, file, line and short commit.
 * @param {unknown} report
 * @returns {JUnitCase[]}
 */
export function gitleaksToCases(report) {
  if (!Array.isArray(report)) return malformed('gitleaks', 'findings array expected');
  const findings = report.filter(isObject);
  const name = 'gitleaks full history: no leaks';
  if (findings.length === 0) return [{ name, classname: 'gitleaks', status: 'passed' }];
  const list = findings.map((f) => `${str(f['RuleID'])} ${str(f['File'])}:${str(f['StartLine'])} ${str(f['Commit']).slice(0, 7)}`);
  return [{ name, classname: 'gitleaks', status: 'failed', message: listFindings(list) }];
}

/** Fields of a Gitleaks finding that may hold the leaked value itself. */
const GITLEAKS_VALUE_FIELDS = ['Secret', 'Match', 'Line'];

/**
 * Returns a copy of a Gitleaks report with every value-bearing field replaced, so the native report can be committed
 * as evidence even when the scan ran without `--redact`.
 * @param {unknown} report
 * @returns {unknown}
 */
export function redactGitleaks(report) {
  if (!Array.isArray(report)) return report;
  return report.map((finding) => {
    if (!isObject(finding)) return finding;
    const copy = { ...finding };
    for (const field of GITLEAKS_VALUE_FIELDS) if (field in copy) copy[field] = 'REDACTED';
    return copy;
  });
}

// --- Stryker ----------------------------------------------------------------------------------------------------

/**
 * Stryker mutation-testing report -> one informational case per file (mutation score in the message) plus one gating
 * case "mutation score >= break". Score = detected / valid, detected = Killed + Timeout, valid = detected + Survived +
 * NoCoverage (Stryker's definition; Ignored/CompileError/RuntimeError/Pending excluded).
 * @param {unknown} report
 * @param {{ breakAt?: number }} [options] defaults to `thresholds.break`, else 0
 * @returns {JUnitCase[]}
 */
export function strykerToCases(report, options = {}) {
  if (!isObject(report) || !isObject(report['files'])) return malformed('stryker', 'files{} missing');
  const thresholds = isObject(report['thresholds']) ? report['thresholds'] : {};
  const breakAt = options.breakAt ?? (typeof thresholds['break'] === 'number' ? thresholds['break'] : 0);
  /** @type {JUnitCase[]} */
  const cases = [];
  let detected = 0;
  let valid = 0;
  for (const [file, body] of Object.entries(report['files']).sort(([a], [b]) => a.localeCompare(b))) {
    let fileDetected = 0;
    let fileValid = 0;
    for (const mutant of isObject(body) ? arr(body['mutants']).filter(isObject) : []) {
      const status = str(mutant['status']);
      if (status === 'Killed' || status === 'Timeout') {
        fileDetected += 1;
        fileValid += 1;
      } else if (status === 'Survived' || status === 'NoCoverage') fileValid += 1;
    }
    detected += fileDetected;
    valid += fileValid;
    const score = fileValid === 0 ? 100 : (fileDetected / fileValid) * 100;
    cases.push({
      name: `stryker ${file}`,
      classname: 'stryker',
      status: 'passed',
      message: `mutation score ${score.toFixed(2)} % (${fileDetected}/${fileValid})`,
    });
  }
  if (valid === 0) return [...cases, ...malformed('stryker', 'no valid mutant')];
  const total = (detected / valid) * 100;
  const name = `stryker mutation score >= ${breakAt}`;
  const message = `mutation score ${total.toFixed(2)} % (${detected}/${valid})`;
  cases.push(
    total >= breakAt
      ? { name, classname: 'stryker', status: 'passed', message }
      : { name, classname: 'stryker', status: 'failed', message },
  );
  return cases;
}

/**
 * Converter registry used by tools/quality/suite-runners.json `converter` values. `junit` (the command wrote JUnit
 * itself) is handled by heavy.mjs.
 */
export const CONVERTERS = /** @type {const} */ ({
  k6: 'k6ToCases',
  lighthouse: 'lighthouseToCases',
  zap: 'zapToCases',
  trivy: 'trivyToCases',
  gitleaks: 'gitleaksToCases',
  stryker: 'strykerToCases',
});

/**
 * @param {keyof typeof CONVERTERS} converter
 * @param {unknown} report
 * @param {Record<string, unknown>} [options] converter options from suite-runners.json
 * @returns {JUnitCase[]}
 */
export function convertNative(converter, report, options = {}) {
  switch (converter) {
    case 'k6':
      return k6ToCases(report, { ...(typeof options['scenario'] === 'string' ? { scenario: options['scenario'] } : {}) });
    case 'lighthouse':
      return lighthouseToCases(report, { urls: arr(options['urls']).map(str) });
    case 'zap':
      return zapToCases(report, {
        ...(typeof options['failAtRisk'] === 'number' ? { failAtRisk: options['failAtRisk'] } : {}),
        ignore: arr(options['ignore']).map(str),
      });
    case 'trivy':
      return trivyToCases(report, { ...(typeof options['failAt'] === 'string' ? { failAt: options['failAt'] } : {}) });
    case 'gitleaks':
      return gitleaksToCases(report);
    case 'stryker':
      return strykerToCases(report, { ...(typeof options['breakAt'] === 'number' ? { breakAt: options['breakAt'] } : {}) });
    default:
      return malformed(String(converter), 'unknown converter');
  }
}

/**
 * The native report as it may be committed: Gitleaks values redacted, everything else unchanged.
 * @param {string} converter
 * @param {unknown} report
 * @returns {unknown}
 */
export function sanitizeNative(converter, report) {
  return converter === 'gitleaks' ? redactGitleaks(report) : report;
}
