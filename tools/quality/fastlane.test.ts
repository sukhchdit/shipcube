/**
 * Degraded-mode lane A (TASK-011; ADR-0023 amendment C, I item 4): the local step list mirrors lane A and the verdict
 * is INVALID on a dirty tree, a SKIP_ variable or a missing step, FAIL on any failing or timed-out step.
 */
import { describe, expect, it } from '@jest/globals';

import { FASTLANE_STEPS, fastlaneVerdict, stepCommand } from './fastlane.mjs';

const ok = FASTLANE_STEPS.map((s) => ({ name: s.name, exit: 0, signal: null, timed_out: false, duration_s: 1 }));
const clean = { dirtyPaths: [], invalidEnv: [] };

describe('quality:fastlane (TASK-011)', () => {
  it('[R-ARCH-21] runs format, lint, typecheck, unit, build, the post-build porcelain check and npm audit, in that order', () => {
    expect(FASTLANE_STEPS.map((s) => s.name)).toEqual([
      'format:check',
      'lint',
      'typecheck',
      'test:unit',
      'build',
      'porcelain',
      'npm-audit',
    ]);
    for (const step of FASTLANE_STEPS) expect(step.timeoutMin).toBeGreaterThan(0);
    const npm = ['node', 'npm-cli.js'];
    expect(stepCommand(FASTLANE_STEPS[0] as (typeof FASTLANE_STEPS)[number], npm)).toEqual(['node', 'npm-cli.js', 'run', 'format:check']);
    expect(stepCommand(FASTLANE_STEPS[5] as (typeof FASTLANE_STEPS)[number], npm)).toEqual([
      process.execPath,
      'tools/ci/check-porcelain.mjs',
    ]);
    expect(stepCommand(FASTLANE_STEPS[6] as (typeof FASTLANE_STEPS)[number], npm)).toEqual([
      'node',
      'npm-cli.js',
      'audit',
      '--audit-level=high',
    ]);
  });

  it('[R-ARCH-21] PASS when every step exits 0; FAIL on a failing or timed-out step (a build that mutates the tree fails porcelain)', () => {
    expect(fastlaneVerdict(ok, clean)).toEqual({ verdict: 'PASS', reasons: [] });
    const porcelain = ok.map((s) => (s.name === 'porcelain' ? { ...s, exit: 1 } : s));
    expect(fastlaneVerdict(porcelain, clean)).toEqual({ verdict: 'FAIL', reasons: ['step porcelain exited 1'] });
    const slow = ok.map((s) => (s.name === 'test:unit' ? { ...s, exit: null, timed_out: true } : s));
    expect(fastlaneVerdict(slow, clean).reasons).toEqual(['step test:unit timed out']);
  });

  it('[D-ARCH-021] INVALID on a dirty tree, a SKIP_ variable (name only) or a missing step', () => {
    expect(fastlaneVerdict(ok, { dirtyPaths: ['apps/api/x.ts'], invalidEnv: [] }).verdict).toBe('INVALID');
    expect(fastlaneVerdict(ok, { dirtyPaths: [], invalidEnv: ['SKIP_LINT'] }).reasons).toEqual([
      'invalidating environment variable set: SKIP_LINT',
    ]);
    expect(fastlaneVerdict(ok.slice(1), clean).reasons).toEqual(['step format:check did not run']);
  });
});
