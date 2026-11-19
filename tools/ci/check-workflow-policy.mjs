// @ts-check
/**
 * Workflow policy (lane A; ADR-0023 amendments F item 4, H, I item 3, J items 2 (e) and 5; D-ARCH-041, D-ARCH-044;
 * SEC-TC-32, SEC-TC-51, SEC-TC-64; PR1-SEC-02/-08/-12, PR4-SEC-08, PR5-SEC-07; AT-US-005-04/-05).
 *
 * Reads every `.github/workflows/*.{yml,yaml}` with the strict subset parser (`yaml-subset.mjs`; a construct outside
 * the subset is itself a finding) and enforces:
 *   pinned-action         `uses:` is `./local`, `docker://…@sha256:<64 hex>` or `owner/repo[/path]@<40 hex>` with a
 *                         trailing `# vX.Y.Z` comment.
 *   forbidden-trigger     no `pull_request_target`, `workflow_run`, `issue_comment`, `pull_request_review`,
 *                         `pull_request_review_comment`, `discussion`, `discussion_comment` (privileged or comment-driven
 *                         triggers; PR10-SEC-07).
 *   permissions           top-level `permissions` present and read-only (`{}` or scopes set to read/none); job-level
 *                         `write` only for the (workflow, job, scope) triples in JOB_WRITE_ALLOWLIST; `actions:` (other
 *                         than none) never at workflow level and only on ACTIONS_READ_JOBS (ci.yml fast-lane and
 *                         ci-gate, the proof lookups; RR-8 (ii), D-ARCH-128); `pull-requests:` likewise (PR46-SEC-15).
 *   gh-token              a token reference (`github.token`, `secrets.GITHUB_TOKEN`, GH_TOKEN, GITHUB_TOKEN) appears
 *                         only as the `GH_TOKEN` step env entry of fast-lane's classify step or ci-gate's lane-scope and
 *                         aggregation steps, found by gate position and exact text (RR-8 (i), PR55-SEC-09); never at
 *                         workflow or job level, never in security-integration.
 *   workflow-env          NPM_CONFIG_IGNORE_SCRIPTS="true", CHECKPOINT_DISABLE="1", SCARF_ANALYTICS="false" at workflow level.
 *   forbidden-env         Prisma engine redirects (FORBIDDEN_ENV) and PLAYWRIGHT_*DOWNLOAD_HOST (any case, also as
 *                         npm_config_* / npm_package_config_*; PR46-SEC-02) in any env map or run script.
 *   ignore-scripts        npm_config_ignore_scripts (any case) set to anything but true; any npm invocation that
 *                         re-enables lifecycle scripts or spells ignore-scripts non-canonically (`--ignore-scripts false`,
 *                         `=false`, `--no-ignore-scripts`, `--ig false`, `npm config set ignore-scripts …`), under every
 *                         npm command alias (npm-command.mjs; review M1).
 *   node-options-preload  NODE_OPTIONS with --require/-r/--import/--loader/--experimental-loader/--env-file, or with a
 *                         ${{ }} expression (PR42-SEC-18).
 *   lint-env              a step whose run: is exactly `npm run lint`, in any workflow, sets exactly LINT_ENV (PR42-SEC-18;
 *                         other spellings of the lint script are not matched, PR #55 R1-n2).
 *   tls-verify-disabled   NODE_TLS_REJECT_UNAUTHORIZED=0.
 *   platform-registry     `--@platform:registry=` anywhere but on `npm audit signatures`; any npm_config_@platform:registry env.
 *   audit-signatures-masked  `npm audit signatures … || …`.
 *   continue-on-error     no job or step may set it to anything but false.
 *   npx                   no `npx`/`bunx`/`pnpm dlx`/`yarn dlx`; `npm exec` only as `npm exec --no -- <bin>`.
 *   pr-secrets            pull_request workflows, and the no-release workflows outside a carrier-sandbox job (PR46-SEC-07),
 *                         reference no secret except GITHUB_TOKEN and never `secrets: inherit`; `github.token` is the
 *                         GITHUB_TOKEN reference (RR-8 (iii); gh-token decides where it may appear).
 *   sandbox-secrets       secrets.CARRIER_* / secrets.STRIPE_* only in jobs with `environment: carrier-sandbox`; no
 *                         pull_request/push workflow references that environment (SEC-TC-51).
 *   secrets-dump          no `toJSON(secrets)`.
 *   image-digest          `*_IMAGE` env values, `container`/`services` images and `docker run` images are pinned by digest.
 *   job-timeout           every job (except reusable-workflow calls) sets `timeout-minutes`.
 *   ci-no-release         in ci.yml, lane-c.yml and nightly.yml (NO_RELEASE_WORKFLOWS): no `npm publish`, no
 *                         `terraform apply|destroy` (also through "$TERRAFORM_IMAGE"), no AWS role or deploy, no
 *                         `id-token: write`; image pushes only in ci.yml job `images` gated on dispatch/main/tags.
 *   dispatch-only         lane-c.yml and nightly.yml have exactly one trigger, workflow_dispatch (no schedule; D-ARCH-010).
 *   playwright-install    Playwright browser installs (deps:rebuild --playwright, DEPS_REBUILD_PLAYWRIGHT, playwright
 *                         install; apt via --with-deps on Linux) only in lane-c.yml (PR4-SEC-08 residual).
 *   untrusted-expression  `${{ … }}` inside `run:` or `with.script` only for SAFE_EXPRESSION contexts; everything else
 *                         goes through `env:` (script injection; PR10-SEC-07).
 *   gitleaks-hardening    a step running the gitleaks image passes `--ignore-gitleaks-allow`, `--diff-merges=first-parent`
 *                         and `--network none`, and mounts no workspace path except `.git` (gitleaks auto-loads
 *                         `<source>/.gitleaksignore`; PR10-SEC-01).
 *   scans-isolation       ci.yml job `ci-gate` (with the folded scans) runs no npm, nothing from node_modules or the workspace, no
 *                         local action and no setup-node cache, so no head-controlled code shares their runner or their
 *                         actions: read token (PR10-SEC-02; RR-6).
 *   required-gates        ci.yml keeps every gate step of CI_REQUIRED_GATES_STAGE_2 in its job, unconditional or with its
 *                         listed `if:` and exactly its listed `env:`, with no `shell:`/`working-directory:` on the step
 *                         and no `defaults.run` on the workflow or the gate's job (PR10-SEC-07, PR17-SEC-03); pinned
 *                         steps are exact and pure ASCII (PR33-SEC-01); OASDIFF_IMAGE is the openapi-breaking.mjs pin, set
 *                         at workflow level only (PR33-SEC-03 (i)). stage2Findings (ADR-0023 am. L item 3, D-ARCH-128):
 *                         the tested-base tooling and classify steps, every gate tool as "${GATE_*:?}", ci-gate exactly
 *                         its pinned steps, the jobs' shape, permissions, env, outputs and action inputs, $GITHUB_ENV
 *                         written only by the pinned steps (PR46-SEC-11/-12/-15/-17, PR42-SEC-18, PR55-SEC-01/-02,
 *                         PR59-SEC-01). The stage-1 topology (a `scans` job) is retired (TASK-287 part 287-A, PR55-SEC-10,
 *                         D-TASK286-01a, D-ARCH-140): a ci.yml with a `scans` job is a finding.
 *   gate-env              no `env:` entry named GATE_* or GATES_* anywhere: gate locations come only from the base-ref
 *                         gate-tooling steps through $GITHUB_ENV.
 *   lint-fixture-mode     LINT_FIXTURE_MODE appears nowhere but in the `env:` of ci.yml's base-ref lint fixture step
 *                         (no workflow/job/other-step env, no `run:`/`if:` mention, no $GITHUB_ENV write), so the head
 *                         unit-test run keeps exact semantics (PR2-SEC-08, D-ORCH-018). A tripwire: it finds literal
 *                         mentions, also split by quotes or a line continuation, not names built at run time.
 * Repository mode (no explicit files) also checks:
 *   codeowners-*          `.github/CODEOWNERS` exists and covers REQUIRED_CODEOWNED_PATHS.
 *   gitleaksignore        no `.gitleaksignore` anywhere in the tree (gitleaks would load it from the scanned source;
 *                         PR10-SEC-01). Findings are fixed, not fingerprinted.
 *   swcrc                 no `.swcrc` anywhere in the tree: Jest compiles with the inline options in jest.config.ts
 *                         (`swcrc: false`), so a `.swcrc` is unused at best and an unowned compile redirect at worst
 *                         (PR17-SEC-01).
 *   jest-manual-mocks     no `__mocks__` directory anywhere in the tree and no tracked path with a `node_modules/`
 *                         segment (PR4-SEC-11, PR17-SEC-09).
 * The tree walks skip node_modules, .git and nested checkouts (a directory with its own `.git`, e.g. a git worktree).
 *
 * CLI: node tools/ci/check-workflow-policy.mjs [--root <dir>] [--summary <file>] [--json] [files...]
 * Exit 0 pass, 1 findings, 2 usage/internal error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { npmInvocations, writesIgnoreScriptsConfig } from './npm-command.mjs';
import { OASDIFF_IMAGE } from './openapi-breaking.mjs';
import { YamlSubsetError, deepStrings, isMap, parseYamlSubset } from './yaml-subset.mjs';

/** @typedef {import('./yaml-subset.mjs').YamlNode} YamlNode */
/** @typedef {import('./yaml-subset.mjs').YamlMap} YamlMap */
/** @typedef {{ rule: string, message: string, location: string }} Finding */

/** Engine-redirecting variables (ADR-0023 am. J item 2 (c); superset of tools/deps/prisma-engines.mjs FORBIDDEN_ENGINE_ENV). */
export const FORBIDDEN_ENV = Object.freeze([
  'PRISMA_ENGINES_MIRROR',
  'PRISMA_BINARIES_MIRROR',
  'PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING',
  'BINARY_DOWNLOAD_VERSION',
  'PRISMA_SCHEMA_ENGINE_BINARY',
  'PRISMA_MIGRATION_ENGINE_BINARY',
  'PRISMA_CLI_BINARY_TARGETS',
  'PRISMA_QUERY_ENGINE_LIBRARY',
  'PRISMA_QUERY_ENGINE_BINARY',
  'PRISMA_FMT_BINARY',
]);

/**
 * Variables that make bash, the dynamic loader or Node run or find code before a step's own command (PR55-SEC-01,
 * PR17-SEC-08 item 1): BASH_ENV and ENV are sourced by bash before the script, PATH and NODE_PATH re-point commands and
 * modules, LD_PRELOAD/LD_LIBRARY_PATH/LD_AUDIT inject shared objects, SHELLOPTS/BASHOPTS/PS4/IFS change how the pinned
 * script runs, BASH_FUNC_* export functions that shadow commands. PR #55 code review R2-n1: git and npm read
 * configuration that runs code the same way: GIT_CONFIG_PARAMETERS and GIT_CONFIG_COUNT/KEY_<n>/VALUE_<n> (core.pager,
 * core.fsmonitor, diff.external), GIT_EXTERNAL_DIFF, HOME and XDG_CONFIG_HOME (where ~/.gitconfig and ~/.npmrc are
 * found), and npm's script-shell, userconfig, globalconfig and node-options settings. Refused at workflow, job, step,
 * container and service level in every workflow (case-insensitive, fail closed). The gitleaks `docker run -e
 * GIT_CONFIG_*` arguments are container arguments, not an env map, so they are unaffected.
 */
export const PRELOAD_ENV = Object.freeze([
  'BASH_ENV',
  'ENV',
  'PATH',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'SHELLOPTS',
  'BASHOPTS',
  'PS4',
  'IFS',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_EXTERNAL_DIFF',
  'HOME',
  'XDG_CONFIG_HOME',
  'NPM_CONFIG_SCRIPT_SHELL',
  'NPM_CONFIG_USERCONFIG',
  'NPM_CONFIG_GLOBALCONFIG',
  'NPM_CONFIG_NODE_OPTIONS',
]);
const PRELOAD_ENV_PREFIX = /^(?:BASH_FUNC_|GIT_CONFIG_(?:KEY|VALUE)_\d+$)/iu;

/**
 * Playwright browser download redirects (PR4-SEC-08; PR46-SEC-02, code review PR #46 m3): PLAYWRIGHT_DOWNLOAD_HOST and
 * the per-browser variants, in any case, also through npm's channels (Playwright's getFromENV falls back to
 * npm_config_<name> from .npmrc and npm_package_config_<name> from package.json "config").
 */
export const PLAYWRIGHT_HOST = /^(?:npm_config_|npm_package_config_)?playwright_(?:[a-z]+_)?download_host$/iu;

export const REQUIRED_WORKFLOW_ENV = Object.freeze({
  NPM_CONFIG_IGNORE_SCRIPTS: 'true',
  CHECKPOINT_DISABLE: '1',
  SCARF_ANALYTICS: 'false',
});

/**
 * Job-level `write` grants that are allowed, as `<workflow file>:<job id>:<scope>`. ADR-0023 am. F item 4: `images` is the
 * only ci.yml job holding `packages: write`. Owning tasks extend this list in a reviewed change (CODEOWNERS on tools/ci).
 */
export const JOB_WRITE_ALLOWLIST = Object.freeze(['ci.yml:images:packages']);

/**
 * Dispatch-only workflows (D-ARCH-010 items 3 and 4; ADR-0023 am. C; TASK-015 part 015-B): lane C and nightly run only
 * on `workflow_dispatch` (no schedule, no push or PR trigger), so hosted minutes are spent only when an agent decides.
 */
export const DISPATCH_ONLY_WORKFLOWS = Object.freeze(['lane-c.yml', 'nightly.yml']);
/** Workflows that build and test but never release (AT-US-005-04/-05): no publish, push, apply, AWS role or OIDC token. */
export const NO_RELEASE_WORKFLOWS = Object.freeze(['ci.yml', 'ci.yaml', ...DISPATCH_ONLY_WORKFLOWS]);
/**
 * The only workflow that may install Playwright browsers (`deps:rebuild --playwright=…`, DEPS_REBUILD_PLAYWRIGHT,
 * `playwright install`), which on Linux also runs apt through `--with-deps` (PR4-SEC-08 residual, COND-E2E-FF).
 */
export const PLAYWRIGHT_INSTALL_WORKFLOWS = Object.freeze(['lane-c.yml']);
const PLAYWRIGHT_INSTALL = /--playwright(?:=|\s)|\bDEPS_REBUILD_PLAYWRIGHT\b|\bplaywright\s+install\b/u;

/** Triggers that run with a write token and secrets, or are driven by comments/reviews (PR10-SEC-07). */
export const FORBIDDEN_TRIGGERS = Object.freeze([
  'pull_request_target',
  'workflow_run',
  'issue_comment',
  'pull_request_review',
  'pull_request_review_comment',
  'discussion',
  'discussion_comment',
]);

/**
 * `${{ … }}` contexts allowed inside `run:` / `with.script` (PR10-SEC-07): values no PR author, branch name, title,
 * body or comment controls. Everything else (`github.event.*`, `github.head_ref`, `github.ref`/`ref_name` (branch
 * names), `inputs.*`, `secrets.*`, functions, operators) must go through `env:`.
 */
export const SAFE_EXPRESSION =
  /^(?:github\.(?:sha|repository|repository_id|repository_owner|run_id|run_number|run_attempt|workflow|event_name|job|action|server_url|api_url|workspace)|runner\.[A-Za-z_]+|steps\.[A-Za-z_][\w-]*\.(?:outputs\.[A-Za-z_][\w-]*|outcome|conclusion)|needs\.[A-Za-z_][\w-]*\.(?:outputs\.[A-Za-z_][\w-]*|result)|matrix\.[A-Za-z_][\w.-]*|env\.[A-Za-z_]\w*|vars\.[A-Za-z_]\w*)$/;

/** The variable that selects the lint fixture suite's mode (tools/lint/fixture-expectations.mjs; D-ORCH-018). */
export const LINT_FIXTURE_MODE_ENV = 'LINT_FIXTURE_MODE';

/**
 * The commands of the base-ref lint fixture step (PR2-SEC-08, D-ORCH-018; PR17-SEC-03, review m1): an allow-list, not a
 * deny-list of Jest flags. The step takes the suite, fixtures, harness, modes and Jest config from the base ref, runs
 * exactly that suite (`--runTestsByPath`) under exactly that config, restores the head copies and exits with Jest's
 * status. Any other command, flag or spelling (`--test-name-pattern`, `-tX`, `--listTests`, `|| true`, `exit 0`, a
 * checkout of head files before Jest, …) means the step is no longer the gate. Changing the step is a two-step change:
 * this list on main first, because the gate tooling runs from the base ref.
 */
export const BASE_LINT_FIXTURES_SCRIPT = Object.freeze([
  'set -euo pipefail',
  'suite=tools/lint/negative-fixtures.test.ts',
  'config=tools/lint/jest.base-fixtures.config.json',
  'if ! git cat-file -e "$RANGE_BASE:$suite" 2>/dev/null; then',
  '  echo "Base ref has no $suite; the head copy already ran in the unit tests." >> "$GITHUB_STEP_SUMMARY"',
  '  exit 0',
  'fi',
  'base_paths=("$suite" tests/fixtures/lint)',
  'rm -rf tests/fixtures/lint',
  'for path in tools/lint/lint-fixtures.mjs tools/lint/fixture-expectations.mjs "$config" tools/test-support; do',
  '  if git cat-file -e "$RANGE_BASE:$path" 2>/dev/null; then',
  '    rm -rf "$path"',
  '    base_paths+=("$path")',
  '  fi',
  'done',
  'git checkout "$RANGE_BASE" -- "${base_paths[@]}"',
  'status=0',
  'node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js \\',
  '  --config "$config" --runTestsByPath "$suite" || status=$?',
  'rm -rf tests/fixtures/lint tools/test-support',
  'git checkout HEAD -- "$suite" tests/fixtures/lint tools/test-support tools/lint/lint-fixtures.mjs \\',
  '  tools/lint/fixture-expectations.mjs "$config"',
  'echo "Base-ref lint negative fixtures (no-weakening subset): exit $status" >> "$GITHUB_STEP_SUMMARY"',
  'exit "$status"',
]);

