/**
 * Which Jest project runs which test file (TASK-276 R1-M1). The suffix picks the project for plain unit tests everywhere,
 * tests/generated included, so lane A's `test:unit` keeps the route-registry and contract-drift suites there; the
 * `generated` project takes only the `*.api` / `*.int` suites under tests/generated, and nothing runs in two projects.
 * Matching mirrors Jest: `testMatch` globs and `testPathIgnorePatterns` regular expressions against the absolute path.
 */
import { posix } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import config from '../../jest.config.js';

type Project = { displayName?: unknown; testMatch?: unknown; testPathIgnorePatterns?: unknown };

const ROOT = '/repo';
const projects = (config.projects ?? []) as Project[];

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/** Display names of the projects that would run `relative` (a `/`-separated path under the repository root). */
function projectsOf(relative: string): string[] {
  const path = `${ROOT}/${relative}`;
  return projects
    .filter((project) => strings(project.testMatch).some((glob) => posix.matchesGlob(path, glob)))
    .filter((project) => !strings(project.testPathIgnorePatterns).some((pattern) => new RegExp(pattern).test(path)))
    .map((project) => String(project.displayName));
}

describe('Jest project selection', () => {
  it.each([
    ['tests/generated/route-metadata.test.ts', ['unit']],
    ['tests/generated/contract-drift.test.ts', ['unit']],
    ['tests/generated/sub/view.test.tsx', ['unit-dom']],
    ['tests/generated/rbac-matrix.api.test.ts', ['generated']],
    ['tests/generated/rls/cross-tenant.int.test.ts', ['generated']],
    ['tests/generated/audit.api.test.tsx', ['generated']],
    ['apps/api/src/platform/http/x.test.ts', ['unit']],
    ['apps/web/app/routes/home.test.tsx', ['unit-dom']],
    ['apps/api/tests/health.api.test.ts', ['api']],
    ['prisma/tests/db/query-counter.int.test.ts', ['integration']],
    ['tests/e2e/smoke.test.ts', []],
    ['packages/shared/node_modules/x/y.test.ts', []],
    // R1-n3 (PR #39): the opt-in stack suite builds images; without JEST_STACK=1 no project runs it.
    ['tests/compose/x.stack.test.ts', []],
  ])('%s runs in %j', (path, expected) => {
    expect(projectsOf(path)).toEqual(expected);
  });

  it('declares the five projects', () => {
    expect(projects.map((project) => project.displayName)).toEqual(['unit', 'unit-dom', 'integration', 'api', 'generated']);
  });
});
