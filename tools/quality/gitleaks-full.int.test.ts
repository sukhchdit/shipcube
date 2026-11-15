/**
 * gitleaks-full runner against the real history with the pinned image (PR33-SEC-08 integration cases; PR25-SEC-01;
 * D-SEC-PR45-01; TASK-015 part 015-B). Docker required (lane B). The ancestry of HEAD carries the 17 recorded
 * baseline fingerprints: the full baseline gives 0 findings, dropping one line gives exactly that one finding back, and
 * the config is the committed `.gitleaks.toml` read from git (the file lane A reads from the base ref).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import { BASELINE_COUNT, BASELINE_PATH, CONFIG_PATH, scan, validateBaseline } from './gitleaks-full.mjs';

const repoRoot = findRepoRoot();
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const git = (args: string[]): string => {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};
const head = git(['rev-parse', 'HEAD']).trim();
const configText = git(['show', `${head}:${CONFIG_PATH}`]);
const baseline = validateBaseline(git(['show', `${head}:${BASELINE_PATH}`]), { count: BASELINE_COUNT });

function report(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitleaks-full-int-'));
  temps.push(dir);
  return join(dir, 'gitleaks-full.json');
}

describe('gitleaks-full: full-history scan with the pinned image', () => {
  it('[PR33-SEC-08] the 17-line baseline gives 0 findings over the ancestry of HEAD', () => {
    const file = report();
    const result = scan({ root: repoRoot, sha: head, configText, baselineLines: baseline, report: file });
    expect(result).toEqual({ status: 'clean', findings: 0 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
  }, 900_000);

  it('[PR33-SEC-08] a 16-line baseline gives back exactly the dropped fingerprint (redacted)', () => {
    const [dropped, ...rest] = baseline;
    const file = report();
    const result = scan({ root: repoRoot, sha: head, configText, baselineLines: rest, report: file });
    expect(result).toEqual({ status: 'findings', findings: 1 });
    const findings = JSON.parse(readFileSync(file, 'utf8')) as Array<{ Fingerprint: string; Secret: string }>;
    expect(findings.map((f) => f.Fingerprint)).toEqual([dropped]);
    expect(findings[0]?.Secret).toBe('REDACTED');
  }, 900_000);
});
