/**
 * Runs the repository's Semgrep rule packs (.semgrep/*.yml: raw SQL, outbound HTTP, innerHTML, country branches,
 * password hashing) in Docker, pinned by digest (US-048, NFR-SEC-002, PR2-SEC-02, PR2-SEC-04, SEC-P3-31).
 *
 *  - Scan (default): scans the working tree mounted read-only, with `--disable-nosem` (inline `nosemgrep` cannot
 *    suppress a finding), `--error` and `--metrics=off`, with no network. `--rules-from <dir>` takes the rule packs from
 *    another directory, so lane A passes the BASE ref's `.semgrep/` (checked out separately) and a PR can neither weaken
 *    nor delete the rules it is scanned with. Fixtures under tests/fixtures/ are excluded by `.semgrepignore`.
 *  - `--test`: `semgrep --test` for every rule pack against its fixture tests/fixtures/semgrep/<stem>.{ts,tsx}
 *    (`// ruleid:` / `// ok:` annotations). Every rule pack must have a fixture.
 *
 * Usage: node tools/ci/run-semgrep.mjs [--root <dir>] [--rules-from <dir>] [--test] [--summary <file>] [--json]
 * Exit 0 = clean, 1 = finding(s) or failing rule tests, 2 = usage, Docker or Semgrep error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

/** Semgrep 1.183.0 (published 2026-10-29, older than the 7-day cooldown), pinned by the multi-arch index digest. */
export const SEMGREP_IMAGE =
  'semgrep/semgrep:1.183.0@sha256:2e45517a85e13a9cca14a2a00df6bb48affd66b8ebfae1b0991cd57578362fb0';

export const RULES_DIR = '.semgrep';
export const FIXTURES_DIR = 'tests/fixtures/semgrep';
const FIXTURE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];
const SCAN_TIMEOUT_MS = 15 * 60_000;
const TEST_TIMEOUT_MS = 5 * 60_000;

/**
 * @typedef {{ root: string; rulesFrom: string | undefined; test: boolean; summaryFile: string | undefined; json: boolean }} Options
 * @typedef {{ rule: string; message: string; location: string }} Finding
 */

/**
 * @param {string[]} argv
 * @returns {Options}
 */
export function parseArgs(argv) {
  /** @type {Options} */
  const options = { root: process.cwd(), rulesFrom: undefined, test: false, summaryFile: undefined, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--test') options.test = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--root' || arg === '--rules-from' || arg === '--summary') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--root') options.root = resolve(value);
      else if (arg === '--rules-from') options.rulesFrom = resolve(value);
      else options.summaryFile = value;
      i += 1;
    } else throw new Error(`unknown argument '${String(arg)}'`);
  }
  if (options.test && options.rulesFrom !== undefined) throw new Error('--test runs the head rules; drop --rules-from');
  return options;
}

/**
 * A read-only bind mount. `--mount` (not `-v`) so a Windows drive letter is not read as a separator; a comma would
 * split the mount specification, so it is rejected.
 * @param {string} source absolute host path
 * @param {string} target container path
 */
export function bindMount(source, target) {
  if (source.includes(',')) throw new Error(`cannot bind-mount a path containing a comma: ${source}`);
  return ['--mount', `type=bind,source=${source},target=${target},readonly`];
}

/**
 * `docker run` prefix: no network, no metrics, no version check, the repository read-only at /src.
 * @param {string} root
 * @param {string[]} extraMounts
 */
const dockerRun = (root, extraMounts) => [
  'run',
  '--rm',
  '--network',
  'none',
  ...bindMount(root, '/src'),
  ...extraMounts,
  '--workdir',
  '/src',
  '--env',
  'SEMGREP_ENABLE_VERSION_CHECK=0',
  '--env',
  'SEMGREP_SEND_METRICS=off',
  SEMGREP_IMAGE,
];

/**
 * Docker arguments for a scan of the tree at `root` with the rule packs at `rulesFrom` (default: `<root>/.semgrep`).
 * @param {{ root: string; rulesFrom?: string | undefined }} options
 * @returns {string[]}
 */
