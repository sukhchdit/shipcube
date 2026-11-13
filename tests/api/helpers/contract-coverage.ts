// (operationId, status) contract-coverage report (api/README.md §16 item 6; PR #21 R1-m5 (b), D-ARCH-084). The contract
// helper records every conforming (operationId, status) pair it validates; at the end of the api lane the pairs of all
// Jest workers are merged and, for the IMPLEMENTED operations only (tools/openapi/implemented-operations.json), the
// documented statuses never exercised are listed and written to reports/api-contract-coverage.json.
// A REPORT, not a gate: nothing here changes the Jest exit code (qa-lead ratchets it into a gate later).
//
// Wiring that works with Jest workers: each worker process rewrites its own file `reports/api-contract-coverage/<pid>.json`
// synchronously after every new pair (a handful of pairs, so the cost is negligible), stamped with its pid and parent
// pid. The merge runs in the Jest main process (global teardown, coverage-teardown.ts) and takes the files whose pid
// (in-band run) or parent pid (worker processes) is its own, so files of an earlier or concurrent run are ignored.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { type ContractOperation, REPO_ROOT } from '../../../tools/openapi/contract.js';

export const REPORTS_DIR = resolve(REPO_ROOT, 'reports');
/** Per-worker pair files (merged and removed by the teardown). */
export const COVERAGE_PARTS_DIR = join(REPORTS_DIR, 'api-contract-coverage');
export const COVERAGE_REPORT_PATH = join(REPORTS_DIR, 'api-contract-coverage.json');
export const IMPLEMENTED_OPERATIONS_PATH = resolve(REPO_ROOT, 'tools', 'openapi', 'implemented-operations.json');
/** Upper bound on the part files read by one merge (a stale-file pile-up must not make the teardown unbounded). */
const MAX_PART_FILES = 1000;

export interface ExercisedPair {
  readonly operationId: string;
  readonly status: number;
}

export interface CoveragePart {
  readonly pid: number;
  readonly ppid: number;
  readonly pairs: readonly ExercisedPair[];
}

export interface OperationCoverage {
  readonly operationId: string;
  /** Documented response keys (`200`, `4XX`, `default`), in contract order. */
  readonly documented: readonly string[];
  /** Documented keys at least one validated response matched. */
  readonly exercised: readonly string[];
  readonly unexercised: readonly string[];
}

