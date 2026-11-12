import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { nodeFsProbe } from './node-fs-probe.js';
import { API_MODULES, MODULE_LAYERS, MODULES_DIR, REQUIRED_FOLDERS, findStructureViolations } from './structure.js';

const repoRoot = findRepoRoot();
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const checkCli = join(repoRoot, 'tools', 'repo', 'check-structure.ts');

/** Builds a complete structure under a temp dir; `omit` skips folders (paths relative to root). */
function buildFixture(omit: readonly string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'structure-'));
  const make = (rel: string) => {
    if (!omit.includes(rel)) mkdirSync(join(root, ...rel.split('/')), { recursive: true });
  };
  REQUIRED_FOLDERS.forEach(make);
  for (const mod of API_MODULES) {
    for (const layer of MODULE_LAYERS) make(`${MODULES_DIR}/${mod}/${layer}`);
  }
  return root;
}

describe('repository structure (US-001, REQ-PLAT-001)', () => {
  const fixtures: string[] = [];
  const fixture = (omit: readonly string[] = []) => {
    const dir = buildFixture(omit);
    fixtures.push(dir);
    return dir;
  };
  afterAll(() => fixtures.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('[AT-US-001-01] the repository contains every required folder and module layer', () => {
    expect(findStructureViolations(nodeFsProbe(repoRoot))).toEqual([]);
  });

  it('[AT-US-001-01] accepts a layer implemented as a file instead of a folder', () => {
    const root = fixture([`${MODULES_DIR}/identity/routes`]);
    writeFileSync(join(root, ...`${MODULES_DIR}/identity/routes.ts`.split('/')), 'export {};\n');
    expect(findStructureViolations(nodeFsProbe(root))).toEqual([]);
  });

  it('[AT-US-001-02] a missing packages/authz is named', () => {
    const root = fixture(['packages/authz']);
    expect(findStructureViolations(nodeFsProbe(root))).toEqual(['packages/authz']);
  });

  it('[AT-US-001-02] a module missing a layer, or an extra module without layers, is named', () => {
    const root = fixture([`${MODULES_DIR}/quotes/policies`]);
    mkdirSync(join(root, ...`${MODULES_DIR}/ledger`.split('/')));
    const missing = findStructureViolations(nodeFsProbe(root));
    expect(missing).toContain(`${MODULES_DIR}/quotes/policies`);
    expect(missing).toEqual(expect.arrayContaining(MODULE_LAYERS.map((l) => `${MODULES_DIR}/ledger/${l}`)));
  });

  describe('CLI', () => {
    let complete: string;
    let withoutAuthz: string;
    beforeAll(() => {
      complete = fixture();
      withoutAuthz = fixture(['packages/authz']);
    });

    it('[AT-US-001-02] exits non-zero and names "packages/authz" when it is renamed', () => {
      const result = runNode([tsxCli, checkCli, withoutAuthz], { cwd: repoRoot });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('packages/authz');
    });

    it('[AT-US-001-01] exits zero on a complete tree', () => {
      const result = runNode([tsxCli, checkCli, complete], { cwd: repoRoot });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    });
  });
});
