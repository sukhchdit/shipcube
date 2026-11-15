// @ts-check
/**
 * Lane scope, proof inheritance and the lane A gate (ADR-0023 amendment L items 1-2; D-ARCH-126/127; ruling
 * docs/03-architecture/rulings/wave-0-ci-minutes.md section 4 RR-1, RR-4, RR-6; TASK-015 part 015-B fix cycle 1).
 *
 * Base-ref gate tooling: ci.yml runs the BASE ref's copy of tools/ci (this file and the three it imports from the same
 * directory) and bootstraps it from the head's git objects only while the base lacks it, with the summary saying so. It
 * imports nothing but `node:` modules and siblings, runs `git` and (with --lookup / --gate) the runner's `gh`, and never
 * reads node_modules, so it may run in the no-head-code jobs `scans` and `ci-gate`.
 *
 * Classification (every mode):
 *   push_scope    `docs` when the PUSH range is docs-only, else `code`. The push range is `<before>..<head>` (a tree diff)
 *                 when `--before` is a commit in the clone and an ancestor of the head (a `synchronize` event); otherwise
 *                 (opened, reopened, ready_for_review, or a `before` that is not an ancestor) the PR range decides
 *                 (`docs` only when `pr_docs_only`). Any event but `pull_request`, an unknown range or a git error is
 *                 `code` (fail closed: the full lane runs). `code_changed` = push_scope == code; `mode` = full | light.
 *   pr_docs_only  every path of `<base>...<head>` is in DOCS_ONLY_PATHS (an empty or unknown range is not docs-only).
 *   identical     the head plus the first-parent commits of `<base>..<head>` (newest first, at most MAX_IDENTICAL)
 *                 whose TREE diff to the head is docs-only (union merges are handled because trees are compared).
 *   security_paths the `security-paths.mjs` classifier (`classifyRange`, with the production-closure lockfile rule).
 *   record_ok     `check-security-owned-paths.mjs` evaluates `pass` or `not-required` for `--pr` (pull_request only;
 *                 any error, a missing record or another event gives false).
 * DOCS_ONLY_PATHS (one constant, `docsOnlyPath`): `docs/**` minus `docs/03-architecture/api/**` minus the base-ref
 * manifest's `tooling_inputs` (a missing or unreadable base manifest makes all of `docs/**` code), plus `.claude/**`
 * minus `.claude/settings.json`, plus `*.md` outside `docs/**` and outside CODE_ROOTS. A docs change counts only while
 * both sides are regular non-executable files (mode 100644 or absent; a symlink, submodule or executable is code), as
 * for the lane B staleness rule (PR28-SEC-03 item 3).
 *
 * --lookup (job `scans`; `GH_TOKEN` in that step's env only, `actions: read`): proofs read from the GitHub jobs API.
 *   Binding (code review PR #46 R2-M1 = PR46-SEC-13, D-ORCH-090): a proof run is a run of THIS pull request into
 *   PROOF_BASE_REF only. Before the first candidate's jobs are read, the head branch (`--head-ref`, `github.head_ref`)
 *   must have exactly one pull request (state all), this one (`--pr`), into `main` of this repository, and the PR's
 *   `base_ref_changed` issue events give a cutoff: runs created at or before the last retarget are never proofs. A
 *   candidate run must be on that head branch in this repository and list exactly this PR with base `main`; an empty,
 *   longer or other `pull_requests` list (a fork, another PR, another base) is no proof. Any failed or malformed binding
 *   call gives no proof at all (fail closed: the full lane runs).
 *   code_proof      `<run_id>:<sha>` of a completed `ci.yml` pull_request run of this PR (bound as above; workflow
 *                   conclusion any) on a commit of `identical` whose `fast-lane` job concluded success with every
 *                   CODE-gated step of CI_REQUIRED_GATES concluded success (steps also gated by LINT_CONTROLS may be
 *                   skipped) and whose `scans` job's gitleaks, Semgrep and openapi-breaking steps concluded success;
 *                   else empty. Step conclusions, never the job colour: a light run is green with its code steps
 *                   skipped, so it is never a proof. Queued and in-progress runs (and this run) are not proofs.
 *   security_proof  `<run_id>:<sha>` of such a run whose `security-integration` job concluded success; else empty.
 *   security_integration_due  pull_request && security_paths && record_ok && security_proof == ''.
 *   A failed or unauthenticated API call yields no proof (fail closed: the gate is red, the job runs).
 *
 * --gate (job `ci-gate`'s aggregation step; `GH_TOKEN` in that step's env only): rules (a)-(f) of RR-6 over the needs
 * results and outputs passed in the step env (FAST_LANE, FAST_LANE_MODE, SCANS, SECURITY_INTEGRATION, CODE_CHANGED,
 * PR_DOCS_ONLY, CODE_PROOF, SECURITY_PROOF, RECORD_OK, SECURITY_PATHS, SECURITY_INTEGRATION_DUE) and this run's jobs:
 *   (a) fast-lane success; (b) a code push ran full and this run's CODE-gated required steps concluded success; a
 *   docs push that ran full disagrees with the classification; (c) a docs push of a PR with code changes has a
 *   code proof; (d) scans success; (e) security_paths → security-integration success in this run or a security proof;
 *   (f) an empty or malformed classification output is `classification missing`. Prints `MERGE-READY` (exit 0) or
 *   `BLOCKED: <reasons>` (exit 1). On push events (CI_MAIN_FAST_LANE) only (a), (b), (d) and (f) apply.
 *
 * CLI: node tools/ci/lane-scope.mjs --root <dir> --base <sha> --head <sha> [--before <sha>] [--event <name>]
 *        [--pr <n>] [--head-ref <branch>] [--lookup] [--output <$GITHUB_OUTPUT>] [--summary <$GITHUB_STEP_SUMMARY>] [--json]
 *      node tools/ci/lane-scope.mjs --gate --root <dir> [--summary <file>] [--json]
 * Exit 0 classified / MERGE-READY, 1 BLOCKED (--gate), 2 usage or internal error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { checkSecurityOwnedPaths } from './check-security-owned-paths.mjs';
import { CI_REQUIRED_GATES, gateStepIndex } from './check-workflow-policy.mjs';
import { classifyRange, matchGlob } from './security-paths.mjs';
import { isMap, parseYamlSubset } from './yaml-subset.mjs';

/** @typedef {import('./check-workflow-policy.mjs').RequiredGate} RequiredGate */
/** @typedef {{ path: string, oldMode: string, newMode: string }} TreeChange */
/** @typedef {{ ok: true, json: unknown } | { ok: false, problem: string }} ApiResult */
/** @typedef {(path: string) => ApiResult} Api */
/** @typedef {{ name: string, mayBeSkipped: boolean }} RequiredStep */
/** @typedef {{ fastLane: RequiredStep[], scans: string[] }} ProofSteps */

