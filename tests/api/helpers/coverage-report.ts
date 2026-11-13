// CLI of the api lane's contract-coverage report (api/README.md §16 item 6), run by coverage-teardown.ts under tsx
// with the Jest main process id: merges the (operationId, status) pairs every worker recorded and prints the report.
import { listOperations, loadContract } from '../../../tools/openapi/contract.js';
import {
  buildCoverageReport,
  collectRunPairs,
  COVERAGE_PARTS_DIR,
  readImplementedOperations,
  writeCoverageReport,
} from './contract-coverage.js';

const jestPid = Number(process.argv[2]);
if (!Number.isSafeInteger(jestPid) || jestPid <= 0) throw new Error('usage: coverage-report.ts <jest main pid>');
const { pairs, skipped } = collectRunPairs(COVERAGE_PARTS_DIR, jestPid);
const report = buildCoverageReport(listOperations(await loadContract()), readImplementedOperations(), pairs);
const lines = writeCoverageReport(report);
if (skipped.length > 0) lines.push(`  skipped unreadable part file(s): ${skipped.join(', ')}`);
process.stdout.write(`\n${lines.join('\n')}\n`);
