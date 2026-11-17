/**
 * PR48-SEC-03 (TASK-289): the RBAC matrix generator is the US-071 test oracle, so it leaves the production entry point.
 * `@platform/authz` exports none of it; `@platform/authz/matrix` (src/generator/index.ts) exports all of it. The lint
 * half (no-restricted-imports + the boundaries resolved-file arm) is pinned by tools/lint/negative-fixtures.test.ts.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from '@jest/globals';

import * as production from '../index.js';
import * as oracle from './index.js';

/** Every value the oracle subpath exports; none may be reachable from the production entry point. */
const ORACLE_VALUES = Object.keys(oracle).sort();

describe('[PR48-SEC-03] the matrix oracle is a test-only subpath', () => {
  it('@platform/authz/matrix exports the generator, the committed-matrix document and the SEC-TC-01 cases', () => {
    expect(ORACLE_VALUES).toEqual([
      'CELL_SYMBOLS',
      'FIXED_CALLERS',
      'NOT_APPLICABLE',
      'ORG_PATH_PARAMETER',
      'REFUSALS',
      'ROUTE_MATRIX_COMMAND',
      'ROUTE_MATRIX_PATH',
      'SIGNATURE_HEADER_NAMES',
      'appliesTo',
      'expectCell',
      'generateMatrix',
      'matrixCallers',
      'matrixDrift',
      'orgMismatchCases',
      'orgScopedRoutes',
      'parseRouteMatrix',
      'pathParameterNames',
      'presentedKind',
      'renderRouteMatrix',
      'signatureHeaderId',
      'signatureOnlyOf',
      'verifiedId',
    ]);
  });

  it('@platform/authz (the production entry point) exports none of it, under any name', () => {
    expect(ORACLE_VALUES.filter((name) => name in production)).toEqual([]);
    const values = new Set<unknown>(Object.values(production));
    expect(ORACLE_VALUES.filter((name) => values.has((oracle as Record<string, unknown>)[name]))).toEqual([]);
  });

  it('the package manifest maps ./matrix to the generator entry for source, types and the built output', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      readonly exports: Readonly<Record<string, unknown>>;
    };
    expect(manifest.exports['./matrix']).toEqual({
      '@platform/source': './src/generator/index.ts',
      types: './dist/generator/index.d.ts',
      default: './dist/generator/index.js',
    });
    expect(manifest.exports['.']).toMatchObject({ '@platform/source': './src/index.ts' });
  });
});
