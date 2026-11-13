/**
 * Evidence retention (TASK-011; ADR-0023 amendment B "Retention"): current and previous wave runs, every gate run and
 * every newer run are kept; older pr and wave runs are pruned; an unclassifiable run is never deleted.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { commitMessage, planPrune, scanRuns } from './prune.mjs';

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const run = (dirName: string, profile: string | null, root = 'tests') => ({ root, dirName, profile });
const ids = (dirs: Array<{ root: string; dirName: string }>) => dirs.map((d) => `${d.root}/${d.dirName}`);

describe('planPrune (TASK-011)', () => {
  const dirs = [
    run('20261101T1000Z_aaaaaaa', 'wave'),
    run('20261101T1000Z_aaaaaaa', 'wave', 'security'),
    run('20261102T1000Z_bbbbbbb', 'pr'),
    run('20261103T1000Z_ccccccc', 'gate'),
    run('20261104T1000Z_ddddddd', 'wave'),
    run('20261105T1000Z_eeeeeee', 'pr'),
    run('20261105T1100Z_fffffff', null),
    run('20261106T1000Z_0000000', 'wave'),
    run('20261107T1000Z_1111111', 'pr'),
  ];

  it('[R-ARCH-16] keeps the two newest wave runs, every gate run, newer runs and unreadable runs; prunes the rest across roots', () => {
    const plan = planPrune(dirs);
    expect(plan.boundary).toBe('20261104T1000Z_ddddddd');
    expect(plan.waves).toEqual(['20261104T1000Z_ddddddd', '20261106T1000Z_0000000']);
    expect(ids(plan.remove)).toEqual(['tests/20261101T1000Z_aaaaaaa', 'security/20261101T1000Z_aaaaaaa', 'tests/20261102T1000Z_bbbbbbb']);
    expect(ids(plan.keep)).toContain('tests/20261103T1000Z_ccccccc');
    expect(ids(plan.keep)).toContain('tests/20261105T1100Z_fffffff');
    expect(plan.unknown).toEqual(['20261105T1100Z_fffffff']);
  });

  it('[R-ARCH-16] with fewer than two wave runs nothing is pruned', () => {
    expect(planPrune([run('20261101T1000Z_aaaaaaa', 'pr'), run('20261102T1000Z_bbbbbbb', 'wave')]).remove).toEqual([]);
  });

  it('[R-ARCH-16] the profile of a run comes from any root that has a readable summary', () => {
    const plan = planPrune([
      run('20261101T1000Z_aaaaaaa', null, 'security'),
      run('20261101T1000Z_aaaaaaa', 'wave'),
      run('20261102T1000Z_bbbbbbb', 'wave'),
      run('20261100T1000Z_9999999', 'pr'),
    ]);
    expect(ids(plan.remove)).toEqual(['tests/20261100T1000Z_9999999']);
  });

  it('[R-ARCH-16] suggests a dedicated Conventional Commit', () => {
    const message = commitMessage(planPrune(dirs));
    expect(message.split('\n')[0]).toBe('chore(evidence): prune 2 lane B run(s) older than wave 20261104T1000Z_ddddddd');
  });
});

describe('scanRuns (fs edge)', () => {
  it('[R-ARCH-16] reads run directories and their profile; ignores names outside <stamp>_<sha7>', () => {
    const base = mkdtempSync(join(tmpdir(), 'prune-'));
    temps.push(base);
    const mk = (rel: string, summary?: string) => {
      mkdirSync(join(base, rel), { recursive: true });
      if (summary !== undefined) writeFileSync(join(base, rel, 'summary.json'), summary);
    };
    mk('tests/runs/20261101T1000Z_aaaaaaa', JSON.stringify({ profile: 'wave' }));
    mk('security/runs/20261101T1000Z_aaaaaaa', '{not json');
    mk('performance/runs/notes');
    expect(scanRuns(base)).toEqual([
      { root: 'tests', dirName: '20261101T1000Z_aaaaaaa', profile: 'wave' },
      { root: 'security', dirName: '20261101T1000Z_aaaaaaa', profile: null },
    ]);
  });
});