/** Top-level directories whose Markdown is code (READMEs next to code, fixtures, templates). */
export const CODE_ROOTS = Object.freeze(['apps', 'packages', 'prisma', 'tools', 'tests', 'infra', '.github']);
/** The API contract is docs by location but a lane A input (oasdiff, openapi:types). */
export const API_CONTRACT_GLOB = 'docs/03-architecture/api/**';
export const MANIFEST_PATH = 'tools/quality/required-suites.json';
export const WORKFLOW_PATH = '.github/workflows/ci.yml';
/** At most this many first-parent commits are compared for the code-identical set. */
export const MAX_IDENTICAL = 50;
/** At most this many API calls per lookup (a run list per commit and a job list per completed run). */
export const MAX_API_CALLS = 40;
/** The scans gates whose step conclusions belong to a code proof (by CI_REQUIRED_GATES `gate`). */
export const PROOF_SCANS_GATES = Object.freeze(['gitleaks', 'semgrep', 'openapi-breaking']);
/** Proof runs are runs against this base branch only (R2-M1, PR46-SEC-13; ci.yml `on.pull_request.branches`). */
export const PROOF_BASE_REF = 'main';
/** A page of the issue events API; a full page means another page is read (within MAX_API_CALLS). */
const EVENTS_PAGE = 100;
/** Head branch names a binding accepts (a git ref subset; anything else is no proof, never a usage error). */
const BRANCH = /^(?![-/.])(?!.*(?:\.\.|\/\/|@\{|\.lock$|\/$|\.$))[A-Za-z0-9._/-]{1,200}$/u;
const CODE_IF = "env.CODE == 'true'";
const LINT_IF = "env.LINT_CONTROLS == 'true'";
const DOC_MODES = new Set(['100644', '000000']);
const ZERO_SHA = /^0{40}$/u;
const SHA = /^[0-9a-f]{7,64}$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const PROOF = /^[1-9]\d{0,19}:[0-9a-f]{40}$/u;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const RUN_ID = /^[1-9]\d{0,19}$/u;
const PR_NUMBER = /^[1-9]\d{0,8}$/u;
const BOOL = new Set(['true', 'false']);

/**
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.error === undefined && result.status === 0, stdout: result.stdout ?? '' };
}

/**
 * The full commit id of `rev`, or null (an empty, zero, malformed or unknown id).
 * @param {string} root
 * @param {string} rev
 */
export function resolveCommit(root, rev) {
  if (rev === '' || ZERO_SHA.test(rev) || !SHA.test(rev)) return null;
  const result = git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`]);
  const sha = result.stdout.trim();
  return result.ok && FULL_SHA.test(sha) ? sha : null;
}

/**
 * Tree changes between two revisions (`from..to`, or `from...to` with `mergeBase`), with modes, or null on a git error.
 * @param {string} root
 * @param {string} from
 * @param {string} to
 * @param {{ mergeBase?: boolean }} [options]
 * @returns {TreeChange[] | null}
 */
export function treeChanges(root, from, to, options = {}) {
  const range = options.mergeBase === true ? [`${from}...${to}`] : [from, to];
  const result = git(root, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', '--ignore-submodules=none', ...range]);
  if (!result.ok) return null;
  return parseRaw(result.stdout);
}

/**
 * Parses `git diff --raw -z` output (`:<old mode> <new mode> <old> <new> <status>\0<path>\0`, no renames).
 * @param {string} text
 * @returns {TreeChange[] | null}
 */
export function parseRaw(text) {
  const parts = text.split('\0');
  /** @type {TreeChange[]} */
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ [A-Z]\d*$/u.exec(parts[i] ?? '');
    const path = parts[i + 1];
    if (meta === null || path === undefined || path === '') return null;
    out.push({ path, oldMode: meta[1] ?? '', newMode: meta[2] ?? '' });
  }
  return out;
}

/**
 * The base-ref manifest's `tooling_inputs`, or null when the base has no readable manifest (docs/** is then code).
 * @param {string} root
 * @param {string | null} base
 * @returns {string[] | null}
 */
export function toolingInputs(root, base) {
  if (base === null) return null;
  const shown = git(root, ['show', `${base}:${MANIFEST_PATH}`]);
  if (!shown.ok) return null;
  try {
    const value = /** @type {unknown} */ (JSON.parse(shown.stdout));
    const inputs = isRecord(value) ? value.tooling_inputs : undefined;
    return Array.isArray(inputs) && inputs.every((glob) => typeof glob === 'string' && glob !== '') ? inputs : null;
  } catch {
    return null;
  }
}

/**
 * DOCS_ONLY_PATHS membership (see the header).
 * @param {string} path repository-relative, `/`-separated
 * @param {readonly string[] | null} inputs the base-ref manifest's tooling_inputs (null: no manifest)
 */
export function docsOnlyPath(path, inputs) {
  if (path.includes('\\') || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  if (matchGlob(path, 'docs/**')) {
    if (inputs === null || matchGlob(path, API_CONTRACT_GLOB)) return false;
    return !inputs.some((glob) => matchGlob(path, glob.replace(/^!/u, '')));
  }
  if (matchGlob(path, '.claude/**')) return path !== '.claude/settings.json';
  if (!path.endsWith('.md')) return false;
  const top = path.split('/')[0] ?? '';
  return !path.includes('/') || !CODE_ROOTS.includes(top);
}

/**
 * True when every change is a docs-only path between regular non-executable files.
 * @param {readonly TreeChange[]} changes
 * @param {readonly string[] | null} inputs
 */
export function allDocs(changes, inputs) {
  return changes.every((change) => docsOnlyPath(change.path, inputs) && DOC_MODES.has(change.oldMode) && DOC_MODES.has(change.newMode));
}

/**
 * @typedef {object} Classification
 * @property {'docs' | 'code'} pushScope
 * @property {string} pushReason
 * @property {boolean} prDocsOnly
 * @property {string} prReason
 * @property {string[]} identical full SHAs, the head first
 * @property {boolean} securityPaths
 * @property {string} securityReason
 * @property {boolean} recordOk
 * @property {string} recordReason
 */

/**
 * @param {{ root: string, base: string, head: string, before?: string, event?: string, pr?: string }} input
 * @returns {Classification}
 */
export function classify({ root, base, head, before = '', event = 'pull_request', pr = '' }) {
  const baseSha = resolveCommit(root, base);
  const headSha = resolveCommit(root, head);
  const inputs = toolingInputs(root, baseSha);
  const inputsNote = inputs === null ? ' (no base-ref manifest: docs/** counts as code)' : '';

  /** @type {{ prDocsOnly: boolean, prReason: string }} */
  let pr_ = { prDocsOnly: false, prReason: 'unknown PR range (code)' };
  if (baseSha !== null && headSha !== null) {
    const changes = treeChanges(root, baseSha, headSha, { mergeBase: true });
    if (changes === null) pr_ = { prDocsOnly: false, prReason: 'git diff of the PR range failed (code)' };
    else if (changes.length === 0) pr_ = { prDocsOnly: false, prReason: 'the PR range changes nothing (code)' };
    else {
      const docs = allDocs(changes, inputs);
      pr_ = {
        prDocsOnly: docs,
        prReason: `PR range: ${String(changes.length)} path(s), ${docs ? 'all docs' : 'code among them'}${inputsNote}`,
      };
    }
  }

  /** @type {{ pushScope: 'docs' | 'code', pushReason: string }} */
  let push = { pushScope: 'code', pushReason: `${event} event: the full lane runs` };
  if (event === 'pull_request') {
    const beforeSha = resolveCommit(root, before);
    const ancestor =
      beforeSha !== null &&
      headSha !== null &&
      spawnSync('git', ['merge-base', '--is-ancestor', beforeSha, headSha], { cwd: root, windowsHide: true, timeout: 60_000 }).status === 0;
    if (ancestor && beforeSha !== null && headSha !== null) {
      const changes = treeChanges(root, beforeSha, headSha);
      if (changes === null) push = { pushScope: 'code', pushReason: 'git diff of the push range failed (code)' };
      else {
        const docs = allDocs(changes, inputs);
        push = {
          pushScope: docs ? 'docs' : 'code',
          pushReason: `push range ${beforeSha.slice(0, 7)}..${headSha.slice(0, 7)}: ${String(changes.length)} path(s), ${docs ? 'all docs' : 'code among them'}${inputsNote}`,
        };
      }
    } else if (pr_.prDocsOnly) {
      push = { pushScope: 'docs', pushReason: 'no push range (no ancestor before-SHA): the PR range is docs-only' };
    } else {
      push = { pushScope: 'code', pushReason: 'no push range (no ancestor before-SHA) and the PR range is not docs-only (code)' };
    }
  }

  const identical = headSha === null ? [] : identicalSet(root, baseSha, headSha, inputs);

  /** @type {{ selected: boolean, reason: string }} */
  let security;
  try {
    security = classifyRange(root, base, head);
  } catch (error) {
    security = { selected: true, reason: `classifier error (fail closed: run): ${message(error)}` };
  }

  let recordOk = false;
  let recordReason = 'not evaluated (pull_request with --pr only)';
  if (event === 'pull_request' && PR_NUMBER.test(pr) && baseSha !== null && headSha !== null) {
    try {
      const evaluation = checkSecurityOwnedPaths({ root, base: baseSha, head: headSha, pr: Number(pr) });
      recordOk = evaluation.status === 'pass' || evaluation.status === 'not-required';
      recordReason = `security record check: ${evaluation.status}`;
    } catch (error) {
      recordReason = `security record check failed (not a merge candidate): ${message(error)}`;
    }
  }

  return {
    ...push,
    ...pr_,
    identical,
    securityPaths: security.selected,
    securityReason: security.reason,
    recordOk,
    recordReason,
  };
}

/**
 * The head plus the first-parent commits of `<base>..<head>` whose tree diff to the head is docs-only, newest first.
 * @param {string} root
 * @param {string | null} base
 * @param {string} head full SHA
 * @param {readonly string[] | null} inputs
 * @returns {string[]}
 */
export function identicalSet(root, base, head, inputs) {
  if (base === null) return [head];
  const listed = git(root, ['rev-list', '--first-parent', `--max-count=${String(MAX_IDENTICAL)}`, `${base}..${head}`]);
  if (!listed.ok) return [head];
  const out = [head];
  for (const sha of listed.stdout.split(/\r?\n/u).filter((line) => FULL_SHA.test(line))) {
    if (sha === head) continue;
    const changes = treeChanges(root, sha, head);
    if (changes !== null && allDocs(changes, inputs)) out.push(sha);
  }
  return out;
}

/**
 * The step names a code proof needs, from a ci.yml text and CI_REQUIRED_GATES (this directory's copy).
 * @param {string} workflowText
 * @param {readonly RequiredGate[]} [gates]
 * @returns {ProofSteps | { problem: string }}
 */
export function proofSteps(workflowText, gates = CI_REQUIRED_GATES) {
  let doc;
  try {
    doc = parseYamlSubset(workflowText).value;
  } catch (error) {
    return { problem: `ci.yml does not parse: ${message(error)}` };
  }
  const root = doc ?? undefined;
  const jobs = isMap(root) && isMap(root.jobs) ? root.jobs : {};
  /** @param {string} jobId */
  const stepsOf = (jobId) => {
    const job = jobs[jobId];
    return isMap(job) && Array.isArray(job.steps) ? job.steps : [];
  };
  /**
   * @param {RequiredGate} gate
   * @returns {{ name: string } | { problem: string }}
   */
  const nameOf = (gate) => {
    const steps = stepsOf(gate.job);
    const index = gateStepIndex(steps, gate);
    const step = steps[index];
    const name = isMap(step) && typeof step.name === 'string' ? step.name.trim() : '';
    if (index === -1 || name === '') return { problem: `the ${gate.gate} gate step has no step or no name in ${gate.job}` };
    const same = steps.filter((other) => isMap(other) && typeof other.name === 'string' && other.name.trim() === name).length;
    if (same !== 1) return { problem: `the ${gate.gate} gate step name is not unique in ${gate.job}` };
    return { name };
  };
  /** @type {RequiredStep[]} */
  const fastLane = [];
  for (const gate of gates) {
    if (gate.job !== 'fast-lane' || !gate.ifs.some((condition) => condition.includes(CODE_IF))) continue;
    const found = nameOf(gate);
    if ('problem' in found) return found;
    fastLane.push({ name: found.name, mayBeSkipped: gate.ifs.every((condition) => condition.includes(LINT_IF)) });
  }
  /** @type {string[]} */
  const scans = [];
  for (const id of PROOF_SCANS_GATES) {
    const gate = gates.find((candidate) => candidate.job === 'scans' && candidate.gate === id);
    if (gate === undefined) return { problem: `CI_REQUIRED_GATES has no scans gate ${id}` };
    const found = nameOf(gate);
    if ('problem' in found) return found;
    scans.push(found.name);
  }
  if (fastLane.length === 0) return { problem: 'CI_REQUIRED_GATES has no CODE-gated fast-lane step' };
  return { fastLane, scans };
}

/**
 * @param {unknown} jobsJson a jobs API response
 * @param {string} name
 * @returns {Record<string, any> | string} the one job of that name, or a problem
 */
function oneJob(jobsJson, name) {
  const jobs = isRecord(jobsJson) && Array.isArray(jobsJson.jobs) ? jobsJson.jobs : null;
  if (jobs === null) return 'the jobs API response has no jobs list';
  const matches = jobs.filter((job) => isRecord(job) && job.name === name);
  if (matches.length !== 1) return `${String(matches.length)} jobs named ${name}`;
  return /** @type {Record<string, any>} */ (matches[0]);
}

/**
 * Problems that keep a run's `fast-lane` job from proving the code (empty = the job is a proof).
 * @param {unknown} jobsJson
 * @param {readonly RequiredStep[]} required
 * @returns {string[]}
 */
export function fastLaneProblems(jobsJson, required) {
  const job = oneJob(jobsJson, 'fast-lane');
  if (typeof job === 'string') return [job];
  if (job.status !== 'completed' || job.conclusion !== 'success') return [`fast-lane ${String(job.conclusion ?? job.status)}`];
  const steps = Array.isArray(job.steps) ? job.steps.filter(isRecord) : [];
  /** @type {string[]} */
  const out = [];
  for (const { name, mayBeSkipped } of required) {
    const matches = steps.filter((step) => step.name === name);
    const conclusion = matches.length === 1 ? String(matches[0]?.conclusion) : matches.length === 0 ? 'missing' : 'ambiguous';
    if (!(conclusion === 'success' || (mayBeSkipped && conclusion === 'skipped'))) out.push(`${name}: ${conclusion}`);
  }
  return out;
}

/**
 * Problems that keep a run's `scans` job from proving the code (the job colour is ignored; the record step may fail).
 * @param {unknown} jobsJson
 * @param {readonly string[]} names
 * @returns {string[]}
 */
export function scansProblems(jobsJson, names) {
  const job = oneJob(jobsJson, 'scans');
  if (typeof job === 'string') return [job];
  if (job.status !== 'completed') return [`scans ${String(job.status)}`];
  const steps = Array.isArray(job.steps) ? job.steps.filter(isRecord) : [];
  return names.flatMap((name) => {
    const matches = steps.filter((step) => step.name === name);
    return matches.length === 1 && matches[0]?.conclusion === 'success'
      ? []
      : [`${name}: ${matches.length === 1 ? String(matches[0]?.conclusion) : 'missing'}`];
  });
}

/**
 * @param {unknown} jobsJson
 * @returns {boolean}
 */
export function securityIntegrationPassed(jobsJson) {
  const job = oneJob(jobsJson, 'security-integration');
  return typeof job !== 'string' && job.status === 'completed' && job.conclusion === 'success';
}

/**
 * @typedef {object} Binding this PR's proof binding (R2-M1, PR46-SEC-13)
 * @property {string} repo `owner/name`
 * @property {string} pr the pull request number
 * @property {string} headRef its head branch
 * @property {number} since runs created at or before this time (ms; the last `base_ref_changed`, else 0) are no proofs
 */

/**
 * The repository named by a pull-request entry's `repo` (`full_name`, or the API `url` of a workflow run's entry).
 * @param {unknown} repoJson
 * @param {string} repo
 */
function sameRepo(repoJson, repo) {
  if (!isRecord(repoJson)) return false;
  if (typeof repoJson.full_name === 'string') return repoJson.full_name === repo;
  return typeof repoJson.url === 'string' && repoJson.url.endsWith(`/repos/${repo}`);
}

/**
 * True when a pull-request entry is THIS pull request: number, head branch and base `main`, all in this repository.
 * @param {unknown} entry a `pulls` item or a workflow run's `pull_requests` item
 * @param {{ repo: string, pr: string, headRef: string }} binding
 */
function isThisPullRequest(entry, binding) {
  if (!isRecord(entry) || String(entry.number) !== binding.pr) return false;
  const base = isRecord(entry.base) ? entry.base : {};
  const head = isRecord(entry.head) ? entry.head : {};
  return (
    base.ref === PROOF_BASE_REF && sameRepo(base.repo, binding.repo) && head.ref === binding.headRef && sameRepo(head.repo, binding.repo)
  );
}

/**
 * Binds proofs to this pull request (D-ORCH-090): the head branch has exactly one pull request (state all), this one into
 * `main`, and the cutoff is its last `base_ref_changed` event (no-retarget rule: a retarget voids every earlier run).
 * @param {{ call: Api, repo: string, pr: string, headRef: string }} input
 * @returns {Binding | { problem: string }}
 */
export function proofBinding({ call, repo, pr, headRef }) {
  if (!PR_NUMBER.test(pr)) return { problem: 'no pull request number (--pr)' };
  if (!BRANCH.test(headRef)) return { problem: 'no usable head branch (--head-ref)' };
  const binding = { repo, pr, headRef };
  const owner = repo.split('/')[0] ?? '';
  const pulls = call(`repos/${repo}/pulls?state=all&head=${encodeURIComponent(`${owner}:${headRef}`)}&per_page=100`);
  if (!pulls.ok) return { problem: `pull requests of the head branch: ${pulls.problem}` };
  if (!Array.isArray(pulls.json)) return { problem: 'pull requests of the head branch: not a list' };
  if (pulls.json.length !== 1 || !isThisPullRequest(pulls.json[0], binding))
    return {
      problem: `${String(pulls.json.length)} pull request(s) from the head branch; exactly this PR into ${PROOF_BASE_REF} is required`,
    };
  let since = 0;
  for (let page = 1; ; page += 1) {
    const events = call(`repos/${repo}/issues/${pr}/events?per_page=${String(EVENTS_PAGE)}&page=${String(page)}`);
    if (!events.ok) return { problem: `events of PR ${pr}: ${events.problem}` };
    if (!Array.isArray(events.json) || !events.json.every(isRecord)) return { problem: `events of PR ${pr}: not a list of events` };
    for (const event of events.json) {
      if (event.event !== 'base_ref_changed') continue;
      const at = Date.parse(String(event.created_at));
      if (!Number.isFinite(at)) return { problem: `events of PR ${pr}: a base_ref_changed event without a time` };
      since = Math.max(since, at);
    }
    if (events.json.length < EVENTS_PAGE) break;
  }
  return { ...binding, since };
}

/**
 * Why a run is not a run of this pull request into `main` after its last retarget ('' = bound).
 * @param {Record<string, any>} run a workflow run of the runs API
 * @param {Binding} binding
 */
export function runBindingProblem(run, binding) {
  if (run.head_branch !== binding.headRef) return 'another head branch';
  if (!sameRepo(run.head_repository, binding.repo)) return 'another head repository (fork)';
  const listed = Array.isArray(run.pull_requests) ? run.pull_requests : [];
  if (listed.length !== 1) return `${String(listed.length)} pull requests listed (exactly this PR is required)`;
  if (!isThisPullRequest(listed[0], binding)) return `not this PR into ${PROOF_BASE_REF}`;
  const created = Date.parse(String(run.created_at));
  if (!Number.isFinite(created)) return 'no creation time';
  if (created <= binding.since) return 'created before the last base change of this PR';
  return '';
}

/**
 * Proof lookup over the code-identical set (D-ARCH-126/127), bound to this pull request (R2-M1, PR46-SEC-13).
 * @param {{ api: Api, repo: string, identical: readonly string[], steps: ProofSteps, currentRunId?: string, pr?: string,
 *   headRef?: string }} input
 * @returns {{ codeProof: string, securityProof: string, notes: string[] }}
 */
export function lookupProofs({ api, repo, identical, steps, currentRunId = '', pr = '', headRef = '' }) {
  /** @type {string[]} */
  const notes = [];
  let codeProof = '';
  let securityProof = '';
  let calls = 0;
  const call = (/** @type {string} */ path) => {
    calls += 1;
    if (calls > MAX_API_CALLS) return /** @type {ApiResult} */ ({ ok: false, problem: `more than ${String(MAX_API_CALLS)} API calls` });
    return api(path);
  };
  /** @type {Binding | { problem: string } | null} read once, before the first candidate's jobs */
  let binding = null;
  for (const sha of identical) {
    if (codeProof !== '' && securityProof !== '') break;
    const listed = call(`repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=pull_request&status=completed&per_page=100`);
    if (!listed.ok) {
      notes.push(`runs of ${sha.slice(0, 7)}: ${listed.problem}`);
      if (calls > MAX_API_CALLS) break;
      continue;
    }
    const runs = isRecord(listed.json) && Array.isArray(listed.json.workflow_runs) ? listed.json.workflow_runs.filter(isRecord) : [];
    const completed = runs.filter(
      (run) =>
        run.head_sha === sha &&
        run.event === 'pull_request' &&
        run.status === 'completed' &&
        typeof run.path === 'string' &&
        /^\.github\/workflows\/ci\.yml(?:@|$)/u.test(run.path) &&
        RUN_ID.test(String(run.id)) &&
        String(run.id) !== currentRunId,
    );
    if (completed.length === 0) continue;
    if (binding === null) binding = proofBinding({ call, repo, pr, headRef });
    if ('problem' in binding) {
      notes.push(`no proof (binding, fail closed): ${binding.problem}`);
      break;
    }
    /** @type {Record<string, any>[]} */
    const candidates = [];
    for (const run of completed) {
      const problem = runBindingProblem(run, binding);
      if (problem === '') candidates.push(run);
      else notes.push(`run ${String(run.id)} (${sha.slice(0, 7)}) is not a run of this PR into ${PROOF_BASE_REF}: ${problem}`);
    }
    candidates.sort((a, b) => Number(b.id) - Number(a.id));
    for (const run of candidates) {
      if (codeProof !== '' && securityProof !== '') break;
      const jobs = call(`repos/${repo}/actions/runs/${String(run.id)}/jobs?per_page=100`);
      if (!jobs.ok) {
        notes.push(`jobs of run ${String(run.id)}: ${jobs.problem}`);
        continue;
      }
      if (codeProof === '') {
        const problems = [...fastLaneProblems(jobs.json, steps.fastLane), ...scansProblems(jobs.json, steps.scans)];
        if (problems.length === 0) codeProof = `${String(run.id)}:${sha}`;
        else notes.push(`run ${String(run.id)} (${sha.slice(0, 7)}) is not a code proof: ${problems.slice(0, 3).join('; ')}`);
      }
      if (securityProof === '' && securityIntegrationPassed(jobs.json)) securityProof = `${String(run.id)}:${sha}`;
    }
  }
  return { codeProof, securityProof, notes };
}

/** Synchronous sleep (the CLI is synchronous; retries are rare and short). */
const sleep = (/** @type {number} */ ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * The runner's `gh api` as an Api: GET only, 30 s timeout, three attempts with jittered backoff (idempotent reads).
 * @param {{ gh?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Api}
 */
export function ghApi(options = {}) {
  const env = options.env ?? process.env;
  return (path) => {
    if ((env.GH_TOKEN ?? '') === '') return { ok: false, problem: 'GH_TOKEN is not set (no lookup)' };
    let problem = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = spawnSync(options.gh ?? 'gh', ['api', '--method', 'GET', '-H', 'Accept: application/vnd.github+json', path], {
        encoding: 'utf8',
        env,
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      });
      if (result.error === undefined && result.status === 0) {
        try {
          return { ok: true, json: /** @type {unknown} */ (JSON.parse(result.stdout)) };
        } catch {
          return { ok: false, problem: 'the API response is not JSON' };
        }
      }
      problem = result.error !== undefined ? result.error.message : `gh api exit ${String(result.status)}`;
      if (attempt < 3) sleep(250 * 2 ** attempt + Math.floor(Math.random() * 250));
    }
    return { ok: false, problem };
  };
}

/**
 * @typedef {object} GateInput
 * @property {string} event GITHUB_EVENT_NAME
 * @property {string} fastLane needs.fast-lane.result
 * @property {string} fastLaneMode needs.fast-lane.outputs.mode
 * @property {string} scans needs.scans.result
 * @property {string} securityIntegration needs.security-integration.result
 * @property {Record<string, string>} outputs scans outputs: code_changed, pr_docs_only, code_proof, security_proof,
 *   record_ok, security_paths, security_integration_due
 * @property {() => string[]} thisRunCodeProblems problems of this run's CODE-gated fast-lane steps (jobs API)
 */

/** The scans outputs ci-gate requires, and their domains. */
export const GATE_OUTPUTS = Object.freeze(['code_changed', 'pr_docs_only', 'record_ok', 'security_paths', 'security_integration_due']);

/**
 * Rules (a)-(f) of RR-6. Reasons are enumerated strings (the summary and the tests match them).
 * @param {GateInput} input
 * @returns {{ ready: boolean, reasons: string[] }}
 */
export function gateVerdict(input) {
  /** @type {string[]} */
  const reasons = [];
  const pr = input.event === 'pull_request';
  const out = input.outputs;
  // (f) fail closed on a missing or malformed classification.
  const malformed =
    GATE_OUTPUTS.some((key) => !BOOL.has(out[key] ?? '')) ||
    !['full', 'light'].includes(input.fastLaneMode) ||
    ![out.code_proof ?? '', out.security_proof ?? ''].every((proof) => proof === '' || PROOF.test(proof));
  if (malformed) reasons.push('classification missing');
  // (a)
  if (input.fastLane !== 'success')
    reasons.push(
      input.fastLane === 'skipped'
        ? 'fast-lane skipped (a draft PR is not gated: mark it ready for review)'
        : `fast-lane ${input.fastLane || 'missing'}`,
    );
  // (d)
  if (input.scans !== 'success') reasons.push(`scans ${input.scans || 'missing'}`);
  if (!malformed) {
    const codeChanged = !pr || out.code_changed === 'true';
    // (b)
    if (codeChanged) {
      if (input.fastLaneMode !== 'full') reasons.push('code gates skipped on a code push');
      else if (input.fastLane === 'success') {
        const problems = input.thisRunCodeProblems();
        if (problems.length > 0) reasons.push(`code gates skipped on a code push (${problems.slice(0, 3).join('; ')})`);
      }
    } else if (input.fastLaneMode !== 'light') reasons.push('fast-lane mode disagrees with the classification');
    // (c)
    if (pr && out.code_changed === 'false' && out.pr_docs_only === 'false' && (out.code_proof ?? '') === '')
      reasons.push('no code proof for this tree');
    // (e)
    if (pr && out.security_paths === 'true' && input.securityIntegration !== 'success' && (out.security_proof ?? '') === '') {
      if (input.securityIntegration === 'failure' || input.securityIntegration === 'cancelled') reasons.push('security-integration red');
      else if (out.record_ok !== 'true') reasons.push('security-integration pending (record missing)');
      else reasons.push('security-integration pending (not run)');
    }
  }
  return { ready: reasons.length === 0, reasons };
}

/**
 * Collects the gate input from the environment (the aggregation step's env and the runner's variables).
 * @param {{ root: string, env: NodeJS.ProcessEnv, api: Api }} input
 * @returns {GateInput}
 */
export function gateInputFromEnv({ root, env, api }) {
  const get = (/** @type {string} */ name) => (env[name] ?? '').trim();
  /** @type {Record<string, string>} */
  const outputs = {
    code_changed: get('CODE_CHANGED'),
    pr_docs_only: get('PR_DOCS_ONLY'),
    code_proof: get('CODE_PROOF'),
    security_proof: get('SECURITY_PROOF'),
    record_ok: get('RECORD_OK'),
    security_paths: get('SECURITY_PATHS'),
    security_integration_due: get('SECURITY_INTEGRATION_DUE'),
  };
  return {
    event: get('GITHUB_EVENT_NAME'),
    fastLane: get('FAST_LANE'),
    fastLaneMode: get('FAST_LANE_MODE'),
    scans: get('SCANS'),
    securityIntegration: get('SECURITY_INTEGRATION'),
    outputs,
    thisRunCodeProblems: () => {
      const repo = get('GITHUB_REPOSITORY');
      const runId = get('GITHUB_RUN_ID');
      const attempt = get('GITHUB_RUN_ATTEMPT') || '1';
      if (!REPO.test(repo) || !RUN_ID.test(runId) || !/^[1-9]\d{0,4}$/u.test(attempt))
        return ['this run is not identifiable (GITHUB_REPOSITORY, GITHUB_RUN_ID)'];
      const shown = git(root, ['show', `HEAD:${WORKFLOW_PATH}`]);
      if (!shown.ok) return [`${WORKFLOW_PATH} is not readable at HEAD`];
      const steps = proofSteps(shown.stdout);
      if ('problem' in steps) return [steps.problem];
      const jobs = api(`repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`);
      if (!jobs.ok) return [`jobs API: ${jobs.problem}`];
      return fastLaneProblems(jobs.json, steps.fastLane);
    },
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} error */
function message(error) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/gu, ' ').slice(0, 200);
}

/** Markdown-safe one-line text for the job summary. */
const safe = (/** @type {string} */ text) => text.replace(/[`\r\n|]/gu, '?');

