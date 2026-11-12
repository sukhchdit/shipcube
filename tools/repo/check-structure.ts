/**
 * CLI: `tsx tools/repo/check-structure.ts [root]`. Exits 1 and names every missing path when the
 * repository structure is incomplete (US-001 scenario 2).
 */
import { resolve } from 'node:path';

import { nodeFsProbe } from './node-fs-probe.js';
import { findStructureViolations } from './structure.js';

const root = resolve(process.argv[2] ?? process.cwd());
const missing = findStructureViolations(nodeFsProbe(root));
if (missing.length > 0) {
  process.stderr.write(`Repository structure incomplete; missing:\n${missing.map((m) => `  - ${m}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Repository structure complete.\n');
}