export function buildScanArgs({ root, rulesFrom }) {
  const mounts = rulesFrom === undefined ? [] : bindMount(rulesFrom, '/rules');
  const config = rulesFrom === undefined ? `/src/${RULES_DIR}` : '/rules';
  return [
    ...dockerRun(root, mounts),
    'semgrep',
    'scan',
    '--config',
    config,
    '--disable-nosem',
    '--error',
    '--metrics=off',
    '--json',
    '.',
  ];
}

/**
 * Docker arguments for `semgrep --test` of one rule pack against its fixtures.
 * @param {{ root: string; ruleFile: string; fixtures: string[] }} options repository-relative, forward slashes
 * @returns {string[]}
 */
export function buildTestArgs({ root, ruleFile, fixtures }) {
  return [...dockerRun(root, []), 'semgrep', '--test', '--metrics=off', '--config', ruleFile, ...fixtures];
}

/**
 * Pairs every rule pack with its fixture(s): `.semgrep/<stem>.yml` -> `tests/fixtures/semgrep/<stem>.{ts,tsx,js,mjs}`.
 * @param {string} root
 * @returns {{ pairs: Array<{ ruleFile: string; fixtures: string[] }>; missing: string[] }}
 */
export function pairRuleFixtures(root) {
  const rules = readdirSync(join(root, RULES_DIR))
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort();
  const fixtureNames = existsSync(join(root, FIXTURES_DIR)) ? readdirSync(join(root, FIXTURES_DIR)) : [];
  /** @type {Array<{ ruleFile: string; fixtures: string[] }>} */
  const pairs = [];
  /** @type {string[]} */
  const missing = [];
  for (const rule of rules) {
    const stem = basename(rule, extname(rule));
    const fixtures = fixtureNames
      .filter((name) => basename(name, extname(name)) === stem && FIXTURE_EXTENSIONS.includes(extname(name)))
      .sort()
      .map((name) => `${FIXTURES_DIR}/${name}`);
    if (fixtures.length === 0) missing.push(`${RULES_DIR}/${rule}`);
    else pairs.push({ ruleFile: `${RULES_DIR}/${rule}`, fixtures });
  }
  return { pairs, missing };
}

/**
 * Findings from Semgrep's JSON output.
 * @param {string} stdout
 * @returns {{ findings: Finding[]; errors: string[]; scanned: number }}
 */
export function parseScanOutput(stdout) {
  /** @type {{ results?: Array<{ check_id?: string; path?: string; start?: { line?: number }; extra?: { message?: string } }>; errors?: Array<{ message?: string; type?: unknown }>; paths?: { scanned?: string[] } }} */
  const report = JSON.parse(stdout);
  const scanned = report.paths?.scanned?.length ?? 0;
  const findings = (report.results ?? []).map((result) => ({
    // Semgrep prefixes a rule id with its config directory (`semgrep.`, `rules.`); every repository rule id lives
    // under `platform.` (asserted by run-semgrep.test.ts), so the prefix is dropped for a stable id.
    rule: String(result.check_id ?? 'unknown').replace(/^(?:[\w-]+\.)*?(?=platform\.)/u, ''),
    message: String(result.extra?.message ?? '').replace(/\s+/gu, ' ').trim(),
    location: `${String(result.path ?? '?')}:${String(result.start?.line ?? 0)}`,
  }));
  const errors = (report.errors ?? []).map((error) => String(error.message ?? JSON.stringify(error.type ?? error)));
  // Fail closed: a scan that saw no file (wrong mount, over-broad .semgrepignore) proves nothing.
  if (scanned === 0) errors.push('no file was scanned; check the mount and .semgrepignore');
  return { findings, errors, scanned };
}

/**
 * `semgrep --test` passes when it exits 0 and prints "N/N: ✓ All tests passed"; a failing rule prints
 * "… unit tests did not pass" with "✖ <rule-id>" lines. Both conditions are required (fail closed on odd output).
 * @param {number | null} status
 * @param {string} output
 */
export function isTestPass(status, output) {
  return status === 0 && /\d+\/\d+: ✓ All tests passed/u.test(output) && !/did not pass|✖/u.test(output);
}

/**
 * @param {string[]} args
 * @param {number} timeoutMs
 */