/**
 * @param {readonly string[]} argv
 * @returns {{ values: Record<string, string>, flags: Set<string> } | { error: string }}
 */
export function parseArgs(argv) {
  const valued = new Set(['--root', '--base', '--head', '--before', '--event', '--pr', '--head-ref', '--output', '--summary']);
  const boolean = new Set(['--lookup', '--json', '--gate']);
  /** @type {Record<string, string>} */
  const values = {};
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (boolean.has(arg)) flags.add(arg);
    else if (valued.has(arg) && i + 1 < argv.length) {
      values[arg] = argv[i + 1] ?? '';
      i += 1;
    } else return { error: `unknown or incomplete argument ${arg}` };
  }
  if (values['--root'] === undefined || values['--root'] === '') return { error: '--root is required' };
  if (flags.has('--gate')) {
    if (flags.has('--lookup') || ['--base', '--head', '--head-ref'].some((name) => values[name] !== undefined))
      return { error: '--gate takes --root, --summary and --json only' };
    return { values, flags };
  }
  if (values['--head'] === undefined) return { error: '--base and --head are required' };
  if (values['--base'] === undefined) return { error: '--base and --head are required' };
  const event = values['--event'] ?? 'pull_request';
  if (!['pull_request', 'push'].includes(event)) return { error: `--event must be pull_request or push (got ${event})` };
  const pr = values['--pr'] ?? '';
  if (pr !== '' && !PR_NUMBER.test(pr)) return { error: '--pr must be a pull request number' };
  return { values, flags };
}

