# CI/CD: lanes, workflows and the minutes budget

Operator view of the pipeline as built in Wave 0 (TASK-007, TASK-011, TASK-015). The design and its reasons are in
ADR-0023 (amendments A to L) and D-ORCH-001 / D-ARCH-010; the test-side rules are in
[TEST-STRATEGY section 4](../05-quality/TEST-STRATEGY.md). Every `node`/`npm` command below runs with the CLAUDE.md
section 2 PATH prefix on the Windows host. Nothing in this pipeline deploys, pushes images or applies infrastructure yet
(`DEPLOY_TARGET_*` blank, `CLOUD_BUDGET_MONTHLY_USD` = 0).

## 1. Lanes

| Lane | Where | Trigger | What | Verdict |
|---|---|---|---|---|
| A (fast lane) | `.github/workflows/ci.yml`, hosted | non-draft pull request into `main`; push to `main` only with `CI_MAIN_FAST_LANE=true` | `fast-lane` (tested-base gate tooling, lane scope and proofs, base-ref gates, install, signatures and audit, lint, format, typecheck, unit, build, lane B evidence check; light mode on a docs-only push), `security-integration` (once per code tree on merge-candidate heads that change a security-critical path) | `ci-gate` (lane scope recomputed and compared, gitleaks range, Semgrep, oasdiff, security record; `MERGE-READY` or `BLOCKED: <reasons>`) |
| B (heavy lane) | developer host, Docker Desktop | `npm run quality:heavy -- --profile pr\|wave\|gate` | integration, API, generated suites, merged coverage gate, and every other active suite of `tools/quality/required-suites.json` | committed `docs/05-quality/*/runs/<stamp>_<sha7>/summary.json`, checked by lane A |
| C (full lane) | `.github/workflows/lane-c.yml`, hosted | `workflow_dispatch` only | static, integration (merged coverage, US-006 gate), images, e2e-stack (one shard per engine), iac, scans-full, inventory | `lane-c-gate` |
| nightly | `.github/workflows/nightly.yml`, hosted | `workflow_dispatch` only (no schedule) | dependency freshness report, gitleaks over the full history | job conclusions |

### Light mode and proofs (lane A, ADR-0023 amendment L item 1)

