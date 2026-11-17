/**
 * Writes the committed RBAC route matrix (US-071 AT-US-071-04/-05; TASK-027): openapi.yaml route metadata x the
 * packages/authz role seed, rendered by `renderRouteMatrix` to `ROUTE_MATRIX_PATH`.
 *
 * CLI: `npm run authz:matrix` writes it; `npm run authz:matrix -- --check` exits 1 naming every difference
 * (`matrixDrift`). The unit test rbac-matrix-doc.test.ts runs the same comparison in the fast lane.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CATALOGUE_VERSION, PERMISSION_DEFINITIONS, ROLES } from '@platform/authz';
import { generateMatrix, matrixDrift, parseRouteMatrix, renderRouteMatrix, ROUTE_MATRIX_PATH } from '@platform/authz/matrix';

import { loadContract, REPO_ROOT } from '../../../tools/openapi/contract.js';
import { contractRoutes } from './contract-routes.js';

/** The document the generator renders from the contract and the role seed. */
export async function renderCommittedMatrix(): Promise<{ readonly text: string; readonly matrix: ReturnType<typeof generateMatrix> }> {
  const routes = contractRoutes(await loadContract()).map((route) => route.matrix);
  const matrix = generateMatrix(routes, { roles: ROLES, catalogue: PERMISSION_DEFINITIONS });
  return { text: renderRouteMatrix(matrix, CATALOGUE_VERSION), matrix };
}

/** Writes the document, or with `--check` reports every difference; returns the exit code. */
export async function main(argv: readonly string[], root: string = REPO_ROOT): Promise<number> {
  const file = resolve(root, ROUTE_MATRIX_PATH);
  const { text, matrix } = await renderCommittedMatrix();
  if (!argv.includes('--check')) {
    writeFileSync(file, text, 'utf8');
    process.stdout.write(`[authz:matrix] wrote ${ROUTE_MATRIX_PATH}\n`);
    return 0;
  }
  const committed = readFileSync(file, 'utf8');
  if (committed === text) return 0;
  const findings = matrixDrift(parseRouteMatrix(committed), matrix);
  for (const finding of findings.length === 0 ? [`${ROUTE_MATRIX_PATH} differs from the generator output`] : findings) {
    process.stderr.write(`[authz:matrix] ${finding}\n`);
  }
  return 1;
}

if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
