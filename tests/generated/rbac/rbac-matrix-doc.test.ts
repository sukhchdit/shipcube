/**
 * The committed RBAC route matrix in the fast lane (US-071 AT-US-071-04/-05; TASK-027): the file equals the generator
 * output over openapi.yaml and the role seed, and `npm run authz:matrix -- --check` fails naming each difference. The
 * rbac-matrix suite (lane B) runs the cells; this test keeps a stale matrix from merging even when lane B is not run.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ROUTE_MATRIX_COMMAND, ROUTE_MATRIX_PATH } from '@platform/authz';

import { REPO_ROOT } from '../../../tools/openapi/contract.js';
import { main, renderCommittedMatrix } from './write-matrix.js';

describe(`AT-US-071-04/-05 ${ROUTE_MATRIX_PATH}`, () => {
  let root = '';
  let stderr: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rbac-matrix-'));
    mkdirSync(dirname(join(root, ROUTE_MATRIX_PATH)), { recursive: true });
    stderr = [];
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    });
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it(`AT-US-071-04 the committed matrix equals the generator output (regenerate with \`${ROUTE_MATRIX_COMMAND}\`)`, async () => {
    const { text, matrix } = await renderCommittedMatrix();
    expect(readFileSync(resolve(REPO_ROOT, ROUTE_MATRIX_PATH), 'utf8')).toBe(text);
    expect(matrix.rows.length).toBeGreaterThanOrEqual(133);
    expect(await main(['--check'])).toBe(0);
  });

  it('AT-US-071-05 the writer writes the document; --check names a changed seeded grant cell and a missing route row', async () => {
    expect(await main([], root)).toBe(0);
    const file = join(root, ROUTE_MATRIX_PATH);
    const fresh = readFileSync(file, 'utf8');
    expect(await main(['--check'], root)).toBe(0);
    const stale = fresh
      .replace(
        /^(\| `getShipment` \| [^\n]*?\| session \| 401 \| MFA \| MFA \| MFA \| MFA \| MFA \| MFA \| MFA \| MFA \|) Y \|/mu,
        '$1 403 |',
      )
      .replace(/^\| `getLiveness` \|[^\n]*\n/mu, '');
    expect(stale).not.toBe(fresh);
    writeFileSync(file, stale, 'utf8');
    expect(await main(['--check'], root)).toBe(1);
    expect(stderr).toEqual([
      '[authz:matrix] route GET /api/v1/shipments/{shipmentId} (getShipment) x role CUSTOMER_OWNER: committed 403, generated Y\n',
      '[authz:matrix] route GET /health/live (getLiveness) has no row in the committed matrix\n',
    ]);
  });

  it('--check reports a difference outside the table (banner or legend) as the file differing', async () => {
    expect(await main([], root)).toBe(0);
    const file = join(root, ROUTE_MATRIX_PATH);
    writeFileSync(file, readFileSync(file, 'utf8').replace('# RBAC route matrix', '# RBAC matrix'), 'utf8');
    expect(await main(['--check'], root)).toBe(1);
    expect(stderr).toEqual([`[authz:matrix] ${ROUTE_MATRIX_PATH} differs from the generator output\n`]);
  });
});
