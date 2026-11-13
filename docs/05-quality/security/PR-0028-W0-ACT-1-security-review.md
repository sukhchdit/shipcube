# PR-0028 / W0-ACT-1: first suite activation (qa-lead) and the lane B activation semantics

| Field | Value |
|---|---|
| PR | #28 `chore(quality): activate unit, integration, api, catalog and migrations suites (W0-ACT-1)`, https://github.com/sukhchdit/shipcube/pull/28, branch `chore/W0-ACT-1-activate-suites`. Reviewed head is `22c6461`. The pushed tip at review time is `d3f2b6d`, a docs-only commit on top (README, TEST-STRATEGY, and removal of the superseded run `0616Z_629a84d`); the `tools/quality` tree is the same object (`430208e`) from the first commit `629a84d` through `d3f2b6d`. Merge base with `main` is `9d188fd`; `main` is now `5107f1e` (`docs/sdlc`, `.claude/agent-memory` and the code-review record only) |
| Head | 22c6461d32aa0400e616d1ed425f1625fb84ebfa |
| Lane A evidence | Run [43381750062](https://github.com/sukhchdit/shipcube/actions/runs/43381750062) on `22c6461` (`pull_request`, base `9d188fd`). **fast-lane `success`.** "Lane B evidence" ran the **base-ref copy** (not the bootstrap branch, no `--report-only`): it printed `no active lane B suite is required for this change; selected suites still planned: unit`, rejected both committed runs and ended `PASS`. "Unit tests": 122 suites, 2592 passed, `tools/quality/activation.test.ts` among them. **scans:** Gitleaks `5 commits scanned, no leaks found`; Semgrep `success`. Only "Security-owned paths need a review record" failed: 2 owned paths (`tools/quality/activation.test.ts`, `tools/quality/required-suites.json`) and no `PR-0028-*` record. `ci-gate` failed as a consequence. This file is the missing record |
| Owned paths changed | 2, per lane A. Every other owned tree is byte-identical to the base: `.github` (`9f6e5fa`), `tools/ci` (`602d395`), `package.json` (`0145163`), `package-lock.json` (`1453a95`). The other 11 files of the net change are docs and evidence |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. Git commands ran in the main checkout against commit SHAs, or in a scratch `git clone --shared` with a `node_modules` junction to the main checkout (both removed afterwards). No git command ran in the PR worktree `Shipqube-W0ACT1`. I read three plain files of its gitdir inside the main checkout's `.git` (`HEAD`, `COMMIT_EDITMSG`, `logs/HEAD`) to see that the remote tip was ahead of the named head, plus the shared `info/exclude`. No install, build, Docker, integration or e2e run: the gate results are the developer's table plus lane A run 43381750062 |

## 1. Summary

PR #28 is the W0-ACT-1 activation that PR #23 R2 required (D-SEC-PR23-02, COND-PR23-2):
- `unit`, `integration`, `api`, `catalog-c1-c14` and `migrations` go `planned` to `active`;
- four SEC-TC IDs that no test on `main` carries move to a new informational key `required_cases_pending`;
- `tooling_inputs` gains the two `tools/quality` inputs;
- `activation.test.ts` adds the active-needs-runner invariant;
- two committed `pr`-profile runs, TEST-STRATEGY/README text and D-QA-014.

**The activation semantics are sound.**
- **(a)** The base-ref checker judges this PR against the old manifest, so nothing is required and both runs are rejected as uncredited (reproduced: exit 0, `required []`). The head checker accepts run `11f1877` at the evidence commit `dbfe4df`. There is no credit path for a `planned` suite: it can never enter `required`, and a run that carries its JUnit is rejected as a whole.
- **(b)** `required_cases_pending` is read by nothing but `activation.test.ts`. A case listed in both places is still required (probe V-E1). The four parked IDs are carried by no test on `main`. Parking or un-parking an ID is a `tools/quality/required-suites.json` edit, which is code-owned and pinned, so it needs a record; the PR that does it is judged by the old `required_cases` (SEC-P3-31).
- **(c)** The D-SEC-PR23-02 interim controls hold (§5). The lockfile and `package.json` are byte-identical to the base, so the `ajv` tuple is unchanged.
- **(d)** Both committed runs verify: SHA-256 of every file, stamp, `git_sha` prefix, ancestry, `lockfile_sha256`, `manifest_sha256`, counts. The unit total (2592) equals the hosted lane A total at the same head.
- **(f)** No workflow, policy, `package.json` or lockfile change, so no D-ORCH-021 lever moves.

**Findings:** 2 LOW, 2 INFO. Nothing Critical, High or Medium is new. **Verdict: PASS_WITH_FOLLOW-UPS** (§10).

Two facts the orchestrator should plan around:
- **The head checker rejects the pushed head.** At `22c6461` it reports `stale: 7 path(s)`, all `.claude/agent-memory/*/*.md`, so run `11f1877` is not accepted there (probe V-B2). That is the live case of D-ORCH-034 (3). It does not affect this PR's gate, which the base copy decides. §6 rules on the exact pattern, and with it the same head checker accepts the run (probe V-D1).
- **The first committed evidence carries a host path fragment** (PR28-SEC-02, LOW). It is a six-character prefix of the OS user name in 8.3 form, inside one test title. It is not a blocker, but every later evidence commit from this host repeats it until the scrub list is fixed.

## 2. Method

| Area | How |
|---|---|
| Diff | `git diff 9d188fd 22c6461` (13 files, +11,439 / −16) and `22c6461..d3f2b6d` (docs and the deleted run only). A leaf-level deep diff of the base and head manifests (positive control: one flipped status gives exactly one leaf) shows only: `date`; five `status` flips; `required_cases` emptied for `unit` (SEC-TC-14, -55), `integration` (-22) and `api` (-29); two `tooling_inputs` entries; the new key. `min_tests`, `zero_skip`, `security`, `path_rules`, `profiles` and `rules` are unchanged |
| Code read | `check-evidence.mjs` (all 691 lines), `lib/manifest.mjs`, `suite-runners.json`, `activation.test.ts`, `heavy.mjs` scrub code, `convert.mjs` `scrubPaths`, `check-security-owned-paths.mjs` (record parsing), CODEOWNERS, `jest.config.ts`, `eslint.config.mjs`, `ci.yml` classifier, PR body, commit messages, the code review on `main` (`PR-0028-W0-ACT-1-code-review.md`, APPROVED_WITH_NITS) |
| Verifier scenarios (`scratchpad/review/PR-28-sec/probes/scenarios.mjs`) | Scenario commits are built with git plumbing (temporary index, `commit-tree`, never checked out) in a scratch `git clone --shared`. The BASE-ref copy and the HEAD copy of `tools/quality` run from outside the clone, `--json`. Four patched scratch copies of the head `lib/manifest.mjs` try candidate staleness patterns. The scenario labels V-A to V-F3 used in §5 and §6 are the labels of that script. Results in §5 and §6 |
| Evidence re-verification (`evidence-verify.mjs`) | Reads git objects of the head: SHA-256 of `unit.junit.xml` and `coverage-summary.json` against `summary.json`, stamp and `git_sha` prefix against the directory name, `lockfile_sha256` and `manifest_sha256` against the blobs at `git_sha` and at the head, ancestry, paths changed since `git_sha`, `parseJUnit` counts against `summary.json`, SEC-TC cases and skipped cases |
| Evidence scan (`evscan.mjs`) | Host identifiers, home paths, e-mail, IP, connection strings, JWT/PEM/cloud-key shapes over both run directories |
| Gitleaks | Emulation of the v8.30.1 default ruleset (221 rules compiled) over the nine files of the net change at the tip (including both run files): **0 findings**. Run-time control file with three assembled secret shapes: 3 findings. The same emulation over this record before hand-off: §9. Lane A's real Gitleaks scanned 5 commits and found nothing |
| Ownership and overlap | CODEOWNERS from the base and the head; tree-object comparison of `tools/quality`, `.github`, `tools/ci` across `629a84d`, `11f1877`, `dbfe4df`, `22c6461`, `d3f2b6d` and the base; `git merge-tree --write-tree` of the tip with today's `main` |
| Registry | No dependency change, so no licence or advisory check. The lockfile is the same blob as the base |

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner · due |
|---|---|---|---|---|---|---|
| PR28-SEC-01 | Parked required cases have no mechanical expiry and no "now implemented" detection | LOW | CWE-693 | A08 | `required-suites.json` `required_cases_pending`; `activation.test.ts:71-90`; `check-evidence.mjs` (no gate rule); `lib/manifest.mjs:163-172` (the key is dropped by the parser) | devops-engineer (rule), qa-lead (done in docs by `d3f2b6d`), senior-developer (AC names, code review R1-m3) · gate rule before the `v0.1.0-m0` checkpoint and before G3; the wave-exit checklist until then |
| PR28-SEC-02 | The committed JUnit carries an 8.3 short-name host path fragment from `os.tmpdir()` | LOW | CWE-532 | A09 | `tools/db/bootstrap.test.ts:140` (title built with `%s`); `heavy.mjs:806` (scrub list); `lib/convert.mjs:54` | devops-engineer (scrub list), test-engineer (title) · before the next evidence commit of any PR; this PR accepted as is |
| PR28-SEC-03 | Staleness allow-list for agent notes: exact pattern, residuals and checks for the devops PR | INFO | CWE-345 | A08 | `lib/manifest.mjs:297` `stalenessAllowed` | devops-engineer · the staleness PR now being dispatched |
| PR28-SEC-04 | Activation enforces `tests >= 1` only: the `min_tests` and skip ratchet is outstanding, and the mutation case pins `lint` | INFO | CWE-693 | A08 | manifest `min_tests`; `activation.test.ts:49-54` | qa-lead · Wave-0-exit activation |

## 4. Finding details

### PR28-SEC-01: parked required cases have no expiry and no "now implemented" detection (LOW)

**Description.**
- `required_cases_pending` is, by design, a fail-open list. The verifier never reads it: `parseManifest` returns only the enumerated keys (`lib/manifest.mjs:163-172`).
- `activation.test.ts` checks structure only: active suites, well-formed IDs, a non-empty owner, a checkpoint in the D-ARCH-082 set, disjoint from `required_cases`, unique.
- Nothing fails when an entry outlives its checkpoint.
- Nothing fails when the owning task merges its test and the ID stays parked. The code review reproduced this (R1-m1, R1-n2). Moving a parked ID back to `required_cases` is a manual step that nothing prompts.
- Three of the four IDs appear in no task acceptance criterion (code review R1-m3).

**Exploitability and impact.**
- Nobody can use the key to hide a failure. A failed or skipped test case that carries any SEC-TC ID fails in every suite (hard rule), and a listed ID is not an exemption (probe V-E1).
- The exposure is a missing regression test: SEC-TC-14 (bcrypt pre-hash and 72-byte truncation), SEC-TC-55 (recovery-code pre-hash), SEC-TC-22 (tracking events) and SEC-TC-29 (`Cache-Control` on authenticated responses) could be absent when the owning task merges, and no gate says so.
- Matching is by title: any passing test whose title carries the ID satisfies it. A reviewer must read the test that carries it.
- Compensating controls: the key is in a code-owned, pinned path; the G3 human check "SEC-TC 64/64"; and, since `d3f2b6d`, the written rule that the list must be empty at its checkpoint and that G3 fails on a non-empty list.
- Likelihood is medium, impact is low to medium. The rule exists only in prose until the gate-profile check lands.

**Remediation (code level, `tools/quality`, devops-engineer with the Wave-0-exit runner PR):**
1. Carry the key through `parseManifest`, validated like the test does. A malformed entry throws `ManifestError`, so a typo is not read as "nothing parked".
2. In `checkEvidence`, add a rule for profile `gate` next to `gateBlockers`: a non-empty `required_cases_pending` is a problem `gate profile: required_cases_pending not empty: <suite>:<case>` unless the entry carries a `D-` ID.
3. For profiles `wave` and `gate`, add a problem when a passing test case of an active suite carries a parked ID: `pending ID X is implemented: move it to required_cases`. In profile `pr` this must be a **note only**. The base manifest judges the PR that adds the test, so a failing rule there would deadlock the owning task's own PR.
4. Senior-developer adds the three missing IDs to the owner tasks' acceptance criteria before TASK-020 is dispatched (code review R1-m3). Consider `Wave-0 exit` as SEC-TC-29's checkpoint.

**Verification test.** In `check-evidence.test.ts`:
- gate profile with one pending entry → FAIL naming it;
- gate profile with the entry carrying a `D-` ID → PASS;
- wave profile with a passing case carrying a parked ID → FAIL;
- pr profile with the same → PASS plus a note;
- a pending entry with a bad ID or checkpoint → `ManifestError`.

### PR28-SEC-02: 8.3 host path fragment in the committed JUnit (LOW)

**Description.**
- Run `20261113T0645Z_11f1877/unit.junit.xml` line 1481 contains one test case whose title includes `C:\Users\<FIRST6>~1\AppData\Local\Temp\bootstrap-unit-…\outside-…\s`, where `<FIRST6>` stands for the first six characters of the OS user name.
- The title comes from `it.each([[join(outside, 's')], …])('refuses a path that is not lexically under /run/secrets: %s', …)` (`tools/db/bootstrap.test.ts:140`), and `outside` is below `os.tmpdir()`.
- `heavy.mjs:806` scrubs only `[repoRoot, homedir()]`, compared as literal strings. `os.tmpdir()` on this host returns the 8.3 short profile name, which is a different string from `homedir()`, so the scrub misses.
- The evidence scan finds nothing else of this class in either run: no e-mail or IP of the host, no secret shape, no host name. The other hits are synthetic test data (`10.0.0.1`, `no-reply@shipping.test`, placeholder connection strings).
- The fragment is six characters of the OS user name. The full OS user name occurs in exactly one tracked file on `main`, my own memory note, where I have replaced it by a placeholder (uncommitted, in the working tree).
- Run `629a84d` carried the same line. `d3f2b6d` removes that run before it reaches `main`, which leaves one instance.

**Exploitability and impact.**
- Information disclosure only, limited to a partial local account name plus random temp directory names, in a repository that is private today.
- It repeats in every evidence run made on this host, because the title is dynamic. Under the steady-state rule (D-ORCH-034) every non-docs PR commits such a run.
- The title also changes on every run, which is a test-quality defect.
- Committed runs are immutable under interim control 04, so I do not ask for this run to be rewritten. I accept the one instance.

**Remediation.**
- `heavy.mjs`: build the scrub list as the set of `repoRoot`, `homedir()`, `tmpdir()`, `fs.realpathSync.native` of each, and on win32 the values of `TEMP`, `TMP` and `USERPROFILE` as seen. Longest first.
- `lib/convert.mjs` `scrubPaths`: add a generic pass for a drive-letter or POSIX profile path (`[A-Za-z]:[\\/]Users[\\/][^\\/\s]+`, `/(?:Users|home)/[^/\s]+`) and a fully qualified `~<digit>` short-name form. This is a belt; the list is the control.
- `bootstrap.test.ts`: give the cases a stable label (`it.each([['outside the root', join(outside, 's')], …])('… (%s)')`).

**Verification test.**
- In `convert.test.ts`: `scrubPaths('C:\\Users\\ABCDEF~1\\AppData\\Local\\Temp\\x', <the scrub list built from a fake tmpdir in 8.3 form>)` contains neither `ABCDEF` nor `~1`.
- In `heavy.test.ts`: a fixture Jest report whose title embeds the fake tmpdir yields a JUnit title without it.
- A repeat of the evidence scan over a fresh run finds no profile path.

### PR28-SEC-03: the staleness allow-list for agent notes (INFO)

This is the ruling asked for in D-ORCH-034 (3). Full rating and the exact pattern are in §6. The finding tracks the checks the staleness PR must satisfy:
1. The only new allowance is the constant `.claude/agent-memory/*/*.md` in `stalenessAllowed`, nothing else under `.claude/`.
2. The unit table of §6 (13 path cases, each with an expected result) lives in `manifest.test.ts`, plus a mutation case: widening the constant to `.claude/**` or `.claude/agent-memory/**` makes the table fail.
3. Optional hardening: a mode guard (`git diff --raw -z`; refuse 120000, 160000 and 100755) so a symlink named `*.md` is not allowed.
4. The PR changes `tools/quality/**`, so it needs its own `PR-<n>` record. It is judged by today's allow-list, so its own evidence must not go stale through `.claude/agent-memory` commits; the orchestrator's batching rule applies.
5. If the same glob joins the `docs-or-ci-only` path rule, it is the same constant, with a test that the two stay equal.
6. TASK-014: put `.claude/` into the `.dockerignore` matcher test (with PR27-SEC-01), so agent notes never enter an image.

### PR28-SEC-04: `tests >= 1` and the pinned mutation target (INFO)

**Description.**
- `unit`, `integration`, `api` and `migrations` activate with `min_tests: 1`. The developer's runs show 2592, 186, 80 and 6 tests, and `catalog-c1-c14` 48 against a minimum of 14.
- Deleting most of a suite therefore passes lane B. Lane A's coverage and review are the only counters.
- `rules.min_tests_policy` already requires the ratchet at each wave end, which the Wave-0 exit is.
- `unit` and `integration` allow skips (`zero_skip: false`). Today's skipped cases are 2 POSIX-only unit cases and 1 integration timing spike, none with a SEC-TC ID, and the hard SEC-TC rule applies to every case that has one. Other security tests that carry no ID can still be skipped silently.
- `activation.test.ts:49-54` flips `lint` to `active` and asserts `runnerIds.has('lint') === false`. D-QA-014 (4) gives `lint` a runner entry at the Wave-0 exit, and that PR then has to change this case. It fails loudly, not silently, but the target should be a planned suite without a runner chosen at run time.

**Remediation.**
- qa-lead raises `min_tests` to the run counts in the Wave-0-exit activation PR, with a `max_skipped` or an explicit skip allow-list if the schema allows one.
- The mutation case picks the first `planned` suite that has no runner entry.

**Verification test.** A manifest test that `min_tests` for each active suite is at least a pinned fraction of the last committed run, or the equivalent qa-lead rule. The mutation case still fires after `lint` gains a runner.

## 5. Focus items

| Item | Ruling |
|---|---|
| (a) Activation semantics | **Sound.**<br>• **No active suite without a runner.** The active set is exactly the key set of `suite-runners.json` (`unit`, `integration`, `api`, `catalog-c1-c14`, `migrations`). `activation.test.ts` asserts active implies runner on the real manifest, with a mutation case, no orphan runner, and the five suites staying active. `heavy.mjs` also reports an active suite without a runner as an error. Lane A ran the test (PASS).<br>• **First activation, base checker.** Probe V-A (`BASE..22c6461`): exit 0, `PASS`, `required []`, `planned [unit]`, run `11f1877` and `629a84d` rejected (rule 4: `unit` is planned in the base). This matches lane A's own output. Probe V-F1 (`BASE..d3f2b6d`) is the same.<br>• **Head checker accepts the run.** Probes V-B and V-B1 (`..dbfe4df`): exit 0, `required [unit]`, `11f1877` ACCEPTED, `629a84d` rejected as stale. This holds at the evidence commit only. At the pushed head `22c6461` (V-B2) and at `d3f2b6d` (V-F3) it is exit 1: `stale: 7 path(s)`, all `.claude/agent-memory`. With the §6 pattern it is accepted again (V-D1).<br>• **No credit path for a planned suite.** `selectSuites` puts only `active` suites into `required`. `recomputeVerdict` adds a soft reason when a run holds JUnit for a suite that is `planned` in the manifest the checker loaded, and `accepted` needs zero reasons (`check-evidence.mjs:308`, `:493`). So such a run is rejected as a whole, never partly credited. Enforcement is real for the five suites: V-C3 (an `apps/api` change, head checker) requires `api, catalog-c1-c14, integration, unit` and fails; V-C4 (runs deleted) fails; V-C1 (docs-only after the evidence) passes.<br>• **What the activation PR is not judged on.** Because the base manifest decides, the PR cannot be failed by its own run. It rests on lane A's unit tests, the owned-path record and the developer's restricted run for the four Docker suites (api 80, catalog 48 with SEC-TC-05 in 2 passing cases, integration 186, migrations 6), which I could not reproduce without Docker. If a number is wrong, the next PR fails closed. That is an availability risk, not an integrity one |
| (b) D-QA-014 `required_cases_pending` | **Informational only, confirmed three ways.**<br>• `parseManifest` returns only enumerated keys; the only consumers of the string in the repository are `activation.test.ts`, the manifest and docs (`git grep` at the head).<br>• Probe V-E1: `SEC-TC-14` in `unit.required_cases` **and** in `required_cases_pending`, head checker, evidence commit: exit 1, `required case SEC-TC-14 not in a passing test case`. V-E2 (pending emptied, required emptied): exit 0. V-E3 (a suite with `required_case` instead of `required_cases`): exit 2, `suites.unit.required_cases must be an array`, so a mistyped suite key is not read as "nothing required".<br>• **A later PR cannot move required cases into pending without a record.** `tools/quality/required-suites.json` is code-owned and pinned in `REQUIRED_CODEOWNED_PATHS`. Simulated in §9 (record run D1): a commit that moves `SEC-TC-05` after this record voids it. The PR that makes the move is judged by the old `required_cases`, so it still has to carry the case. Parking an ID that a test already carries is not caught by `activation.test.ts` (code review R1-n2); only the record and PR28-SEC-01 step 3 catch it.<br>• **The four IDs are unimplemented on `main`.** `git grep` of `SEC-TC-14`, `-55`, `-22` and `-29` at the base outside `docs` and `.claude`: only the manifest and, for `-14`, `check-evidence.mjs:247` and two fixture strings in `check-evidence.test.ts:398,508` (synthetic JUnit objects, not tests). Neither run's `unit.junit.xml` has a case that carries any of the four. `SEC-TC-05` is carried by `c01-c12.int.test.ts:445` (C4) and `:680` (C11), so `catalog-c1-c14` rightly keeps it.<br>• **Gap:** PR28-SEC-01 (no expiry, no implemented-but-parked detection) |
| (c) Interim controls of D-SEC-PR23-02 | **All three hold; the table below is the record.** |
| (d) Evidence integrity of `20261113T0645Z_11f1877` | **Verified, no tampering.**<br>• SHA-256 of `unit.junit.xml` and `coverage-summary.json` match `summary.json`. Directory stamp and `git_sha` prefix match. Parsed JUnit counts equal the summary (2592 / 0 / 0 / 2). 303 cases carry SEC-TC IDs, all passed; the 2 skipped cases are POSIX-only `file-secret-provider` cases with none.<br>• `lockfile_sha256` equals the lockfile blob at `11f1877` and at the head. `manifest_sha256` equals the activated manifest at `11f1877`, not the base manifest.<br>• `11f1877` is an ancestor of `22c6461`. The 25 paths changed since it are 18 under `docs/` and the 7 `.claude/agent-memory/*/*.md` paths. Nothing else: no code, no `tools/quality`, no workflow.<br>• Timing is coherent: merge commit `11f1877` 06:30:57Z, `generated_at` 06:47:42Z, evidence commit `dbfe4df` 06:48:17Z. `git_dirty: false`, `build_clean: true`, `env_overrides: []`, `invalid_reasons: []`, profile `pr`, one suite.<br>• The hosted lane A total at the same head (2592 passed) equals the run's 2592. The host fields are OS, CPU model, core count, RAM and tool versions: no host name, user name or address. The one disclosure is PR28-SEC-02.<br>• As with every run (PR23-SEC-04/09), authenticity is by construction self-consistent only; nothing here changes that |
| (e) `.claude/agent-memory` in the staleness allow-list | See §6. **Allow exactly `.claude/agent-memory/*/*.md`.** Rated LOW as a residual. `.claude/**` is rated MEDIUM and `.claude/agent-memory/**` LOW to MEDIUM; do not use either |
| (f) D-ORCH-021 levers and lock delta | **No lever moves.** `.github` and `tools/ci` are the same tree objects as the base; `package.json` and `package-lock.json` are the same blobs. The PR touches no workflow, policy checker, `RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, folded `run: >` or `$GITHUB_ENV`/`$GITHUB_PATH` write. The lockfile has the `node_modules/ajv` entry 8.20.0 from `registry.npmjs.org` (integrity `sha512-Thbli+Ol…`), no `link`, and 15 `link: true` entries, all `node_modules/@platform/*`. The base-ref copy is still the one that runs (lane A log) |

**Interim controls (D-SEC-PR23-02), as satisfied by the evidence commits:**

| Control | Evidence | Result |
|---|---|---|
| 03: lockfile `ajv` tuple, no non-`@platform` `link: true` | The lockfile is the blob `1453a95` at the base, `629a84d`, `11f1877`, `dbfe4df`, `22c6461` and `d3f2b6d`. Tuple and links as in (f) | Satisfied |
| 04: no `wave` or `gate` run committed; no change to a committed run | Both runs are profile `pr`. No run exists on `main`, so `629a84d`, added and then removed inside this PR (`d3f2b6d`), is net zero and not a modification of a committed run | Satisfied |
| 05: install before the run, empty `info/exclude`, clean tree | Commit `dbfe4df` carries the gate table: `npm ci --ignore-scripts` (exit 0) then `npm run deps:rebuild` (exit 0) in that worktree immediately before `quality:heavy`; `.git/info/exclude` with no entries and `core.excludesFile` unset; `git status --porcelain --untracked-files=all` empty before the run and after install; profiles `pr` only. I checked the state today: the shared `info/exclude` holds 0 non-comment lines (240 bytes of template), no `core.excludesfile` at any config level, and the worktree gitdir has no `info/` of its own. The install itself is self-reported; the run records `git_dirty: false` and `build_clean: true` | Satisfied (install self-reported) |

## 6. Ruling on the staleness pattern (e)

**Question.** Can the lane B staleness allow-list (`stalenessAllowed`, `lib/manifest.mjs:297`, today `docs/**` minus the API contract minus `tooling_inputs`) take `.claude/agent-memory/**` like `docs/**`, and which exact pattern?

**What the allowance means.** A path in the list can change after an evidence run without invalidating it. That is safe only if nothing the run covers reads the path. Facts at the head:
- Jest `roots` are `apps`, `packages`, `prisma`, `tests`, `tools`. `.claude/` is outside every project, so no file under it is ever run as a test.
- `tsconfig.json` references no `.claude` path. ESLint ignores `.claude/**` (`eslint.config.mjs:416`); Prettier, Semgrep and Stylelint ignore it; `check-suppressions` excludes it.
- Lane A already classifies `.claude/**` except `.claude/settings.json` as docs-only (`ci.yml` classifier, `paths-ignore`).
- `.claude/` holds 112 tracked files, all mode 100644: 75 agent notes (every one `.claude/agent-memory/<agent>/<file>.md`, four segments, `.md`), 29 agent definitions, 7 commands, `settings.json`.
- CODEOWNERS owns `.claude/settings.json`, `.claude/agents/` and `CLAUDE.md`. It does not own `.claude/commands/` (a deliberate choice: the owned-paths test treats `.claude/commands/x.md` as docs-only) or `.claude/agent-memory/`.
- No Dockerfile exists yet (TASK-014).

**Candidate patterns, probed** (patched scratch copies of the head checker, evidence commit plus one changed path, 13 cases; `allow` means the head checker still accepts the run):

| Path changed after the evidence | `.claude/**` | `.claude/agent-memory/**` | `.claude/agent-memory/**/*.md` | `.claude/agent-memory/*/*.md` |
|---|---|---|---|---|
| `agent-memory/<agent>/zz.md` and `MEMORY.md` | allow | allow | allow | **allow** |
| `.claude/settings.json` (hooks, permissions) | allow | stale | stale | stale |
| `.claude/agents/zz.md` | allow | stale | stale | stale |
| `.claude/commands/zz.md` | allow | stale | stale | stale |
| `agent-memory/<agent>/zz.sh`, `.mjs`, `.json` | allow | allow | stale | stale |
| `agent-memory/<agent>/sub/zz.md` (nested) | allow | allow | allow | stale |
| `agent-memory/zz.md` (no agent directory) | allow | allow | allow | stale |
| sibling `.claude/agent-memory-x/<agent>/zz.md` | allow | stale | stale | stale |
| `.claude/worktrees/<w>/apps/api/src/zz.ts` | allow | stale | stale | stale |
| `agent-memory/<agent>/zz.md` as a symlink (mode 120000) | allow | allow | allow | allow |

**Ratings.**

| Pattern | Risk | Why |
|---|---|---|
| `.claude/**` | **MEDIUM** | Allows `settings.json` (hooks that run on the maintainer host, permissions), the agent definitions and the commands to change after the evidence. They are control-plane code (PR10-SEC-04) |
| `.claude/agent-memory/**` | LOW to MEDIUM | Any depth and extension: a script or a config file could sit there unevidenced. Nothing runs it today, but nothing pins that |
| `.claude/agent-memory/**/*.md` | LOW | Markdown only, but allows nested directories that no legitimate note uses |
| **`.claude/agent-memory/*/*.md`** | **LOW (accepted residual)** | Exactly the shape of the 75 existing notes. Nothing a covered suite reads, so the evidence cannot become wrong. Residuals below |

**Recommendation: `.claude/agent-memory/*/*.md`**, as a constant in `lib/manifest.mjs`, in the base-ref copy that judges later PRs. In this checker's glob dialect `*` never crosses `/`, so the pattern allows exactly four segments ending `.md`. Keep `.claude/settings*`, `.claude/agents/**`, `.claude/commands/**` and `.claude/worktrees/**` non-docs.

**Residuals (why LOW, not nil):**
- Agent notes are loaded into agents' context, so they are a stored prompt-injection channel. That channel exists today: lane A treats the path as docs-only and CODEOWNERS does not own it. The pattern does not widen it. Only the orchestrator commits notes (D-ORCH-013). It stays INFO.
- A symlink named `*.md` passes every name-only pattern. It changes nothing a suite reads and today's `.claude` has no non-regular entry. The optional mode guard (PR28-SEC-03 item 3) removes it.
- A backslash in a raw path is normalised to a separator by the glob matcher, which only changes depth accounting. The allowed shape still ends `.md` under `.claude/agent-memory/`.

**Effect, probed.** The patched head checker (`.claude/agent-memory/*/*.md`) at the pushed head `22c6461`: exit 0, run `11f1877` ACCEPTED (probe V-D1).

**Selection is separate.** A `.claude/**`-only PR still selects `unit` today, because it matches no path rule. Adding the same glob to `docs-or-ci-only` makes memory-only PRs lane-A-only. Safe for the same reasons; the edit is a record-gated manifest change. Without it the PR only has to carry a `unit` run it does not need.

## 7. Relation to open items

| Item | State after this PR |
|---|---|
| COND-PR23-2 (PR23-SEC-02, MEDIUM) | **W0-ACT-1 part satisfied** (five suites with runners, `api` earlier than its Wave-0-exit deadline, active-needs-runner test, manifest-only, `pr`-profile `unit` run, no evidence outside the run directories). **Stays open at reduced scope:** the Wave-0-exit activation PR, the `v0.1.0-m0` activation, and the G3 gate-profile transcript with SEC-P3-07 items 5 and 6 live. The Wave-0-exit activation record is FAIL while any of PR23-SEC-03/04/05 is open |
| PR23-SEC-03/04/05 (LOW) | Open; due before the Wave-0-exit activation PR; interim controls hold from this PR on (§5) |
| PR23-SEC-04/09 (authenticity) | Now live for five suites: a self-consistent fabricated run is still accepted. Unchanged residual; SEC-P3-07 items 5 and 6 (TASK-015) and the G3 transcript carry it |
| PR23-SEC-06, -07, -10 (TASK-015) | Unchanged. PR23-SEC-08 (INFO) gains a live instance in PR28-SEC-02 |
| PR27-SEC-01 (`.dockerignore`) | Add `.claude/` to its matcher test (PR28-SEC-03 item 6) |

## 8. Merge conditions and overlap

1. **The record is valid for the pushed tip.** `d3f2b6d` changes no owned path after `22c6461`, so a later docs-only commit keeps the named head valid.
2. **Overlap with `main`.** `main` changed only `.claude/agent-memory/qa-lead/*`, the code-review record, `DECISIONS.md` and `STATUS.md` since the merge base. `git merge-tree` of the tip with `5107f1e`: one textual conflict, `docs/sdlc/DECISIONS.md`, an unowned append. A merge of `main` therefore keeps this record valid (record run G). The record is voided by any later change to `tools/quality/activation.test.ts` or `tools/quality/required-suites.json` (record runs D1, D2).
3. **No re-run of evidence is needed** for the merge: the run is uncredited here, and a re-run would go stale again at the next commit on `main`.
4. **Hand-offs tracked, not blocking:**
   - the staleness PR (devops), with the checks in PR28-SEC-03;
   - PR28-SEC-02 scrub fix (devops, test-engineer) before the next evidence commit of any PR;
   - PR28-SEC-01 gate rule (devops, with the Wave-0-exit runner PR) and the AC names (senior-developer, R1-m3);
   - PR28-SEC-04 ratchet and mutation target (qa-lead, Wave-0-exit activation).
5. **Checks owed on later PRs:**
   - *Wave-0-exit activation:* PR23-SEC-03/04/05 merged; manifest-only plus `pr` unit run; no `wave` or `gate` run; the mutation case still fires; `min_tests` ratcheted.
   - *First PR after this one:* the evidence cycle of D-ORCH-034 (2), the gate table, and the pending list unchanged.
   - *Any lockfile PR:* state the `ajv` tuple and the `link: true` count.
   - *G3:* the gate-profile transcript, `required_cases_pending` empty, SEC-P3-07 items 5 and 6 live.

**Proposed decision text** (for the orchestrator to log as D-SEC-PR28-01): "PR #28 (W0-ACT-1) security r1 at 22c6461 = PASS_WITH_FOLLOW-UPS (2 LOW, 2 INFO); the pushed tip d3f2b6d is docs-only after the named head. The W0-ACT-1 part of COND-PR23-2 is satisfied; the rest of COND-PR23-2 and PR23-SEC-03/04/05 stand. `required_cases_pending` is informational and not an exemption (probe-confirmed). Staleness ruling: allow exactly `.claude/agent-memory/*/*.md` in `stalenessAllowed` (rated LOW); never `.claude/**` (MEDIUM) or `.claude/agent-memory/**`; settings, agents, commands and worktrees stay non-docs; tests and mutation case required; optional mode guard. PR28-SEC-01: gate-profile rule for a non-empty pending list and for a pending ID that a passing test carries (note only in profile pr). PR28-SEC-02: scrub `tmpdir()` and 8.3 forms, stable test titles, before the next evidence commit."

## 9. Record check (simulated)

Main's `tools/ci/check-security-owned-paths.mjs` comes from `git archive` of `origin/main` (`5107f1e`; identical to the base's under `tools/ci`). It runs with `--root <clone> --json` against a scratch `git clone --shared` of the main checkout. The clone is checked out at the scenario head with this record copied into its working tree, `--pr 28`. The clone was removed afterwards. Scenario commits are built on top of the pushed tip `d3f2b6d` unless stated.

| Run | Expected | Result |
|---|---|---|
| B: no record in the tree, head = the tip, base = `main` | missing | exit 1, `missing` ("no record named PR-0028-*.md") |
| B2: no record, head = the named head `22c6461`, base = the merge base | missing | exit 1, `missing`, 2 owned paths |
| A: this record committed on top of the tip (docs-only), base = the merge base | pass | exit 0, `pass`, 2 owned, satisfied by this record @ `22c6461` |
| A1: as A, base = today's `main` | pass | exit 0, `pass`, @ `22c6461` |
| A0: this record committed on top of `22c6461`, before the docs commit | pass | exit 0, `pass`, @ `22c6461` |
| C: this record, `--pr 27` | missing | exit 1, `missing` (the PR-0027 record "names no commit of this PR") |
| D1: A + a later commit that moves `SEC-TC-05` from `required_cases` to `required_cases_pending` (manifest only) | missing | exit 1, `missing` ("names 22c6461, but tools/quality/required-suites.json changed after it") |
| D2: A + a later edit of `activation.test.ts` only | missing | exit 1, `missing` ("… activation.test.ts changed after it") |
| D3: A + a later edit of `tools/quality/lib/manifest.mjs` (the staleness PR's file) | missing | exit 1, `missing`; the owned list grows to 3 |
| E: A with a later last `Verdict` row of FAIL | missing | exit 1, `missing` ("verdict FAIL is not one of …") |
| F: A + a later docs-only commit | pass | exit 0, `pass` |
| F2: A + a later `.claude/agent-memory` commit | pass | exit 0, `pass` (unowned) |
| F3: A + a later `.claude/settings.json` edit | missing | exit 1, `missing`; the file is owned and joins this PR's owned set |
| G: A + a real merge of `main` (`DECISIONS.md` conflict resolved with `-X ours`) | pass | exit 0, `pass`; `main` changed no owned path |
| H: the head row names the merge base instead | missing | exit 1, `missing` ("its head row names no commit of this PR") |

Gitleaks emulation (v8.30.1 default rules, 221 compiled) over the net-change files at the tip: 0 findings; run-time control file: 3 findings. The same emulation over the final text of this record: 0 findings (checked after the last edit, before hand-off).

## 10. Verdict

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is new or open for this change at head `22c6461`, so the merge rule is met for the security dimension. The MEDIUM PR23-SEC-02 carried from PR #23 is restated in §7 with its W0-ACT-1 part satisfied.<br>**What holds:** the activation is manifest-only and minimal (leaf diff: five status flips, four emptied `required_cases`, two tooling inputs, one informational key, a date). Only suites with a runner entry are active, and a test pins that. The first activation passes under the base-ref checker with its run uncredited, and the head checker accepts the same run at the evidence commit. A planned suite has no credit path. `required_cases_pending` is not read by the verifier and is not an exemption. The four parked IDs are carried by no test on `main`. Both committed runs verify. The interim controls hold, and no workflow, policy, `package.json` or lockfile path changed, so no D-ORCH-021 lever moves.<br>**Follow-ups (tracked):** PR28-SEC-01 (LOW, gate rule and AC names), PR28-SEC-02 (LOW, scrub fix before the next evidence commit), PR28-SEC-03 (INFO, staleness PR checks with the exact pattern `.claude/agent-memory/*/*.md`), PR28-SEC-04 (INFO, ratchet at the Wave-0 exit). COND-PR23-2 stays open at reduced scope; PR23-SEC-03/04/05 stay due before the Wave-0-exit activation PR.<br>**This round authorises `22c6461` for merge, and the pushed tip `d3f2b6d` (docs-only after it),** once lane A is green on the final head. A later merge of `main` keeps the record valid because it changes no owned path of this PR; any later change to `tools/quality/activation.test.ts` or `tools/quality/required-suites.json` voids it |
