# Code review: PR #46, TASK-015 part 015-B (lane C, nightly, security-integration, C-1, ci:minutes, SPK-07, COND-E2E-FF, gitleaks-full runner), round 1

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The workflows are well built and fail closed where it matters: the base-ref classifier, the "no active suite"
         refusal, ci-gate's skip rule, the dispatch-only and no-release rules, and the C-1 deletion in one commit.
         ONE MAJOR: the lane C inventory cross-check reports a false `lower-count` on any file whose tests share a name.
         It fires deterministically on the first same-code wave-end run, and the ADR treats a discrepancy as revert-the-PR.
         Seven MINORs, mostly unpinned tripwires and test gaps (20 of 37 mutants survived), plus the minutes forecast.
```

| Field | Value |
|---|---|
| PR | #46 `feat/TASK-015-b-lane-c-nightly` |
| Head reviewed | `12ea6a6647ad3b9e7aae48adfb24f37c0f428856` (code head `fa8f6e2`; main has since moved by one docs-only commit `47f942d`) |
| Reviewer | code-reviewer (round 1), 2026-11-14 |
| Scope | `git diff origin/main...12ea6a6`: 52 files, +22,727 / −945. Evidence JSON/XML (about 18.6k lines) was read only for counts. |

## 1. Verification performed

The dispatch allowed light commands only, with no Docker and no workflow triggers. Everything below was run by me on the head unless stated otherwise.

| Check | Result |
|---|---|
| New and changed tool tests (`tools/ci/{ci-minutes,lane-c-policy,security-integration,security-paths,check-workflow-policy,ci-policy}.test.ts`, `tools/deps/rebuild-playwright.test.ts`, `tools/quality/{gitleaks-full,inventory}.test.ts`), paths passed positionally | 9 suites, 248 passed. With `heavy.test.ts` added in the scratch copy: 282 passed. |
| Prettier on every changed non-evidence file | clean |
| ESLint `--max-warnings 0` on every changed `.mjs`/`.ts` | exit 0 |
| `node tools/ci/check-workflow-policy.mjs --root .` (all three workflows) | exit 0 |
| Base-ref `check-evidence` (`git archive origin/main tools/quality` into the scratchpad, `--event pull_request --base origin/main --head HEAD`) | **PASS** (run `20261114T1124Z_fa8f6e2` accepted) |
| `gh pr view 46` status on `12ea6a6` | fast-lane SUCCESS, security-integration SUCCESS, scans FAILURE (security record not yet committed), ci-gate FAILURE for that reason only |
| C-1 commit `8d83468` | One commit holds all three parts: the spike file (−903), the `TENANT_CONTEXT_EXEMPTIONS` entry (−3) and the one-off ci.yml C-1 steps (−26). The ported server-side p95 ≤ 1 ms assertion exists (`prisma/tests/rls/with-tenant-tx.int.test.ts:526`). No live reference to the spike remains (one stale comment, N3). |
| Mutation run (scratch copy, `git archive` + node_modules junction, one jest run per mutant) | 37 mutants: 17 killed, **20 survived** (table §4) |
| Inventory duplicate-name probe (real Jest JSON of 2 files vs the committed lane B `unit.junit.xml`) | false `lower-count` on 2 files (M1) |
| npm env-export probe (npm 11.19.1) | `.npmrc` and `package.json` `config` keys reach Playwright as `npm_config_*` / `npm_package_config_*`. The new refusal misses them (m3). |
| `.git/info/attributes` probe (git, `.git`-only) | `* -diff` turns `git log -p` content into "Binary files differ"; `--text` restores it (m5) |
| Playwright 1.65 JUnit reporter source | A flaky test (failed, then passed on retry) gets no `<failure>` element (m4) |
| Unions with PR #39 / #42 (`git merge-tree`) | Details in §6 |

**Not re-run:** `npm run typecheck`, `npm run build`, full `test:unit`, coverage and lane B (`quality:heavy`, Docker). For those I relied on the author's gate table, the lane B run `20261114T1124Z_fa8f6e2` (which I re-verified with the base-ref checker) and lane A run 43590778652 on `12ea6a6`. `gitleaks-full.int.test.ts` and actionlint were not re-run because both need Docker.

## 2. Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| **M1** | **MAJOR** | `tools/quality/inventory.mjs:76-102` (`jestFileCounts`) | **Duplicate test names produce a false `lower-count`.** Lane C de-duplicates by `file + fullName` to merge a test seen in two reports. That also collapses tests in ONE file that share a full name. Lane B JUnit keeps every case, so the counts differ. The committed lane B `unit.junit.xml` already has 3 such pairs (`prisma/seed/migrator-connection.test.ts` ×1, `tools/db/tenant-key-forms.test.ts` ×2). Probe: real Jest JSON for those 2 files gives 72/28; the lane B JUnit gives 74/29; `compare(... same_code: true)` returns two `lower-count` discrepancies. `same_code` is reachable today: `sameCode(fa8f6e2, 12ea6a6)` = true, and merged branches are not deleted (`git ls-remote` lists `feat/TASK-020-*` and this branch), so their commits are in a `fetch-depth: 0` clone. The suggested first dispatch on main right after this PR merges therefore reports DISCREPANCY. ADR-0023 am. G item 6 then logs an incident and reverts the PR. | Count multiplicity per report: for each `(file, fullName)` take the MAX occurrence count across reports, not 1, and keep "failed wins". Add a unit case with two identical `fullName`s in one report (expect 2), and a case with the same test in two reports (expect 1). |
| m1 | MINOR | `.github/workflows/ci.yml:514-545`; `tools/ci/check-workflow-policy.mjs:1107-1113`; `tools/ci/ci-policy.test.ts` (new security-integration test); `tools/ci/security-integration.mjs:137-140, 201` | **The security-integration controls are tripwires and nothing pins them.** The base-ref policy checks only that `ci-gate` needs the job. The head ci-policy test uses `toContain` on prefixes. Each of these mutants passes the PR's tests AND `check-workflow-policy`: (W1) append `--dry-run` to the step, after which the script exits 0 without running Jest (I7: dry-run returns 0 even with plan errors); (W2) add `if [ "$SECURITY_INTEGRATION" = "failure" ]; then security_ok=true; fi` to ci-gate; (W3) `-n` → `-z`, so the HEAD manifests are always used and a PR drops or activates its own suites. W4 (empty classifier output accepted) is killed by ci-policy, but the base-ref policy still exits 0. This is the same class as PR #23 R2-n3 and PR #33 R1-m2. | Add a `requiredGateFindings` pin in check-workflow-policy (base ref): the security-integration `if:` and run text exact, the manifest step's commands line by line (as for BASE_LINT_FIXTURES_SCRIPT), and the ci-gate aggregate lines exact. Use `toBe` in ci-policy. Make `--dry-run` refuse (exit 2) when `GITHUB_ACTIONS=true`, or drop it from the gate script. Add swap-style mutation tests (appended flag, extra `security_ok=true`, `-z`). |
| m2 | MINOR | `tools/quality/gitleaks-full.mjs:194-197`; `gitleaks-full.test.ts` | **The core D-TASK015-39 property is unpinned: config and baseline come from `--ref`, not HEAD.** Mutants G5 (`.gitleaks.toml` from `HEAD:`) and G6 (baseline from `HEAD:`) survive. Every test builds a repo where HEAD equals the ref. In lane B the ref is the base, so this is what stops a PR from widening its own allow-list. G4 (exit status ignored when the report is an empty array) also survives. | Unit test with a temp repo: commit A (17-line valid baseline), then commit B on top changing the baseline to a commit-less line. `--ref A --scan B` must get past validation (stub `docker` on PATH, or export a `readInputs(root, ref)` and assert its text equals `git show A:…`). `--ref B` must exit 2. |
| m3 | MINOR (security flag) | `tools/deps/rebuild.mjs:129`; `tools/ci/check-workflow-policy.mjs:105` | **The Playwright redirect refusal misses npm's channels.** Playwright's `getFromENV` (`playwright-core/lib/coreBundle.js:9081`) falls back to `npm_config_<name>` and `npm_package_config_<name>`. Probe with npm 11.19.1: a `.npmrc` line `playwright_download_host=…` and a `package.json` `"config": {"playwright_webkit_download_host": …}` both reach the `npm run` child as `npm_config_playwright_download_host` / `npm_package_config_playwright_webkit_download_host`. The anchored `^PLAYWRIGHT_` regex sees neither, and `deps:rebuild` runs `playwright install` through `npm exec`. Workflow env `NPM_CONFIG_PLAYWRIGHT_DOWNLOAD_HOST` is also not matched by the policy regex. This is the PR4-SEC-08 residual the PR says it closes. | Use `/^(?:npm_config_\|npm_package_config_)?playwright_(?:[a-z]+_)?download_host$/iu` in both places (the policy one case-insensitive too). Add fixtures/tests for the `.npmrc` and package `config` channels (`runNode` with `env: {npm_config_playwright_download_host: …}`). |
| m4 | MINOR | `tests/e2e/playwright.config.ts:29`; `.github/workflows/lane-c.yml:257` | **COND-E2E-FF cannot see flakes.** CI retries once. A test that fails and then passes on retry is `flaky`: Playwright exits 0, and its JUnit has no `<failure>` (reporter source; `includeRetries` is off). `inventory.playwrightCounts` therefore reports 0 failures. The WebKit `--repeat-each=5` run exists to catch exactly the R4-m1 intermittent `lang=en`, and that would be absorbed and the condition closed green. | While COND-E2E-FF is open, pass `--fail-on-flaky-tests` (available in 1.65, `program.js:194`) on the e2e-stack command, or `--retries=0` on the firefox/webkit shards. Optionally set junit `includeRetries: true` so `<flakyFailure>` is recorded. Pin it in lane-c-policy.test. |
| m5 | MINOR (security flag) | `tools/quality/gitleaks-full.mjs:111` | **Lane B gitleaks-full reads the host's `.git/info/attributes` and `.git/config`.** Mounting the common dir keeps `$GIT_DIR/info/attributes` in effect. Probe: `* -diff` there makes `git log -p` print "Binary files … differ", so gitleaks scans nothing, and a textconv driver from `.git/config` would run in the container. Hosted lanes C and nightly have fresh clones; lane B runs on the developer host (the PR23-SEC-05 class). | Add `--text --no-textconv --no-ext-diff` to `--log-opts` (gitleaks appends log-opts to `git log -p -U0`). Pin the string in the docker-args test. Consider the same flags for the ci.yml range scan (harmless there). |
| m6 | MINOR | `tools/quality/inventory.mjs:216-253`; `inventory.test.ts:124-135` | **Reference-run selection is untested, and `wave-end` silently narrows without `--since`.** Survivors: V1 (`:(exclude)docs` dropped from `sameCode`), V2 (`--diff-filter=A` dropped) and V3 (`--since` ignored, newest run only). ADR-0023 am. G item 6 says "every lane B evidence merged during the wave", but an empty `since` compares one run with no warning in the verdict. | Tests in a temp repo: two run dirs added in `since..sha` are both selected; a modified (not added) summary is not; a docs-only diff counts as same code and a code diff does not. For `--profile wave-end`, either require `--since` (exit 2) or record `"references_scope": "newest-only"` in inventory.json and the summary. |
| m7 | MINOR | `docs/04-plan/spikes/SPK-07.md` §6 | **The forecast leaves out the job this PR enables.** "≈ 90 % by month end before any lane C run" counts lane A + Dependabot only. Adding `security-integration` at the measured 2 min/run (≈ 12.7 min/day for the remaining 16.6 days ≈ 210 min) gives ≈ 2,010 min (≈ 100 %) by 2026-11-30, and ≈ 104 % with one Wave-0-exit `wave-end`. The 70 % guard moves to ≈ 2026-11-22. In degraded mode security-path PRs cannot merge, because "degraded mode never applies". This number feeds D-ORCH-077. | Add a "with security-integration" row and the combined 70/90/100 % dates. See §5 for the trigger recommendation. |
| N1 | NIT | `tools/ci/security-paths.mjs:139` / test | The "renames count as both paths" claim is unpinned: S4 (`--no-renames` dropped) survives. Without it, renaming a file OUT of `prisma/**` selects nothing. | One test: `git mv prisma/x.sql tools/x.sql` selects. |
| N2 | NIT | `tools/ci/security-integration.mjs:91, 93-95, 71`; tests | I2 (`security` flag ignored for skips) is equivalent today because every security suite is `zero_skip`. I4 (todo not counted) and I6 (coverage override dropped) survive. Required-case matching is a substring (`SEC-TC-05` ⊂ `SEC-TC-050`, as PR #40 m4). | Pin each with a one-line case; match `\[SEC-TC-05\]` or a word boundary. |
| N3 | NIT | `jest.config.ts:127` | The comment still names `spk03` ("seed.int and spk03"). | Drop it. |
| N4 | NIT | `tools/ci/ci-minutes.mjs` | M3 (PR-event filter) and M4 (cancelled runs in wall-clock) survive. The runs list endpoint caps filtered queries at 1,000 results, which fails silent if a month ever exceeds it (159 runs today). Deleted runs are billed but not listed. Runs are attributed to their creation month. | Assert `total_count <= 1000` (or fail with exit 1). One test each for M3 and M4. Note the deleted-runs and boundary limits in the header. |
| N5 | NIT | `tools/quality/heavy.test.ts` | H1: `{base}` ignoring the run base survives because the test passes `'origin/main'`, which equals `DEFAULTS.base`. | Use a non-default base value. |
| N6 | NIT | `tools/ci/check-workflow-policy.mjs:760` | P5: `id-token: write` in lane-c.yml/nightly.yml has no fixture (the `noRelease` → `isCi` mutant survives). | Add a `nightly-id-token.yml` fixture. |
| N7 | NIT | `tools/quality/inventory.mjs:48-57` | `projectsOf` puts `tests/generated/**/*.int.test.ts` in `integration` as well, but jest.config.ts's `integration` and `api` ignore `/tests/generated/`. inventory.json then overstates `integration` once generated suites run in lane C. `compare` is unaffected because it iterates lane B files. | Mirror `GENERATED_PATH` (int/api exclude it). Better: derive membership from the Jest report's project (`--json` has no displayName per file, so run per project or use `--listTests` per project). |
| N8 | NIT | `security-paths.mjs` list vs the suites' own files | When `rls-cross-tenant`/`csrf-cookie` activate, a PR that only edits `tests/generated/rls/**`, `tests/api/**` or the Testcontainers harness will not select the job. This conforms to the ADR (item 5 paths). | Route to principal-architect/qa-lead: add each active security suite's own paths when it activates. |

## 3. Workflow correctness (focus items)

- **lane-c.yml**
  - Dispatch-only. Inputs reach scripts only through `env:`. `since` is regex-validated twice and `webkit_repeat_each` twice. No `ref` input.
  - `lane-c-gate` requires `success` from all 7 needs. `images` cannot be `skipped` because its steps are conditional, not the job. The `inventory` job runs with `!cancelled()` and fails when the integration artifact is missing.
  - `iac` gives Terraform network only for `init`, with `-lockfile=readonly`.
  - Good.
- **nightly.yml.** Dispatch-only; `dependency-freshness` treats exit 1 as the report. Without `npm ci`, `npm outdated` shows `MISSING` for "current" (it reads node_modules). This is acceptable as a "wanted vs latest" report. Optionally state it in the header.
- **ci.yml**
  - The classifier runs from the base ref (bootstrap from head git objects) BEFORE the scans, and fails closed (unknown base or git error → `true`).
  - `security-integration` runs on `!cancelled() && pull_request && security_paths == 'true'`, after a red scans job too.
  - ci-gate accepts `skipped` only for a non-PR event or an explicit `false`. An empty output, as when scans fails before the classifier, stays red.
  - Draft PRs run nothing (unchanged).
  - All correct. The weak point is that nothing pins it (m1).
- **Base-ref manifest.**
  - The job copies `required-suites.json` and `suite-runners.json` from `RANGE_BASE` and checks out the merge ref.
  - The runner script, `heavy.mjs` `jestArgs` and `jest.config.ts` are HEAD code. The header says so honestly ("not a tamper-proof control").
  - The ci.yml comment "a PR neither drops a suite from its own run" holds only as long as the step text is pinned (m1).
- **Fail closed with no active suite.** `planSecuritySuites` errors on an empty, missing or all-planned list, a missing runner and a non-Jest runner. Mutant I1 is killed. Good.

## 4. Mutation results (scratch copy of `12ea6a6`)

| Area | Killed | Survived |
|---|---|---|
| ci.yml security-integration / ci-gate | W4 | W1 `--dry-run`, W2 accept failure, W3 head manifests (and the base-ref policy exits 0 on all four) |
| security-paths | S2 lockfile | S1 + S3 (each backstops the other; equivalent individually), S4 `--no-renames` |
| security-integration.mjs | I1 fail-closed, I3 bare exit, I5 passing-only | I2 (equivalent today), I4, I6, I7 dry-run exit |
| gitleaks-full | G1 allow markers, G2 rw mount, G3 duplicates | G4, **G5 config from HEAD, G6 baseline from HEAD** |
| inventory | V4 linux-fail | V1, V2, V3 |
| ci-minutes | M1 ceil, M2 multiplier | M3, M4 |
| rebuild.mjs | R1 case, R2 main wiring | – |
| check-workflow-policy | P1 dispatch-only, P2 TERRAFORM_IMAGE, P3 env name, P4 needs | P5 id-token |
| heavy `{base}` | – | H1 |

## 5. Minutes budget (SPK-07 §6): recommendation

**Measured facts I accept:**
- Lane A costs 7 job-min median per PR run (`ci-gate` alone is 14 % of the month, because of rounding).
- `security-integration` costs 2 job-min per run with `catalog-c1-c14`.
- 33 of 45 PRs touch item-5 paths.
- There are 2.6 runs per PR.

**Combined forecast (m7):** November reaches ≈ 100 % on lane A plus `security-integration` alone. With all six suites active, the job by itself is 1,100–1,900 min a month. The present trigger is therefore not sustainable past the next suite activation. Degraded mode cannot absorb it, by design.

**Recommendation to principal-architect (D-ORCH-077 ruling):** keep the control fail-closed, and spend it once per merge candidate instead of once per push.

1. **Label-gated run, unchanged gate rule.**
   - `security-integration` runs only when the PR carries a `merge-candidate` label. The label is read from the event payload: `contains(github.event.pull_request.labels.*.name, 'merge-candidate')`.
   - Do NOT add `labeled` to the trigger types. That would re-run all of lane A for 6–7 min.
   - ci-gate keeps today's rule: classifier `true` + `skipped` = red. A security-path head without the label therefore cannot pass ci-gate, so no head can be merged unproven.
   - The orchestrator applies the label when it dispatches the final round (approvals in hand, last push or evidence commit). That run proves the exact head that merges.
   - Expected cost: about 1.1 runs per PR instead of 2.6, roughly −58 %.
   - Pin the label condition in the base-ref policy (m1) so a PR cannot drop it to force a skip. A dropped label condition makes the job run (more cost), and a forged one cannot make it skip without the classifier saying `false`.
2. **Before the second security suite activates** (the qa-lead manifest PR), measure the per-run cost with the real suites and re-forecast. If it exceeds about 6 min/run, add (b) from SPK-07 §6: per-suite selection inside the job by changed path. `package-lock.json` and `packages/config/**` still select all suites.
3. **Process levers that cost nothing:**
   - Keep PRs in draft during fix cycles (drafts run nothing and get a red ci-gate).
   - One push per round (already D-ORCH-077).
   - Schedule the Wave-0-exit `wave-end` lane C dispatch for early December (after the reset) unless the 70 % guard has not been reached.
4. Paid minutes and a public repository remain human decisions (PLAN.md §8), as D-ORCH-077 says.

## 6. Union hazards (PR #39 TASK-014, PR #42 TASK-025)

- **#46 + #39.** Shared files: `package.json`, `tools/deps/rebuild.mjs`, `tools/ci/check-workflow-policy.{mjs,test.ts}`.
  - `rebuild.mjs` and `package.json` auto-merge; the merged `rebuild.mjs` keeps `playwrightRedirects` and the main wiring.
  - The conflicts in `check-workflow-policy.mjs` (REQUIRED_CODEOWNED_PATHS) and its test (describe blocks) are main's PR43-SEC-04 lines vs #39's PR39-SEC-05 lines. #46 does not cause them; keep both blocks whole (as noted at #43 r2). `apps/api/src/main.ts` is a #39-vs-main conflict.
  - After #39, lane C `images` becomes live. `npm run test:stack -- --ci` passes `--ci` to Jest (valid).
  - Checkov's `dockerfile` framework will then scan #39's real Dockerfiles (CKV_DOCKER_*) for the first time. Run Checkov with the lane C flags on the union before the first `release-candidate` dispatch.
  - Every #39 push touching `prisma/`/`packages/config/` will run `security-integration` once #46 is on main.
- **#46 + #42.** Shared file: `eslint.config.mjs` (auto-merges; #46 only removes the spike entry). `tools/lint/negative-fixtures.test.ts` conflicts #42 vs main, not #46. #42's `required-suites.json` change touches `unit` required cases only, with no `security_integration_suites` change. #42 touches `packages/audit/**` and `apps/api/src/platform/**`, so after #46 merges its next push runs `security-integration`.
- `suite-runners.json` and `ci.yml` are touched by neither #39 nor #42.

## 7. Deviation rulings

| Decision | Ruling |
|---|---|
| D-TASK015-33 lane C in its own `lane-c.yml` | **Accept.** It keeps ci.yml's pinned triggers and the check-evidence `EVENTS` untouched (PR #23 R2-n2). principal-architect owes an ADR-0023 §1 / am. C wording note. |
| D-TASK015-35 no GHCR push | **Accept** ($0 budget). The push moves to the release pipeline task; ADR-0023 am. C note owed. |
| D-TASK015-36 item-5 paths + lockfile from the base ref | **Accept.** It is a superset of the ADR list. See N8 for the suites' own paths. |
| D-TASK015-37 required by ci-gate, runs after a red scans job | **Accept**, subject to m1. |
| D-TASK015-38 C-1 artifact 7 days | **Accept.** The figures are in SPK-03 §4.1 and ADR-0005 W-1. |
| D-TASK015-39 gitleaks-full runner | **Accept** with m2 and m5. |
| D-TASK015-41 inventory rules (same-code only for count rules) | **Accept the design**, with M1 and m6. In practice `lower-count`/`linux-fail` evaluate only against the newest same-code run. Say so in ADR-0023 am. G item 6's verification note. |
| D-TASK015-42 lane C integration via `test:coverage` + `coverage:gate` | **Accept.** |
| D-TASK015-43 Checkov skips CKV_GHA_7 and the fixture folders | **Accept.** The reasoning holds (choice inputs via env, nothing published). Terraform licence: OI-07 (architect). |
| D-TASK015-44 `globalTimeout` 20 min, WebKit 1\|5 | **Accept**, with m4. 20 min covers 130 WebKit runs today. Revisit when the journeys land (T-QA-05), because a CI-only constant fails hard when the suite grows. |
| Deferrals: heavy attachment hook → 015-C (due before G3); `--checkpoint`/`required_from` → dedicated PR or 015-C before v0.1.0-m0; PR10-SEC-19..21 → 015-C | **Accept.** Owners and dates are unchanged. |

## 8. Follow-up closure (from earlier reviews)

- PR #4 R3-n6 (WebKit close hang, CI `globalTimeout`): **closed** by `globalTimeout`.
- PR #4 R4-m1 (WebKit `lang=en` once): local Linux repeat ×5 did not reproduce it. The hosted proof is pending and depends on m4.
- PR #33 015-B owners, gitleaks-full runner: baseline from the base/gate ref (yes), ancestry rather than `--all` (yes). The property is unpinned (m2).
- PR4-SEC-08 residual: partially closed (m3).
- PR #33 R2-m1 (`GATE_*` via `$GITHUB_ENV`): unchanged, 015-C. The new `GATE_SECURITY_PATHS` is written in scans, where no head code runs, so it is not exposed.

## 9. GOOD

- The classifier fails closed on every unknown range, and the step runs before the scans so a red scan cannot hide the selection.
- ci-gate's skip rule distinguishes `false` from an empty output.
- The C-1 lifecycle was done as specified: measure on the hosted runner, record, then delete file + exemption + steps in one commit.
- gitleaks-full validates every baseline line and the exact count BEFORE mounting. It mounts only `.git` read-only, uses `--network none`, makes allow markers inert and scans first-parent ancestry of a full SHA. The image digest is pinned equal to ci.yml's.
- `deps:rebuild` refuses before any step runs, and the policy confines browser installs to lane-c.yml.
- `ci:minutes` never touches a token and states its estimate method. SPK-07 reports measurements, not guesses, and flags its own budget risk.
- `TERRAFORM_IMAGE apply` is caught through the containerised CLI form.

## 10. SECURITY-FLAGS (for security-analyst)

1. m1: the security-integration step, its `if:` and the ci-gate aggregate are unpinned in the base-ref policy (`--dry-run`, accept-failure and head-manifest mutants pass).
2. m3: Playwright download redirect through `npm_config_*` / `npm_package_config_*` (from `.npmrc` / `package.json config`) and `NPM_CONFIG_PLAYWRIGHT_*` workflow env (PR4-SEC-08 residual).
3. m5: lane B gitleaks-full honours the host's `.git/info/attributes` (`-diff`) and textconv.
4. INFO: `HEAVY_RUNNER_LABELS` switches lane C to a self-hosted label repository-wide. Any branch with write access can dispatch lane C on it. Review runner isolation before that variable is ever set.
5. INFO: `security-integration` runs HEAD code (jest config, runner, tests) by design; its value is drift detection, not tamper resistance.

## 11. Merge conditions

1. M1 fixed and tested; m1–m6 fixed in-PR (preferred), or each routed with an owner and a due date before the first lane C dispatch. m7: SPK-07 §6 updated.
2. D-ORCH-077 trigger ruling implemented as planned. If the label design (§5) is used, the label condition is pinned in the base-ref policy.
3. Fresh lane B evidence on the final code head. Lane A green on the exact head: fast-lane, scans with the security record, `security-integration` and ci-gate.
4. A security-analyst record naming the final head.
5. Round 2 = delta: re-run the 37-mutant table (scratch script recipe in §4); expect M1, W1–W3, G5/G6, V1–V3 and the m3 channels killed.


---

# Round 2 (head ad30316)

```
VERDICT: CHANGES_REQUESTED
SUMMARY: Every r1 item is closed and pinned. All 31 re-run r1 mutants are killed, and so are 57 of 67 new mutants on the
         stage-1 code; the policy pins hold (W1-W11 fail the base-ref policy). The two unions are pure, and the heap
         line matches #42/#39. ONE MAJOR: a "code proof" can come from a ci.yml run against ANY base branch. A run
         whose workflow came from an attacker-controlled base forges every step name the proof checks, so ci-gate
         turns MERGE-READY with no real check on that code tree. Two MINORs: ci-gate's own-run step check is
         untested, and `devOptional` (the Prisma CLI and engines) is counted as dev.
```

| Field | Value |
|---|---|
| Head reviewed | `ad3031694a44ea75b3ea6f0f26248860e408150b` (code head `6e94ba4`; `ad30316` adds lane B evidence only) |
| Delta | `12ea6a6..ad30316`: fix commits `5a48afb` (stage 1 + r1 fixes, 29 files), `382a6e1` (SPK-07, CI-CD.md), `6e94ba4` (lint heap); merges `ed67a98`, `814c5bf`; 3 evidence commits |
| Reviewer | code-reviewer (round 2), 2026-11-14/15 |

## R2.1 Verification performed

The dispatch allowed light commands only, with no Docker and no workflow triggers.

| Check | Result |
|---|---|
| Changed tool suites on the head, paths passed positionally BEFORE `--selectProjects unit` (`lane-scope`, `ci-policy`, `check-workflow-policy`, `security-paths`, `security-integration`, `ci-minutes`, `lane-c-policy`, `inventory`, `gitleaks-full`, `heavy`, `rebuild-playwright`) | 11 suites, **408 passed**. `lane-scope.test.ts` = 57 (34 `it` + `it.each` rows). |
| Base-ref `check-evidence` (`git archive origin/main tools/quality`, `--event pull_request --base origin/main --head HEAD`) | **PASS**. Run `20261114T1505Z_6e94ba4` was accepted (it includes `rls-cross-tenant` from #47). |
| Lane A run 43609726745 (jobs API, read-only) | `head_sha` = `ad30316`. fast-lane success with every step success (full mode). scans failed only at the record step. security-integration skipped. ci-gate failed at "Aggregate lane A". This matches the PR comment. The rollup on the PR is the same. |
| Mutation run: scratch copy of `6e94ba4` (`git archive`, node_modules junction, `git init`; script `review/PR-46-cr/mut2.mjs`; one Jest run per mutant; `ci.yml` mutants also run the real `check-workflow-policy.mjs`) | **98 mutants: 88 killed, 10 survived** (table R2.4). The unmutated copy gave 401/401 and policy exit 0. |
| Union purity (`git merge-tree --write-tree P1 P2` vs the merge) | `ed67a98` and `814c5bf`: `git diff --stat <tree> <merge>` is empty for both, so each is byte-identical to a clean re-merge. Main's side is `.claude/**` and `docs/**`, plus `tools/quality/required-suites.json` in `814c5bf` (#47 activation). `origin/main` has moved since only under `docs/`/`.claude/`. |
| Unions with #42 (`96bd37a`) and #39 (`c85d5e5`) | Both conflict ONLY on the lint step's comment lines in `ci.yml`. The `env: NODE_OPTIONS: --max-old-space-size=4096` lines are common and appear once in each merge tree. #42: `eslint.config.mjs` auto-merges. #39: `check-workflow-policy.{mjs,test.ts}`, `rebuild.mjs`, `jest.config.ts` and `package.json` auto-merge. |
| Lockfile probe (`package-lock.json` `packages`) | 131 `devOptional` entries, including `node_modules/prisma` 7.10.1, `@prisma/engines` and `@prisma/config` (R2-m2) |
| Repository PRs into a base other than `main` (`gh pr list --state all --limit 100`) | 0. R2-M1 has not happened yet, but nothing prevents it. |

**Not re-run:** typecheck, build, full `test:unit`, coverage, lane B and actionlint. For these I relied on lane A run 43609726745 (fast-lane full, all steps green on `ad30316`) and the base-ref-verified lane B run `20261114T1505Z_6e94ba4`.

## R2.2 Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| **R2-M1** | **MAJOR** (security flag) | `tools/ci/lane-scope.mjs:443-477` (candidate filter `:452-463`); `.github/workflows/ci.yml:29-30` (`pull_request` has no `branches:`); `lane-scope.test.ts:411` | **A code proof or security proof can come from a run against any base branch, so it can be forged.** `lookupProofs` accepts any completed `ci.yml` `pull_request` run on a commit of the identical set, "any PR". It never looks at the run's base. ci.yml's `pull_request` trigger has no base filter. For a `pull_request` run, GitHub takes the workflow, and every base-ref tool it runs, from the merge commit of head + base.<br>**Attack:** a writer pushes a branch `weak` whose `ci.yml` defines a job `fast-lane` with the 13 required step names (`proofSteps` list, test `:250-264`), a job `scans` with the 3 proof step names and a job `security-integration`, all `run: true`. The writer then opens PR B, `<branch of PR A> → weak`. B's run on commit C (PR A's code head) is `completed`, `pull_request`, path `.github/workflows/ci.yml`, with every named step `success`. PR A's next docs push then gets `code_proof = security_proof = <B's run>:C`. ci-gate rules (a)–(f) all pass (light fast-lane, scans re-run on main's tooling, the record names the docs head), so the result is **MERGE-READY**. Yet lint, unit, build, licences, cooldown, signatures, audit, lint fixtures and the Testcontainers security suites never ran on that code against `main`'s tooling.<br>**The same weakness without malice:** a stacked PR whose base is PR A's branch donates a proof that was evaluated with PR A's OWN head tooling. That breaks the base-ref principle (SEC-P3-31) that the ruling's §3 "against the same base-ref tooling" depends on.<br>**Pre-existing variant (not introduced here, closed by the same fix):** retargeting a PR to `weak` for one push and back to `main` leaves a green ci-gate from the `weak` run on the exact SHA, and D-ORCH-012/013 merges on that.<br>**Why the trigger filter alone is not enough:** an attacker-controlled base supplies the merge commit's `ci.yml`, so it can drop the filter. | **In-PR (preferred):**<br>(1) Bind proofs to THIS PR's head branch. Pass `--head-ref` (`github.head_ref`, pinned in `LANE_SCOPE_RUN`/`PINNED_JOB_ENV`). Accept only runs with `run.head_branch === head_ref`. One extra call, `pulls?state=all&head=<owner>:<head_ref>`, must list only this PR, and its `issues/{n}/events` must have no `base_ref_changed` event. Otherwise give no proof (fail closed: the docs push needs a full run). Branches are one-PR-per-task, so this almost never costs a run.<br>(2) Add `branches: [main]` to the `pull_request` trigger. The base policy only checks trigger names (`CI_TRIGGERS`), so it accepts this. Add a base-ref pin and a fixture. This stops mis-targeted and stacked PRs from producing proofs.<br>(3) Add fake-API cases: a run on another head branch is rejected; a branch with a second PR or a retarget is rejected. Replace the `:411` "other PR accepted" case or narrow it.<br>(4) Orchestrator procedural rule: never retarget a PR; close it and reopen from a fresh branch.<br>**Alternative:** principal-architect + security-analyst rule the residual acceptable under the trusted-agent model. Then (2), (4) and a documented residual are the minimum, and this finding drops to MINOR. RR-1's "other-PR run on the same commit accepted" needs the wording "other PR **into main from the same head branch**" either way. |
| R2-m1 | MINOR | `tools/ci/lane-scope.mjs:604-617` (`gateInputFromEnv().thisRunCodeProblems`) | **ci-gate's read of this run's own step conclusions is untested.** Mutant L10 (`return []`) and mutant L10b (the `attempts/{n}` path dropped) both pass all 57 tests: every gate test injects `thisRunCodeProblems`, and the `--gate` CLI test uses a light push. This is the control that `ci.yml:98-99` relies on: head code that rewrites `CODE` through `$GITHUB_ENV` must make ci-gate red. It is base-ref code, so a regression would silently remove rule (b)'s second half. | Add a unit test of `gateInputFromEnv` with a temp repo whose HEAD has the real `ci.yml`, an env with `GITHUB_REPOSITORY`/`GITHUB_RUN_ID`/`GITHUB_RUN_ATTEMPT=2`, and a fake API. Assert three things: the exact `runs/<id>/attempts/2/jobs` path; a skipped `Unit tests` gives `code gates skipped on a code push (Unit tests: skipped)`; a missing run id gives `this run is not identifiable`. |
| R2-m2 | MINOR (route: principal-architect; security flag) | `tools/ci/security-paths.mjs:207-212` (`devOnly`); ADR-0023 am. L item 2 (b); ruling §3 (3) | **`devOptional` is not dev-only.** In npm, `devOptional` means a dev dependency that is ALSO an optional dependency of a non-dev package. Here that is the Prisma CLI (`node_modules/prisma` 7.10.1, an optional peer of `@prisma/client`), `@prisma/engines` and `@prisma/config` (131 such entries). The integration harness applies the migrations those suites prove with the Prisma CLI (`tools/db/reset.ts`). A lockfile-only Prisma CLI or engines change (within the `package.json` range) therefore does not select `security-integration`. That contradicts the rule's own reason ("a Prisma, adapter or `pg` bump changes the transaction and RLS behaviour"). Today it is masked: a Dependabot bump edits the root entry's `devDependencies`, which selects. The refinement D-TASK015-59 proposes (ignore `devDependencies` in the root entry) would expose it. The implementation follows the ADR text literally, and mutant K8 shows the tests pin that. | Architect amends am. L item 2 (b): `devOptional` counts as production closure, or at least `node_modules/prisma`, `node_modules/@prisma/**` and `node_modules/pg*` always select. Do not adopt the D-TASK015-59 refinement before this. Fix in-PR if the ruling lands in time; otherwise 015-C or TASK-286. |
| R2-n1 | NIT | `lane-scope.test.ts` | Unpinned guards (survivors):<br>• **L1:** the `API_CONTRACT_GLOB` backstop. The test's `INPUTS` already lists `docs/03-architecture/api/**`, so the backstop is never exercised; test with inputs that omit it.<br>• **L12:** the `--is-ancestor` check. The non-ancestor case's tree diff contains code anyway; add a non-ancestor `before` whose tree diff is docs-only.<br>• **L14:** `security_integration_due` ignores `record_ok`. The CLI case has `record_ok=true`.<br>• **L20/L21:** a duplicated job name or step name takes the first match.<br>• **L27:** an empty PR range counts as code.<br>• **P10:** top-level `permissions: actions:` has no fixture.<br>All of these fail closed or are cost-only today, except L20/L21, which need a reviewed `ci.yml` change. | One case each. |
| R2-n2 | NIT | `tools/ci/check-security-owned-paths.test.ts:475` | This is the one unit test that reads committed `docs/**` (the record-format tripwire). Its result is inherited across docs pushes, so a malformed record for ANOTHER PR can merge in a light run and turn every PR's unit lane red. A PR's own record is still parsed by the base-ref record gate on every push. This is the residual the PR comment names; it is accepted. | Optional: have the record gate also parse every changed `PR-*.md` in the push range. Otherwise record it in the security record's residual list. |

## R2.3 Ruling requirements RR-1..RR-11

| RR | Verdict | Notes |
|---|---|---|
| RR-1 lane-scope | **Met, except R2-M1** | Push scope: the `before..head` tree diff when `before` is an ancestor, else the PR range (D-TASK015-50 accepted: a code PR still runs full). The identical set is the first-parent tree diff to the head (union-merge fixture), and modes are guarded. `--lookup` reads step conclusions, never job colour; light, failed, in-progress and current runs are rejected (L4–L7, L16, L24–L26, L33 killed). The API cap is 40 calls and fails closed. `DOCS_ONLY_PATHS` (D-TASK015-51 accepted): `.prettierignore` ignores `docs/` and `*.md`, so format:check is not an inherited input. The only non-`.md` code under `docs/` is `docs/04-plan/generator/*.mjs` (ESLint-ignored, untested, outside lane A), so it is safe. |
| RR-2 lockfile | Met (see R2-m2 on the spec) | Merge-base vs head from git objects; root entry, new, deleted and unparseable all select; dev→prod selects. K1–K8 killed. |
| RR-3 fast-lane | Met | `CODE` = push scope, `LINT_CONTROLS` over the PR range, `mode` output from the classify step (before any head code). A hard-coded `mode` (W12) is unpinned but safety-equivalent: ci-gate's mode-vs-classification check (D-TASK015-55, L19 killed) turns either direction red. |
| RR-4 scans | Met | The step's token, exact run, env, id and order before gitleaks are all pinned; outputs come from one source; `actions: read` (W7, W10 killed). |
| RR-5 security-integration | Met | `if` on `security_integration_due` plus PR46-SEC-01; needs `[scans, fast-lane]`; base-ref manifests only, head copy removed (W3, W5 killed). |
| RR-6 ci-gate | Met; rules (a)–(f) killed (L8, L9, L11, L15, L19, L29–L32, L36) | Untested own-run read: R2-m1. **D-TASK015-52 (`contents: read`) accepted.** The job checks out the merge ref but runs only the base-ref archive (`scans-isolation` now covers ci-gate; P8 killed), with the token on the aggregation step only. Same trust class as scans. |
| RR-7 concurrency | Met (W6 killed) | CI-CD.md:28-32 documents how to recover when a pending code run is superseded. |
| RR-8 policy | Met (P6, P7, P9 killed; P10 NIT) | gh-token, actions-read and pr-secrets fixtures are wired (`check-workflow-policy.test.ts:112-169`). |
| RR-9 ci-minutes | Met (X-M5..M8 killed) | |
| RR-10 SPK-07 | Met | §6:148-152 has the combined forecast (closes m7). The first light run is still pending, as stated. |
| RR-11 | Met / routed | TEST-STRATEGY §4.1 → qa-lead, accepted. `platform.md` §7.8 `cancel-in-progress` wording → architect. |

**Is proof inheritance as strong as re-running for a code-identical tree?** Within one PR into `main`, yes:
- The tree identity is exact: tree diff with modes, symlinks and executables counted as code, and a missing base manifest counted as code.
- A light run cannot chain.
- A failed or cancelled full run gives no proof.
- Every base-ref gate re-runs on the exact head.

Across PRs, no: R2-M1. The time-dependent and base-movement residuals (ruling §3) are unchanged and accepted. One related point for the security record: an inherited `security_proof` does not bind the manifest's `security_integration_suites` version, so a suite activated on `main` after the proof run is not exercised until the PR unions `main` (P1).

## R2.4 Mutation results (copy of `6e94ba4`)

| Area | Killed | Survived |
|---|---|---|
| r1 table re-run (31 of 37; I2/S3 equivalent, P1–P4 killed in r1) | W1–W4 (policy AND ci-policy), S1, S2, S4, I1, I3–I7, G1–G6, V1–V4, M1–M4, R1, R2, P5, H1 (direct probe; its Jest run hit the host-load timeout) | – |
| r1 M1 + fix additions | X-M1 (duplicate collapse), X-V6, X-V7, X-G7, X-I8, X-I9, X-R3, X-M5–M8 | – |
| lockfile rule | K1–K8 | – |
| lane-scope (35) | L2–L9, L11, L13, L15, L16, L18, L19, L22–L26, L28–L33, L35, L36 | **L10, L10b** (R2-m1); L1, L12, L14, L20, L21, L27 (R2-n1) |
| policy code | P6–P9 | P10 (R2-n1) |
| ci.yml stage-1 (policy CLI + ci-policy) | W5–W11 | W12 (safety-equivalent) |

## R2.5 Follow-up closure (round 1)

- **Closed (verified by mutant or probe):** M1, m1 (= PR46-SEC-03), m2, m3 (= PR46-SEC-02, both channels plus the policy fixture), m4 (`lane-c-policy.test.ts:77` pin), m5, m6, m7, N1, N2, N3, N4, N5, N6, N7.
- **Routed, accepted with owner:** N8 (with PR46-SEC-08).
- **(c) Lint heap line, D-TASK015-63: accepted.** It is a size only, with no preload, and it is identical to #42 (D-TASK025-29) and #39. Union: whichever of #46/#42/#39 merges second resolves a comment-only conflict above the shared `env:` block in `ci.yml` and keeps ONE `NODE_OPTIONS` line. `lane-c.yml` exists only in #46.
- **(d) Unions: pure** (R2.1).
- **(e) Test quality:**
  - The 57 lane-scope tests are real-git fixtures plus a fake jobs API, with exact assertions.
  - The policy fixtures cover each RR-8 arm in both directions.
  - Gaps: R2-m1, R2-n1.

## R2.6 SECURITY-FLAGS (for security-analyst)

1. R2-M1: proofs are accepted from runs against any base, so a proof can be forged with an attacker-controlled base workflow. The pre-existing retarget variant also affects the D-ORCH-012/013 merge rule.
2. R2-m2: `devOptional` Prisma CLI/engines lockfile changes do not select `security-integration`.
3. INFO: an inherited `security_proof` is not bound to the current base manifest's suite list (ruling §3 residual; P1 is the control).
4. INFO: the security record's §3 residual list should add R2-n2 (unit tests reading `docs/**` are inherited across docs pushes).

## R2.7 Merge conditions

1. R2-M1 is fixed in-PR per (1)–(3), with fake-API tests, and (4) is recorded as a D-ORCH rule. Alternatively, an architect + security ruling accepts the residual and (2) + (4) land in-PR, which downgrades R2-M1 to MINOR.
2. R2-m1 is fixed in-PR (one test). R2-m2 is ruled by principal-architect, then fixed in-PR or routed with an owner and a due point.
3. Fresh lane B evidence if any code changes. Lane A on the exact final head: fast-lane, scans with the security delta record, `security-integration` (or a verified security proof that satisfies the R2-M1 binding) and ci-gate `MERGE-READY`.
4. A security-analyst delta record naming the final head.
5. Round 3 = delta. Re-run `review/PR-46-cr/mut2.mjs` (paths before `--selectProjects`; add the R2-M1 binding mutants: head-branch check dropped, PR-count check dropped, `base_ref_changed` check dropped). Expect L10/L10b to be killed.
