// @ts-check
/**
 * Degraded-mode lane A on the developer host (TASK-011; ADR-0023 amendment C "Degraded mode", I item 4).
 *
 *   npm run quality:fastlane
 *
 * Runs the local lane A steps sequentially, each with a timeout, and writes `fastlane.json` (sha, per-step exit and
 * duration, verdict) to docs/05-quality/tests/fastlane/<UTCstamp>_<sha7>.json, outside the lane B runs/ tree that
 * quality:check-evidence verifies (a fast-lane record is not lane B evidence). Every step runs even after a failure, so
 * the evidence shows the whole picture. Never a substitute for the hosted `security-integration` job on
 * security-critical paths (ADR-0023 am. G item 5). Exit: 0 PASS, 1 FAIL/INVALID, 2 internal error.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { envOverrides, gitRoot, headSha, hostSpec, npmCommand, porcelain, runStreaming, utcStamp } from './lib/host.mjs';
import { isCleanTreePath, loadManifest, manifestFile } from './lib/manifest.mjs';

/**
 * Lane A local steps (ADR-0023 am. A content runnable without GitHub; am. I item 4 porcelain after build).
 * `run` names an npm script; `node` a script run with this Node binary; `npm` raw npm arguments.
 * @type {ReadonlyArray<{ name: string, run?: string, node?: string[], npm?: string[], timeoutMin: number }>}
 */
export const FASTLANE_STEPS = Object.freeze([
  { name: 'format:check', run: 'format:check', timeoutMin: 10 },
  { name: 'lint', run: 'lint', timeoutMin: 30 },
  { name: 'typecheck', run: 'typecheck', timeoutMin: 30 },
  { name: 'test:unit', run: 'test:unit', timeoutMin: 45 },
  { name: 'build', run: 'build', timeoutMin: 30 },
  { name: 'porcelain', node: ['tools/ci/check-porcelain.mjs'], timeoutMin: 2 },
  { name: 'npm-audit', npm: ['audit', '--audit-level=high'], timeoutMin: 5 },
]);

/**
 * @typedef {{ name: string, exit: number | null, signal: string | null, timed_out: boolean, duration_s: number }} StepResult
 */

/**
 * @param {readonly StepResult[]} steps
 * @param {{ dirtyPaths: readonly string[], invalidEnv: readonly string[] }} integrity
 * @returns {{ verdict: 'PASS' | 'FAIL' | 'INVALID', reasons: string[] }}
 */
export function fastlaneVerdict(steps, { dirtyPaths, invalidEnv }) {
  /** @type {string[]} */
  const invalid = [];
  if (dirtyPaths.length > 0) invalid.push(`dirty tree under rules.clean_tree_paths: ${dirtyPaths.slice(0, 3).join(', ')}`);
  for (const name of invalidEnv) invalid.push(`invalidating environment variable set: ${name}`);
  const missing = FASTLANE_STEPS.filter((s) => !steps.some((r) => r.name === s.name)).map((s) => `step ${s.name} did not run`);
  invalid.push(...missing);
  if (invalid.length > 0) return { verdict: 'INVALID', reasons: invalid };
  const failed = steps
    .filter((s) => s.timed_out || s.exit !== 0)
    .map((s) => `step ${s.name} ${s.timed_out ? 'timed out' : `exited ${String(s.exit)}`}`);
  return failed.length > 0 ? { verdict: 'FAIL', reasons: failed } : { verdict: 'PASS', reasons: [] };
}

/**
 * @param {(typeof FASTLANE_STEPS)[number]} step
 * @param {readonly string[]} npm `[node, npm-cli.js]`
 * @returns {string[]} argv including the executable
 */
export function stepCommand(step, npm) {
  if (step.run !== undefined) return [...npm, 'run', step.run];
  if (step.node !== undefined) return [process.execPath, ...step.node];
  return [...npm, ...(step.npm ?? [])];
}

/** @returns {Promise<number>} */
export async function main() {
  const root = gitRoot(process.cwd());
  const manifest = loadManifest(manifestFile(root));
  const sha = headSha(root);
  const stamp = utcStamp(new Date());
  const dirtyPaths = porcelain(root)
    .map((e) => e.path)
    .filter((path) => isCleanTreePath(path, manifest));
  const env = envOverrides(process.env, manifest.rules.recorded_env_prefixes, manifest.rules.invalid_env_prefixes);
  const npm = npmCommand();
  /** @type {StepResult[]} */
  const steps = [];
  for (const step of FASTLANE_STEPS) {
    console.error(`quality:fastlane: ${step.name} (timeout ${step.timeoutMin} min)`);
    const [command, ...args] = stepCommand(step, npm);
    const r = await runStreaming(/** @type {string} */ (command), args, { cwd: root, timeoutMs: step.timeoutMin * 60_000 });
    steps.push({
      name: step.name,
      exit: r.status,
      signal: r.signal,
      timed_out: r.timedOut,
      duration_s: Math.round(r.durationMs / 100) / 10,
    });
  }
  const { verdict, reasons } = fastlaneVerdict(steps, { dirtyPaths, invalidEnv: env.invalid });
  const host = hostSpec(root);
  const report = {
    schema_version: 1,
    lane: 'A-local',
    git_sha: sha,
    git_dirty: dirtyPaths.length > 0,
    stamp,
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    node_version: host.node_version,
    npm_version: host.npm_version,
    os: host.os,
    env_overrides: env.names,
    steps,
    verdict,
    reasons,
  };
  const dir = join(root, 'docs', '05-quality', 'tests', 'fastlane');
  const file = join(dir, `${stamp}_${sha.slice(0, 7)}.json`);
  if (existsSync(file)) throw new Error(`${file} already exists (one fast-lane run per minute and sha)`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`sha ${sha.slice(0, 7)} · ${stamp} · fastlane · verdict ${verdict}`);
  for (const reason of reasons) console.log(`  - ${reason}`);
  console.log(`evidence: ${file}`);
  return verdict === 'PASS' ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`quality:fastlane: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    },
  );
}
