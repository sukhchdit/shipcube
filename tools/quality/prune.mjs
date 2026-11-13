// @ts-check
/**
 * Evidence retention for lane B runs (TASK-011; ADR-0023 amendment B "Retention"): keeps the run directories of the
 * current and previous `wave` runs, every `gate` run, and every newer run; deletes the rest. History keeps the deleted
 * directories; the deletion is committed on its own with the printed message.
 *
 *   npm run quality:prune [-- --dry-run]
 *
 * A run is identified by its directory name `<UTCstamp>_<sha7>`, shared by the tests/, security/ and performance/
 * roots; its profile comes from any root's summary.json. A run whose profile cannot be read is never deleted.
 * Exit: 0 ok, 2 usage or internal error.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { gitRoot } from './lib/host.mjs';

export const EVIDENCE_ROOTS = /** @type {const} */ (['tests', 'security', 'performance']);
const RUN_DIR = /^(\d{8}T\d{4}Z)_[0-9a-f]{7}$/;

/**
 * @typedef {{ root: string, dirName: string, profile: string | null }} RunDir
 * @typedef {{ keep: RunDir[], remove: RunDir[], boundary: string | null, waves: string[], gates: string[], unknown: string[] }} PrunePlan
 */

/**
 * Pure retention plan.
 * @param {readonly RunDir[]} dirs
 * @returns {PrunePlan}
 */
export function planPrune(dirs) {
  /** @type {Map<string, string | null>} run id -> profile (first readable one wins) */
  const profiles = new Map();
  for (const d of dirs) if (!profiles.has(d.dirName) || profiles.get(d.dirName) === null) profiles.set(d.dirName, d.profile);
  const ids = [...profiles.keys()].sort();
  const waves = ids.filter((id) => profiles.get(id) === 'wave');
  const gates = ids.filter((id) => profiles.get(id) === 'gate');
  const unknown = ids.filter((id) => !['pr', 'wave', 'gate'].includes(String(profiles.get(id))));
  // The previous wave run is the boundary; with fewer than two wave runs nothing is old enough to prune.
  const boundary = waves.length >= 2 ? /** @type {string} */ (waves[waves.length - 2]) : null;
  /** @param {string} id */
  const kept = (id) => boundary === null || id >= boundary || profiles.get(id) === 'gate' || unknown.includes(id);
  return {
    keep: dirs.filter((d) => kept(d.dirName)),
    remove: dirs.filter((d) => !kept(d.dirName)),
    boundary,
    waves: waves.slice(-2),
    gates,
    unknown,
  };
}

/**
 * @param {PrunePlan} plan
 * @returns {string}
 */
export function commitMessage(plan) {
  const runs = new Set(plan.remove.map((d) => d.dirName)).size;
  return [
    `chore(evidence): prune ${runs} lane B run(s) older than wave ${plan.boundary ?? 'n/a'}`,
    '',
    `Retention (ADR-0023 am. B): kept wave runs ${plan.waves.join(', ') || 'none'}, ${plan.gates.length} gate run(s) and every newer run.`,
    'The removed directories stay in git history.',
  ].join('\n');
}

/**
 * @param {string} evidenceBase absolute docs/05-quality
 * @returns {RunDir[]}
 */
export function scanRuns(evidenceBase) {
  /** @type {RunDir[]} */
  const dirs = [];
  for (const root of EVIDENCE_ROOTS) {
    const runs = join(evidenceBase, root, 'runs');
    if (!existsSync(runs)) continue;
    for (const entry of readdirSync(runs, { withFileTypes: true })) {
      if (!entry.isDirectory() || !RUN_DIR.test(entry.name)) continue;
      /** @type {string | null} */
      let profile = null;
      const summary = join(runs, entry.name, 'summary.json');
      if (existsSync(summary)) {
        try {
          const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(summary, 'utf8')));
          if (typeof parsed === 'object' && parsed !== null && 'profile' in parsed && typeof parsed.profile === 'string')
            profile = parsed.profile;
        } catch {
          // An unreadable summary leaves the profile unknown: planPrune never deletes such a run.
          profile = null;
        }
      }
      dirs.push({ root, dirName: entry.name, profile });
    }
  }
  return dirs;
}

/**
 * @param {readonly string[]} argv
 * @returns {number}
 */
export function main(argv) {
  const unknownArgs = argv.filter((a) => a !== '--dry-run');
  if (unknownArgs.length > 0) {
    console.error(`quality:prune: unknown argument(s) ${unknownArgs.join(' ')}`);
    return 2;
  }
  const dryRun = argv.includes('--dry-run');
  const base = join(gitRoot(process.cwd()), 'docs', '05-quality');
  const plan = planPrune(scanRuns(base));
  for (const d of plan.unknown) console.log(`keep (profile unreadable): ${d}`);
  if (plan.remove.length === 0) {
    console.log(`quality:prune: nothing to prune (boundary: ${plan.boundary ?? 'fewer than two wave runs'})`);
    return 0;
  }
  for (const d of plan.remove) {
    console.log(`${dryRun ? 'would remove' : 'remove'} docs/05-quality/${d.root}/runs/${d.dirName}/ (${d.profile ?? '?'})`);
    if (!dryRun) rmSync(join(base, d.root, 'runs', d.dirName), { recursive: true, force: true });
  }
  console.log(`\nSuggested dedicated commit:\n\n${commitMessage(plan)}`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`quality:prune: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
