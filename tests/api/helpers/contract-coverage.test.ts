// (operationId, status) contract-coverage report (api/README.md §16 item 6; PR #21 R1-m5 (b)): merge, print and the
// per-worker part files. Pure functions plus a temporary directory; no app, no openapi.yaml.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import type { ContractOperation } from '../../../tools/openapi/contract.js';
import {
  buildCoverageReport,
  collectRunPairs,
  createCoverageRecorder,
  documentedKeyFor,
  formatCoverageReport,
  parseCoveragePart,
  partsOfRun,
  writeCoverageReport,
} from './contract-coverage.js';

const op = (operationId: string, statuses: readonly string[]): ContractOperation => ({
  operationId,
  method: 'GET',
  path: `/${operationId}`,
  fullPath: `/${operationId}`,
  operation: { operationId, responses: Object.fromEntries(statuses.map((status) => [status, { description: status }])) },
});

const OPERATIONS = [op('getLiveness', ['200', '500', '503']), op('getReadiness', ['200', '4XX', 'default']), op('getOther', ['200'])];

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'api-contract-coverage-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('[PR #21 R1-m5] contract-coverage report', () => {
  it('resolves a status to its documented key: exact, then NXX, then default', () => {
    expect(documentedKeyFor(['200', '4XX', 'default'], 200)).toBe('200');
    expect(documentedKeyFor(['200', '4XX', 'default'], 404)).toBe('4XX');
    expect(documentedKeyFor(['200', '4XX', 'default'], 503)).toBe('default');
    expect(documentedKeyFor(['200'], 503)).toBeUndefined();
  });

  it('lists, for the implemented operations only, the documented statuses never exercised', () => {
    const report = buildCoverageReport(
      OPERATIONS,
      ['getReadiness', 'getLiveness', 'getLiveness', 'ghostOperation'],
      [
        { operationId: 'getLiveness', status: 200 },
        { operationId: 'getLiveness', status: 200 },
        { operationId: 'getReadiness', status: 409 },
        { operationId: 'getReadiness', status: 200 },
        { operationId: 'getOther', status: 200 },
      ],
    );
    expect(report.operations).toEqual([
      { operationId: 'getLiveness', documented: ['200', '500', '503'], exercised: ['200'], unexercised: ['500', '503'] },
      { operationId: 'getReadiness', documented: ['200', '4XX', 'default'], exercised: ['200', '4XX'], unexercised: ['default'] },
    ]);
    expect(report.unknownOperations).toEqual(['ghostOperation']);
    expect(report.totals).toEqual({ documented: 6, exercised: 3, unexercised: 3 });
  });

  it('prints a summary line, one line per operation with gaps, the unknown ledger entries and the file', () => {
    const report = buildCoverageReport(OPERATIONS, ['getLiveness', 'ghostOperation'], [{ operationId: 'getLiveness', status: 200 }]);
    expect(formatCoverageReport(report, 'reports/x.json')).toEqual([
      'API contract coverage (report only, not a gate): 1/3 documented (operationId, status) pairs of 1 implemented operation(s) exercised.',
      '  getLiveness: never exercised 500, 503',
      '  ledger entries not in the contract: ghostOperation',
      '  written to reports/x.json',
    ]);
    const full = buildCoverageReport([op('getOther', ['200'])], ['getOther'], [{ operationId: 'getOther', status: 200 }]);
    expect(formatCoverageReport(full, 'r.json')).toContain('  every documented status of the implemented operations was exercised.');
  });

  it('keeps only well-formed part files and the parts of the current run (own pid in band, parent pid for workers)', () => {
    expect(
      parseCoveragePart({
        pid: 1,
        ppid: 2,
        pairs: [
          { operationId: 'a', status: 200 },
          { operationId: 'b', status: 'x' },
        ],
      }),
    ).toEqual({
      pid: 1,
      ppid: 2,
      pairs: [{ operationId: 'a', status: 200 }],
    });
    expect(parseCoveragePart({ pid: '1', ppid: 2, pairs: [] })).toBeUndefined();
    expect(parseCoveragePart([])).toBeUndefined();
    const parts = [
      { pid: 10, ppid: 1, pairs: [] },
      { pid: 11, ppid: 10, pairs: [] },
      { pid: 12, ppid: 99, pairs: [] },
    ];
    expect(partsOfRun(parts, 10).map((part) => part.pid)).toEqual([10, 11]);
  });

  it('records each new pair synchronously into the worker file; the merge takes and removes only the files of this run', () => {
    const dir = tempDir();
    const worker = createCoverageRecorder(dir, 501, 500);
    worker.record({ operationId: 'getLiveness', status: 200 });
    worker.record({ operationId: 'getLiveness', status: 200 });
    worker.record({ operationId: 'getReadiness', status: 503 });
    expect(JSON.parse(readFileSync(join(dir, '501.json'), 'utf8'))).toEqual({
      pid: 501,
      ppid: 500,
      pairs: [
        { operationId: 'getLiveness', status: 200 },
        { operationId: 'getReadiness', status: 503 },
      ],
    });
    createCoverageRecorder(dir, 777, 1).record({ operationId: 'getOther', status: 200 });
    writeFileSync(join(dir, 'torn.json'), '{"pid": 5');

    const { pairs, skipped } = collectRunPairs(dir, 500);
    expect(pairs).toEqual([
      { operationId: 'getLiveness', status: 200 },
      { operationId: 'getReadiness', status: 503 },
    ]);
    expect(skipped).toEqual(['torn.json']);
    expect(readdirSync(dir).sort()).toEqual(['777.json', 'torn.json']);
  });

  it('a missing parts directory yields no pairs; the report file is written as JSON', () => {
    const dir = tempDir();
    expect(collectRunPairs(join(dir, 'absent'), 1)).toEqual({ pairs: [], skipped: [] });
    const report = buildCoverageReport(OPERATIONS, ['getOther'], []);
    const path = join(dir, 'out', 'api-contract-coverage.json');
    expect(writeCoverageReport(report, path)).toContain('  getOther: never exercised 200');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(report);
  });
});
