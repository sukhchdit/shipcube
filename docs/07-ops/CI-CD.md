# CI/CD: lanes, workflows and the minutes budget

Operator view of the pipeline as built in Wave 0 (TASK-007, TASK-011, TASK-015). The design and its reasons are in
ADR-0023 (amendments A to L) and D-ORCH-001 / D-ARCH-010; the test-side rules are in
[TEST-STRATEGY section 4](../05-quality/TEST-STRATEGY.md). Every `node`/`npm` command below runs with the CLAUDE.md
section 2 PATH prefix on the Windows host. Nothing in this pipeline deploys, pushes images or applies infrastructure yet
(`DEPLOY_TARGET_*` blank, `CLOUD_BUDGET_MONTHLY_USD` = 0).

## 1. Lanes

| Lane | Where | Trigger | What | Verdict |
|---|---|---|---|---|
| A (fast lane) | `.github/workflows/ci.yml`, hosted | non-draft pull request into `main`; push to `main` only with `CI_MAIN_FAST_LANE=true` | `fast-lane` (base-ref gates, install, lint, format, typecheck, unit, build, lane B evidence check; light mode on a docs-only push), `scans` (lane scope and proofs, gitleaks range, Semgrep, oasdiff, security record), `security-integration` (once per code tree on merge-candidate heads that change a security-critical path) | `ci-gate` (`MERGE-READY` or `BLOCKED: <reasons>`) |
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
`actions: read` by `scans` and `ci-gate`, token on the lane-scope steps only). A proof run must be a run of **this**
pull request into `main` (code review PR #46 R2-M1, PR46-SEC-13): its head branch is the PR's (`--head-ref`), the head
branch has exactly one pull request (this one, into `main`), the run lists exactly this PR with base `main`, and it was
created after the PR's last `base_ref_changed` event. An empty or ambiguous `pull_requests` list (a fork, a stacked PR)
is no proof, and lane A runs only for pull requests into `main` (`on.pull_request.branches: [main]`, policy-pinned).
**Never retarget a PR** (D-ORCH-090): a retarget voids every earlier proof and record and needs a full run; close the PR
and reopen it from a fresh branch instead. Every other gate runs on the exact head.
`ci-gate` is red when a code push ran light or skipped a code step, when a docs push has no proof, or when a
classification output is empty. Pull-request runs queue (`cancel-in-progress: false`), so a full run is never
cancelled by a later docs push. GitHub keeps one pending run per PR and replaces it on the next push,
so push the code, let its run start and finish, then push the record or evidence (P2: one docs push per review round);
a docs push that replaces a still-pending code run leaves itself without a proof (red: re-run the replaced code run,
then re-run the docs run).

### security-integration (lane A, amendment G item 5 as amended by L item 2)

Selected by the base-ref lane scope when the PR range changes `packages/authz/**`, `packages/audit/**`,
`packages/config/**`, `prisma/**`, `apps/api/src/platform/**`, `apps/api/src/modules/identity/**` or makes a
production-closure `package-lock.json` change (dev-only bumps do not select; a new or unparseable lockfile does),
**and** the head is a merge candidate (security record check `pass` or `not-required`), **and** no
`security-integration` success exists on a code-identical commit. It runs after `fast-lane` succeeded (the supply-chain
gates passed on this tree), every `active` suite of the base manifest's `security_integration_suites` with its lane B
runner entry on ubuntu with Testcontainers (`tools/ci/security-integration.mjs`). `ci-gate` requires its success in the
run or an inherited security proof; until then it reports `security-integration pending (record missing | not run)`.
Degraded mode never applies to these paths.

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
fail-closed jobs and steps; the GitHub token only as `GH_TOKEN` on the lane-scope steps of `scans` and `ci-gate`,
the only jobs that hold `actions: read`; the lane-scope step, the `security-integration` job and `ci-gate` pinned to
exact text. On top of that: `lane-c.yml` and `nightly.yml` are `workflow_dispatch` only; ci.yml,
lane-c.yml and nightly.yml never publish, push, apply or assume a cloud role; Playwright browsers (and apt through
`--with-deps`) are installed only in lane-c.yml, and only through `npm run deps:rebuild`, which refuses Playwright and
Prisma download redirects.