export interface CoverageReport {
  readonly operations: readonly OperationCoverage[];
  /** Ledger entries with no operation in the contract (the drift check reports them; listed here for completeness). */
  readonly unknownOperations: readonly string[];
  readonly totals: { readonly documented: number; readonly exercised: number; readonly unexercised: number };
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The documented key a status is validated against: exact, then `NXX`, then `default` (as the validator resolves it). */
export function documentedKeyFor(keys: readonly string[], status: number): string | undefined {
  const exact = String(status);
  if (keys.includes(exact)) return exact;
  const range = `${String(Math.floor(status / 100))}XX`;
  if (keys.includes(range)) return range;
  return keys.includes('default') ? 'default' : undefined;
}

/** Pure: the report for the implemented operations, from the merged pairs. */
export function buildCoverageReport(
  operations: readonly ContractOperation[],
  implemented: readonly string[],
  pairs: readonly ExercisedPair[],
): CoverageReport {
  const byId = new Map(operations.map((operation) => [operation.operationId, operation]));
  const statusesById = new Map<string, Set<number>>();
  for (const { operationId, status } of pairs) {
    const statuses = statusesById.get(operationId) ?? new Set<number>();
    statuses.add(status);
    statusesById.set(operationId, statuses);
  }
  const covered: OperationCoverage[] = [];
  const unknownOperations: string[] = [];
  for (const operationId of [...new Set(implemented)].sort()) {
    const operation = byId.get(operationId);
    if (operation === undefined) {
      unknownOperations.push(operationId);
      continue;
    }
    const documented = Object.keys(operation.operation.responses ?? {});
    const hit = new Set<string>();
    for (const status of statusesById.get(operationId) ?? []) {
      const key = documentedKeyFor(documented, status);
      if (key !== undefined) hit.add(key);
    }
    const exercised = documented.filter((key) => hit.has(key));
    covered.push({ operationId, documented, exercised, unexercised: documented.filter((key) => !hit.has(key)) });
  }
  const sum = (pick: (entry: OperationCoverage) => readonly string[]): number =>
    covered.reduce((total, entry) => total + pick(entry).length, 0);
  return {
    operations: covered,
    unknownOperations,
    totals: {
      documented: sum((entry) => entry.documented),
      exercised: sum((entry) => entry.exercised),
      unexercised: sum((entry) => entry.unexercised),
    },
  };
}

/** Pure: the console lines of the report. */
export function formatCoverageReport(report: CoverageReport, reportPath: string = COVERAGE_REPORT_PATH): string[] {
  const { documented, exercised, unexercised } = report.totals;
  const lines = [
    `API contract coverage (report only, not a gate): ${String(exercised)}/${String(documented)} documented (operationId, status) pairs of ${String(report.operations.length)} implemented operation(s) exercised.`,
  ];
  for (const entry of report.operations) {
    if (entry.unexercised.length > 0) lines.push(`  ${entry.operationId}: never exercised ${entry.unexercised.join(', ')}`);
  }
  if (unexercised === 0) lines.push('  every documented status of the implemented operations was exercised.');
  if (report.unknownOperations.length > 0) lines.push(`  ledger entries not in the contract: ${report.unknownOperations.join(', ')}`);
  lines.push(`  written to ${reportPath}`);
  return lines;
}

/** Narrows a part file's JSON; undefined when it is not a part file. */
export function parseCoveragePart(value: unknown): CoveragePart | undefined {
  if (!isObject(value) || typeof value['pid'] !== 'number' || typeof value['ppid'] !== 'number' || !Array.isArray(value['pairs'])) {
    return undefined;
  }
  const pairs = (value['pairs'] as unknown[]).flatMap((pair): ExercisedPair[] =>
    isObject(pair) && typeof pair['operationId'] === 'string' && Number.isInteger(pair['status'])
      ? [{ operationId: pair['operationId'], status: pair['status'] as number }]
      : [],
  );
  return { pid: value['pid'], ppid: value['ppid'], pairs };
}

/** Pure: the parts that belong to the Jest run whose main process is `runPid`. */
export function partsOfRun(parts: readonly CoveragePart[], runPid: number): CoveragePart[] {
  return parts.filter((part) => part.pid === runPid || part.ppid === runPid);
}

export interface CoverageRecorder {
  record(pair: ExercisedPair): void;
}

/** A recorder that rewrites `<dir>/<pid>.json` synchronously whenever it sees a new pair. */
export function createCoverageRecorder(
  dir: string = COVERAGE_PARTS_DIR,
  pid: number = process.pid,
  ppid: number = process.ppid,
): CoverageRecorder {
  const seen = new Map<string, ExercisedPair>();
  const file = join(dir, `${String(pid)}.json`);
  return {
    record(pair) {
      const key = `${pair.operationId} ${String(pair.status)}`;
      if (seen.has(key)) return;
      seen.set(key, pair);
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `${JSON.stringify({ pid, ppid, pairs: [...seen.values()] } satisfies CoveragePart)}\n`);
    },
  };
}

/** Reads the part files of the run `runPid`, removes them and returns their pairs. Unreadable files are skipped. */
export function collectRunPairs(dir: string, runPid: number): { pairs: ExercisedPair[]; skipped: string[] } {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (isObject(error) && error['code'] === 'ENOENT') return { pairs: [], skipped: [] };
    throw error;
  }
  const skipped: string[] = [];
  const parts: { file: string; part: CoveragePart }[] = [];
  for (const name of names.slice(0, MAX_PART_FILES)) {
    const file = join(dir, name);
    let part: CoveragePart | undefined;
    try {
      part = parseCoveragePart(JSON.parse(readFileSync(file, 'utf8')) as unknown);
    } catch {
      // A torn write or a foreign file: listed in `skipped`, never fatal (the report is not a gate).
      part = undefined;
    }
    if (part === undefined) skipped.push(name);
    else parts.push({ file, part });
  }
  const mine = new Set(
    partsOfRun(
      parts.map(({ part }) => part),
      runPid,
    ),
  );
  const pairs: ExercisedPair[] = [];
  for (const { file, part } of parts) {
    if (!mine.has(part)) continue;
    pairs.push(...part.pairs);
    rmSync(file, { force: true });
  }
  return { pairs, skipped };
}

/** Reads the `operations` list of the implemented-operations ledger. */
export function readImplementedOperations(path: string = IMPLEMENTED_OPERATIONS_PATH): string[] {
  const ledger = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const operations = isObject(ledger) ? ledger['operations'] : undefined;
  if (!Array.isArray(operations) || !operations.every((entry) => typeof entry === 'string')) {
    throw new TypeError(`${path}: "operations" must be an array of operationIds`);
  }
  return operations;
}

/** Writes the report file and returns the console lines. */
export function writeCoverageReport(report: CoverageReport, path: string = COVERAGE_REPORT_PATH): string[] {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return formatCoverageReport(report, path);
}
