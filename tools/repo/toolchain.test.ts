/**
 * Asserts the ADR-0001 version baseline that `npm ci` alone cannot enforce: runtime pins,
 * exact pins for coupled toolchains, no pre-releases, private workspaces.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import { dependencyEntries, listManifests } from './workspaces.js';

const repoRoot = findRepoRoot();
const manifests = listManifests(repoRoot);
const entries = manifests.flatMap(({ dir, manifest }) =>
  dependencyEntries(manifest).map(([name, range, field]) => ({ dir, name, range, field })),
);
const rangesOf = (name: string) => [
  ...new Set(entries.filter((e) => e.name === name && e.field !== 'peerDependencies').map((e) => e.range)),
];

describe('toolchain baseline (ADR-0001, R-ARCH-01)', () => {
  it('pins Node 24 LTS in .node-version and engines, and runs on it', () => {
    expect(readFileSync(join(repoRoot, '.node-version'), 'utf8').trim()).toBe('24');
    expect(manifests[0]?.manifest.engines?.['node']).toBe('>=24.2 <25');
    expect(process.versions.node.split('.')[0]).toBe('24');
  });

  it.each([
    ['typescript', /^6\.0\.\d+$/],
    ['jest', /^30\.\d+\.\d+$/],
    ['prisma', /^7\.10\.\d+$/],
    ['@prisma/client', /^7\.10\.\d+$/],
    ['@prisma/adapter-pg', /^7\.10\.\d+$/],
    ['react-router', /^8\.\d+\.\d+$/],
    ['@react-router/dev', /^8\.\d+\.\d+$/],
    ['vite', /^8\.\d+\.\d+$/],
  ])('pins %s to one exact version in the ADR-0001 line', (name, pattern) => {
    const ranges = rangesOf(name);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatch(pattern);
  });

  it('keeps the Prisma CLI, client and adapter on the same version', () => {
    const versions = new Set(['prisma', '@prisma/client', '@prisma/adapter-pg'].flatMap(rangesOf));
    expect([...versions]).toHaveLength(1);
  });

  it('never consumes pre-release versions', () => {
    const prerelease = entries.filter(
      (e) => /-(alpha|beta|rc|next|canary|dev|pre)/i.test(e.range) || /^(next|rc|beta|canary|latest)$/.test(e.range),
    );
    expect(prerelease).toEqual([]);
  });

  it('marks every workspace private and UNLICENSED (D-ARCH-003 rev 2 item 3)', () => {
    const notPrivate = manifests
      .filter(({ manifest }) => manifest.private !== true || manifest.license !== 'UNLICENSED')
      .map(({ dir }) => dir);
    expect(notPrivate).toEqual([]);
  });
});