The base ref's `tools/ci/lane-scope.mjs` classifies the **push** (`github.event.before` → head; without a usable
`before`, the PR range). A push whose every path is in `DOCS_ONLY_PATHS` (`docs/**` minus the API contract and the
manifest's `tooling_inputs`, `.claude/**` minus `.claude/settings.json`, `*.md` outside the code roots; regular files
only) runs `fast-lane` in **light** mode: the `env.CODE` steps (supply-chain gates, lint, format, type-check, unit, build)
are skipped and inherited from a **code proof**, a completed pull-request run on a commit whose tree differs from the
head only in docs, whose code steps and gitleaks/Semgrep/oasdiff steps concluded `success` (jobs API, read with
`actions: read` by `fast-lane`'s classify step and `ci-gate`, token on the lane-scope steps only). A proof run must be a run of **this**
pull request into `main` (code review PR #46 R2-M1, PR46-SEC-13): its head branch is the PR's (`--head-ref`), the head
branch has exactly one pull request (this one, into `main`), the run lists exactly this PR with base `main`, and it was
created after the PR's last `base_ref_changed` event. An empty or ambiguous `pull_requests` list (a fork, a stacked PR)
is no proof, and lane A runs only for pull requests into `main` (`on.pull_request.branches: [main]`, policy-pinned).
**Never retarget a PR** (D-ORCH-090): a retarget voids every earlier proof and record and needs a full run; close the PR
and reopen it from a fresh branch instead, and never open a second PR from a branch. When a docs push finds no proof
(`ci-gate`: `no code proof for this tree`; the lane-scope summary names the binding problem), closing and reopening the PR
runs the full lane on the same head (a `reopened` event has no push range, so the PR range decides). The binding needs
`pull-requests: read` on `fast-lane` and `ci-gate` (policy-pinned). Every other gate runs on the exact head.
`ci-gate` is red when a code push ran light or skipped a code step, when a docs push has no proof, or when a
classification output is empty. Pull-request runs queue (`cancel-in-progress: false`), so a full run is never
cancelled by a later docs push. GitHub keeps one pending run per PR and replaces it on the next push,
so push the code, let its run start and finish, then push the record or evidence (P2: one docs push per review round);
a docs push that replaces a still-pending code run leaves itself without a proof (red: re-run the replaced code run,
then re-run the docs run).

### Stage 2: the folded topology (amendment L item 3, D-ARCH-128, TASK-286)

The base-ref policy changed the lane A job graph in two steps, policy first. The **policy PR** taught
`check-workflow-policy.mjs` and `lane-scope.mjs` the stage-2 topology next to stage 1: a ci.yml with a `scans` job is
held to the stage-1 pins, one without it to the stage-2 pins, each in full (no mixture passes). The **workflow PR**
installed the stage-2 `ci.yml`. TASK-287 part 287-A retired the stage-1 topology (PR55-SEC-10, D-TASK286-01a,
D-ARCH-140): the stage-1 pins, gate rules, classify call and fixture are gone, and a `ci.yml` that restores a `scans`
job is a `required-gates` finding. In stage 2:

- `fast-lane` takes its gate tooling from the **tested base** `TOOLS_REF`: on a pull request the first parent of
  GitHub's test merge (`HEAD^1`, the current `main`; `HEAD^2` must be the PR head and the event's base an ancestor),
  on a push the pushed range's base (PR46-SEC-17). A PR whose merge base predates a tool (PR #53, D-ORCH-103) therefore
  starts lane A without a union. The lane B evidence verifier, the lint fixtures and the `security-integration`
  manifests come from `TOOLS_REF` too.
- `fast-lane`'s classify step (the only fast-lane step whose env holds the token, before any head code; the job's
  `actions: read` and `pull-requests: read` scopes are an accepted D-ARCH-128 trade-off, PR55-SEC-06) classifies the
  push and looks up the proofs. A proof is void when, after the proof run was created, the tested base gained a
  first-parent commit touching a lane A input: `.github`, `prisma`, `tools/ci`, `tools/quality`, `tools/deps`, the
  lint controls (`tools/eslint-rules`, `tools/stylelint-rules`, `tools/lint`, `tools/test-support`,
  `tests/fixtures`, `.semgrep`), root non-Markdown files, the manifest's `tooling_inputs`, **or any path the PR itself
  changes** (P1 (b); PR46-SEC-16 as widened by PR55-SEC-03, D-TASK286-06). A semantic conflict between files that only
  one side changed, outside that set, is left to the D-ORCH-042 post-merge gate. A base change is dated by its
  committer time: a squash merge lands with its landing time, so push `main` commits that touch these paths right
  after creating them (PR55-SEC-04 residual). Since TASK-287 a docs push of a PR with code changes runs the full lane at
  once (`code_changed=true`, `mode=full`, `push_scope` stays `docs`) only when no bound run on its code that failed
  on the code survived the tested-base check, and at least one voided run would have been a proof (none of its fast-lane
  or scans steps failed, was cancelled or skipped; a step the current workflow added since is ignored):
  the code must run on the new base before the merge anyway, and the full run (about 8-10 billed minutes) is cheaper
  than the blocked light run plus that re-push (SPK-07 section 6.1; D-TASK286-06a option; PR #62 code review R1-m1).
  (TASK-287 parts 287-B/287-C1: a cancelled, superseded or light newer run does not count against it.) With no
  candidate, a red voided run, or a newer non-voided run that failed on the code, the push stays light and ends
  `BLOCKED: no code proof`; push a code change, or close and reopen the PR with no new commits (D-ORCH-135). Commitlint, actionlint and the head-code checks run only on a code push; the
  install, registry signatures and the advisory audit run on **every** push (PR46-SEC-11, D-TASK286-03), and when the
  PR range touches a lint control the lint-fixture steps must have succeeded in this run or the proof (R1-n1).
- `security-integration` needs `fast-lane` only. `ci-gate` is last and holds the former `scans` steps: it recomputes
  the classification with the tested base's `lane-scope.mjs`, re-reads the proofs under the same binding, runs
  gitleaks and the record check on every head and Semgrep/oasdiff unless a docs push has a code proof, and is red when
  its classification differs from `fast-lane`'s (PR46-SEC-12). When the aggregation step carries fast-lane's separate
  outputs (`FAST_LANE_MODE`, `FAST_LANE_CODE_PROOF`, `FAST_LANE_SECURITY_INTEGRATION_DUE`, `FAST_LANE_TOOLS_REF`; the
  policy requires all four with exactly these values since TASK-287 part 287-B, PR62-SEC-02) each must equal ci-gate's
  own value (PR55-SEC-05). Measured bill: code push 8-10 billed minutes; docs push with a proof 3.5 (the first one
  measured 4; SPK-07 section 6.1).

### security-integration (lane A, amendment G item 5 as amended by L item 2)

Selected by the base-ref lane scope when the PR range changes `packages/authz/**`, `packages/audit/**`,
`packages/config/**`, `prisma/**`, `apps/api/src/platform/**`, `apps/api/src/modules/identity/**`, the suites' own
code paths `jest.config.ts`, `tools/test-support/**`, `tools/db/**`, `tools/deps/**`, `tests/generated/rls/**` and
`tests/generated/api-mounts.ts` (their `*.test.ts` files and `tools/db/fixtures/**` excluded; PR57-SEC-02,
D-SEC-PR57-01, about 20-30 extra job-min a month) or makes a
production-closure `package-lock.json` change (an entry without `dev: true`, so a `devOptional` Prisma CLI or engines
bump selects, D-ARCH-133; dev-only bumps do not select; a new or unparseable lockfile does),
**and** the head is a merge candidate (security record check `pass` or `not-required`), **and** no
`security-integration` success exists on a code-identical commit. It runs after `fast-lane` succeeded (the supply-chain
gates passed on this tree), every `active` suite of the base manifest's `security_integration_suites` with its lane B
runner entry on ubuntu with Testcontainers (`tools/ci/security-integration.mjs`). `ci-gate` requires its success in the
run or an inherited security proof; until then it reports `security-integration pending (record missing | not run)`.
Degraded mode never applies to these paths.

### Lane B on the shared host: the serial queue and the prerender re-run rule (interim)

*Added 2026-11-19 by principal-architect (D-ARCH-158; ADR-0023 amendment O). This section is the single copy of the
rule. TASK-294 part 294-A rewrites it with the outcome of its measurement, before G3.*

Lane B runs one at a time on the developer host (D-ORCH-125). Agents do not start `quality:heavy` themselves: they
prepare a clean evidence worktree at their final head, and the orchestrator's queue runs it when no Testcontainers
container is running and at least 7 GB of memory is free. The queue script is orchestrator tooling outside the
repository.

One kind of `INVALID` run has its own rule, because its cause is a fixed limit inside the build tool and not the change
under test. The build-time prerender of `apps/web` gives each request 10 s and no retry (`@react-router/dev` 8.5.1;
`prerender.concurrency` is its only setting), and on a loaded host the first request, `/en/`, has run into that limit
(D-TASK020-99/-100, D-ORCH-127).

1. **Signature.** Both hold: (a) the verdict is `INVALID` with the reason `npm run build failed or timed out; suites
   were not run`; (b) the run log of that attempt, which is the console output of `quality:heavy` and not `summary.md`,
   has one line that contains `Prerender: Request failed for /` or `Prerender: Request timed out for /` and also
   `aborted due to timeout`. The wording is read from the plugin source, because no failing log was kept: the first use
   quotes the real line in its record. Any other build failure is outside the rule, a build that reaches
   `--build-timeout-min` included.
2. **Action.** The queue runs the same commit once more, with the same command line and the same preconditions. The run
   directory of the first attempt is moved aside and never committed.
3. **Accounting.** The re-run is not a fix cycle (CLAUDE.md section 7) and not a finding against the change. The
   verdict of the second attempt is the verdict of the run. Each use is recorded in the DECISIONS entry that reports
   the run: the commit, both stamps, the quoted signature line, and the free memory at the start of the first attempt.
4. **Limits.** One re-run per commit. If the second attempt is `INVALID` with the signature again, there is no third
   attempt, and TASK-294 part 294-A becomes the next queue job. The same applies at the second use of this rule within
   20 consecutive queue runs: two such failures in 20 runs do not fit a failure rate below 1 %.
5. **Outside the rule.** The product build stays one un-retried `react-router build` in the workspace script, the
   Dockerfiles, lane A and lane C: no wrapper script, no patch, fork or `overrides` entry (D-ARCH-146). When the change
   under test touches `apps/web/**`, `packages/ui/**` or the `@react-router/*` or `vite` entries of
   `package-lock.json`, the use is also named in that change's code review, because the change itself may have moved
   the time of the first request.

## 2. Dispatching lane C and nightly

Check the month first (section 4), then dispatch on the SHA to judge (the run's ref is both the code and the workflow
definition):

```bash
gh workflow run lane-c.yml --ref main -f profile=wave-end -f since=<SHA of the previous wave end>
gh workflow run lane-c.yml --ref main -f profile=release-candidate          # before G3, G4, per release candidate
gh workflow run nightly.yml --ref main -f job=gitleaks-full                  # or dependency-freshness, all
gh run watch "$(gh run list --workflow lane-c.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

- `wave-end` reports a missing Compose stack (`compose.yaml` / `npm run test:stack`, TASK-014) and continues;
  `release-candidate` fails on it.
- `webkit_repeat_each` (`5` or `1`): WebKit repetitions for COND-E2E-FF; keep `5` until qa-lead closes the condition.
- `since`: lane B runs added after that commit are cross-checked by `inventory`; empty = the newest lane B run.
- For a gate run, the orchestrator downloads the `lane-c-evidence` artifact (`inventory.json`, `coverage-summary.json`)
  and commits it with the gate evidence (TEST-STRATEGY section 15 item 3). Lane C has no write token.
- A workflow file that is not on `main` yet cannot be dispatched (GitHub rule): lane C and nightly changes are first
  exercised by the first dispatch after their PR merges.

## 3. Inventory cross-check (lane C)

`tools/quality/inventory.mjs` counts, per active Jest suite of the manifest, the tests lane C ran per file (through the
suite's `suite-runners.json` projects and paths) and compares them with the committed lane B JUnit:

- `missing-suite`: lane B ran tests in a suite, lane C none (any reference run);
- `lower-count`, `linux-fail`: a file with fewer tests, or failures only on Linux, against a lane B run of the same code
  (its commit is in the clone and differs only under `docs/` or `.claude/`).

A discrepancy fails the wave end; the orchestrator logs it in DECISIONS.md and reverts the offending PR
(ADR-0023 amendment G item 6). Playwright counts are recorded per engine and compared once lane B has e2e runners.

## 4. Minutes budget

```bash
npm run ci:minutes                    # this month (UTC), estimate per job, guard level, lane A per-run figures
npm run ci:minutes -- --forecast --planned 75   # month forecast (rate x remaining UTC days + planned lane C), guard dates
npm run ci:minutes -- --month 2026-11 --json
npm run ci:minutes -- --billing       # also asks the billing report (needs a token with the `user` scope)
```

The estimate applies GitHub's private-repository rule (each job rounded up to a whole minute, Linux x1); the billing
page is authoritative. Dependabot runs (standard runners) are not billed and are listed apart. Guards (ADR-0023
amendment L item 4, D-ARCH-129): **forecast** ≥ 70 % → tier-1 lane C only (≤ 1 `wave-end` a month), process levers
P1/P2 mandatory, `CI_MAIN_FAST_LANE` stays `false`; **actual** ≥ 90 % → lane C for gates only, except a tier-1
`wave-end` already planned, up to a hard stop at 95 %; 100 % → degraded mode (`npm run quality:fastlane` locally).
`nightly.yml` is dispatched only together with a `wave-end` run. Run `--forecast` every Monday and at each wave-exit
checklist (P4). The measured figures and the forecast are in [SPK-07](../04-plan/spikes/SPK-07.md).

## 5. Rules the workflow policy enforces

`tools/ci/check-workflow-policy.mjs` (lane A, from the base ref) checks every workflow: actions pinned by commit SHA,
container tools by digest, read-only top-level permissions, no privileged triggers, no secrets in pull-request jobs,
fail-closed jobs and steps; the GitHub token only as `GH_TOKEN` on the lane-scope steps (stage 1: a step of `scans` or
`ci-gate` that runs the lane-scope tool; stage 2: exactly `fast-lane`'s classify step and `ci-gate`'s lane-scope and
aggregation steps, found by gate position and exact text, PR55-SEC-09), the only jobs that hold `actions: read` and
`pull-requests: read` (never at workflow level, never in another workflow; PR46-SEC-15); the tooling, lane-scope,
`security-integration` and `ci-gate` steps pinned to exact text, gate tools called as `"${GATE_*:?}"` in stage 2. In
stage 2 every fast-lane gate from the classify step to the lane B evidence step (workflow policy, install flags,
migration immutability, lockfile, dependency age, install, licences, signatures, audit) and `ci-gate`'s gitleaks,
Semgrep and record steps are exact, contiguous and carry no step env; `fast-lane` and `security-integration` use only
`actions/checkout`, `actions/setup-node` and `actions/cache`, each with exactly its pinned `with:` map (checkout:
`fetch-depth: 0`, `persist-credentials: false`, no `ref`/`repository`; setup-node and the engine cache as in ci.yml;
the same for `ci-gate`), so none of those inputs can move the checkout (PR59-SEC-01 item 1). Since TASK-287 part
287-C1 each action step has exactly the keys `name`, `uses` and `with` (fast-lane's engine cache also its exact
`if: env.CODE == 'true'`) and each action its exact commit, verified against the upstream tag (`STAGE_2_ACTION_COMMITS`:
checkout v7.0.1, setup-node v7.1.0, cache v6.1.0; PR62-SEC-01); each of the three jobs has an exact key set and
`runs-on: ubuntu-24.04` (PR287B-SEC-02). An action bump is a policy change first, then the ci.yml change. On a runner
`lane-scope.mjs` (tested-base tooling) exits 2 unless `HEAD` is the event commit `GITHUB_SHA`, and both tooling steps
carry the same check in bash before the tested-base lines (V2, the only accepted text since TASK-287 part 287-B;
PR59-SEC-01 item 2, PR62-SEC-02). **Residual (ADR-0023 am. N item 3):** a PR that edits `ci.yml` controls its own
workflow in that run, and `checkoutProblem` runs from the `HEAD^1` that run's checkout chose. So for every PR that
changes `.github/workflows/**` the merge rule stays: a security record names the PR's code head (D-ORCH-116,
PR59-SEC-01 (3)). The record may sit on the PR branch or already on `main`: main's copy reaches the record check
through the merge ref, so either satisfies the rule. The workflow env has exactly the install settings and the four image pins (PR55-SEC-01/-02). `$GITHUB_ENV` is written only by the pinned tooling and classify steps (PR46-SEC-12;
a lexical tripwire for the head-code steps, which are not exact). In every workflow, an `actions/cache` (or
`cache/restore`, `cache/save`) step whose `path:` would restore `node_modules/.cache/shipqube-test-locks/` (the
test locks of TASK-288) must exclude it with a `!node_modules/.cache/shipqube-test-locks` line (`cache-hygiene`;
D-SEC-PR57-02). In every workflow, at every level: no
`BASH_ENV`, `ENV`, `PATH`, `NODE_PATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `LD_AUDIT`, `SHELLOPTS`, `BASHOPTS`, `PS4`,
`IFS`, `BASH_FUNC_*`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`/`KEY_<n>`/`VALUE_<n>`, `GIT_EXTERNAL_DIFF`, `HOME`,
`XDG_CONFIG_HOME` or `NPM_CONFIG_SCRIPT_SHELL`/`USERCONFIG`/`GLOBALCONFIG`/`NODE_OPTIONS` entry, in any case
(`preload-env`; PR55-SEC-01, PR #55 R2-n1), and every non-empty `env:` is a mapping, never an expression
(`env-expression`). The ci.yml workflow env has exactly the install settings and the four image pins in both topologies
(PR55-SEC-11). A step whose
`run:` is exactly `npm run lint` must have exactly `NODE_OPTIONS: --max-old-space-size=4096`, and no `NODE_OPTIONS`
holds `${{ }}` (PR42-SEC-18; other spellings of the lint script are not matched, PR #55 R1-n2). On top of that:
`lane-c.yml` and `nightly.yml` are `workflow_dispatch` only; ci.yml,
lane-c.yml and nightly.yml never publish, push, apply or assume a cloud role; Playwright browsers (and apt through
`--with-deps`) are installed only in lane-c.yml, and only through `npm run deps:rebuild`, which refuses Playwright and
Prisma download redirects.

## 6. Node base image: major, security releases and hand bumps

*Added 2026-11-22 by devops-engineer (PR87-SEC-01 (a) to (c), D-SECCHORE-01; D-DEVOPS-005).*

The five image Dockerfiles (api, worker, web, admin, prisma) share one `node:<version>-trixie-slim@sha256:…` base,
which must be byte-identical everywhere (check-dockerfiles `runtime-codename` (b)). ADR-0001 fixes Node 24 LTS.
Three controls keep it there:

1. **Major (static, lane A and lane B unit).** check-dockerfiles rule `node-major` fails when a `node:` FROM has a major
   other than `.node-version`'s or a version outside `engines.node` of the root `package.json`. It fails closed when
   either file is unreadable. The repository test `tools/ci/check-dockerfiles.test.ts` (repository Dockerfiles) runs it
   in every unit run, so a Node 26 base fails before an image build.
2. **Dependabot.** The `docker` ecosystem ignores `node` versions `>= 25.a`, an absolute range rather than the
   semver-major update type, which is relative to the version in the file. Note a race: a Dependabot job carries the
   configuration of the commit that triggered it but clones the default branch when it starts. #90 came from the job
   triggered by #86's push, which still had no node ignore, and it ran against the tree after #87. The job triggered
   by #87 applied the ignore and proposed nothing. No configuration can close that race, so control 1 does.
3. **Security releases (local, zero hosted minutes).**
   `node tools/ci/check-node-security.mjs` compares the pin with the newest release of the same major that
   <https://nodejs.org/dist/index.json> marks `security: true`. It exits 0 if the pin is current, 1 if it is behind and 2
   if the check could not run (no network, ambiguous pins). `--index <file>` reads a saved copy instead of the network.
   The orchestrator runs it at each session start and before G3 and G4, and the devops engineer runs it after every
   Node security announcement.

**Hand-bump rule for Node security releases.** Dependabot's 7-day cooldown delays a security release by a week. When
`check-node-security` exits 1, or nodejs.org announces a security release that covers the pinned major, a
devops-engineer chore PR bumps all five FROM lines in one commit within 2 working days. The bump goes to the security
release's `node:<x.y.z>-trixie-slim` tag at its current index digest, read from Docker Hub. It does not wait for the
cooldown, because that week of delay is the exposure this rule removes (#50 offered 26.13.0 five days after the 26.13.1
security release). The same PR moves the
`debian:trixie-slim` runtime pin if that image was rebuilt (D-ARCH-116 rule 3). Lane B runs on the head, and the PR
records the advisory, the old and new versions and the digest source. A new **major** is never a hand bump: it needs a
superseding ADR that moves `.node-version`, `engines`, CI and images together.