/**
 * The command lines of a `run:` script as the pinned comparison sees them: trailing blanks trimmed, blank and
 * comment-only lines dropped, except after a line continuation (where bash would join them to the command). Blank means
 * ASCII space or tab only, as bash splits words: JavaScript `\s` would also take U+00A0, and bash runs a line that
 * starts with U+00A0 plus `#` as a command (PR33-SEC-01). Pinned scripts are pure ASCII anyway (NON_ASCII).
 * @param {string} script
 * @returns {string[]}
 */
export function commandLines(script) {
  /** @type {string[]} */
  const out = [];
  for (const raw of script.split(/\r?\n/u)) {
    const line = raw.replace(/[ \t]+$/u, '');
    const continued = (out.at(-1) ?? '').endsWith('\\');
    if (!continued && /^[ \t]*(?:#|$)/u.test(line)) continue;
    out.push(line);
  }
  return out;
}

/** Any character a pinned `run:` block must not contain: everything but printable ASCII, tab and line breaks. */
export const NON_ASCII = /[^\t\n\r\x20-\x7e]/u;

/**
 * The problem a non-ASCII character in a pinned `run:` block is (PR33-SEC-01), or null.
 * @param {string} script
 * @returns {string | null}
 */
export function nonAsciiProblem(script) {
  const match = NON_ASCII.exec(script);
  if (match === null) return null;
  const code = (match[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
  return `non-ASCII character U+${code} in a pinned run: (pinned scripts are pure ASCII; PR33-SEC-01)`;
}

/** The porcelain gates' exact `run:` (post-lint and post-build; PR4-SEC-13 item 1, PR #33 R1-m2). */
export const PORCELAIN_RUN = 'node "$GATE_CHECK_PORCELAIN" --root "$GITHUB_WORKSPACE" --summary "$GITHUB_STEP_SUMMARY"';
/** The openapi-breaking gate's exact `run:` (NFR-MAINT-004; PR #33 R1-m2, PR33-SEC-03 (i)). */
export const OPENAPI_BREAKING_RUN =
  'node "$GATE_OPENAPI_BREAKING" --root "$GITHUB_WORKSPACE" --base "$RANGE_BASE" --head "$RANGE_HEAD" --image "$OASDIFF_IMAGE" --summary "$GITHUB_STEP_SUMMARY"';

/**
 * A `problems` check holding a single-command gate to exactly one ASCII command line: no `|| true`, `; true`,
 * `>/dev/null`, prefix, extra line or changed argument (PR #33 R1-m2).
 * @param {string} expected
 * @returns {(script: string) => string[]}
 */
export function exactRunProblems(expected) {
  return (script) => {
    /** @type {string[]} */
    const out = [];
    const ascii = nonAsciiProblem(script);
    if (ascii !== null) out.push(ascii);
    const lines = commandLines(script);
    if (lines.length !== 1 || lines[0] !== expected) out.push(`the run: must be exactly \`${expected}\``);
    return out;
  };
}

export const CI_TRIGGERS = Object.freeze(['pull_request', 'push']);

/**
 * Why a lane B evidence `run:` differs from LANE_B_EVIDENCE_SCRIPT, naming the probe it trips (one message each).
 * @param {string} script
 * @param {readonly string[]} [expected] the pinned script (stage 2: LANE_B_EVIDENCE_SCRIPT_TESTED_BASE)
 * @returns {string[]}
 */
export function laneBEvidenceProblems(script, expected = LANE_B_EVIDENCE_SCRIPT_TESTED_BASE) {
  const lines = commandLines(script);
  /** @type {string[]} */
  const out = [];
  const ascii = nonAsciiProblem(script);
  if (ascii !== null) out.push(ascii);
  if (/--report-only\b/u.test(script)) out.push('--report-only is refused: the base ref has the verifier (R2-n3)');
  if (/\$quality\/head\b|"\$RANGE_HEAD" tools\/quality/u.test(script))
    out.push('the head-copy bootstrap branch is refused: only the base copy of tools/quality runs');
  for (const match of script.matchAll(/--event(?:=|\s+)(\S+)/gu))
    if (match[1] !== '"$GITHUB_EVENT_NAME"') out.push(`--event must be "$GITHUB_EVENT_NAME" (found ${match[1] ?? ''})`);
  if (/\bGITHUB_EVENT_NAME\+?=|\b(?:export|declare|typeset|readonly|local|read|unset)\b[^\n]*\bGITHUB_EVENT_NAME\b/u.test(script))
    out.push('GITHUB_EVENT_NAME must not be assigned, exported, read or unset in the step');
  if (/--profile(?:=|\s+)["']?(?:wave|gate)\b/u.test(script)) out.push('--profile wave|gate is not a lane A run');
  if (lines.length !== expected.length || lines.some((line, index) => line !== expected[index])) {
    const index = expected.findIndex((line, i) => lines[i] !== line);
    out.push(
      `the run: must be exactly ${expected === LANE_B_EVIDENCE_SCRIPT_TESTED_BASE ? 'LANE_B_EVIDENCE_SCRIPT_TESTED_BASE' : 'the pinned evidence script'} (first difference at command line ${String((index === -1 ? expected.length : index) + 1)})`,
    );
  }
  return out;
}

/** Matches a `run:` that runs the base-ref verifier (the step is then held to LANE_B_EVIDENCE_SCRIPT). */
const LANE_B_EVIDENCE_RUN = /tools\/quality\/check-evidence\.mjs/u;

/**
 * A `problems` check holding a multi-line `run:` to exactly `expected` (command lines, pure ASCII; PR17-SEC-03 style).
 * @param {readonly string[]} expected
 * @returns {(script: string) => string[]}
 */
export function pinnedScriptProblems(expected) {
  return (script) => {
    /** @type {string[]} */
    const out = [];
    const ascii = nonAsciiProblem(script);
    if (ascii !== null) out.push(ascii);
    const lines = commandLines(script);
    if (lines.length !== expected.length || lines.some((line, index) => line !== expected[index])) {
      const index = expected.findIndex((line, i) => lines[i] !== line);
      out.push(
        `the run: must be exactly the pinned script (first difference at command line ${String((index === -1 ? expected.length : index) + 1)})`,
      );
    }
    return out;
  };
}

/*
 * ADR-0023 amendment L (D-ARCH-126/127/128; ruling rulings/wave-0-ci-minutes.md section 4 RR-4..RR-8; PR46-SEC-01/-03/
 * -11/-12/-15/-17; TASK-286) as amended by am. N items 3-5 (D-ARCH-140; TASK-287 part 287-A): ci.yml has one job
 * topology, the folded stage 2 (fast-lane, security-integration, ci-gate). The stage-1 topology (a `scans` job) is
 * retired (PR #55 R1-m2, PR55-SEC-10, D-TASK286-01a): a ci.yml that restores a `scans` job is a required-gates finding,
 * so no PR can bring back CODE-gated signatures and audit or the pattern-pinned stage-1 scans.
 */
/** ci-gate's lane-scope step env (RR-4): GH_TOKEN, RANGE_BEFORE and HEAD_REF, nothing else. */
export const LANE_SCOPE_ENV = Object.freeze({
  GH_TOKEN: '${{ github.token }}',
  RANGE_BEFORE: '${{ github.event.before }}',
  // R2-M1 / PR46-SEC-13: proofs are bound to this PR's head branch (an env value, never interpolated into run:).
  HEAD_REF: '${{ github.head_ref }}',
});
/**
 * R2-M1 / PR46-SEC-13 (D-ORCH-090): lane A runs for pull requests into main only, so no ci.yml run against another base
 * exists to be adopted as a proof (lane-scope.mjs PROOF_BASE_REF binds the lookup as well).
 */
export const CI_PULL_REQUEST_BRANCHES = Object.freeze(['main']);
/** The id of ci-gate's lane-scope step (its outputs gate Semgrep/oasdiff and feed the aggregation). */
export const LANE_SCOPE_STEP_ID = 'lane-scope';
/** ci-gate's job env: the range and event inputs its pinned commands read. */
const RANGE_JOB_ENV = Object.freeze({
  RANGE_BASE: '${{ github.event.pull_request.base.sha || github.event.before }}',
  RANGE_HEAD: '${{ github.event.pull_request.head.sha || github.sha }}',
  EVENT: '${{ github.event_name }}',
  PR_NUMBER: '${{ github.event.pull_request.number }}',
});
/**
 * The security-integration suites step template (manifests from the base, no head-copy branch, no extra flag such as
 * --dry-run); SECURITY_INTEGRATION_SCRIPT_TESTED_BASE is the pinned form, reading the tested base (PR46-SEC-17).
 */
export const SECURITY_INTEGRATION_SCRIPT = Object.freeze([
  'set -euo pipefail',
  'manifests="$RUNNER_TEMP/security-manifests"',
  'mkdir -p "$manifests"',
  'for name in required-suites suite-runners; do',
  '  if [ -z "$RANGE_BASE" ] || ! git cat-file -e "$RANGE_BASE:tools/quality/$name.json" 2>/dev/null; then',
  '    echo "::error title=security-integration::the base ref has no tools/quality/$name.json (fail closed; the head copy is never used)"',
  '    exit 1',
  '  fi',
  '  git show "$RANGE_BASE:tools/quality/$name.json" > "$manifests/$name.json"',
  'done',
  'node tools/ci/security-integration.mjs --root "$GITHUB_WORKSPACE" --manifest "$manifests/required-suites.json" --runners "$manifests/suite-runners.json" --out "$RUNNER_TEMP/security-integration" --summary "$GITHUB_STEP_SUMMARY"',
]);
export const CI_GATE_IF = "${{ !cancelled() && (github.event_name == 'pull_request' || vars.CI_MAIN_FAST_LANE == 'true') }}";
/** RR-7: pull-request runs queue per PR; a running full run is never cancelled (its proof serves a later docs push). */
export const CI_CONCURRENCY = Object.freeze({
  group: '${{ github.event.pull_request.number || github.sha }}',
  'cancel-in-progress': 'false',
});
/** Jobs that may hold `actions:` (read), as `<workflow file>:<job id>`: the two proof lookups (RR-8 (ii), D-ARCH-128). */
export const ACTIONS_READ_JOBS = Object.freeze(['ci.yml:fast-lane', 'ci.yml:ci-gate']);
/** PR46-SEC-15: jobs that may hold `pull-requests:` (read): the same two lookups (the proof binding). */
export const PULL_REQUESTS_READ_JOBS = Object.freeze(['ci.yml:fast-lane', 'ci.yml:ci-gate']);
/**
 * RR-8 (i) `gh-token`: the jobs with token steps; within them only the pinned classify, lane-scope and aggregation
 * steps (tokenFindings; PR55-SEC-09).
 */
export const TOKEN_JOBS = Object.freeze(['fast-lane', 'ci-gate']);
/** The retired stage-1 job (PR55-SEC-10): its presence in ci.yml is a required-gates finding. */
export const RETIRED_SCANS_JOB = 'scans';

/**
 * PR46-SEC-17: the tested base. On pull requests TOOLS_REF = HEAD^1, the first parent of GitHub's test merge (the
 * current main), with HEAD^2 = the PR head and RANGE_BASE an ancestor (else fail closed); on a push the pushed range's
 * base. The same lines open both tooling steps.
 */
export const TESTED_BASE_SCRIPT = Object.freeze([
  'tools_ref=""',
  'if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then',
  '  tools_ref=$(git rev-parse --verify --quiet "HEAD^1^{commit}" || true)',
  '  merged=$(git rev-parse --verify --quiet "HEAD^2^{commit}" || true)',
  '  if [ -z "$tools_ref" ] || [ "$merged" != "$RANGE_HEAD" ] || ! git merge-base --is-ancestor "$RANGE_BASE" "$tools_ref"; then',
  '    echo "::error title=Tested base::the checkout is not the test merge of the PR head into a descendant of its base (fail closed, PR46-SEC-17)"',
  '    exit 1',
  '  fi',
  'elif [ -n "$RANGE_BASE" ] && [ "$RANGE_BASE" != "0000000000000000000000000000000000000000" ] && git cat-file -e "$RANGE_BASE^{commit}" 2>/dev/null; then',
  '  tools_ref="$RANGE_BASE"',
  'fi',
]);
/**
 * PR59-SEC-01 item 2 (TASK-287, policy first): the checkout must be GITHUB_SHA, the commit the event names, so no
 * checkout input can make HEAD^1 a tested base of the PR's choosing. V2 = these lines, then TESTED_BASE_SCRIPT. The
 * policy accepts V1 and V2 while ci.yml moves (the next TASK-287 PR switches ci.yml to V2 and drops V1).
 */
export const CHECKOUT_IS_EVENT_SHA = Object.freeze([
  'if [ "$(git rev-parse HEAD)" != "$GITHUB_SHA" ]; then',
  '  echo "::error title=Tested base::the checkout is not the event commit GITHUB_SHA (fail closed, PR59-SEC-01)"',
  '  exit 1',
  'fi',
]);
/** fast-lane's tooling step (PR46-SEC-12, PR33-SEC-09): every GATE_* and TOOLS_REF come from here, before any head code. */
export const FAST_LANE_TOOLING_SCRIPT = Object.freeze([
  'set -euo pipefail',
  ...TESTED_BASE_SCRIPT,
  'base_dir="$RUNNER_TEMP/base"',
  'head_dir="$RUNNER_TEMP/head"',
  'mkdir -p "$base_dir" "$head_dir"',
  'for path in tools/ci .github/CODEOWNERS; do',
  '  if [ -n "$tools_ref" ] && git cat-file -e "$tools_ref:$path" 2>/dev/null; then',
  '    git archive "$tools_ref" "$path" | tar -x -C "$base_dir"',
  '  fi',
  'done',
  'if git cat-file -e "$RANGE_HEAD:tools/ci" 2>/dev/null; then',
  '  git archive "$RANGE_HEAD" tools/ci | tar -x -C "$head_dir"',
  'fi',
  '{',
  '  echo "## Lane A (fast lane)"',
  '  echo',
  '  echo "Range \\`${RANGE_BASE:0:7}..${RANGE_HEAD:0:7}\\`, tested base \\`${tools_ref:0:7}\\`."',
  '  echo',
  '  echo "| Gate tool | Runs from |"',
  '  echo "|---|---|"',
  '} >> "$GITHUB_STEP_SUMMARY"',
  'for tool in check-workflow-policy check-install-flags check-migration-immutability check-lockfile check-dep-age licence-check check-audit check-porcelain lane-scope; do',
  '  var="GATE_$(echo "$tool" | tr \'a-z-\' \'A-Z_\')"',
  '  if [ -f "$base_dir/tools/ci/$tool.mjs" ]; then',
  '    echo "$var=$base_dir/tools/ci/$tool.mjs" >> "$GITHUB_ENV"',
  '    echo "| \\`$tool\\` | tested base |" >> "$GITHUB_STEP_SUMMARY"',
  '  else',
  '    echo "$var=$head_dir/tools/ci/$tool.mjs" >> "$GITHUB_ENV"',
  '    echo "| \\`$tool\\` | head (bootstrap: not on the tested base yet) |" >> "$GITHUB_STEP_SUMMARY"',
  '  fi',
  'done',
  'echo "TOOLS_REF=$tools_ref" >> "$GITHUB_ENV"',
]);
/** ci-gate's tooling step (the folded scans' inputs plus lane-scope; PR46-SEC-12 item 1). */
export const CI_GATE_TOOLING_SCRIPT_TESTED_BASE = Object.freeze([
  'set -euo pipefail',
  'gates="$RUNNER_TEMP/gates"',
  'mkdir -p "$gates/base" "$gates/head"',
  ...TESTED_BASE_SCRIPT,
  '{',
  '  echo "## Lane A (ci-gate)"',
  '  echo',
  '  echo "Tested base \\`${tools_ref:0:7}\\`."',
  '  echo',
  '  echo "| Gate input | From |"',
  '  echo "|---|---|"',
  '} >> "$GITHUB_STEP_SUMMARY"',
  'for path in tools/ci .semgrep .gitleaks.toml .semgrepignore .gitignore; do',
  '  if [ -n "$tools_ref" ] && git cat-file -e "$tools_ref:$path" 2>/dev/null; then',
  '    git archive "$tools_ref" "$path" | tar -x -C "$gates/base"',
  '    echo "| \\`$path\\` | tested base |" >> "$GITHUB_STEP_SUMMARY"',
  '  elif git cat-file -e "$RANGE_HEAD:$path" 2>/dev/null; then',
  '    git archive "$RANGE_HEAD" "$path" | tar -x -C "$gates/base"',
  '    echo "| \\`$path\\` | head (bootstrap: not on the tested base yet) |" >> "$GITHUB_STEP_SUMMARY"',
  '  fi',
  'done',
  'if [ -n "$tools_ref" ] && git cat-file -e "$tools_ref:tools/ci/check-security-owned-paths.mjs" 2>/dev/null; then',
  '  echo "RECORD_MODE=enforce" >> "$GITHUB_ENV"',
  'else',
  '  echo "RECORD_MODE=report-only" >> "$GITHUB_ENV"',
  'fi',
  'echo "GATES_DIR=$gates/base" >> "$GITHUB_ENV"',
  'for tool in run-semgrep check-security-owned-paths openapi-breaking lane-scope; do',
  '  var="GATE_$(echo "$tool" | tr \'a-z-\' \'A-Z_\')"',
  '  if [ -f "$gates/base/tools/ci/$tool.mjs" ]; then',
  '    echo "$var=$gates/base/tools/ci/$tool.mjs" >> "$GITHUB_ENV"',
  '  else',
  '    [ -d "$gates/head/tools/ci" ] || git archive "$RANGE_HEAD" tools/ci | tar -x -C "$gates/head"',
  '    echo "$var=$gates/head/tools/ci/$tool.mjs" >> "$GITHUB_ENV"',
  '    echo "| \\`tools/ci/$tool.mjs\\` | head (bootstrap: not on the tested base yet) |" >> "$GITHUB_STEP_SUMMARY"',
  '  fi',
  'done',
  'echo "TOOLS_REF=$tools_ref" >> "$GITHUB_ENV"',
]);
/**
 * The two tooling scripts with CHECKOUT_IS_EVENT_SHA in front of the tested-base lines (PR59-SEC-01 item 2, V2).
 * @param {readonly string[]} script
 */
const withEventShaCheck = (script) => {
  const at = script.indexOf(TESTED_BASE_SCRIPT[0] ?? '');
  return Object.freeze([...script.slice(0, at), ...CHECKOUT_IS_EVENT_SHA, ...script.slice(at)]);
};
export const FAST_LANE_TOOLING_SCRIPT_V2 = withEventShaCheck(FAST_LANE_TOOLING_SCRIPT);
export const CI_GATE_TOOLING_SCRIPT_TESTED_BASE_V2 = withEventShaCheck(CI_GATE_TOOLING_SCRIPT_TESTED_BASE);

/**
 * PR59-SEC-01 item 1 (TASK-287): the `with:` inputs of every action step of the stage-2 jobs, exactly. A `ref:` or
 * `repository:` would let a ci.yml PR choose the tree, and so the tested base, that judges it; `persist-credentials`,
 * `submodules`, `path`, `fetch-depth` and the cache inputs change what the pinned steps read. Keyed by job, then
 * by action (owner/name).
 */
const CHECKOUT_WITH = Object.freeze({ 'fetch-depth': '0', 'persist-credentials': 'false' });
const SETUP_NODE_LOCKED_WITH = Object.freeze({
  'node-version-file': '.node-version',
  cache: 'npm',
  'cache-dependency-path': 'package-lock.json',
});
const ENGINE_CACHE_WITH = Object.freeze({
  path: 'node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x',
  key: 'prisma-engines-${{ runner.os }}-${{ steps.engines.outputs.version }}',
});
/**
 * PR62-SEC-01 (TASK-287 part 287-C1, policy first): the exact commit of each action the three stage-2 jobs use, each
 * verified against its upstream release tag (checkout v7.0.1, setup-node v7.1.0, cache v6.1.0; GitHub API, 2026-11-19).
 * Any other 40-hex commit (a fork-network commit resolves under the upstream name) is a finding. A version bump is a
 * reviewed change of this table first, then of ci.yml (policy first).
 */
export const STAGE_2_ACTION_COMMITS = Object.freeze({
  'actions/checkout': '3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/setup-node': '949feb2413d6458794dcd2491c4babbbce0c15c1',
  'actions/cache': '55cc8345863c7cc4c66a329aec7e433d2d1c52a9',
});
/**
 * PR62-SEC-01: the keys an action step of a stage-2 job may have, exactly `{name, uses, with}` (no `env:`, `id:`,
 * `continue-on-error:`, `timeout-minutes:`, `shell:` or `working-directory:`), and `if:` only where ci.yml needs it:
 * fast-lane's engine cache is CODE-gated with exactly this condition.
 */
export const STAGE_2_ACTION_STEP_KEYS = Object.freeze(['name', 'uses', 'with']);
export const STAGE_2_ACTION_STEP_IFS = Object.freeze({ 'fast-lane:actions/cache': "env.CODE == 'true'" });
/**
 * PR287B-SEC-02: the exact key set and runner of the three stage-2 jobs (an allow-list replaces the deny-list of
 * `defaults`/`container`/`services`/`strategy`/`continue-on-error`, so `environment:`, `concurrency:` at job level
 * and any later GitHub key are findings too); `runs-on` is exactly the hosted `ubuntu-24.04` label (no self-hosted
 * runner can keep state between a head-code job and ci-gate).
 */
export const STAGE_2_JOB_KEYS = Object.freeze({
  'fast-lane': Object.freeze(['name', 'if', 'runs-on', 'timeout-minutes', 'permissions', 'outputs', 'env', 'steps']),
  'security-integration': Object.freeze(['name', 'needs', 'if', 'runs-on', 'timeout-minutes', 'permissions', 'env', 'steps']),
  'ci-gate': Object.freeze(['name', 'if', 'needs', 'runs-on', 'timeout-minutes', 'permissions', 'env', 'steps']),
});
export const STAGE_2_RUNS_ON = 'ubuntu-24.04';
/**
 * D-SEC-PR57-02 / D-TASK287A-03 (TASK-287 part 287-C1): TASK-288's test locks live under this directory; a CI cache that
 * would restore it must exclude it (a restored stale lock would make a suite wait or take over a lock it does not own).
 */
export const TEST_LOCKS_DIR = 'node_modules/.cache/shipqube-test-locks';
export const STAGE_2_ACTION_INPUTS = Object.freeze({
  'fast-lane': Object.freeze({
    'actions/checkout': CHECKOUT_WITH,
    'actions/setup-node': SETUP_NODE_LOCKED_WITH,
    'actions/cache': ENGINE_CACHE_WITH,
  }),
  'security-integration': Object.freeze({
    'actions/checkout': CHECKOUT_WITH,
    'actions/setup-node': SETUP_NODE_LOCKED_WITH,
    'actions/cache': ENGINE_CACHE_WITH,
  }),
  'ci-gate': Object.freeze({ 'actions/checkout': CHECKOUT_WITH, 'actions/setup-node': Object.freeze({ 'node-version': '24' }) }),
});
/** fast-lane's classify step (D-ARCH-128): the lane scope with the proof lookup, before any head code; exact. */
export const CLASSIFY_RUN =
  'node "${GATE_LANE_SCOPE:?}" --root "$GITHUB_WORKSPACE" --base "$RANGE_BASE" --head "$RANGE_HEAD" --before "$RANGE_BEFORE" --event "$GITHUB_EVENT_NAME" --pr "$PR_NUMBER" --head-ref "$HEAD_REF" --tools-ref "$TOOLS_REF" --lookup --env "$GITHUB_ENV" --output "$GITHUB_OUTPUT" --summary "$GITHUB_STEP_SUMMARY"';
export const CLASSIFY_ENV = Object.freeze({
  GH_TOKEN: '${{ github.token }}',
  RANGE_BEFORE: '${{ github.event.before }}',
  HEAD_REF: '${{ github.head_ref }}',
  PR_NUMBER: '${{ github.event.pull_request.number }}',
});
export const CLASSIFY_STEP_ID = 'classify';
/** ci-gate's lane-scope step (PR46-SEC-12 item 3: the proofs re-read under the binding, in the no-head-code job). */
export const LANE_SCOPE_RUN_TESTED_BASE =
  'node "${GATE_LANE_SCOPE:?}" --root "$GITHUB_WORKSPACE" --base "$RANGE_BASE" --head "$RANGE_HEAD" --before "$RANGE_BEFORE" --event "$EVENT" --pr "$PR_NUMBER" --head-ref "$HEAD_REF" --tools-ref "$TOOLS_REF" --lookup --output "$GITHUB_OUTPUT" --summary "$GITHUB_STEP_SUMMARY"';
/** ci-gate's aggregation in stage 2: its own classification against fast-lane's (rule (g)). */
export const CI_GATE_RUN_TESTED_BASE = 'node "${GATE_LANE_SCOPE:?}" --gate --root "$GITHUB_WORKSPACE" --summary "$GITHUB_STEP_SUMMARY"';
/**
 * PR55-SEC-05: fast-lane's separate outputs that steer security-integration, passed into the aggregation so the gate
 * compares each with its own classification (lane-scope FAST_LANE_OUTPUT_ENV); required since TASK-287 part 287-B
 * (PR62-SEC-02).
 */
export const CI_GATE_ENV_FAST_LANE_OUTPUTS = Object.freeze({
  FAST_LANE_MODE: '${{ needs.fast-lane.outputs.mode }}',
  FAST_LANE_CODE_PROOF: '${{ needs.fast-lane.outputs.code_proof }}',
  FAST_LANE_SECURITY_INTEGRATION_DUE: '${{ needs.fast-lane.outputs.security_integration_due }}',
  FAST_LANE_TOOLS_REF: '${{ needs.fast-lane.outputs.tools_ref }}',
});
export const CI_GATE_ENV_TESTED_BASE = Object.freeze({
  GH_TOKEN: '${{ github.token }}',
  FAST_LANE: '${{ needs.fast-lane.result }}',
  FAST_LANE_CLASSIFICATION: '${{ needs.fast-lane.outputs.classification }}',
  SECURITY_INTEGRATION: '${{ needs.security-integration.result }}',
  CLASSIFICATION: `\${{ steps.${LANE_SCOPE_STEP_ID}.outputs.classification }}`,
  ...CI_GATE_ENV_FAST_LANE_OUTPUTS,
});
/**
 * The lane B evidence step (PR23-SEC-06 as amended by D-SEC-PR23-02 (2); D-ORCH-032 (1); PR #23 code review R2-n3;
 * PR46-SEC-17), as command lines, pinned exactly: the verifier, its lib and the manifest come only from the tested base;
 * the event is always `"$GITHUB_EVENT_NAME"` (never a literal, never re-assigned); there is no head-copy bootstrap and
 * no `--report-only`; a missing base fails closed on every event but push (where the verifier skips itself anyway).
 */
export const LANE_B_EVIDENCE_SCRIPT_TESTED_BASE = Object.freeze([
  'set -euo pipefail',
  'quality="$RUNNER_TEMP/quality"',
  'mkdir -p "$quality/base"',
  'if [ -z "$RANGE_BASE" ] || [ "$RANGE_BASE" = "0000000000000000000000000000000000000000" ] || ! git cat-file -e "$RANGE_BASE^{commit}" 2>/dev/null; then',
  '  if [ "$GITHUB_EVENT_NAME" = "push" ]; then',
  '    echo "### Lane B evidence (quality:check-evidence): not run, the pushed range has no base commit (push skips the check)" >> "$GITHUB_STEP_SUMMARY"',
  '    exit 0',
  '  fi',
  '  echo "::error title=Lane B evidence::the range has no base commit; the verifier runs only from the tested base (fail closed, PR23-SEC-06)"',
  '  exit 1',
  'fi',
  'if [ -z "$TOOLS_REF" ] || ! git cat-file -e "$TOOLS_REF:tools/quality/check-evidence.mjs" 2>/dev/null; then',
  '  echo "::error title=Lane B evidence::the tested base has no tools/quality/check-evidence.mjs (fail closed, PR46-SEC-17); the head copy is never trusted."',
  '  echo "### Lane B evidence (quality:check-evidence): FAIL, the tested base has no verifier" >> "$GITHUB_STEP_SUMMARY"',
  '  exit 1',
  'fi',
  'git archive "$TOOLS_REF" tools/quality | tar -x -C "$quality/base"',
  'node "$quality/base/tools/quality/check-evidence.mjs" --root "$GITHUB_WORKSPACE" --base "$RANGE_BASE" --head "$RANGE_HEAD" --event "$GITHUB_EVENT_NAME" --summary "$GITHUB_STEP_SUMMARY"',
]);
/** TOOLS_REF in a step env: the classify step's output, which no later step of the job can rewrite. */
export const TOOLS_REF_FROM_CLASSIFY = `\${{ steps.${CLASSIFY_STEP_ID}.outputs.tools_ref }}`;
/** The base-ref lint fixture step from the tested base (PR46-SEC-17; otherwise BASE_LINT_FIXTURES_SCRIPT). */
export const BASE_LINT_FIXTURES_SCRIPT_TESTED_BASE = Object.freeze(
  BASE_LINT_FIXTURES_SCRIPT.map((line) =>
    line
      .replaceAll('"$RANGE_BASE', '"$TOOLS_REF')
      .replace('Base ref has no $suite', 'Tested base has no $suite')
      .replace('Base-ref lint negative fixtures', 'Tested-base lint negative fixtures'),
  ),
);
/** security-integration's suites step from the tested base (PR46-SEC-17; otherwise SECURITY_INTEGRATION_SCRIPT). */
export const SECURITY_INTEGRATION_SCRIPT_TESTED_BASE = Object.freeze(
  SECURITY_INTEGRATION_SCRIPT.map((line) =>
    line.replaceAll('$RANGE_BASE', '$TOOLS_REF').replace('the base ref has no tools/quality', 'the tested base has no tools/quality'),
  ),
);
export const SECURITY_INTEGRATION_IF_STAGE_2 =
  "${{ !cancelled() && github.event_name == 'pull_request' && needs.fast-lane.result == 'success' && needs.fast-lane.outputs.security_integration_due == 'true' && (needs.fast-lane.outputs.mode == 'full' || needs.fast-lane.outputs.code_proof != '') }}";
export const SECURITY_INTEGRATION_NEEDS_STAGE_2 = Object.freeze(['fast-lane']);
export const CI_GATE_NEEDS_STAGE_2 = Object.freeze(['fast-lane', 'security-integration']);
/** fast-lane's outputs in stage 2: the classify step's (security-integration's if: and manifests, ci-gate's compare). */
export const FAST_LANE_OUTPUTS_STAGE_2 = Object.freeze(
  Object.fromEntries(
    ['mode', 'code_proof', 'security_integration_due', 'tools_ref', 'classification'].map((key) => [
      key,
      `\${{ steps.${CLASSIFY_STEP_ID}.outputs.${key} }}`,
    ]),
  ),
);
export const PINNED_JOB_ENV_STAGE_2 = Object.freeze({
  'fast-lane': Object.freeze({
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    RANGE_BASE: '${{ github.event.pull_request.base.sha || github.event.before }}',
    RANGE_HEAD: '${{ github.event.pull_request.head.sha || github.sha }}',
  }),
  'security-integration': Object.freeze({ NPM_CONFIG_IGNORE_SCRIPTS: 'true' }),
  'ci-gate': RANGE_JOB_ENV,
});
export const PINNED_JOB_PERMISSIONS_STAGE_2 = Object.freeze({
  'fast-lane': Object.freeze({ contents: 'read', actions: 'read', 'pull-requests': 'read' }),
  'security-integration': Object.freeze({ contents: 'read' }),
  'ci-gate': Object.freeze({ contents: 'read', actions: 'read', 'pull-requests': 'read' }),
});
/** D-ARCH-128: Semgrep and oasdiff run unless a docs-only push has a code proof (fail closed on any other output). */
export const SCANS_IF_STAGE_2 = `steps.${LANE_SCOPE_STEP_ID}.outputs.code_changed != 'false' || steps.${LANE_SCOPE_STEP_ID}.outputs.code_proof == ''`;
/** PR42-SEC-18: the Lint step's env, exactly (a heap size only; node-options-preload refuses preloads anyway). */
export const LINT_ENV = Object.freeze({ NODE_OPTIONS: '--max-old-space-size=4096' });
const TOKEN_MENTION =
  /\bgithub\s*(?:\.\s*token\b|\[\s*['"]token['"]\s*\])|\bsecrets\s*(?:\.\s*GITHUB_TOKEN\b|\[\s*['"]GITHUB_TOKEN['"]\s*\])|\bGH_TOKEN\b|\bGITHUB_TOKEN\b/u;
const TOKEN_VALUES = Object.freeze(['${{ github.token }}', '${{ secrets.GITHUB_TOKEN }}']);

/**
 * ci.yml gate steps that must stay (PR10-SEC-07 `required-gates`): the job, a pattern its `run:` matches, the only
 * `if:` values allowed on that step (empty: unconditional) and the `env:` entries it must set. Adding a gate is a
 * reviewed change to this list.
 */
/**
 * `after`: the gate whose step must come directly before this one in the same job (PR #33 R1-m2).
 * @typedef {{ job: string, gate: string, name?: RegExp, run: { test: (script: string) => boolean }, ifs: readonly string[],
 *   env?: Record<string, string>, problems?: (script: string) => string[], after?: string }} RequiredGate
 */
/**
 * `node "${<name>:?}"` as a pattern (PR33-SEC-09: an unset gate location fails the step instead of running nothing).
 * @param {string} name
 */
const gateNode = (name) => new RegExp(`node "\\$\\{${name}:\\?\\}"`, 'u');
/*
 * PR55-SEC-02 (= PR #55 code review R1-m1, widened): in stage 2 every gate that runs before head code in fast-lane, and
 * ci-gate's gitleaks, Semgrep and record steps, are held to their exact text (no `|| true`, `; exit 0`, `--exit-code 0`,
 * forced `--report-only`, indirect `$GITHUB_ENV` write or extra line), with no step env (PR55-SEC-01).
 */
export const WORKFLOW_POLICY_RUN_STAGE_2 =
  'node "${GATE_CHECK_WORKFLOW_POLICY:?}" --root "$GITHUB_WORKSPACE" --summary "$GITHUB_STEP_SUMMARY"';
export const INSTALL_FLAGS_RUN_STAGE_2 = 'node "${GATE_CHECK_INSTALL_FLAGS:?}" --root "$GITHUB_WORKSPACE" --summary "$GITHUB_STEP_SUMMARY"';
export const MIGRATION_IMMUTABILITY_RUN_STAGE_2 =
  'node "${GATE_CHECK_MIGRATION_IMMUTABILITY:?}" --root "$GITHUB_WORKSPACE" --base "$RANGE_BASE" --head "$RANGE_HEAD" --summary "$GITHUB_STEP_SUMMARY"';
export const LOCKFILE_RUN_STAGE_2 =
  'node "${GATE_CHECK_LOCKFILE:?}" --root "$GITHUB_WORKSPACE" --base "$RANGE_BASE" --summary "$GITHUB_STEP_SUMMARY"';
export const DEP_AGE_SCRIPT_STAGE_2 = Object.freeze([
  'set -euo pipefail',
  'node "${GATE_CHECK_DEP_AGE:?}" --fetch --out "$RUNNER_TEMP/registry-times.json" --root "$GITHUB_WORKSPACE" --base "$RANGE_BASE"',
  'node "${GATE_CHECK_DEP_AGE:?}" --times "$RUNNER_TEMP/registry-times.json" --root "$GITHUB_WORKSPACE" --base "$RANGE_BASE" --summary "$GITHUB_STEP_SUMMARY"',
]);
/** The install, unconditional in stage 2 (D-TASK286-03, PR #55 R1-n5): the verifier, signatures and audit read it. */
export const INSTALL_RUN_STAGE_2 = 'npm ci --ignore-scripts --no-audit --no-fund';
export const LICENCES_RUN_STAGE_2 = 'node "${GATE_LICENCE_CHECK:?}" --root "$GITHUB_WORKSPACE" --summary "$GITHUB_STEP_SUMMARY"';
export const SIGNATURES_RUN_STAGE_2 = 'npm audit signatures --@platform:registry=https://registry.npmjs.org/';
/** Both scanners' exit codes are recorded, check-audit is the gate (it fails on missing or error JSON). */
export const AUDIT_SCRIPT_STAGE_2 = Object.freeze([
  'set +e',
  'npm audit --json > "$RUNNER_TEMP/npm-audit.json"',
  'echo "npm audit exit $? (evaluated by check-audit)"',
  'docker run --rm -v "$GITHUB_WORKSPACE:/src:ro" "$OSV_SCANNER_IMAGE" scan source --lockfile /src/package-lock.json --format json > "$RUNNER_TEMP/osv.json"',
  'echo "osv-scanner exit $? (evaluated by check-audit)"',
  'set -e',
  'node "${GATE_CHECK_AUDIT:?}" --root "$GITHUB_WORKSPACE" --npm-audit "$RUNNER_TEMP/npm-audit.json" --osv "$RUNNER_TEMP/osv.json" --summary "$GITHUB_STEP_SUMMARY"',
]);
export const GITLEAKS_SCRIPT_STAGE_2 = Object.freeze([
  'set -euo pipefail',
  'range="$RANGE_BASE..$RANGE_HEAD"',
  'if [ -z "$RANGE_BASE" ] || [ "$RANGE_BASE" = "0000000000000000000000000000000000000000" ]; then range="-1 $RANGE_HEAD"; fi',
  'docker run --rm --network none \\',
  '  -v "$GITHUB_WORKSPACE/.git:/repo/.git:ro" -v "$GATES_DIR/.gitleaks.toml:/config/gitleaks.toml:ro" \\',
  '  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo \\',
  '  "$GITLEAKS_IMAGE" git /repo --config /config/gitleaks.toml \\',
  '  --log-opts="--diff-merges=first-parent $range" --ignore-gitleaks-allow \\',
  '  --redact --no-banner --exit-code 1',
]);
export const SEMGREP_RUN_STAGE_2 =
  'node "${GATE_RUN_SEMGREP:?}" --root "$GITHUB_WORKSPACE" --rules-from "$GATES_DIR/.semgrep" --ignore-from "$GATES_DIR" --summary "$GITHUB_STEP_SUMMARY"';
/** --report-only only while the tested base has no record checker (RECORD_MODE from the pinned tooling step). */
export const RECORD_SCRIPT_STAGE_2 = Object.freeze([
  'set -euo pipefail',
  'mode=()',
  'if [ "$RECORD_MODE" = "report-only" ]; then mode=(--report-only); fi',
  'if [ "$EVENT" = "pull_request" ]; then',
  '  node "${GATE_CHECK_SECURITY_OWNED_PATHS:?}" --root "$GITHUB_WORKSPACE" --base "$RANGE_BASE" --head "$RANGE_HEAD" --pr "$PR_NUMBER" "${mode[@]}" --summary "$GITHUB_STEP_SUMMARY"',
  'else',
  '  echo "Security-owned paths record: pull-request control, not evaluated on push." >> "$GITHUB_STEP_SUMMARY"',
  'fi',
]);
/** Actions a stage-2 fast-lane or security-integration step may use (PR55-SEC-02 item 5: no exporting action). */
export const STAGE_2_USES = /^actions\/(?:checkout|setup-node|cache)@/u;
/** The workflow env keys of stage 2 besides REQUIRED_WORKFLOW_ENV: the four digest-pinned images (PR55-SEC-01 item 3). */
export const STAGE_2_WORKFLOW_IMAGES = Object.freeze(['GITLEAKS_IMAGE', 'ACTIONLINT_IMAGE', 'OSV_SCANNER_IMAGE', 'OASDIFF_IMAGE']);

/** The porcelain and openapi-breaking gates' exact `run:` in stage 2 ("${GATE_*:?}"). */
export const PORCELAIN_RUN_STAGE_2 = PORCELAIN_RUN.replace('"$GATE_CHECK_PORCELAIN"', '"${GATE_CHECK_PORCELAIN:?}"');
export const OPENAPI_BREAKING_RUN_STAGE_2 = OPENAPI_BREAKING_RUN.replace('"$GATE_OPENAPI_BREAKING"', '"${GATE_OPENAPI_BREAKING:?}"');
const CODE = "env.CODE == 'true'";

/** Matches a `run:` whose command lines are exactly BASE_LINT_FIXTURES_SCRIPT_TESTED_BASE, in pure ASCII. */
const BASE_LINT_FIXTURES_RUN_TESTED_BASE = Object.freeze({
  /** @param {string} script */
  test: (script) => pinnedScriptProblems(BASE_LINT_FIXTURES_SCRIPT_TESTED_BASE)(script).length === 0,
});

/**
 * The required gates of ci.yml (D-ARCH-128; the stage-1 topology is retired, TASK-287 part 287-A): the gates, the two tooling steps and
 * the classify step, with the scans in job `ci-gate`, every gate tool called as "${GATE_*:?}" and the routed items.
 * @type {readonly RequiredGate[]}
 */
export const CI_REQUIRED_GATES_STAGE_2 = Object.freeze(
  /** @type {RequiredGate[]} */ ([
    // PR46-SEC-12 item 1 / PR46-SEC-17: the tooling step that sets every GATE_* and TOOLS_REF, then the classify step
    // (the token's only fast-lane step) directly after it.
    {
      job: 'fast-lane',
      gate: 'gate tooling',
      name: /^Gate tooling from the tested base\b/,
      run: /echo "TOOLS_REF=\$tools_ref" >> "\$GITHUB_ENV"/,
      ifs: [],
      env: {},
      problems: pinnedScriptProblems(FAST_LANE_TOOLING_SCRIPT_V2),
    },
    {
      job: 'fast-lane',
      gate: 'lane scope',
      name: /^Classify changed paths and look up proofs\b/,
      run: gateNode('GATE_LANE_SCOPE'),
      ifs: [],
      env: CLASSIFY_ENV,
      problems: exactRunProblems(CLASSIFY_RUN),
      after: 'gate tooling',
    },
    // PR55-SEC-02 items 1-4: from the classify step to the lane B evidence step every gate is exact, has no step env and
    // directly follows the previous one, so nothing unpinned runs between the token step and the first head code.
    {
      job: 'fast-lane',
      gate: 'workflow policy',
      run: gateNode('GATE_CHECK_WORKFLOW_POLICY'),
      ifs: [],
      env: {},
      problems: exactRunProblems(WORKFLOW_POLICY_RUN_STAGE_2),
      after: 'lane scope',
    },
    {
      job: 'fast-lane',
      gate: 'install flags',
      run: gateNode('GATE_CHECK_INSTALL_FLAGS'),
      ifs: [],
      env: {},
      problems: exactRunProblems(INSTALL_FLAGS_RUN_STAGE_2),
      after: 'workflow policy',
    },
    {
      job: 'fast-lane',
      gate: 'migration immutability',
      run: gateNode('GATE_CHECK_MIGRATION_IMMUTABILITY'),
      ifs: [],
      env: {},
      problems: exactRunProblems(MIGRATION_IMMUTABILITY_RUN_STAGE_2),
      after: 'install flags',
    },
    {
      job: 'fast-lane',
      gate: 'lockfile',
      run: gateNode('GATE_CHECK_LOCKFILE'),
      ifs: [CODE],
      env: {},
      problems: exactRunProblems(LOCKFILE_RUN_STAGE_2),
      after: 'migration immutability',
    },
    {
      job: 'fast-lane',
      gate: 'dependency age',
      run: gateNode('GATE_CHECK_DEP_AGE'),
      ifs: [CODE],
      env: {},
      problems: pinnedScriptProblems(DEP_AGE_SCRIPT_STAGE_2),
      after: 'lockfile',
    },
    // D-TASK286-03 / PR #55 R1-n5: unconditional (the evidence verifier, signatures and the audit read node_modules).
    {
      job: 'fast-lane',
      gate: 'install',
      run: /^npm ci --ignore-scripts\b/,
      ifs: [],
      env: {},
      problems: exactRunProblems(INSTALL_RUN_STAGE_2),
      after: 'dependency age',
    },
    {
      job: 'fast-lane',
      gate: 'licences',
      run: gateNode('GATE_LICENCE_CHECK'),
      ifs: [CODE],
      env: {},
      problems: exactRunProblems(LICENCES_RUN_STAGE_2),
      after: 'install',
    },
    // PR46-SEC-11 item 1: signatures and the advisory audit run on every push (a light run too), straight after the
    // licences step; a light run thus re-audits the inherited lockfile against today's advisories before the merge.
    {
      job: 'fast-lane',
      gate: 'registry signatures',
      run: /npm audit signatures\b/,
      ifs: [],
      env: {},
      problems: exactRunProblems(SIGNATURES_RUN_STAGE_2),
      after: 'licences',
    },
    {
      job: 'fast-lane',
      gate: 'vulnerability audit',
      run: gateNode('GATE_CHECK_AUDIT'),
      ifs: [],
      env: {},
      problems: pinnedScriptProblems(AUDIT_SCRIPT_STAGE_2),
      after: 'registry signatures',
    },
    { job: 'fast-lane', gate: 'lint', run: /^npm run lint$/, ifs: [CODE], env: LINT_ENV },
    { job: 'fast-lane', gate: 'format', run: /^npm run format:check$/, ifs: [CODE] },
    { job: 'fast-lane', gate: 'commitlint', run: /npm exec --no -- commitlint\b/, ifs: [CODE] },
    { job: 'fast-lane', gate: 'actionlint', run: /"\$ACTIONLINT_IMAGE"/, ifs: [CODE] },
    { job: 'fast-lane', gate: 'type-check', run: /^npm run typecheck$/, ifs: [CODE] },
    { job: 'fast-lane', gate: 'unit tests', run: /^npm run test:unit$/, ifs: [CODE] },
    {
      job: 'fast-lane',
      gate: 'base-ref lint negative fixtures',
      run: BASE_LINT_FIXTURES_RUN_TESTED_BASE,
      ifs: ["env.CODE == 'true' && env.LINT_CONTROLS == 'true'"],
      env: { [LINT_FIXTURE_MODE_ENV]: 'no-weakening', TOOLS_REF: TOOLS_REF_FROM_CLASSIFY },
    },
    { job: 'fast-lane', gate: 'build', run: /^npm run build$/, ifs: [CODE] },
    {
      job: 'fast-lane',
      gate: 'porcelain after lint',
      name: /^Lint must not mutate the tree\b/,
      run: gateNode('GATE_CHECK_PORCELAIN'),
      ifs: [CODE],
      env: {},
      problems: exactRunProblems(PORCELAIN_RUN_STAGE_2),
      after: 'lint',
    },
    {
      job: 'fast-lane',
      gate: 'porcelain',
      name: /^Build must not mutate the tree\b/,
      run: gateNode('GATE_CHECK_PORCELAIN'),
      ifs: [CODE],
      env: {},
      problems: exactRunProblems(PORCELAIN_RUN_STAGE_2),
      after: 'build',
    },
    {
      job: 'fast-lane',
      gate: 'lane B evidence',
      name: /^Lane B evidence\b/,
      run: LANE_B_EVIDENCE_RUN,
      ifs: [],
      env: { TOOLS_REF: TOOLS_REF_FROM_CLASSIFY },
      problems: (script) => laneBEvidenceProblems(script, LANE_B_EVIDENCE_SCRIPT_TESTED_BASE),
      after: 'vulnerability audit',
    },
    {
      job: 'security-integration',
      gate: 'security integration suites',
      name: /^Security integration suites\b/,
      run: /tools\/ci\/security-integration\.mjs/,
      ifs: [],
      env: { TOOLS_REF: '${{ needs.fast-lane.outputs.tools_ref }}' },
      problems: pinnedScriptProblems(SECURITY_INTEGRATION_SCRIPT_TESTED_BASE),
    },
    {
      job: 'ci-gate',
      gate: 'ci-gate tooling',
      name: /^Gate tooling and scan configuration from the tested base\b/,
      run: /echo "TOOLS_REF=\$tools_ref" >> "\$GITHUB_ENV"/,
      ifs: [],
      env: {},
      problems: pinnedScriptProblems(CI_GATE_TOOLING_SCRIPT_TESTED_BASE_V2),
    },
    {
      job: 'ci-gate',
      gate: 'lane scope',
      name: /^Lane scope and proofs\b/,
      run: gateNode('GATE_LANE_SCOPE'),
      ifs: [],
      env: LANE_SCOPE_ENV,
      problems: exactRunProblems(LANE_SCOPE_RUN_TESTED_BASE),
      after: 'ci-gate tooling',
    },
    {
      job: 'ci-gate',
      gate: 'gitleaks',
      run: /"\$GITLEAKS_IMAGE" git \/repo --config \/config\/gitleaks\.toml /,
      ifs: [],
      env: {},
      problems: pinnedScriptProblems(GITLEAKS_SCRIPT_STAGE_2),
    },
    {
      job: 'ci-gate',
      gate: 'semgrep',
      run: gateNode('GATE_RUN_SEMGREP'),
      ifs: [SCANS_IF_STAGE_2],
      env: {},
      problems: exactRunProblems(SEMGREP_RUN_STAGE_2),
    },
    {
      job: 'ci-gate',
      gate: 'openapi-breaking',
      run: gateNode('GATE_OPENAPI_BREAKING'),
      ifs: [SCANS_IF_STAGE_2],
      env: {},
      problems: exactRunProblems(OPENAPI_BREAKING_RUN_STAGE_2),
    },
    {
      job: 'ci-gate',
      gate: 'security-owned paths record',
      run: gateNode('GATE_CHECK_SECURITY_OWNED_PATHS'),
      ifs: [],
      env: {},
      problems: pinnedScriptProblems(RECORD_SCRIPT_STAGE_2),
    },
    {
      job: 'ci-gate',
      gate: 'ci-gate aggregate',
      name: /^Aggregate lane A\b/,
      run: /node "\$\{GATE_LANE_SCOPE:\?\}" --gate\b/,
      ifs: [],
      env: CI_GATE_ENV_TESTED_BASE,
      problems: exactRunProblems(CI_GATE_RUN_TESTED_BASE),
    },
  ]),
);

/**
 * The required gates of ci.yml (lane-scope.mjs maps them to step names for the jobs API). One topology since the stage-1
 * retirement (TASK-287 part 287-A).
 * @returns {readonly RequiredGate[]}
 */
export function requiredGatesFor() {
  return CI_REQUIRED_GATES_STAGE_2;
}
/** ci-gate's steps after checkout and setup-node in stage 2, in this order and nothing else (PR46-SEC-12 item 1). */
export const CI_GATE_STEPS_STAGE_2 = Object.freeze([
  'ci-gate tooling',
  'lane scope',
  'gitleaks',
  'semgrep',
  'openapi-breaking',
  'security-owned paths record',
  'ci-gate aggregate',
]);
/** The job holding the scans (gitleaks, Semgrep, oasdiff, record). */
export const SCANS_JOB = 'ci-gate';

const GITLEAKS_RUN = /\$\{?GITLEAKS_IMAGE\b|gitleaks\/gitleaks[:@]/;
const VOLUME = /(?:^|\s)(?:-v|--volume)(?:\s+|=)["']?([^"'\s]+)/g;

const SANDBOX_ENVIRONMENT = 'carrier-sandbox';
const SANDBOX_SECRET = /secrets(?:\.|\[\s*['"])(?:CARRIER|STRIPE)_/;
const ANY_SECRET = /secrets(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([^'"]+)['"]\s*\])/g;
const PINNED_USES = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/;
const VERSION_COMMENT = /#\s*v?\d+(?:\.\d+){0,2}\S*\s*$/;
const DIGEST = /@sha256:[0-9a-f]{64}\b/;
const PRELOAD = /(?:^|\s)(?:--require|-r|--import|--loader|--experimental-loader|--env-file)(?:[=\s]|$)/;

/**
 * Splits a shell script into command segments: joins `\` continuations and splits on `&&`, `||`, `;` and `|`
 * outside quotes. Each segment keeps the operator that FOLLOWS it, so `x || true` is detectable.
 * @param {string} script
 * @returns {{ text: string, next: string }[]}
 */
export function shellSegments(script) {
  const joined = script.replace(/\\\r?\n/g, ' ');
  /** @type {{ text: string, next: string }[]} */
  const out = [];
  for (const line of joined.split(/\r?\n/)) {
    let current = '';
    /** @type {string | null} */
    let quote = null;
    for (let i = 0; i < line.length; i += 1) {
      const c = line.charAt(i);
      if (quote !== null) {
        if (c === quote) quote = null;
        current += c;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        current += c;
        continue;
      }
      if (c === '#' && (i === 0 || /\s/.test(line.charAt(i - 1)))) break;
      const two = line.slice(i, i + 2);
      if (two === '&&' || two === '||') {
        out.push({ text: current.trim(), next: two });
        current = '';
        i += 1;
      } else if (c === ';' || c === '|') {
        out.push({ text: current.trim(), next: c });
        current = '';
      } else current += c;
    }
    out.push({ text: current.trim(), next: '' });
  }
  return out.filter((segment) => segment.text !== '' || segment.next !== '');
}

/** @param {YamlNode | undefined} node */
const asMap = (node) => (isMap(node) ? node : undefined);
/** @param {YamlNode | undefined} node */
const asString = (node) => (typeof node === 'string' ? node : undefined);

/**
 * @param {YamlNode | undefined} on
 * @returns {Set<string>}
 */
export function triggersOf(on) {
  if (typeof on === 'string') return new Set([on]);
  if (Array.isArray(on)) return new Set(on.filter((item) => typeof item === 'string'));
  if (isMap(on)) return new Set(Object.keys(on));
  return new Set();
}

/**
 * @param {string} name
 * @param {string} value
 * @returns {{ rule: string, message: string }[]}
 */
function envEntryFindings(name, value) {
  /** @type {{ rule: string, message: string }[]} */
  const out = [];
  if (FORBIDDEN_ENV.includes(name) || PLAYWRIGHT_HOST.test(name)) {
    out.push({ rule: 'forbidden-env', message: `${name} redirects a binary download or engine path and is not allowed in workflows` });
  }
  if (PRELOAD_ENV.includes(name.toUpperCase()) || PRELOAD_ENV_PREFIX.test(name)) {
    out.push({
      rule: 'preload-env',
      message: `${name} makes the shell, loader or Node run or find other code before a step's command and is not allowed in workflows (PR55-SEC-01)`,
    });
  }
  // Runner-provided variables steer gate scripts (GITHUB_EVENT_NAME selects the lane B verdict path, RUNNER_TEMP and
  // GITHUB_WORKSPACE where gates are extracted and read): never set by a workflow (PR23-SEC-06, D-SEC-PR23-02 (2)).
  if (/^(?:GITHUB|RUNNER)_/iu.test(name) && name !== 'GITHUB_TOKEN') {
    out.push({ rule: 'reserved-env', message: `${name} is a runner-provided variable gate steps rely on; workflows must not set it` });
  }
  // Gate script and gate input locations are written to $GITHUB_ENV only by the gate-tooling steps, from the base ref;
  // an `env:` entry (workflow, job or step) could point a gate at a head copy (PR #33 R1-m2, PR33-SEC-03 (i)).
  if (/^GATES?_/u.test(name)) {
    out.push({ rule: 'gate-env', message: `${name} locates gate tooling; only the gate-tooling steps set it (via $GITHUB_ENV)` });
  }
  if (/^npm_config_ignore_scripts$/i.test(name) && value.trim().toLowerCase() !== 'true') {
    out.push({ rule: 'ignore-scripts', message: `${name} must stay "true" (got "${value}")` });
  }
  if (/^npm_config_@platform:registry$/i.test(name)) {
    out.push({ rule: 'platform-registry', message: `${name} overrides the @platform scope pin (PR1-SEC-12)` });
  }
  if (name === 'NODE_OPTIONS' && PRELOAD.test(value)) {
    out.push({ rule: 'node-options-preload', message: 'NODE_OPTIONS must not preload code (--require/--import/--loader/--env-file)' });
  }
  // PR42-SEC-18: an expression (a PR title, a branch name) could carry a preload past the literal check above.
  if (name === 'NODE_OPTIONS' && value.includes('${{')) {
    out.push({ rule: 'node-options-preload', message: 'NODE_OPTIONS must be a literal (no ${{ }} expression; PR42-SEC-18)' });
  }
  if (name === 'NODE_TLS_REJECT_UNAUTHORIZED' && value.trim() === '0') {
    out.push({ rule: 'tls-verify-disabled', message: 'NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS verification' });
  }
  if (/_IMAGE$/.test(name) && value !== '' && !DIGEST.test(value) && !value.includes('${{')) {
    out.push({ rule: 'image-digest', message: `${name} must pin its image by @sha256 digest` });
  }
  return out;
}

/**
 * D-SEC-PR57-02 / D-TASK287A-03 (`cache-hygiene`): the findings for one `actions/cache` `path:` input. A path line
 * that would restore TEST_LOCKS_DIR (the directory itself, an ancestor such as `node_modules` or `node_modules/.cache`,
 * or a glob matching one) needs a `!${TEST_LOCKS_DIR}` exclusion line. `./` and `${{ github.workspace }}/` prefixes are
 * read as the workspace root.
 * @param {string} pathText the `with.path` value (one path or glob per line)
 * @returns {string[]}
 */
export function cacheHygieneFindings(pathText) {
  const normalise = (/** @type {string} */ line) =>
    line
      .trim()
      .replace(/^\$\{\{\s*github\.workspace\s*\}\}\//u, '')
      .replace(/^\.\//u, '')
      .replace(/\/+$/u, '');
  const lines = pathText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const segments = TEST_LOCKS_DIR.split('/');
  const targets = segments.map((_, index) => segments.slice(0, index + 1).join('/'));
  /** @param {string} glob */
  const toRegExp = (glob) =>
    new RegExp(
      `^${glob
        .split('/')
        .map((part) => (part === '**' ? '<GLOBSTAR>' : part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]*')))
        .join('/')
        .replace(/<GLOBSTAR>\//gu, '(?:.*/)?')
        .replace(/\/<GLOBSTAR>/gu, '(?:/.*)?')
        .replace(/<GLOBSTAR>/gu, '.*')}$`,
      'u',
    );
  const covered = lines.some((line) => !line.startsWith('!') && targets.some((target) => toRegExp(normalise(line)).test(target)));
  const excluded = lines.some(
    (line) => line.startsWith('!') && [TEST_LOCKS_DIR, `${TEST_LOCKS_DIR}/**`].includes(normalise(line.slice(1))),
  );
  return covered && !excluded
    ? [
        `an actions/cache path that restores ${TEST_LOCKS_DIR} must exclude it with a !${TEST_LOCKS_DIR} line (a restored stale test lock; D-SEC-PR57-02)`,
      ]
    : [];
}

/**
 * Findings for one shell script (`run:`).
 * @param {string} script
 * @param {boolean} isCi true for a NO_RELEASE_WORKFLOWS file (ci.yml, lane-c.yml, nightly.yml)
 * @param {string} [fileName] named in the no-release messages
 * @returns {{ rule: string, message: string }[]}
 */
export function scriptFindings(script, isCi, fileName = 'ci.yml') {
  /** @type {{ rule: string, message: string }[]} */
  const out = [];
  for (const name of FORBIDDEN_ENV) {
    if (new RegExp(`\\b${name}\\s*=`).test(script)) out.push({ rule: 'forbidden-env', message: `${name} is set in a run script` });
  }
  const playwright = /\b((?:npm_config_|npm_package_config_)?PLAYWRIGHT_(?:[A-Z]+_)?DOWNLOAD_HOST)\s*=/iu.exec(script);
  if (playwright) out.push({ rule: 'forbidden-env', message: `${playwright[1] ?? 'PLAYWRIGHT_DOWNLOAD_HOST'} is set in a run script` });
  const ignore = /\bnpm_config_ignore_scripts\s*=\s*["']?([^\s"';]*)/i.exec(script);
  if (ignore && (ignore[1] ?? '').toLowerCase() !== 'true') {
    out.push({ rule: 'ignore-scripts', message: 'npm_config_ignore_scripts is overridden in a run script' });
  }
  for (const segment of shellSegments(script)) {
    const overrides = npmInvocations(segment.text).flatMap((invocation) => invocation.overrides);
    if (overrides.length > 0 || writesIgnoreScriptsConfig(segment.text)) {
      out.push({
        rule: 'ignore-scripts',
        message: `a command re-enables lifecycle scripts or spells ignore-scripts non-canonically${overrides.length > 0 ? ` (${overrides.join(', ')})` : ''}: "${segment.text.slice(0, 80)}"`,
      });
    }
  }
  for (const f of untrustedExpressionFindings(script, 'run')) out.push(f);
  if (GITLEAKS_RUN.test(script)) out.push(...gitleaksFindings(script));
  if (/\bnpm_config_@platform:registry\s*=/i.test(script)) {
    out.push({ rule: 'platform-registry', message: 'npm_config_@platform:registry is set in a run script (PR1-SEC-12)' });
  }
  const nodeOptions = /\bNODE_OPTIONS\s*=\s*(["']?)([^\n]*)/.exec(script);
  if (nodeOptions && PRELOAD.test(nodeOptions[2] ?? '')) {
    out.push({ rule: 'node-options-preload', message: 'NODE_OPTIONS must not preload code (--require/--import/--loader/--env-file)' });
  }
  if (/\bNODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0\b/.test(script)) {
    out.push({ rule: 'tls-verify-disabled', message: 'NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS verification' });
  }
  for (const segment of shellSegments(script)) {
    const text = segment.text;
    const signatures = /^(?:\S+=\S*\s+)*npm\s+audit\s+signatures\b/.test(text);
    if (/--@platform:registry\b/.test(text) && !signatures) {
      out.push({
        rule: 'platform-registry',
        message: `--@platform:registry= is allowed only on \`npm audit signatures\` (PR1-SEC-12): "${text.slice(0, 80)}"`,
      });
    }
    if (signatures && segment.next === '||') {
      out.push({ rule: 'audit-signatures-masked', message: '`npm audit signatures` must not be masked with `|| …` (PR1-SEC-12)' });
    }
    if (/(?:^|[\s(`$])(?:npx|bunx)(?:\s|$)|\b(?:pnpm|yarn)\s+dlx\b/.test(text)) {
      out.push({ rule: 'npx', message: `use \`npm exec --no -- <bin>\` instead of npx (SEC-TC-64): "${text.slice(0, 80)}"` });
    }
    if (/\bnpm\s+(?:exec|x|exe)\b/.test(text) && !/\bnpm\s+exec\s+--no\s+--\s/.test(text)) {
      out.push({ rule: 'npx', message: `\`npm exec\` must be \`npm exec --no -- <bin>\` (SEC-TC-64): "${text.slice(0, 80)}"` });
    }
    if (/\bdocker\s+run\b/.test(text) && !DIGEST.test(text) && !/\$\{?[A-Z0-9_]*_IMAGE\b/.test(text)) {
      out.push({
        rule: 'image-digest',
        message: `docker run must use an image pinned by digest or a *_IMAGE variable: "${text.slice(0, 80)}"`,
      });
    }
    if (isCi) {
      if (/\bnpm\s+publish\b/.test(text))
        out.push({ rule: 'ci-no-release', message: `${fileName} must not publish packages (AT-US-005-04)` });
      // Also the containerised CLI: `docker run … "$TERRAFORM_IMAGE" [-chdir=…] apply` (lane-c.yml iac).
      if (
        /\b(?:terraform|tofu)\b(?:\s+-\S+)*\s+(?:apply|destroy)\b/.test(text) ||
        /TERRAFORM_IMAGE\}?"?(?:\s+-\S+)*\s+(?:apply|destroy)\b/.test(text)
      )
        out.push({ rule: 'ci-no-release', message: `${fileName} must not run terraform apply/destroy (AT-US-005-05)` });
      if (/\baws\s+(?:sts\s+assume-role|ecs\s+(?:update-service|deploy)|deploy\b|cloudformation\s+deploy)/.test(text)) {
        out.push({ rule: 'ci-no-release', message: `${fileName} must not deploy to AWS or assume an AWS role (AT-US-005-05)` });
      }
    }
  }
  return out;
}

/**
 * `${{ … }}` expressions in a script whose context is not SAFE_EXPRESSION (PR10-SEC-07).
 * @param {string} script
 * @param {string} where `run` or `with.script`
 * @returns {{ rule: string, message: string }[]}
 */
export function untrustedExpressionFindings(script, where) {
  /** @type {{ rule: string, message: string }[]} */
  const out = [];
  for (const match of script.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    const expression = (match[1] ?? '').trim();
    if (!SAFE_EXPRESSION.test(expression)) {
      out.push({
        rule: 'untrusted-expression',
        message: `\`${'$'}{{ ${expression.slice(0, 60)} }}\` in ${where}: pass it through env: and quote the variable (script injection)`,
      });
    }
  }
  return out;
}

/**
 * Hardening of a gitleaks invocation (PR10-SEC-01).
 * @param {string} script
 * @returns {{ rule: string, message: string }[]}
 */
export function gitleaksFindings(script) {
  /** @type {{ rule: string, message: string }[]} */
  const out = [];
  const add = (/** @type {string} */ message) => out.push({ rule: 'gitleaks-hardening', message });
  if (!/(?:^|\s)--ignore-gitleaks-allow\b/.test(script))
    add('gitleaks must run with --ignore-gitleaks-allow (inline allow markers become inert)');
  if (!/--diff-merges=first-parent\b/.test(script))
    add('gitleaks --log-opts must include --diff-merges=first-parent (merge commits are scanned)');
  if (!/(?:^|\s)--network(?:\s+|=)none\b/.test(script)) add('the gitleaks container must run with --network none');
  for (const match of script.matchAll(VOLUME)) {
    const source = (match[1] ?? '').split(':')[0] ?? '';
    if (/GITHUB_WORKSPACE|github\.workspace/.test(source) && !/\/\.git\/?$/.test(source)) {
      add(`gitleaks may mount only the workspace .git (it loads <source>/.gitleaksignore); found ${source}`);
    }
  }
  return out;
}

/**
 * @param {YamlMap} job
 * @returns {boolean} true when the job's `if:` restricts it to dispatch, main or tags (lane C image publication).
 */
function imagePushGuarded(job) {
  const condition = asString(job.if) ?? '';
  if (/pull_request/.test(condition) && !/!=\s*'pull_request'/.test(condition)) return false;
  return /github\.event_name\s*==\s*'workflow_dispatch'|github\.ref\s*==\s*'refs\/heads\/main'|startsWith\(github\.ref,\s*'refs\/tags\/'\)/.test(
    condition,
  );
}

/**
 * @param {string} text workflow file content
 * @param {string} fileName base name, e.g. `ci.yml` (ci.yml gets the AT-US-005-04/-05 rules)
 * @param {{ requiredGates?: boolean }} [options] `requiredGates`: also apply CI_REQUIRED_GATES (the repository's own
 *   `.github/workflows/ci.yml`; fixtures named ci-*.yml are checked without it)
 * @returns {Finding[]}
 */
export function checkWorkflow(text, fileName, options = {}) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {import('./yaml-subset.mjs').ParsedYaml} */
  let parsed;
  try {
    parsed = parseYamlSubset(text);
  } catch (error) {
    if (error instanceof YamlSubsetError) {
      return [{ rule: 'yaml-subset', message: error.message, location: `${fileName}:${error.line}` }];
    }
    throw error;
  }
  const rawLines = text.split(/\r?\n/);
  const lineOf = (/** @type {string[]} */ path) => {
    for (let n = path.length; n > 0; n -= 1) {
      const line = parsed.lines.get(path.slice(0, n).join('.'));
      if (line !== undefined) return line;
    }
    return 1;
  };
  const add = (/** @type {string} */ rule, /** @type {string} */ message, /** @type {string[]} */ path) =>
    findings.push({ rule, message, location: `${fileName}:${lineOf(path)}${path.length > 0 ? ` ${path.join('.')}` : ''}` });

  const doc = asMap(parsed.value ?? undefined);
  if (doc === undefined) return [{ rule: 'yaml-subset', message: 'workflow is not a mapping', location: `${fileName}:1` }];
  const isCi = fileName === 'ci.yml' || fileName === 'ci.yaml';
  const noRelease = NO_RELEASE_WORKFLOWS.includes(fileName);
  const mayInstallBrowsers = PLAYWRIGHT_INSTALL_WORKFLOWS.includes(fileName);
  const triggers = triggersOf(doc.on);
  const prTriggered = triggers.has('pull_request') || triggers.has('pull_request_target');
  // D-ARCH-128: the read scopes and token steps only ci.yml may hold; other workflows hold none.
  /** @type {readonly string[]} */
  const actionsJobs = isCi ? ACTIONS_READ_JOBS : [];
  /** @type {readonly string[]} */
  const pullRequestsJobs = isCi ? PULL_REQUESTS_READ_JOBS : [];

  for (const event of FORBIDDEN_TRIGGERS) {
    if (triggers.has(event))
      add('forbidden-trigger', `trigger "${event}" runs with elevated privileges or comment input and is not allowed`, ['on']);
  }
  if (DISPATCH_ONLY_WORKFLOWS.includes(fileName) && (triggers.size !== 1 || !triggers.has('workflow_dispatch'))) {
    add('dispatch-only', `${fileName} runs on workflow_dispatch only (no schedule, push or pull_request; D-ARCH-010)`, ['on']);
  }

  // permissions
  const top = doc.permissions;
  if (top === undefined) add('permissions', 'top-level `permissions` is required (least privilege)', []);
  else if (typeof top === 'string')
    add('permissions', `top-level permissions "${top}" is too broad; use \`contents: read\` or \`{}\``, ['permissions']);
  else if (isMap(top)) {
    for (const [scope, level] of Object.entries(top)) {
      if (level !== 'read' && level !== 'none')
        add('permissions', `top-level permission ${scope}: ${String(level)} must be read or none`, ['permissions', scope]);
      // RR-8 (ii) / PR46-SEC-15: `actions:` and `pull-requests:` only on the lookup jobs, never for every job.
      if ((scope === 'actions' || scope === 'pull-requests') && level !== 'none')
        add(
          'permissions',
          `top-level permission ${scope}: ${String(level)} is not allowed (only ${(scope === 'actions' ? actionsJobs : pullRequestsJobs).join(', ') || 'the ci.yml lookup jobs'} hold ${scope}: read)`,
          ['permissions', scope],
        );
    }
  }
  for (const f of tokenFindings(doc, isCi)) add(f.rule, f.message, f.path);

  // workflow-level env
  const workflowEnv = asMap(doc.env) ?? {};
  for (const [name, value] of Object.entries(REQUIRED_WORKFLOW_ENV)) {
    if (workflowEnv[name] !== value) add('workflow-env', `workflow-level env ${name}: "${value}" is required (D-ARCH-044)`, ['env']);
  }
  const checkEnvMap = (/** @type {YamlNode | undefined} */ node, /** @type {string[]} */ path) => {
    // PR #55 R2-n2: an empty `env:` (null in GitHub's parser) is an absent map.
    if (node !== undefined && node !== null && node !== '' && !isMap(node)) {
      add(
        'env-expression',
        'an env: must be a mapping of literal names (an expression could add BASH_ENV, NODE_OPTIONS or a gate location; PR55-SEC-01)',
        path,
      );
      return;
    }
    const map = asMap(node);
    if (map === undefined) return;
    for (const [name, value] of Object.entries(map)) {
      for (const f of envEntryFindings(name, typeof value === 'string' ? value : '')) add(f.rule, f.message, [...path, name]);
      if (!mayInstallBrowsers && PLAYWRIGHT_INSTALL.test(name))
        add(
          'playwright-install',
          `${name}: Playwright browsers are installed only in ${PLAYWRIGHT_INSTALL_WORKFLOWS.join(', ')} (PR4-SEC-08)`,
          [...path, name],
        );
    }
  };
  checkEnvMap(doc.env, ['env']);
  for (const value of deepStrings(doc.env)) {
    if (SANDBOX_SECRET.test(value))
      add('sandbox-secrets', 'carrier/Stripe secrets must not be exposed at workflow level (SEC-TC-51)', ['env']);
  }
  if (deepStrings(doc).some((value) => /toJSON\(\s*secrets\s*\)/.test(value)))
    add('secrets-dump', 'toJSON(secrets) exposes every secret', []);

  const jobs = asMap(doc.jobs) ?? {};
  for (const [jobId, jobNode] of Object.entries(jobs)) {
    const job = asMap(jobNode);
    const jobPath = ['jobs', jobId];
    if (job === undefined) {
      add('yaml-subset', `job ${jobId} is not a mapping`, jobPath);
      continue;
    }
    const reusable = typeof job.uses === 'string';
    if (!reusable && job['timeout-minutes'] === undefined) add('job-timeout', `job ${jobId} must set timeout-minutes`, jobPath);
    if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== 'false') {
      add('continue-on-error', `job ${jobId} must not continue on error (gate jobs fail closed)`, [...jobPath, 'continue-on-error']);
    }

    const perms = job.permissions;
    if (typeof perms === 'string' && perms !== '')
      add('permissions', `job permissions "${perms}" is too broad`, [...jobPath, 'permissions']);
    if (isMap(perms)) {
      for (const [scope, level] of Object.entries(perms)) {
        if (level === 'write' && !JOB_WRITE_ALLOWLIST.includes(`${fileName}:${jobId}:${scope}`)) {
          add('permissions', `job ${jobId} must not hold ${scope}: write (not in JOB_WRITE_ALLOWLIST)`, [...jobPath, 'permissions', scope]);
        }
        if (scope === 'actions' && level !== 'none' && !actionsJobs.includes(`${fileName}:${jobId}`)) {
          add(
            'permissions',
            `job ${jobId} must not hold actions: (only ${actionsJobs.join(', ') || 'the ci.yml lookup jobs'}; RR-8 (ii))`,
            [...jobPath, 'permissions', scope],
          );
        }
        if (scope === 'pull-requests' && level !== 'none' && !pullRequestsJobs.includes(`${fileName}:${jobId}`)) {
          add(
            'permissions',
            `job ${jobId} must not hold pull-requests: (only ${pullRequestsJobs.join(', ') || 'the ci.yml lookup jobs'}; PR46-SEC-15)`,
            [...jobPath, 'permissions', scope],
          );
        }
        if (noRelease && scope === 'id-token' && level === 'write')
          add('ci-no-release', `${fileName} must not request id-token: write (no AWS role, AT-US-005-05)`, [
            ...jobPath,
            'permissions',
            scope,
          ]);
      }
    }

    // environment / secrets
    const environment = isMap(job.environment) ? asString(job.environment.name) : asString(job.environment);
    const jobStrings = deepStrings(job);
    if (environment === SANDBOX_ENVIRONMENT && (prTriggered || triggers.has('push'))) {
      add('sandbox-secrets', `a pull_request/push workflow must not reference environment ${SANDBOX_ENVIRONMENT} (SEC-TC-51)`, [
        ...jobPath,
        'environment',
      ]);
    }
    if (environment !== SANDBOX_ENVIRONMENT && jobStrings.some((value) => SANDBOX_SECRET.test(value))) {
      add('sandbox-secrets', `secrets.CARRIER_*/STRIPE_* only in jobs with environment ${SANDBOX_ENVIRONMENT} (SEC-TC-51)`, jobPath);
    }
    // RR-8 (iii): `github.token` is the GITHUB_TOKEN reference and is not a secret here (gh-token decides where it may
    // appear). PR46-SEC-07: the no-release workflows (lane C, nightly) follow the same rule, except a carrier-sandbox job.
    if (prTriggered || (noRelease && environment !== SANDBOX_ENVIRONMENT)) {
      const what = prTriggered ? 'pull_request jobs' : `${fileName} jobs`;
      if (job.secrets === 'inherit') add('pr-secrets', `${what} must not pass \`secrets: inherit\``, [...jobPath, 'secrets']);
      for (const value of jobStrings) {
        for (const match of value.matchAll(ANY_SECRET)) {
          const name = match[1] ?? match[2] ?? '';
          if (name !== 'GITHUB_TOKEN') add('pr-secrets', `${what} use GITHUB_TOKEN only (found secrets.${name}; ADR-0023 am. H)`, jobPath);
        }
      }
    }

    checkEnvMap(job.env, [...jobPath, 'env']);
    const container = asMap(job.container);
    checkEnvMap(container?.env, [...jobPath, 'container', 'env']);
    const containerImage = typeof job.container === 'string' ? job.container : asString(container?.image);
    if (containerImage !== undefined && !DIGEST.test(containerImage))
      add('image-digest', 'job container image must be pinned by digest', [...jobPath, 'container']);
    for (const [serviceId, serviceNode] of Object.entries(asMap(job.services) ?? {})) {
      const service = asMap(serviceNode);
      checkEnvMap(service?.env, [...jobPath, 'services', serviceId, 'env']);
      const image = asString(service?.image);
      if (image !== undefined && !DIGEST.test(image))
        add('image-digest', `service ${serviceId} image must be pinned by digest`, [...jobPath, 'services', serviceId]);
    }

    /** @type {[YamlNode | undefined, string[]][]} */
    const usesSites = [[job.uses, [...jobPath, 'uses']]];
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const [index, stepNode] of steps.entries()) {
      const step = asMap(stepNode);
      const stepPath = [...jobPath, 'steps', String(index)];
      if (step === undefined) continue;
      usesSites.push([step.uses, [...stepPath, 'uses']]);
      checkEnvMap(step.env, [...stepPath, 'env']);
      if (step['continue-on-error'] !== undefined && step['continue-on-error'] !== 'false') {
        add('continue-on-error', 'steps must not continue on error (gate steps fail closed)', [...stepPath, 'continue-on-error']);
      }
      const run = asString(step.run);
      if (run !== undefined) {
        for (const f of scriptFindings(run, noRelease, fileName)) add(f.rule, f.message, [...stepPath, 'run']);
        if (
          noRelease &&
          /\bdocker\s+(?:push|buildx\s+build\b[^\n]*--push)\b/.test(run) &&
          !(isCi && jobId === 'images' && imagePushGuarded(job))
        ) {
          add('ci-no-release', `${fileName} pushes images only from ci.yml's \`images\` job gated on dispatch/main/tags (AT-US-005-04)`, [
            ...stepPath,
            'run',
          ]);
        }
        // PR42-SEC-18: every `npm run lint` step, in any workflow, sets exactly LINT_ENV (a literal heap size; no
        // expression-valued NODE_OPTIONS and no BASH_ENV or other variable beside it).
        if (/^npm run lint$/u.test(run.trim()) && !sameMap(step.env, LINT_ENV))
          add('lint-env', `a "npm run lint" step must set exactly env ${showMap(LINT_ENV)} (PR42-SEC-18)`, [...stepPath, 'env']);
        if (!mayInstallBrowsers && PLAYWRIGHT_INSTALL.test(run)) {
          add(
            'playwright-install',
            `Playwright browsers (and apt --with-deps) are installed only in ${PLAYWRIGHT_INSTALL_WORKFLOWS.join(', ')} (PR4-SEC-08)`,
            [...stepPath, 'run'],
          );
        }
      }
      const uses = asString(step.uses) ?? '';
      const withMap = asMap(step.with) ?? {};
      // D-SEC-PR57-02: no cache in any workflow restores the test-lock directory.
      if (/^actions\/cache(?:\/restore|\/save)?@/u.test(uses))
        for (const message of cacheHygieneFindings(asString(withMap.path) ?? ''))
          add('cache-hygiene', message, [...stepPath, 'with', 'path']);
      const script = asString(withMap.script);
      if (script !== undefined) {
        for (const f of untrustedExpressionFindings(script, 'with.script')) add(f.rule, f.message, [...stepPath, 'with', 'script']);
      }
      // ci-gate holds actions: read and runs the tested-base lane-scope and the scans, so it is isolated (RR-6).
      if (isCi && jobId === 'ci-gate') {
        for (const message of scansStepViolations(step)) add('scans-isolation', message, stepPath);
      }
      if (noRelease && /^aws-actions\/configure-aws-credentials@/.test(uses))
        add('ci-no-release', `${fileName} must not assume an AWS role (AT-US-005-05)`, [...stepPath, 'uses']);
      if (noRelease && withMap['role-to-assume'] !== undefined)
        add('ci-no-release', `${fileName} must not assume an AWS role (AT-US-005-05)`, [...stepPath, 'with']);
      if (
        noRelease &&
        /^docker\/build-push-action@/.test(uses) &&
        withMap.push !== undefined &&
        withMap.push !== 'false' &&
        !(isCi && jobId === 'images' && imagePushGuarded(job))
      ) {
        add('ci-no-release', `${fileName} pushes images only from ci.yml's \`images\` job gated on dispatch/main/tags (AT-US-005-04)`, [
          ...stepPath,
          'with',
          'push',
        ]);
      }
    }

    for (const [usesNode, path] of usesSites) {
      const uses = asString(usesNode);
      if (uses === undefined) continue;
      const line = rawLines[lineOf(path) - 1] ?? '';
      if (uses.startsWith('./')) continue;
      if (uses.startsWith('docker://')) {
        if (!DIGEST.test(uses)) add('pinned-action', `${uses} must be pinned by @sha256 digest`, path);
        continue;
      }
      if (!PINNED_USES.test(uses)) add('pinned-action', `${uses} must be pinned by a full 40-character commit SHA`, path);
      else if (!VERSION_COMMENT.test(line))
        add('pinned-action', `${uses} needs a trailing "# vX.Y.Z" comment naming the pinned release`, path);
    }
  }
  for (const path of mentionsOf(doc, LINT_FIXTURE_MODE_ENV)) {
    if (!(isCi && isBaseLintFixtureModeEntry(jobs, path))) {
      add('lint-fixture-mode', `${LINT_FIXTURE_MODE_ENV} may be set only in the env of ci.yml's base-ref lint fixture step`, path);
    }
  }
  if (options.requiredGates === true) {
    for (const f of requiredGateFindings(jobs, doc.defaults, triggers, doc.env ?? {})) add(f.rule, f.message, f.path);
    for (const f of stage2Findings(doc)) add(f.rule, f.message, f.path);
    // PR33-SEC-01: outside comment lines ci.yml is pure ASCII. The YAML subset trims Unicode blanks that GitHub's parser
    // keeps (and bash does not treat as blanks), so a non-ASCII character in a key, value or run: line is refused.
    for (const [index, line] of rawLines.entries()) {
      if (/^[ \t]*#/u.test(line)) continue;
      const problem = nonAsciiProblem(line);
      if (problem !== null)
        findings.push({
          rule: 'required-gates',
          message: `ci.yml ${problem.replace('in a pinned run:', 'outside a comment line')}`,
          location: `${fileName}:${index + 1}`,
        });
    }
  }
  return findings;
}

/**
 * Why a step of ci.yml job `ci-gate` (the folded scans) would run head-controlled code (PR10-SEC-02).
 * @param {YamlMap} step
 * @returns {string[]}
 */
function scansStepViolations(step) {
  /** @type {string[]} */
  const out = [];
  const run = asString(step.run) ?? '';
  const uses = asString(step.uses) ?? '';
  const withMap = asMap(step.with) ?? {};
  if (/(?:^|[\s;&|(`])(?:npm|npx|pnpm|yarn|bun)(?:\s|$)/m.test(run))
    out.push('job ci-gate (the folded scans) must not run a package manager');
  if (/node_modules/.test(run)) out.push('job ci-gate (the folded scans) must not run anything from node_modules');
  if (/\$\{?GITHUB_WORKSPACE\}?\/[^"'\s]*\.(?:[cm]?[jt]s|sh)\b|github\.workspace/.test(run))
    out.push('job ci-gate (the folded scans) must not run a script from the workspace (head-controlled)');
  if (uses.startsWith('./')) out.push('job ci-gate (the folded scans) must not use a local action');
  if (/^actions\/setup-node@/.test(uses) && (withMap.cache !== undefined || withMap['node-version-file'] !== undefined))
    out.push('job ci-gate (the folded scans): setup-node takes a literal node-version and no cache');
  return out;
}

/**
 * Paths of every map key equal to `name` and every string value that mentions it (`run:`, `if:`, `with:`, env values).
 * Quotes and line continuations are removed first, so `"LINT_FIX""TURE_MODE"`, `LINT_FIX'TURE'_MODE` and a name split
 * by `\` + newline still count (PR17-SEC-03, review n3). Names assembled at run time (variables, encodings) do not:
 * the rule is a tripwire.
 * @param {YamlNode | undefined} node
 * @param {string} name
 * @param {string[]} [path]
 * @returns {string[][]}
 */
export function mentionsOf(node, name, path = []) {
  if (typeof node === 'string')
    return node
      .replace(/\\\r?\n[ \t]*/gu, '')
      .replace(/["'\\]/gu, '')
      .includes(name)
      ? [path]
      : [];
  if (Array.isArray(node)) return node.flatMap((child, index) => mentionsOf(child, name, [...path, String(index)]));
  if (isMap(node)) {
    return Object.entries(node).flatMap(([key, child]) => [
      ...(key === name ? [[...path, key]] : []),
      ...mentionsOf(child, name, [...path, key]),
    ]);
  }
  return [];
}

/**
 * True for the one allowed mention of LINT_FIXTURE_MODE: the `env:` key of ci.yml's base-ref lint fixture step
 * (jobs.fast-lane.steps.<n>.env.LINT_FIXTURE_MODE, the step whose `run:` is BASE_LINT_FIXTURES_RUN_TESTED_BASE).
 * @param {YamlMap} jobs
 * @param {string[]} path
 */
function isBaseLintFixtureModeEntry(jobs, path) {
  const [root, job, steps, index, env, key] = path;
  if (path.length !== 6 || root !== 'jobs' || job !== 'fast-lane' || steps !== 'steps' || env !== 'env') return false;
  if (key !== LINT_FIXTURE_MODE_ENV) return false;
  const list = asMap(jobs['fast-lane'])?.steps;
  const step = Array.isArray(list) ? asMap(list[Number(index)]) : undefined;
  const run = asString(step?.run) ?? '';
  return BASE_LINT_FIXTURES_RUN_TESTED_BASE.test(run);
}

/**
 * Index of the first step that is `gate` (its `name` pattern, when it has one, and its `run` pattern), or -1. Shared with
 * tools/ci/lane-scope.mjs, which maps CI_REQUIRED_GATES to step names for the jobs API (D-ARCH-126).
 * @param {readonly YamlNode[]} steps
 * @param {RequiredGate} gate
 * @returns {number}
 */
export function gateStepIndex(steps, gate) {
  return steps.findIndex(
    (node) =>
      (gate.name === undefined || gate.name.test((asString(asMap(node)?.name) ?? '').trim())) &&
      gate.run.test((asString(asMap(node)?.run) ?? '').trim()),
  );
}

/** Step keys that change how a gate's `run:` executes (PR17-SEC-03): `shell: 'true {0}'` runs nothing. */
const GATE_STEP_OVERRIDES = Object.freeze(['shell', 'working-directory']);

/**
 * @param {YamlMap} jobs
 * @param {YamlNode} [workflowDefaults] the workflow-level `defaults:`
 * @param {Set<string>} [triggers] the workflow's `on:` events (checked against CI_TRIGGERS when given)
 * @param {YamlNode} [workflowEnv] the workflow-level `env:` (OASDIFF_IMAGE is checked when given)
 * @param {readonly RequiredGate[]} [gates] the required gates (default: CI_REQUIRED_GATES_STAGE_2)
 * @param {readonly string[]} [ciGateNeeds] jobs `ci-gate` must need (default: CI_GATE_NEEDS_STAGE_2)
 * @returns {{ rule: string, message: string, path: string[] }[]}
 */
export function requiredGateFindings(
  jobs,
  workflowDefaults,
  triggers,
  workflowEnv,
  gates = CI_REQUIRED_GATES_STAGE_2,
  ciGateNeeds = CI_GATE_NEEDS_STAGE_2,
) {
  /** @type {{ rule: string, message: string, path: string[] }[]} */
  const out = [];
  // PR33-SEC-03 (i): the oasdiff image is the one this (base-ref) copy of tools/ci pins, set once at workflow level.
  if (workflowEnv !== undefined) {
    if (asMap(workflowEnv)?.OASDIFF_IMAGE !== OASDIFF_IMAGE)
      out.push({
        rule: 'required-gates',
        message: `ci.yml workflow env OASDIFF_IMAGE must be ${OASDIFF_IMAGE} (tools/ci/openapi-breaking.mjs OASDIFF_IMAGE)`,
        path: ['env', 'OASDIFF_IMAGE'],
      });
    for (const [jobId, jobNode] of Object.entries(jobs)) {
      if (asMap(asMap(jobNode)?.env)?.OASDIFF_IMAGE !== undefined)
        out.push({
          rule: 'required-gates',
          message: `ci.yml job ${jobId} must not set OASDIFF_IMAGE (workflow level only)`,
          path: ['jobs', jobId, 'env', 'OASDIFF_IMAGE'],
        });
    }
  }
  // `defaults.run.shell` / `working-directory` would apply to every gate step below it.
  if (asMap(workflowDefaults)?.run !== undefined) {
    out.push({
      rule: 'required-gates',
      message: 'ci.yml must not set defaults.run (it would change how every gate step runs)',
      path: ['defaults'],
    });
  }
  for (const jobId of new Set(gates.map((gate) => gate.job))) {
    if (asMap(asMap(jobs[jobId])?.defaults)?.run !== undefined) {
      out.push({
        rule: 'required-gates',
        message: `ci.yml job ${jobId} must not set defaults.run (it would change how its gate steps run)`,
        path: ['jobs', jobId, 'defaults'],
      });
    }
  }
  const stepsOf = (/** @type {string} */ jobId) => {
    const job = asMap(jobs[jobId]);
    return job !== undefined && Array.isArray(job.steps) ? job.steps : [];
  };
  /** @param {RequiredGate} gate */
  const stepIndex = (gate) => gateStepIndex(stepsOf(gate.job), gate);
  for (const gate of gates) {
    const steps = stepsOf(gate.job);
    const index = stepIndex(gate);
    if (index === -1) {
      out.push({
        rule: 'required-gates',
        message: `ci.yml job ${gate.job} must keep the ${gate.gate} gate step`,
        path: ['jobs', gate.job],
      });
      continue;
    }
    const condition = asString(asMap(steps[index])?.if);
    if (condition !== undefined && !gate.ifs.includes(condition.trim())) {
      out.push({
        rule: 'required-gates',
        message: `ci.yml ${gate.gate} gate step must be ${gate.ifs.length === 0 ? 'unconditional' : `guarded only by ${gate.ifs.join(' | ')}`} (found if: ${condition})`,
        path: ['jobs', gate.job, 'steps', String(index), 'if'],
      });
    }
    const step = asMap(steps[index]) ?? {};
    if (gate.after !== undefined) {
      const before = gates.find((other) => other.gate === gate.after && other.job === gate.job);
      const beforeIndex = before === undefined ? -1 : stepIndex(before);
      if (beforeIndex !== -1 && index !== beforeIndex + 1) {
        out.push({
          rule: 'required-gates',
          message: `ci.yml ${gate.gate} gate step must directly follow the ${gate.after} gate step (found at step ${index}, ${gate.after} at step ${beforeIndex})`,
          path: ['jobs', gate.job, 'steps', String(index)],
        });
      }
    }
    if (gate.problems !== undefined) {
      for (const problem of gate.problems(asString(step.run) ?? '')) {
        out.push({
          rule: 'required-gates',
          message: `ci.yml ${gate.gate} gate step: ${problem}`,
          path: ['jobs', gate.job, 'steps', String(index), 'run'],
        });
      }
    }
    for (const key of GATE_STEP_OVERRIDES) {
      if (step[key] !== undefined) {
        out.push({
          rule: 'required-gates',
          message: `ci.yml ${gate.gate} gate step must not set ${key}`,
          path: ['jobs', gate.job, 'steps', String(index), key],
        });
      }
    }
    const gateEnv = gate.env;
    if (gateEnv !== undefined) {
      // Exactly the listed entries: another step variable (RANGE_BASE, BASH_ENV, PATH, …) could redirect the run.
      const env = asMap(step.env) ?? {};
      for (const [name, value] of Object.entries(gateEnv)) {
        if (env[name] !== value) {
          out.push({
            rule: 'required-gates',
            message: `ci.yml ${gate.gate} gate step must set env ${name}: ${value}`,
            path: ['jobs', gate.job, 'steps', String(index), 'env'],
          });
        }
      }
      for (const name of Object.keys(env).filter((key) => !Object.hasOwn(gateEnv, key))) {
        out.push({
          rule: 'required-gates',
          message: `ci.yml ${gate.gate} gate step must set no env but ${Object.keys(gateEnv).join(', ')} (found ${name})`,
          path: ['jobs', gate.job, 'steps', String(index), 'env', name],
        });
      }
    }
  }
  // PR #23 R2-n2: a new ci.yml trigger (merge_group, workflow_dispatch, …) reaches check-evidence as an unknown
  // --event and exits 2; adding one is deliberate: extend check-evidence EVENTS on main first, then CI_TRIGGERS here.
  if (triggers !== undefined) {
    for (const trigger of triggers)
      if (!(/** @type {readonly string[]} */ (CI_TRIGGERS).includes(trigger)))
        out.push({
          rule: 'required-gates',
          message: `ci.yml trigger ${trigger} is not in CI_TRIGGERS (${CI_TRIGGERS.join(', ')}): extend check-evidence EVENTS first, then this list (PR #23 R2-n2)`,
          path: ['on', trigger],
        });
  }
  // RR-8 (iv): the step `if:`s above and this needs list are part of the pinned topology.
  const needs = asMap(jobs['ci-gate'])?.needs;
  const needList = Array.isArray(needs) ? needs : typeof needs === 'string' ? [needs] : [];
  for (const job of ciGateNeeds) {
    if (!needList.includes(job))
      out.push({ rule: 'required-gates', message: `ci.yml ci-gate must need ${job}`, path: ['jobs', 'ci-gate'] });
  }
  return out;
}

/** @param {YamlNode | undefined} node */
const asList = (node) => (Array.isArray(node) ? node : typeof node === 'string' ? [node] : []);

/**
 * True when `node` is a mapping with exactly the entries of `expected` (string values, no other key).
 * @param {YamlNode | undefined} node
 * @param {Readonly<Record<string, string>>} expected
 */
function sameMap(node, expected) {
  const map = asMap(node);
  if (map === undefined) return false;
  const keys = Object.keys(map);
  return keys.length === Object.keys(expected).length && keys.every((key) => Object.hasOwn(expected, key) && map[key] === expected[key]);
}

/** @param {Readonly<Record<string, string>>} map */
const showMap = (map) =>
  `{ ${Object.entries(map)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ')} }`;

/** Actions a job may use before its tooling step (no head code and no run: before the gate locations are set). */
const PRE_TOOLING_USES = /^actions\/(?:checkout|setup-node)@/u;

/**
 * Stage-2 pins of ADR-0023 amendment L item 3 for ci.yml (D-ARCH-128; PR46-SEC-11/12/15/17): no retired `scans` job; the
 * trigger, concurrency and job-shape pins for fast-lane, security-integration and ci-gate (permissions, env, outputs,
 * if:, needs, action inputs);
 * the tooling step first in fast-lane and ci-gate (only checkout and setup-node before it) and the lane-scope steps with
 * their ids right after it; gitleaks after ci-gate's lane scope; ci-gate's unconditional aggregation last; and
 * $GITHUB_ENV written only by the tooling and classify steps (gate locations, TOOLS_REF, CODE, LINT_CONTROLS), and
 * ci-gate made of exactly its pinned steps in order (CI_GATE_STEPS_STAGE_2; PR46-SEC-12 item 1).
 * @param {YamlMap} doc the parsed ci.yml
 * @returns {{ rule: string, message: string, path: string[] }[]}
 */
export function stage2Findings(doc) {
  /** @type {{ rule: string, message: string, path: string[] }[]} */
  const out = [];
  const add = (/** @type {string} */ message, /** @type {string[]} */ path) => out.push({ rule: 'required-gates', message, path });
  const jobs = asMap(doc.jobs) ?? {};
  // PR55-SEC-10 (TASK-287 part 287-A): the stage-1 topology is retired; a `scans` job would bring back its weaker pins.
  if (Object.hasOwn(jobs, RETIRED_SCANS_JOB))
    add('ci.yml must not have a scans job: the stage-1 topology is retired (PR55-SEC-10, D-TASK286-01a, TASK-287)', [
      'jobs',
      RETIRED_SCANS_JOB,
    ]);
  out.push(...triggerAndConcurrencyFindings(doc));
  out.push(...workflowEnvKeyFindings(doc));
  for (const [jobId, expected] of Object.entries(PINNED_JOB_PERMISSIONS_STAGE_2)) {
    if (!sameMap(asMap(jobs[jobId])?.permissions, expected))
      add(`ci.yml job ${jobId} permissions must be exactly ${showMap(expected)} (D-ARCH-128, PR46-SEC-15)`, ['jobs', jobId, 'permissions']);
  }
  for (const [jobId, expected] of Object.entries(PINNED_JOB_ENV_STAGE_2)) {
    if (!sameMap(asMap(jobs[jobId])?.env, expected))
      add(`ci.yml job ${jobId} env must be exactly ${showMap(expected)} (the pinned commands read these inputs)`, ['jobs', jobId, 'env']);
  }
  const fastLane = asMap(jobs['fast-lane']) ?? {};
  if (!sameMap(fastLane.outputs, FAST_LANE_OUTPUTS_STAGE_2))
    add(`ci.yml job fast-lane outputs must be exactly the classify step's ${Object.keys(FAST_LANE_OUTPUTS_STAGE_2).join(', ')}`, [
      'jobs',
      'fast-lane',
      'outputs',
    ]);
  const securityIntegration = asMap(jobs['security-integration']) ?? {};
  if (asString(securityIntegration.if) !== SECURITY_INTEGRATION_IF_STAGE_2)
    add(`ci.yml security-integration if: must be exactly ${SECURITY_INTEGRATION_IF_STAGE_2} (RR-5, PR46-SEC-01)`, [
      'jobs',
      'security-integration',
      'if',
    ]);
  const ciGate = asMap(jobs['ci-gate']) ?? {};
  if (asString(ciGate.if) !== CI_GATE_IF) add(`ci.yml ci-gate if: must be exactly ${CI_GATE_IF}`, ['jobs', 'ci-gate', 'if']);
  for (const [jobId, job, expected] of /** @type {const} */ ([
    ['security-integration', securityIntegration, SECURITY_INTEGRATION_NEEDS_STAGE_2],
    ['ci-gate', ciGate, CI_GATE_NEEDS_STAGE_2],
  ])) {
    const list = asList(job.needs);
    if (list.length !== expected.length || !expected.every((need) => list.includes(need)))
      add(`ci.yml job ${jobId} needs must be exactly [${expected.join(', ')}] (D-ARCH-128)`, ['jobs', jobId, 'needs']);
  }
  // PR287B-SEC-02: the exact key set of each stage-2 job and its hosted runner.
  for (const [jobId, job] of /** @type {const} */ ([
    ['fast-lane', fastLane],
    ['security-integration', securityIntegration],
    ['ci-gate', ciGate],
  ])) {
    const allowed = STAGE_2_JOB_KEYS[jobId];
    for (const key of Object.keys(job).filter((name) => !allowed.includes(name)))
      add(`ci.yml job ${jobId} must not set ${key} (pinned job shape: only ${allowed.join(', ')}; PR287B-SEC-02)`, ['jobs', jobId, key]);
    if (asString(job['runs-on']) !== STAGE_2_RUNS_ON)
      add(`ci.yml job ${jobId} runs-on must be exactly ${STAGE_2_RUNS_ON} (PR287B-SEC-02)`, ['jobs', jobId, 'runs-on']);
  }
  const stepsOf = (/** @type {YamlMap} */ job) => (Array.isArray(job.steps) ? job.steps : []);
  // PR55-SEC-02 item 5: no action that could export a variable, rewrite a file or reach the token runs in the jobs that
  // build and test head code (ci-gate is exact anyway); checkout, setup-node and cache only.
  for (const [jobId, job] of /** @type {const} */ ([
    ['fast-lane', fastLane],
    ['security-integration', securityIntegration],
  ])) {
    for (const [index, node] of stepsOf(job).entries()) {
      const uses = asString(asMap(node)?.uses);
      if (uses !== undefined && !STAGE_2_USES.test(uses))
        add(`ci.yml ${jobId} may use only actions/checkout, actions/setup-node and actions/cache (found ${uses}; PR55-SEC-02)`, [
          'jobs',
          jobId,
          'steps',
          String(index),
          'uses',
        ]);
    }
  }
  // PR59-SEC-01 item 1: every action step of the three jobs takes exactly its pinned inputs (and no action outside the map).
  for (const [jobId, job] of /** @type {const} */ ([
    ['fast-lane', fastLane],
    ['security-integration', securityIntegration],
    ['ci-gate', ciGate],
  ])) {
    const inputs = /** @type {Record<string, Readonly<Record<string, string>>>} */ (STAGE_2_ACTION_INPUTS[jobId]);
    for (const [index, node] of stepsOf(job).entries()) {
      const step = asMap(node) ?? {};
      const uses = asString(step.uses);
      if (uses === undefined) continue;
      const [action = '', commit = ''] = uses.split('#')[0]?.trim().split('@') ?? [];
      const expected = Object.hasOwn(inputs, action) ? inputs[action] : undefined;
      // PR62-SEC-01: exactly {name, uses, with} (plus the one pinned if:), and the action's exact commit.
      const ifKey = `${jobId}:${action}`;
      const allowedIf = Object.hasOwn(STAGE_2_ACTION_STEP_IFS, ifKey)
        ? STAGE_2_ACTION_STEP_IFS[/** @type {keyof typeof STAGE_2_ACTION_STEP_IFS} */ (ifKey)]
        : undefined;
      for (const key of Object.keys(step).filter(
        (name) => !STAGE_2_ACTION_STEP_KEYS.includes(name) && !(name === 'if' && allowedIf !== undefined),
      ))
        add(`ci.yml ${jobId} ${action} step must have only the keys ${STAGE_2_ACTION_STEP_KEYS.join(', ')} (found ${key}; PR62-SEC-01)`, [
          'jobs',
          jobId,
          'steps',
          String(index),
          key,
        ]);
      if (allowedIf !== undefined && asString(step.if) !== allowedIf)
        add(`ci.yml ${jobId} ${action} step if: must be exactly ${allowedIf} (PR62-SEC-01)`, ['jobs', jobId, 'steps', String(index), 'if']);
      const pinned = Object.hasOwn(STAGE_2_ACTION_COMMITS, action)
        ? STAGE_2_ACTION_COMMITS[/** @type {keyof typeof STAGE_2_ACTION_COMMITS} */ (action)]
        : undefined;
      if (pinned !== undefined && commit !== pinned)
        add(`ci.yml ${jobId} ${action} must be pinned to exactly ${pinned} (PR62-SEC-01)`, ['jobs', jobId, 'steps', String(index), 'uses']);
      if (expected === undefined)
        add(`ci.yml ${jobId} may not use ${action} (PR59-SEC-01: only ${Object.keys(inputs).join(', ')})`, [
          'jobs',
          jobId,
          'steps',
          String(index),
          'uses',
        ]);
      else if (!sameMap(step.with, expected))
        add(`ci.yml ${jobId} ${action} with: must be exactly ${showMap(expected)} (PR59-SEC-01)`, [
          'jobs',
          jobId,
          'steps',
          String(index),
          'with',
        ]);
    }
  }
  const ciGateSteps = stepsOf(ciGate);
  const last = asMap(ciGateSteps.at(-1));
  if (!/^Aggregate lane A\b/u.test((asString(last?.name) ?? '').trim()) || asString(last?.if) !== undefined)
    add('ci.yml ci-gate must end with its unconditional "Aggregate lane A" step (RR-6)', ['jobs', 'ci-gate', 'steps']);
  /**
   * @param {string} job
   * @param {string} gate
   */
  const indexOf = (job, gate) => {
    const found = CI_REQUIRED_GATES_STAGE_2.find((candidate) => candidate.job === job && candidate.gate === gate);
    return found === undefined ? -1 : gateStepIndex(stepsOf(job === 'fast-lane' ? fastLane : ciGate), found);
  };
  for (const [jobId, job, tooling, id] of /** @type {const} */ ([
    ['fast-lane', fastLane, 'gate tooling', CLASSIFY_STEP_ID],
    ['ci-gate', ciGate, 'ci-gate tooling', LANE_SCOPE_STEP_ID],
  ])) {
    const steps = stepsOf(job);
    const toolingIndex = indexOf(jobId, tooling);
    const laneIndex = indexOf(jobId, 'lane scope');
    // PR46-SEC-12 item 1: nothing but checkout and setup-node before the tooling step, so no unpinned step sets a gate
    // location, TOOLS_REF or a classification input first (and no head code runs before the token step).
    for (const [index, node] of steps.slice(0, toolingIndex === -1 ? 0 : toolingIndex).entries()) {
      const step = asMap(node) ?? {};
      if (step.run !== undefined || !PRE_TOOLING_USES.test(asString(step.uses) ?? ''))
        add(`ci.yml ${jobId}: only actions/checkout and actions/setup-node may run before the ${tooling} step (PR46-SEC-12)`, [
          'jobs',
          jobId,
          'steps',
          String(index),
        ]);
    }
    if (laneIndex !== -1 && asString(asMap(steps[laneIndex])?.id) !== id)
      add(`ci.yml ${jobId} lane scope step must have id ${id} (the outputs read it)`, ['jobs', jobId, 'steps', String(laneIndex)]);
  }
  const gitleaksIndex = indexOf('ci-gate', 'gitleaks');
  const ciGateLane = indexOf('ci-gate', 'lane scope');
  if (ciGateLane !== -1 && gitleaksIndex !== -1 && ciGateLane > gitleaksIndex)
    add('ci.yml ci-gate lane scope step must run before the gitleaks step (a red scan must not hide the classification)', [
      'jobs',
      'ci-gate',
      'steps',
      String(ciGateLane),
    ]);
  // PR46-SEC-12 item 1 (X4): ci-gate holds the token and decides, so it is exactly checkout, setup-node and its pinned
  // gates in order; no step can be inserted to re-point a gate location, mask a scan or rewrite an output.
  const expectedOrder = CI_GATE_STEPS_STAGE_2.map((gate) => indexOf('ci-gate', gate));
  const exact =
    ciGateSteps.length === CI_GATE_STEPS_STAGE_2.length + 2 &&
    /^actions\/checkout@/u.test(asString(asMap(ciGateSteps[0])?.uses) ?? '') &&
    /^actions\/setup-node@/u.test(asString(asMap(ciGateSteps[1])?.uses) ?? '') &&
    expectedOrder.every((index, position) => index === position + 2);
  if (!exact)
    add(`ci.yml ci-gate must be exactly checkout, setup-node, then ${CI_GATE_STEPS_STAGE_2.join(', ')} (PR46-SEC-12)`, [
      'jobs',
      'ci-gate',
      'steps',
    ]);
  const installIndex = indexOf('fast-lane', 'install');
  const classifyIndex = indexOf('fast-lane', 'lane scope');
  if (classifyIndex !== -1 && installIndex !== -1 && classifyIndex > installIndex)
    add('ci.yml fast-lane classify step must run before the install (no head code before the token step)', [
      'jobs',
      'fast-lane',
      'steps',
      String(classifyIndex),
    ]);
  // $GITHUB_ENV steers every later step (gate locations, TOOLS_REF, CODE, LINT_CONTROLS): only the pinned steps write it.
  // A lexical TRIPWIRE for the steps that are not exact (the head-code steps, which could write it indirectly anyway);
  // every step before head code and every ci-gate step is held to exact text above (PR55-SEC-02 item 6).
  const writers = new Set([
    `fast-lane:${String(indexOf('fast-lane', 'gate tooling'))}`,
    `fast-lane:${String(classifyIndex)}`,
    `ci-gate:${String(indexOf('ci-gate', 'ci-gate tooling'))}`,
  ]);
  for (const [jobId, jobNode] of Object.entries(jobs)) {
    for (const [index, node] of stepsOf(asMap(jobNode) ?? {}).entries()) {
      const run = asString(asMap(node)?.run) ?? '';
      if (/GITHUB_ENV/u.test(run) && !writers.has(`${jobId}:${String(index)}`))
        out.push({
          rule: 'gate-env',
          message: `ci.yml ${jobId} step ${String(index)} mentions GITHUB_ENV; only the pinned tooling and classify steps write it (PR46-SEC-12)`,
          path: ['jobs', jobId, 'steps', String(index), 'run'],
        });
    }
  }
  return out;
}

/**
 * PR55-SEC-01 item 3 and PR55-SEC-11: the ci.yml workflow env is exactly the required install settings and the four
 * digest-pinned images, in both topologies (their values are checked by workflow-env, image-digest and the
 * OASDIFF_IMAGE pin); a workflow-level entry reaches every step, the scans and ci-gate included.
 * @param {YamlMap} doc
 * @returns {{ rule: string, message: string, path: string[] }[]}
 */
function workflowEnvKeyFindings(doc) {
  const keys = Object.keys(asMap(doc.env) ?? {}).sort();
  const expected = [...Object.keys(REQUIRED_WORKFLOW_ENV), ...STAGE_2_WORKFLOW_IMAGES].sort();
  if (keys.join(',') === expected.join(',')) return [];
  return [
    {
      rule: 'required-gates',
      message: `ci.yml workflow env must have exactly the keys ${expected.join(', ')} (PR55-SEC-01, PR55-SEC-11)`,
      path: ['env'],
    },
  ];
}

/**
 * The trigger and concurrency pins both topologies share (R2-M1, PR46-SEC-13; RR-7).
 * @param {YamlMap} doc
 * @returns {{ rule: string, message: string, path: string[] }[]}
 */
function triggerAndConcurrencyFindings(doc) {
  /** @type {{ rule: string, message: string, path: string[] }[]} */
  const out = [];
  const add = (/** @type {string} */ message, /** @type {string[]} */ path) => out.push({ rule: 'required-gates', message, path });
  const pullRequest = asMap(asMap(doc.on)?.pull_request);
  const branches = asList(pullRequest?.branches);
  if (
    pullRequest === undefined ||
    branches.length !== CI_PULL_REQUEST_BRANCHES.length ||
    branches.some((branch, index) => branch !== CI_PULL_REQUEST_BRANCHES[index]) ||
    pullRequest['branches-ignore'] !== undefined
  )
    add(
      `ci.yml on.pull_request.branches must be exactly [${CI_PULL_REQUEST_BRANCHES.join(', ')}] with no branches-ignore (R2-M1, PR46-SEC-13: proof runs are runs against main)`,
      ['on', 'pull_request', 'branches'],
    );
  const concurrency = asMap(doc.concurrency);
  if (
    concurrency === undefined ||
    asString(concurrency.group) !== `ci-${CI_CONCURRENCY.group}` ||
    concurrency['cancel-in-progress'] !== 'false' ||
    Object.keys(concurrency).length !== 2
  )
    add(
      `ci.yml concurrency must be exactly { group: ci-${CI_CONCURRENCY.group}, cancel-in-progress: false } (RR-7: a full run is never cancelled)`,
      ['concurrency'],
    );
  return out;
}

/**
 * RR-8 (i) `gh-token` findings for one workflow: every token reference outside the allowed GH_TOKEN step env entries.
 * @param {YamlMap} doc
 * @param {boolean} isCi
 * @returns {{ rule: string, message: string, path: string[] }[]}
 */
export function tokenFindings(doc, isCi) {
  const tokenJobs = TOKEN_JOBS;
  /**
   * PR55-SEC-09 (= PR #55 code review R1-m3): in stage 2 the token is bound to steps, not to a mention of the tool:
   * fast-lane's classify step (id classify, exactly CLASSIFY_RUN) and ci-gate's lane-scope and aggregation steps
   * (exact runs), each found as its required gate. A fast-lane step after head code that names the tool gets nothing.
   * @type {Map<string, { gate: string, run: string, id?: string }[]>}
   */
  const tokenSteps = new Map([
    ['fast-lane', [{ gate: 'lane scope', run: CLASSIFY_RUN, id: CLASSIFY_STEP_ID }]],
    [
      'ci-gate',
      [
        { gate: 'lane scope', run: LANE_SCOPE_RUN_TESTED_BASE, id: LANE_SCOPE_STEP_ID },
        { gate: 'ci-gate aggregate', run: CI_GATE_RUN_TESTED_BASE },
      ],
    ],
  ]);
  /** @type {string[][]} */
  const paths = [];
  /**
   * @param {YamlNode | undefined} node
   * @param {string[]} path
   */
  const visit = (node, path) => {
    if (typeof node === 'string') {
      if (TOKEN_MENTION.test(node)) paths.push(path);
    } else if (Array.isArray(node)) node.forEach((child, index) => visit(child, [...path, String(index)]));
    else if (isMap(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (TOKEN_MENTION.test(key)) paths.push([...path, key]);
        visit(child, [...path, key]);
      }
    }
  };
  visit(doc, []);
  const jobs = asMap(doc.jobs) ?? {};
  /** @param {string[]} path */
  const allowed = (path) => {
    const [root, jobId, steps, index, env, key] = path;
    if (!isCi || path.length !== 6 || root !== 'jobs' || steps !== 'steps' || env !== 'env' || key !== 'GH_TOKEN') return false;
    if (!tokenJobs.includes(jobId ?? '')) return false;
    const list = asMap(jobs[jobId ?? ''])?.steps;
    const step = Array.isArray(list) ? asMap(list[Number(index)]) : undefined;
    const value = asString(asMap(step?.env)?.GH_TOKEN) ?? '';
    if (!TOKEN_VALUES.includes(value)) return false;
    const position = Number(index);
    return (tokenSteps.get(jobId ?? '') ?? []).some((allowedStep) => {
      const gate = CI_REQUIRED_GATES_STAGE_2.find((candidate) => candidate.job === jobId && candidate.gate === allowedStep.gate);
      return (
        gate !== undefined &&
        Array.isArray(list) &&
        gateStepIndex(list, gate) === position &&
        commandLines(asString(step?.run) ?? '').join('\n') === allowedStep.run &&
        (allowedStep.id === undefined || asString(step?.id) === allowedStep.id)
      );
    });
  };
  const seen = new Set();
  return paths
    .filter((path) => !allowed(path))
    .filter((path) => {
      const id = path.join('.');
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((path) => ({
      rule: 'gh-token',
      message: `a token reference is allowed only as the GH_TOKEN env entry (${TOKEN_VALUES.join(' or ')}) of fast-lane's classify step or ci-gate's lane-scope and aggregation steps (exact, PR55-SEC-09; RR-8 (i)); found at ${path.join('.')}`,
      path,
    }));
}

/**
 * Every `.gitleaksignore` in the tree (PR10-SEC-01): gitleaks loads one from the scanned source unconditionally, so a
 * committed file would let a PR fingerprint away its own findings.
 * @param {string} root
 * @returns {string[]} repository-relative paths
 */
export function findGitleaksIgnores(root) {
  return findFilesNamed(root, '.gitleaksignore');
}

/**
 * Every file called `name` in the tree, skipping node_modules, .git and nested checkouts: a subdirectory with its own
 * `.git` (a git worktree or clone, e.g. under .claude/worktrees) is another tree, and git cannot commit a `.git` path.
 * @param {string} root
 * @param {string} name
 * @returns {string[]} repository-relative paths, sorted
 */
export function findFilesNamed(root, name) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git' && !existsSync(join(path, '.git'))) visit(path);
      } else if (entry.name === name) out.push(relative(root, path).replaceAll('\\', '/'));
    }
  };
  visit(root);
  return out.sort();
}

/**
 * Every directory called `name` in the tree (same walk as findFilesNamed; a match is reported, not descended into).
 * @param {string} root
 * @param {string} name
 * @returns {string[]} repository-relative paths, sorted
 */
export function findDirsNamed(root, name) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (entry.name === name) out.push(relative(root, path).replaceAll('\\', '/'));
      else if (entry.name !== 'node_modules' && entry.name !== '.git' && !existsSync(join(path, '.git'))) visit(path);
    }
  };
  visit(root);
  return out.sort();
}

/**
 * jest-manual-mocks (PR4-SEC-11, PR17-SEC-09): no `__mocks__` directory anywhere in the tree (Jest would serve
 * `<roots>/**\/__mocks__/<pkg>` as `<pkg>` in every suite; jest.config.ts also ignores the path) and no tracked path
 * with a `node_modules/` segment (a committed package directory shadows the installed one). The tracked check reads
 * `git ls-files`; a root that is not a git checkout tracks nothing, and git failing in a checkout is a finding.
 * @param {string} root
 * @returns {Finding[]}
 */
export function checkJestManualMocks(root) {
  /** @type {Finding[]} */
  const findings = findDirsNamed(root, '__mocks__').map((path) => ({
    rule: 'jest-manual-mocks',
    message:
      'a __mocks__ directory would replace a module in every Jest suite; use jest.mock(name, factory) in the suite (PR4-SEC-11, PR17-SEC-09)',
    location: `${path}/`,
  }));
  if (!existsSync(join(root, '.git'))) return findings;
  const listed = spawnSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.error !== undefined || listed.status !== 0) {
    findings.push({
      rule: 'jest-manual-mocks',
      message: `git ls-files failed, tracked node_modules/ paths cannot be checked: ${String(listed.error?.message ?? listed.stderr)
        .trim()
        .slice(0, 200)}`,
      location: '.',
    });
    return findings;
  }
  for (const path of listed.stdout.split('\0')) {
    if (/(?:^|\/)node_modules\//u.test(path))
      findings.push({
        rule: 'jest-manual-mocks',
        message: 'a tracked node_modules/ path shadows an installed package for Jest and Node resolution (PR17-SEC-09)',
        location: path,
      });
  }
  return findings;
}

/**
 * Paths that `.github/CODEOWNERS` must cover (WAVE-00 TASK-007; PR5-SEC-04, PR2-SEC-01, PR8-SEC-11, PR8-SEC-13).
 * A trailing `/` marks a folder.
 */
export const REQUIRED_CODEOWNED_PATHS = Object.freeze([
  'packages/authz/',
  'tools/authz/',
  'prisma/migrations/',
  'prisma/bootstrap/',
  'eslint.config.mjs',
  'tools/eslint-rules/',
  '.semgrep/',
  'tools/ci/',
  'tools/db/lint-migrations.ts',
  '.github/workflows/',
  '.gitleaks.toml',
  // PR #10 review M2/m4, PR10-SEC-01/-04: suppression files, gate configuration and the agent control plane.
  '.gitleaksignore',
  '.semgrepignore',
  '.gitignore',
  '.prettierignore',
  'jest.config.ts',
  'tsconfig.json',
  'tsconfig.base.json',
  'commitlint.config.mjs',
  '.node-version',
  'tools/test-support/',
  // PR #4 R3-M1, PR4-SEC-11: the unit-dom Jest environment and setup files moved out of tools/test-support.
  'tools/test-dom/',
  // PR #23 R1-M1, PR23-SEC-01: the lane B verifier, its schema, the required-suite manifest and the suite runners.
  'tools/quality/',
  // PR17-SEC-01: a `.swcrc` at any depth could redirect how a suite compiles (the swcrc rule also rejects it).
  '.swcrc',
  '**/.swcrc',
  // PR4-SEC-11, PR17-SEC-09: a manual mock replaces a module in every suite (the jest-manual-mocks rule rejects it).
  '**/__mocks__/',
  // PR24-SEC-04: the O4 oracles and assertions outside the bootstrap SQL; PR4-SEC-13 item 3: configs that run in
  // deps:rebuild, typegen and the build.
  'prisma/',
  'tools/db/',
  'prisma.config.ts',
  'apps/api/src/platform/',
  'apps/*/vite.config.ts',
  // PR26-SEC-07: server-controlled ids / reserved actors, and every workspace manifest (scripts run before the gates).
  'packages/shared/src/ids/',
  '**/package.json',
  // PR38-SEC-02: every app's database platform (the generated-client value allowance); PR38-SEC-06: the credential-kind
  // predicate (D-ARCH-109) and the SEC-TC-29 oracles.
  'apps/worker/src/platform/db/',
  'packages/shared/src/http/',
  'tests/api/helpers/cache-control.ts',
  'tests/api/helpers/contract-validator.ts',
  'tests/contract-stubs/',
  // PR39-SEC-05: images, compose and infrastructure (prisma/Dockerfile is covered by prisma/), and the start-up guards
  // every container entrypoint and the config loader run before serving.
  'apps/*/Dockerfile',
  '.dockerignore',
  '.hadolint.yaml',
  'compose*.yaml',
  'compose.env',
  'infra/',
  'tools/docker/',
  'tools/compose/',
  'packages/config/src/entry-preflight.ts',
  'packages/config/src/entry-preflight-cli.ts',
  'packages/config/src/node-options.ts',
  'packages/config/src/db-tls.ts',
  'packages/config/src/tooling-env.ts',
  'packages/config/src/guards.ts',
  'packages/config/src/environment.ts',
  // PR43-SEC-04: the O3 oracle (the RLS generator and its executable API cases) and the route enumeration source.
  'tests/generated/rls/',
  'tests/generated/api-mounts.ts',
  // PR40-SEC-01: a `.gitattributes` at any depth decides what `git diff` reports (-diff, binary, textconv) and eol.
  '.gitattributes',
  '**/.gitattributes',
  'CLAUDE.md',
  '.claude/settings.json',
  '.claude/agents/',
]);

/**
 * Findings for a CODEOWNERS text that is missing or leaves a required path without an owner. A line covers a path
 * when its pattern (leading `/` optional, `/**` suffix allowed) equals it or is a folder prefix of it and the line names
 * at least one owner. Only the anchored folder/file forms this repository uses are understood.
 * @param {string | undefined} text
 * @returns {Finding[]}
 */
export function checkCodeowners(text) {
  if (text === undefined) {
    return [{ rule: 'codeowners-missing', message: '.github/CODEOWNERS must exist (PR5-SEC-04)', location: '.github/CODEOWNERS' }];
  }
  const patterns = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(/\s+/u))
    .filter((parts) => parts.slice(1).some((owner) => owner.startsWith('@')))
    .map(([pattern]) => (pattern ?? '').replace(/^\//u, '').replace(/\/\*\*$/u, '/'));
  return REQUIRED_CODEOWNED_PATHS.filter(
    (path) => !patterns.some((pattern) => pattern === path || (pattern.endsWith('/') && path.startsWith(pattern))),
  ).map((path) => ({
    rule: 'codeowners-coverage',
    message: `.github/CODEOWNERS must assign an owner to ${path} (PR5-SEC-04, PR8-SEC-11/13)`,
    location: '.github/CODEOWNERS',
  }));
}

/**
 * @param {string} root
 * @param {string[]} [files] explicit workflow files (default: every .github/workflows/*.yml|yaml)
 * @returns {{ findings: Finding[], checked: string[] }}
 */
export function checkWorkflowPolicy(root, files) {
  const dir = join(root, '.github', 'workflows');
  const list =
    files && files.length > 0
      ? files.map((file) => resolve(root, file))
      : existsSync(dir)
        ? readdirSync(dir)
            .filter((name) => /\.ya?ml$/.test(name))
            .sort()
            .map((name) => join(dir, name))
        : [];
  /** @type {Finding[]} */
  const findings = [];
  for (const file of list) {
    const label = relative(root, file).replaceAll('\\', '/');
    const requiredGates = label === '.github/workflows/ci.yml';
    for (const f of checkWorkflow(readFileSync(file, 'utf8'), basename(file), { requiredGates })) {
      findings.push({ ...f, location: f.location.replace(basename(file), label) });
    }
  }
  // Repository mode (no explicit files): ci.yml exists (required-gates), CODEOWNERS exists and covers the
  // security-owned paths, and no .gitleaksignore or .swcrc is committed.
  if (!(files && files.length > 0)) {
    if (!existsSync(join(dir, 'ci.yml'))) {
      findings.push({
        rule: 'required-gates',
        message: '.github/workflows/ci.yml (lane A) must exist',
        location: '.github/workflows/ci.yml',
      });
    }
    const owners = join(root, '.github', 'CODEOWNERS');
    findings.push(...checkCodeowners(existsSync(owners) ? readFileSync(owners, 'utf8') : undefined));
    for (const path of findGitleaksIgnores(root)) {
      findings.push({
        rule: 'gitleaksignore',
        message: 'a committed .gitleaksignore suppresses gitleaks findings from the PR itself; fix the finding instead (PR10-SEC-01)',
        location: path,
      });
    }
    for (const path of findFilesNamed(root, '.swcrc')) {
      findings.push({
        rule: 'swcrc',
        message:
          'Jest compiles with the inline @swc/jest options in jest.config.ts (swcrc: false); a .swcrc is unused or redirects how suites compile (PR17-SEC-01)',
        location: path,
      });
    }
    findings.push(...checkJestManualMocks(root));
  }
  return { findings, checked: list.map((file) => relative(root, file).replaceAll('\\', '/')) };
}

/**
 * @param {string[]} argv
 * @returns {{ root: string, summary?: string, json: boolean, files: string[] }}
 */
function parseArgs(argv) {
  /** @type {{ root: string, summary?: string, json: boolean, files: string[] }} */
  const options = { root: process.cwd(), json: false, files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--root' || arg === '--summary') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === '--root') options.root = resolve(value);
      else options.summary = value;
      i += 1;
    } else if (arg === '--json') options.json = true;
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else options.files.push(arg);
  }
  return options;
}

/** @param {string[]} argv */
export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`check-workflow-policy: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const { findings, checked } = checkWorkflowPolicy(options.root, options.files);
  if (options.json) console.log(JSON.stringify({ checked, findings }, null, 2));
  else for (const f of findings) console.log(`${f.rule}: ${f.message} (${f.location})`);
  if (options.summary) {
    const verdict = findings.length === 0 ? 'pass' : `**${findings.length} finding(s)**`;
    appendFileSync(
      options.summary,
      `\n### Workflow policy: ${verdict}\n\nChecked: ${checked.map((c) => `\`${c}\``).join(', ') || 'none'}\n`,
    );
  }
  if (checked.length === 0) console.log('check-workflow-policy: no workflow files found');
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-workflow-policy: internal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