function docker(args, timeoutMs) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * @param {Finding[]} findings
 * @param {string} title
 */
export function toMarkdown(findings, title) {
  /** @type {Record<string, number>} */
  const byRule = {};
  for (const { rule } of findings) byRule[rule] = (byRule[rule] ?? 0) + 1;
  const rows = Object.entries(byRule)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, count]) => `| \`${rule}\` | ${String(count)} |`);
  return [`### ${title}`, '', `${String(findings.length)} finding(s).`, '', ...(rows.length > 0 ? ['| Rule | Findings |', '|---|---|', ...rows, ''] : [])].join(
    '\n',
  );
}

/**
 * @param {Options} options
 * @returns {number}
 */
function runTests({ root, summaryFile }) {
  const { pairs, missing } = pairRuleFixtures(root);
  for (const ruleFile of missing) console.error(`semgrep/missing-fixture: ${ruleFile} has no ${FIXTURES_DIR}/<stem>.ts fixture`);
  /** @type {string[]} */
  const failed = [];
  for (const pair of pairs) {
    const result = docker(buildTestArgs({ root, ...pair }), TEST_TIMEOUT_MS);
    const output = `${result.stdout}\n${result.stderr}`;
    const passed = isTestPass(result.status, output);
    console.log(`${passed ? 'PASS' : 'FAIL'} ${pair.ruleFile} <- ${pair.fixtures.join(', ')}`);
    if (!passed) {
      failed.push(pair.ruleFile);
      console.error(output.trim());
    }
  }
  if (summaryFile !== undefined) {
    appendFileSync(
      summaryFile,
      `### Semgrep rule tests\n\n${String(pairs.length - failed.length)}/${String(pairs.length)} rule pack(s) pass their fixtures.${missing.length > 0 ? ` Missing fixtures: ${missing.join(', ')}.` : ''}\n`,
    );
  }
  return failed.length > 0 || missing.length > 0 ? 1 : 0;
}

/**
 * @param {Options} options
 * @returns {number}
 */
function runScan({ root, rulesFrom, summaryFile, json }) {
  const rulesDir = rulesFrom ?? join(root, RULES_DIR);
  if (!existsSync(rulesDir) || !statSync(rulesDir).isDirectory()) throw new Error(`rules directory not found: ${rulesDir}`);
  const result = docker(buildScanArgs({ root, rulesFrom }), SCAN_TIMEOUT_MS);
  if (result.status !== 0 && result.status !== 1) {
    console.error(result.stderr.trim());
    throw new Error(`semgrep exited with status ${String(result.status)}`);
  }
  const { findings, errors, scanned } = parseScanOutput(result.stdout);
  if (json) process.stdout.write(`${JSON.stringify({ findings, errors, scanned }, null, 2)}\n`);
  else {
    for (const { rule, message, location } of findings) console.error(`${rule}: ${message} (${location})`);
    for (const error of errors) console.error(`semgrep/error: ${error}`);
    console.log(
      `run-semgrep: ${String(findings.length)} finding(s), ${String(errors.length)} error(s) in ${String(scanned)} file(s); ` +
        `rules from ${rulesFrom ?? RULES_DIR}`,
    );
  }
  if (summaryFile !== undefined) appendFileSync(summaryFile, `${toMarkdown(findings, `Semgrep (rules from ${rulesFrom === undefined ? 'head' : 'base ref'})`)}\n`);
  if (errors.length > 0) return 2;
  return findings.length > 0 ? 1 : 0;
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`run-semgrep: ${error instanceof Error ? error.message : String(error)}`);
    console.error('usage: node tools/ci/run-semgrep.mjs [--root <dir>] [--rules-from <dir>] [--test] [--summary <file>] [--json]');
    return 2;
  }
  try {
    return options.test ? runTests(options) : runScan(options);
  } catch (error) {
    console.error(`run-semgrep: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

// `import.meta.main` is Node's own entry-point test (Node >= 24.2; see tools/deps/rebuild.mjs). Fail closed without it.
if (typeof import.meta.main !== 'boolean') {
  throw new Error('run-semgrep needs Node >= 24.2 (import.meta.main); see .node-version');
}
if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