/**
 * @param {readonly string[]} argv
 * @param {{ env?: NodeJS.ProcessEnv, api?: Api }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    console.error(`lane-scope: ${parsed.error}`);
    return 2;
  }
  const { values, flags } = parsed;
  const env = deps.env ?? process.env;
  const api = deps.api ?? ghApi({ env });
  const root = values['--root'] ?? '.';
  const summary = values['--summary'];

  if (flags.has('--gate')) {
    const verdict = gateVerdict(gateInputFromEnv({ root, env, api }));
    const line = verdict.ready ? 'MERGE-READY' : `BLOCKED: ${verdict.reasons.join('; ')}`;
    if (flags.has('--json')) console.log(JSON.stringify(verdict, null, 2));
    console.log(`ci-gate: ${line}`);
    if (summary !== undefined)
      appendFileSync(
        summary,
        `\n### ci-gate: ${safe(line)}\n\n${verdict.ready ? 'Lane A is merge-ready for this head.' : 'Merge only on MERGE-READY for the exact head (D-ORCH-012/013).'}\n`,
      );
    return verdict.ready ? 0 : 1;
  }

  const event = values['--event'] ?? 'pull_request';
  const result = classify({
    root,
    base: values['--base'] ?? '',
    head: values['--head'] ?? '',
    before: values['--before'] ?? '',
    event,
    pr: values['--pr'] ?? '',
  });
  /** @type {Record<string, string>} */
  const out = {
    push_scope: result.pushScope,
    code_changed: String(result.pushScope === 'code'),
    mode: result.pushScope === 'code' ? 'full' : 'light',
    pr_docs_only: String(result.prDocsOnly),
    identical: result.identical.join(' '),
    security_paths: String(result.securityPaths),
    record_ok: String(result.recordOk),
  };
  /** @type {string[]} */
  let notes = [];
  if (flags.has('--lookup')) {
    let codeProof = '';
    let securityProof = '';
    const repo = (env.GITHUB_REPOSITORY ?? '').trim();
    if (event !== 'pull_request') notes.push('no lookup on a push event');
    else if (!REPO.test(repo)) notes.push('GITHUB_REPOSITORY is not set (no lookup)');
    else {
      const head = (values['--head'] ?? '').trim();
      const shown = git(root, ['show', `${head}:${WORKFLOW_PATH}`]);
      const steps = shown.ok ? proofSteps(shown.stdout) : { problem: `${WORKFLOW_PATH} is not readable at the head` };
      if ('problem' in steps) notes.push(`no lookup: ${steps.problem}`);
      else {
        const found = lookupProofs({
          api,
          repo,
          identical: result.identical,
          steps,
          currentRunId: (env.GITHUB_RUN_ID ?? '').trim(),
          pr: values['--pr'] ?? '',
          headRef: values['--head-ref'] ?? '',
        });
        codeProof = found.codeProof;
        securityProof = found.securityProof;
        notes = [...notes, ...found.notes];
      }
    }
    out.code_proof = codeProof;
    out.security_proof = securityProof;
    out.security_integration_due = String(event === 'pull_request' && result.securityPaths && result.recordOk && securityProof === '');
  }
  const text = Object.entries(out)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  if (values['--output'] !== undefined && values['--output'] !== '') appendFileSync(values['--output'], `${text}\n`);
  if (flags.has('--json')) console.log(JSON.stringify({ ...out, reasons: result, notes }, null, 2));
  else console.log(text);
  if (summary !== undefined && summary !== '') {
    const lines = [
      `### Lane scope: ${out.mode} (${out.push_scope} push)`,
      '',
      `- ${safe(result.pushReason)}`,
      `- ${safe(result.prReason)}`,
      `- code-identical commits: ${result.identical.map((sha) => `\`${sha.slice(0, 7)}\``).join(', ') || 'none'}`,
      `- security-critical paths: ${out.security_paths} (${safe(result.securityReason)})`,
      `- ${safe(result.recordReason)}`,
    ];
    if (flags.has('--lookup')) {
      lines.push(
        `- code proof: ${out.code_proof === '' ? 'none' : `run ${safe(out.code_proof ?? '')}`}`,
        `- security proof: ${out.security_proof === '' ? 'none' : `run ${safe(out.security_proof ?? '')}`}`,
        `- security-integration due: ${out.security_integration_due ?? 'false'}`,
        ...notes.slice(0, 10).map((note) => `- note: ${safe(note)}`),
      );
    }
    appendFileSync(summary, `\n${lines.join('\n')}\n`);
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`lane-scope: internal error: ${message(error)}`);
    process.exitCode = 2;
  }
}
