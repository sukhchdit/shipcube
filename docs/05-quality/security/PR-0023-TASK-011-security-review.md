# PR-0023 / TASK-011: lane B local heavy lane and evidence integrity

| Field | Value |
|---|---|
| PR | #23 `feat(quality): lane B heavy lane and evidence integrity (TASK-011)`, https://github.com/sukhchdit/shipcube/pull/23, branch `feat/TASK-011-lane-b-local-heavy-lane`. Six feature commits plus one merge of `main` (`51c1dab`); merge base `d38500a`. 28 files (+5,361 / −7), one of them the pure rename `d965629` of the required-suite manifest |
| Head | f61e55d8a0b91aa64a276f90e42b0235c394a69c |
| Lane A evidence | Run [43350657854](https://github.com/sukhchdit/shipcube/actions/runs/43350657854) on `f61e55d` (`pull_request`, base `d38500a`). **fast-lane `success`**: every step passed. The new step "Lane B evidence (quality:check-evidence)" ran in bootstrap mode (head copy, `--report-only`) and printed `no active lane B suite is required for this change; selected suites still planned: unit` and `PASS (report-only)`. **scans:** Gitleaks and Semgrep `success`. Only "Security-owned paths need a review record" failed, because no `PR-0023-*` record existed; this record is that record. `ci-gate` failed as a consequence |
| Owned paths changed | 4, per lane A's checker: `.github/workflows/ci.yml`, `.prettierignore`, `package.json`, `tools/ci/ci-policy.test.ts`. **`tools/quality/**` is not on the list, because `.github/CODEOWNERS` does not name it** (PR23-SEC-01) |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. Every git command ran in the main checkout against commit SHAs, or in scratch repositories. No command ran in the PR worktree (`Shipqube-TASK-011`). No install, build, Docker, integration or e2e run: the gate results are the developer's table plus lane A run 43350657854. Scratch probes (§2) used copies of the main checkout's `ajv` and its four dependencies, not junctions, and were removed afterwards |

## 1. Summary

PR #23 adds the lane B tooling:
- `quality:heavy` (local runner, one JUnit per suite, converters, schema-validated `summary.json`);
- `quality:check-evidence` (the verifier);
- `quality:prune` and `quality:fastlane`;
- the `summary.json` schema and the move of the required-suite manifest to `tools/quality/`;
- a lane A step that runs the verifier.

**The CI step is sound as written.**
- It runs the BASE-ref copy of `tools/quality` (script, lib, schema, manifest) from `$RUNNER_TEMP`, after `npm ci --ignore-scripts` and before `deps:rebuild`.
- It reads evidence from the head commit's git objects only.
- It adds no `env:`, `if:`, `shell:`, `defaults:`, action, permission or secret.
- It writes no `$GITHUB_ENV`/`$GITHUB_PATH`/`$GITHUB_OUTPUT`; it writes only `$GITHUB_STEP_SUMMARY`.
- Its `run: |` is a literal block, not a folded `run: >`.

So none of the D-ORCH-021 levers moves (`RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, folded `run: >`, `$GITHUB_ENV`/`$GITHUB_PATH` writes). One qualification: the verifier imports the Ajv that the head lockfile installed (PR23-SEC-03, LOW; a lockfile change is itself security-owned).

**The verifier does what TEST-STRATEGY §9.2 asks, within its design limits.** The probes (§2) confirm that it rejects:
- a code change without evidence;
- stale evidence after a later code change;
- a non-ancestor SHA;
- a JUnit edited after hashing (FAIL as tampered).

The JUnit writer and reader resist XML injection: 8 hostile names, 0 count changes, with a positive control. Nothing in the converters or `prune` writes outside the evidence tree. Only environment variable NAMES are recorded, and the host spec holds no host name, user name or address.

**Today it enforces nothing.**
- No manifest suite is `active` (63 `planned`, 2 `opt-in`), so the required set is always empty (PR23-SEC-02).
- `tools/quality/**` is not code-owned. A later PR can therefore weaken the verifier or the manifest without a security record, and the base-ref copy protects only the PR that makes the edit (PR23-SEC-01).

Both are MEDIUM and are the conditions of this verdict. As SEC-P3-07 anticipated, self-consistent fabricated evidence passes. It even passes with a wrong lockfile hash, a year-9999 stamp and a 2001 `generated_at` (PR23-SEC-04, PR23-SEC-09). Authenticity therefore still rests on SEC-P3-07 items 5 and 6 (TASK-015).

**Findings:** 2 MEDIUM, 4 LOW, 4 INFO. Nothing is Critical or High. **Verdict: PASS_WITH_CONDITIONS** (§9).

## 2. Method

| Area | How |
|---|---|
| Diff | `git diff d38500a f61e55d` (28 files). The `ci.yml` hunk is the single new step. `check-workflow-policy.mjs` is unchanged; only the head test `ci-policy.test.ts` gained a case. `package.json` adds four `quality:*` scripts and nothing else. The lockfile is unchanged |
| Code read | `check-evidence.mjs`, `heavy.mjs`, `fastlane.mjs`, `prune.mjs`, `lib/{manifest,junit,junit-write,convert,host}.mjs`, `summary.schema.json`, `suite-runners.json`, the manifest and the evidence README, all from `git archive f61e55d` |
| Verifier probes (`scratchpad/review/PR-23-sec/scripts/probe.mjs`) | **Setup.** A scratch repository at base `C1`. Scenario commits are built with git plumbing (temporary index, `commit-tree`, never checked out). The HEAD copy of `tools/quality/check-evidence.mjs` runs from outside the repository with `--manifest` (to simulate a base manifest), as lane A runs the base copy from `$RUNNER_TEMP`. Manifests: the head manifest as is (`planned`), and the same manifest with `unit` set `active`.<br>**Controls, 6 runs, all as expected:** S0 no evidence → 1; S2 stale → 1; S3 non-ancestor → 1; S4 JUnit edited after hashing → 1 (tampered); S9 untracked `apps/api/override.ts` → 1; S10 untracked `.envrc` → 1.<br>**Scenarios:** S1, S5, S5b, S6, S7, S8, and the `info/exclude` and `.env` variants of S9 and S10 (results in §4 and §5).<br>**Total:** 15 runs, 0 unexpected |
| Injection fuzz (`probe2.mjs`) | `toJUnit` → `parseJUnit` round trip with 8 hostile names: attribute break-out, `]]>` + DOCTYPE/ENTITY, closing-tag injection, C0 controls, lone surrogates, entities, U+2028/2029/0085. Every round trip kept 3 cases / 1 failed / 1 skipped and produced no injected passing `SEC-TC` case. The unescaped control showed the injection (2 cases). `jestToCases` was probed for path scrubbing |
| Gitleaks | Emulation of the v8.30.1 default ruleset (221 rules compiled) over the 5,361 added lines: **0 findings**. Run-time control file: 5 findings. Lane A's real gitleaks (base..head, first-parent) is `success`. The same emulation over this record before hand-off: 0 findings (§8) |
| Ownership | `.github/CODEOWNERS` (base = head), `tools/ci/check-security-owned-paths.mjs` on main, and the lane A log of the owned list |
| Overlap | `git merge-base --all` (= `d38500a`, single), the owned-path intersection with main `360f419`, and `git merge-tree --write-tree 360f419 f61e55d` (§7) |
| Registry | No new dependency. `ajv` 8.20.0 (MIT) is already a root devDependency. The lockfile is unchanged, so licences and advisories need no new check |

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner · due |
|---|---|---|---|---|---|---|
| PR23-SEC-01 | `tools/quality/**` (verifier, schema, manifest, runners) is not a security-owned path | MEDIUM | CWE-284 | A08 | `.github/CODEOWNERS` (no `/tools/quality/` line) | devops-engineer · **before the first `planned → active` flip or the next `tools/quality` change, whichever is first** |
| PR23-SEC-02 | Nothing is enforced yet: no suite is `active`, no gate-profile run exists, and SEC-P3-07 items 5–6 are not built | MEDIUM | CWE-693 | A08 | `tools/quality/required-suites.json` (all `planned`); `ci.yml` (profile `pr` only) | qa-lead (activation), devops-engineer (TASK-015), quality-gatekeeper (G3) · **activation by the end of Wave 0; gate run at G3** |
| PR23-SEC-03 | The base-ref verifier executes the head-installed `node_modules/ajv` | LOW | CWE-829 | A08 | `check-evidence.mjs:323` | devops-engineer · before the first activation |
| PR23-SEC-04 | Evidence is bound only by `git_sha`, and runs on the base are mutable and deletable | LOW | CWE-345 | A08 | `check-evidence.mjs` `evaluateRun`, `checkEvidence` | devops-engineer · before the first activation |
| PR23-SEC-05 | `quality:heavy` does not install, and the clean-tree check is blind to ignored paths | LOW | CWE-693 | A08 | `heavy.mjs` `main`; `lib/host.mjs:157-160`; manifest `clean_tree_paths` `.env*` | devops-engineer (code), qa-lead/principal-architect (`.env` ruling) · before the first activation |
| PR23-SEC-06 | The new gate step is not pinned by the base-ref policy, and its bootstrap and no-base branches fail open | LOW | CWE-693 | A08 | `ci.yml` step "Lane B evidence"; `check-workflow-policy.mjs` `CI_REQUIRED_GATES` | devops-engineer · TASK-015 |
| PR23-SEC-07 | LF/CR in an evidence path name injects runner commands and summary lines | INFO | CWE-117 | A03 | `check-evidence.mjs:650-656`, `cell()` :562 | devops-engineer · TASK-015 |
| PR23-SEC-08 | Committed native reports and Jest names are not fully sanitised | INFO | CWE-212 | A04 | `lib/convert.mjs` `sanitizeNative`, `jestToCases` :86-90 | devops-engineer · with the ZAP/Trivy runners (T-QA-09, US-004) |
| PR23-SEC-09 | Self-consistent fabricated evidence is accepted (the SEC-P3-07 residual) | INFO | CWE-345 | A08 | design | quality-gatekeeper (G3 reading), TASK-015 |
| PR23-SEC-10 | heavy selects suites with rename detection on; the verifier selects with it off | INFO | — | — | `lib/host.mjs:171` | devops-engineer · TASK-015 |

## 4. Finding details

### PR23-SEC-01: `tools/quality/**` is not security-owned (MEDIUM)

**Description.** The CODEOWNERS file has no `/tools/quality/` line. `check-security-owned-paths.mjs` derives the owned set from CODEOWNERS alone. Lane A's run on this PR lists 4 owned paths, and none of them is under `tools/quality/`.

The documents all say the opposite:
- TEST-STRATEGY §9.3 "Ownership": "The manifest is a tooling input and a security-critical path (SEC-P3-31): every change needs security-analyst review in the DoD".
- ADR-0023 am. G item 2: "code-owned".
- The manifest's own `security_critical_paths`, which lists `tools/quality/**`.
- The PR body, which lists `tools/quality/**` as security-owned.

**Exploitability and impact.** The base-ref copy (SEC-P3-31) only stops a PR from weakening the rules that judge that same PR. It does not stop the next case. A PR that only edits `tools/quality/**` selects only `unit` (no path rule matches `tools/**`), so it passes the old copy with fresh `unit` evidence and needs only code review. Such a PR could:
- move `rls-cross-tenant` back to `planned` or `opt-in`;
- add a `deferred_at_gate` entry with any `D-…` ID;
- lower `min_tests`;
- change `tooling_inputs`;
- edit `check-evidence.mjs` itself.

Once it merges, the weakened copy judges every later PR. The SEC-P3-07 actor is "an agent under fix-cycle pressure". A manifest "maintenance" PR is exactly the change that actor would make.

Likelihood L–M. Impact H, contained: lane C wave-end and the G3 gate run remain. That gives MEDIUM. The exposure starts at the first activation, because the checker requires nothing today.

**Remediation (code).** In `.github/CODEOWNERS`, section "CI, workflows, supply chain":
```
# Lane B evidence verifier, schema, required-suite manifest and runners (SEC-P3-31, TEST-STRATEGY 9.3, PR23-SEC-01)
/tools/quality/                         @sukhchdit
```
The check reads CODEOWNERS from both base and head. If the line is added in this PR's fix cycle, this PR's `tools/quality/**` changes become owned, and a new round on the new head is required. Activation PRs then need a security record. That is the intended cost (§9.3).

**Verification.** A `check-security-owned-paths.test.ts` case: a PR that changes only `tools/quality/required-suites.json` gives `missing` without a record and `pass` with one. A CODEOWNERS structure assertion that `/tools/quality/` is present.

### PR23-SEC-02: nothing is enforced yet (MEDIUM, programme gap)

**Description.**
- `selectSuites` returns only `active` suites as required, and no suite is `active`: 63 of the 65 manifest suites are `planned`, and the other two (`contract-live`, `e2e-live`) are `opt-in`, which is never selected.
- Lane A runs `--profile pr` only, so `gateBlockers` (rule 5) never runs anywhere.
- The compensating controls of SEC-P3-07 are not built: item 5 (the hosted `security-integration` job on security-critical paths) and item 6 (the lane C wave-end `inventory.json` cross-check).
- Suites that already have tests and runners (`unit` 2,507 tests, `integration` 185, `api` 49, `catalog-c1-c14`, `migrations`) are still `planned`. TEST-STRATEGY §9.3 says a suite turns active "in the PR that adds its first test".

D-TASK011-01 (1) records this, and SHEET-FOLD-2 (b) asks principal-architect and qa-lead for an activation plan.

**Exploitability and impact.** Until activation, R-ARCH-16 and SEC-P3-07 are unmitigated by machine. A Wave-1 PR that changes RLS, authz or audit code merges on lane A plus review, with no lane B evidence at all. Same rating as SEC-P3-07: likelihood L–M × impact H (contained) = MEDIUM.

**Activation control required before G3** (input to the SHEET-FOLD-2 (b) ruling):
1. **Manifest-only activation PRs**, each with a security record (PR23-SEC-01). Probes S5/S5b show why the activation must not share a PR with evidence:
   - The **first** activation passes, because the base manifest makes the required set empty (S5).
   - Every **later** activation whose run also carries the newly activated suite is rejected **as a whole**. Rule 4 ("JUnit for a planned suite", judged by the base manifest) fails the run, so the PR FAILs as soon as another suite is required (S5b: exit 1).

   Security prefers option (a) of the PR body (activate first, with no evidence in that PR). Do not relax rule 4. Have `quality:heavy` select from the base-ref manifest (`git show <base>:tools/quality/required-suites.json`), or warn when the working-tree manifest differs from it, so that writer and verifier agree.
2. **First activations, by the end of Wave 0 (T-QA-04):** `unit`, `integration`, `api`, `catalog-c1-c14` and `migrations`, which have runners. Every security suite and generator follows as its first test lands. Add a manifest test: every `active` suite has a `suite-runners.json` entry, so a suite cannot go active without a runner.
3. **At G3** quality-gatekeeper runs main's verifier with `--profile gate` on the gate SHA:
   ```
   node tools/quality/check-evidence.mjs --root . --base <gate-sha> --head <evidence-commit> --profile gate
   ```
   G3 fails on any rule-5 blocker (a gate suite neither `active` nor deferred with a `D-…` ID) or on a missing accepted gate run. SEC-P3-07 items 5 and 6 must be live (TASK-015).
4. **Interim, until item 2 is done:** STATUS records the gap as a known G3 condition. PRs that touch the manifest's `security_critical_paths` keep the lane A plus review bar only.

**Verification.** A manifest unit test (active ⇒ runner entry). The G3 transcript of the `--profile gate` run. The lane C `wave-end` inventory comparison.

### PR23-SEC-03: the base-ref verifier executes the head-installed Ajv (LOW)

**Description.** `loadSchemaValidator` resolves `ajv/dist/2020.js` with `createRequire(join(root, 'package.json'))` and imports it (`check-evidence.mjs:323-324`). In lane A, `root` is the workspace, so the module is whatever `npm ci` installed from the **head** lockfile. It loads whenever at least one run directory exists, and once main holds evidence that is every run.

**Probe S8.** A substituted `node_modules/ajv` whose `dist/2020.js` prints a PASS line and calls `process.exit(0)` turned the S3 case (non-ancestor SHA, exit 1) into exit 0. The control with the real Ajv restored gave exit 1 again.

There are two vectors:
- a lockfile entry `node_modules/ajv` with `link: true` → a new workspace `packages/ajv`. `check-lockfile.mjs:152` accepts non-`@platform` links to workspace directories, while every real link is `@platform/*`;
- an Ajv version bump to a compromised release that is at least 7 days old.

Both change `package-lock.json`, which is security-owned, hence LOW. The step comment "runs before any head code" should say "before any head code except the locked Ajv".

**Remediation (code).** Preferred: take Ajv out of the verifier's trusted code.
- Generate `tools/quality/summary.validate.mjs` once with `ajv/dist/standalone` (`new Ajv2020({ code: { esm: true, source: true }, unicode: false, strict: true, allowUnionTypes: true })`, then `standaloneCode(ajv, ajv.compile(schema))`). `unicode: false` avoids the `ucs2length` runtime import for `maxLength`.
- Commit the generated file and import `./summary.validate.mjs` (base copy) in `check-evidence.mjs`.
- A unit test regenerates it from the schema, asserts byte equality, and asserts the generated module contains no `import`/`require(`.

Fallback: before importing, require that `realpathSync(resolved)` lies under `realpathSync(<root>/node_modules/ajv)` and is not a link, and that `node_modules/ajv/package.json` `version` equals the BASE lockfile's `packages['node_modules/ajv'].version` (`git show <base>:package-lock.json`).

Separately, for TASK-015, harden `check-lockfile`: a `link: true` entry whose key is not under `node_modules/@platform/` is a finding unless a `source` override covers it.

**Verification.** A test with a fake `node_modules/ajv` (as S8) leaves the verdict unchanged. A `check-lockfile` fixture with `node_modules/ajv` → `packages/ajv` link gives a finding.

### PR23-SEC-04: evidence bound only by `git_sha`; base runs mutable and deletable (LOW)

**Description.**
- **Recorded but never compared:** `lockfile_sha256`, `manifest_sha256`, `stamp`, `generated_at` and `coverage`.
  - Probe S1: a run with `lockfile_sha256` = 64 × `f`, stamp `99991231T2359Z`, `generated_at` 2001 and `coverage` 100/100 was **accepted**.
  - A future stamp also sorts first forever, in the "newest 30" window and in `prune`'s wave boundary.
- **Base runs can be rewritten or deleted.** A PR may change a run that already exists on the base, consistently re-hashed (it is then only "touched" and re-evaluated), or delete it.
  - Probe S6: deleting a committed `gate` run passed (exit 0).
  - Retention (keep every gate run) lives only in `prune.mjs`, which is advisory.

**Exploitability and impact.** No probe found a bypass of the stated rules: ancestry and staleness held in S2 and S3. The cross-checks are cheap, though, and they catch the honest-but-wrong cases that R-ARCH-16 targets: evidence from a different install, a hand-edited field, a copied directory, or a rewritten gate record before G3. Likelihood L × impact M = LOW.

**Remediation (code)**, in `evaluateRun`, for touched runs at least:
- `lockfile_sha256 === sha256(git cat-file blob <git_sha>:package-lock.json)`;
- `manifest_sha256 === sha256(<git_sha>:tools/quality/required-suites.json)`, or record which manifest was used;
- `stamp` (UTC minute) ≥ committer time of `git_sha` − 1 min and ≤ head committer time + 5 min;
- `generated_at ≥ stamp`;
- when `coverage-summary.json` is attached, `coverage.line`/`branch` equal its `total.lines.pct`/`total.branches.pct`.

In `checkEvidence`, make base evidence immutable:
- any changed path under `runs/<id>/` whose `<id>` exists in the base tree → FAIL, "evidence on the base is immutable";
- the one exception is the deletion of a whole run whose base `profile` is not `gate` and whose ID is older than the second-newest base `wave` run (the prune rule).

**Verification.** Fixtures in `check-evidence.test.ts`: wrong lockfile hash, stamp before the commit or after the head, coverage mismatch, a modified base run, a deleted gate run → FAIL. A deletion that `prune` allows → PASS.

### PR23-SEC-05: no install, and the clean-tree check is blind to ignored paths (LOW)

**Description.**
1. ADR-0023 am. F item 1 and platform.md §7.3 item 7 (SEC-P3-04) require `quality:heavy` and `quality:fastlane` to install with `npm ci --ignore-scripts` + `npm run deps:rebuild`. Neither script installs. The README does not mention an install either.

   `lockfile_sha256` therefore states what *should* be installed, not what ran. Possible gaps:
   - a stale `node_modules` after a `main` merge;
   - `npm install --no-save`;
   - a locally patched dependency.

   None of these is visible to `git status`, because `node_modules/` is ignored.
2. `git status --porcelain --untracked-files=all` never lists ignored files. The manifest's `.env*` clean-tree glob can therefore never fire: `.gitignore` ignores `.env` and `.env.*`.
   - Probe S10: an untracked `.env` holding a `SKIP_` line was not reported. The `.envrc` control was reported.
3. Local excludes (`.git/info/exclude`, `core.excludesFile`) hide untracked overrides on clean-tree paths and leave no committed trace.
   - Probe S9: `apps/api/override.ts` was reported (exit 1), then not reported once it was listed in `.git/info/exclude` (exit 0).

   The same `git status` call feeds `git_dirty` in `heavy.mjs` (`lib/host.mjs:157-160`).

**Exploitability and impact.** Honest-agent failure modes: worktrees are re-used across branches. Lane A re-runs `unit` on a clean install, so the residual applies to lane-B-only suites until lane C. Likelihood M × impact L–M = LOW.

**Remediation (code).**
- **Install first.** `heavy.mjs` step 0 runs `npm ci --ignore-scripts --no-audit --no-fund` and then `npm run deps:rebuild` (via `npmCommand()`, no shell), before the first `porcelain()`, and records `"install": "npm ci"` in `summary.json`. At minimum, compare `node_modules/.package-lock.json` `packages` with `package-lock.json` `packages` and record INVALID on a difference.
- **Untracked list.** Build it from committed ignore rules only:
  ```
  git ls-files -z --others --exclude-per-directory=.gitignore -- <clean-tree pathspecs>
  ```
  This applies the repository's `.gitignore` files but neither `info/exclude` nor `core.excludesFile`. Add a reviewed allow-list for ignored build output (`dist/`, `.react-router/`, `coverage/`, `node_modules/`).
- **`.env` (qa-lead / principal-architect ruling).** Either assert that no test harness reads `.env` (a unit test over `jest.config.ts` and `tools/test-support`) and drop `.env*` from `clean_tree_paths` as dead, or record the NAMES of `SKIP_`/`TEST_` keys found in `.env*` files.

**Verification.** Heavy unit tests: a stale `.package-lock.json` gives INVALID; a file listed in `info/exclude` on a clean-tree path gives INVALID; the install step runs before the first `porcelain()`.

### PR23-SEC-06: the new gate step is not policy-pinned, and two branches fail open (LOW)

**Description.**
- **Not pinned.** `CI_REQUIRED_GATES` in the base-ref `check-workflow-policy.mjs` is unchanged. The only pin is the head test `ci-policy.test.ts`, which is head code that a PR can edit together with the step. An owned `ci.yml` edit that drops the step or adds `if:` is caught only by the security record; this is PR10-SEC-17's class.
- **Bootstrap branch.** The `else` branch (head copy, `--report-only`) stays live after merge. It re-arms whenever `RANGE_BASE` lacks `tools/quality/check-evidence.mjs`, for example after a later rename.
- **No-base branch.** It exits 0 ("not run") when the base commit is unknown. For `pull_request` the base SHA always exists, so that path should fail closed.

**Remediation.** TASK-015, after this PR merges, because the policy runs from the base:
1. Add to `CI_REQUIRED_GATES`:
   ```js
   { job: 'fast-lane', gate: 'lane B evidence', run: /node "\$quality\/base\/tools\/quality\/check-evidence\.mjs" --root "\$GITHUB_WORKSPACE" --base "\$RANGE_BASE" --head "\$RANGE_HEAD"/, ifs: [] }
   ```
   Also pin the `git archive "$RANGE_BASE" tools/quality` line.
2. Replace the `else` bootstrap branch with `echo "…base ref lacks the verifier" >&2; exit 1`.
3. In the no-base branch, exit 1 when `GITHUB_EVENT_NAME` is `pull_request`.

**Verification.** Workflow-policy fixtures: step missing; step with `if:`; bootstrap branch still present; no-base exit 0 on `pull_request` → each a finding.

### PR23-SEC-07: runner-command and summary-line injection through evidence path names (INFO)

**Probe S7.**
- **LF:** a committed stray path `docs/05-quality/tests/runs/x<LF>::warning title=probe::…` makes `check-evidence` print a stdout line that starts with `::warning`, which the runner treats as a workflow command.
- **CR:** a path containing a CR followed by `### Lane B evidence (quality:check-evidence): PASS (forged line)` puts a forged heading line into `$GITHUB_STEP_SUMMARY`. `cell()` replaces LF but not CR, and CommonMark treats a lone CR as a line ending.

`set-env`/`add-path` are disabled, and the step has no `id`. Head code that runs later in the same job can print anything anyway. Merges gate on the `ci-gate` conclusion, not on summary text. Hence INFO; this is the PR17-SEC-05 CR note in a new place.

**Fix.**
- Treat any evidence path that contains a C0 control as a problem.
- Print names with `JSON.stringify`.
- Make `cell()` replace every C0 control including CR (as `?`).

### PR23-SEC-08: native reports and Jest names not fully sanitised (INFO)

`sanitizeNative` redacts only the Gitleaks value fields. The other report types keep values that may be sensitive:
- **ZAP:** a committed `zap-baseline.json` keeps `instances[].evidence`, `otherinfo` and `attack`, which can carry `Set-Cookie`/session values from the local stack.
- **Trivy:** keeps `Secrets[].Match` and `Code.Lines`. Trivy masks the match but keeps the surrounding lines.
- **Gitleaks:** keeps `Author` and `Email`.

`jestToCases` scrubs failure messages but not `name` or `classname`. The probe kept `C:/Users/<user>/…` in both when the test file lay outside the root, for example after a junction or `subst` realpath difference.

Lane A gitleaks over committed evidence is the backstop. The real risk is a JWT-shaped session value blocking an evidence commit, or tempting a `runs/**` allowlist.

**Fix.**
- `sanitizeNative('zap')` drops `evidence`/`otherinfo`/`attack` and keeps `uri`/`param` names.
- `sanitizeNative('trivy')` drops `Match`/`Code`.
- Gitleaks: also drop `Author`/`Email`.
- Pass `scrubPaths` over `name` and `classname` in `jestToCases`.
- Never add an allowlist for `docs/05-quality/**/runs/**`.

### PR23-SEC-09: fabricated evidence is accepted (INFO, accepted residual)

Probe S1: a self-consistent `summary.json` plus a JUnit whose passing cases are named after the required `SEC-TC` IDs is accepted. Hashes prove internal consistency only, as SEC-P3-07 stated.

This is not a defect of this PR. It is listed so that nobody, G3 included, reads `quality:check-evidence` as an authenticity control. Authenticity comes from:
- SEC-P3-07 item 5 (hosted `security-integration` on the PR head) and item 6 (wave-end inventory cross-check, with incident and revert), both TASK-015;
- review of the dedicated `test(evidence)` commits;
- quality-gatekeeper's evidence-SHA versus gate-SHA comparison.

### PR23-SEC-10: selection differs between writer and verifier on renames (INFO)

`lib/host.mjs:171` runs `git diff --name-only -z <base>...HEAD` with rename detection on, so a rename lists only the new path. The verifier uses `--no-renames`, which lists both paths.

A rename out of a path-rule glob therefore under-selects locally and fails closed at lane A ("required suite missing"). That is a usability issue only. Add `--no-renames`.

## 5. Focus items

| Item | Answer |
|---|---|
| (a) CI step, base ref only | **Yes, with the PR23-SEC-03 qualification.** In base mode the step extracts `git archive "$RANGE_BASE" tools/quality` into `$RUNNER_TEMP/quality/base` and runs that copy; the manifest and schema load from the script's own directory. `check-evidence.mjs` imports only `./lib/junit.mjs` and `./lib/manifest.mjs` (Node built-ins only); it does not import `lib/host.mjs`, which reaches into `tools/deps`. The steps before it run no head JavaScript, only owned inputs (`.npmrc`, `package.json`, lockfile, `.node-version`). The job has `permissions: contents: read`, `persist-credentials: false` and no secret. The step adds no action, `env:`, `if:`, `shell:` or `defaults:`, and writes no `$GITHUB_ENV`/`$GITHUB_PATH`/`$GITHUB_OUTPUT`. `RANGE_BASE`/`RANGE_HEAD` are unchanged job-env SHAs from the event, with no `${{ }}` in the script. **The D-ORCH-021 levers do not move**, and this record rules on that explicitly. `check-workflow-policy.mjs` is **not** changed (not weakened, but also not extended; PR23-SEC-06). The lane A `Workflow policy` step (base copy) passed on the head `ci.yml` |
| (b) Evidence forgery | Fabrication passes (S1, PR23-SEC-09, SEC-P3-07 residual). **Replay for a newer head:** rejected unless every path changed since `git_sha` is staleness-allowed (S2 stale, S3 non-ancestor). **Bounded scan:** fail-closed. Touched runs are always evaluated; a run outside the newest 30 is merely not a candidate. Future stamps (S1) can crowd that window, which can only cause a FAIL. Tampered untouched base runs are ignored by design. **Hash binding:** `git_sha` ↔ directory name ↔ ancestry only; lockfile, manifest, stamp, time and coverage are not cross-checked (PR23-SEC-04). **Tamper vs reject:** a sound split. Hash, count, schema, name and size failures, or a declared PASS contradicted by the run's own JUnit, are tampering and FAIL when the run is touched (S4). Manifest-dependent differences only reject. Base-run rewrites and deletions are not caught (S6, PR23-SEC-04) |
| (c) `active`-only | MEDIUM programme gap, with the activation control spelled out in PR23-SEC-02. The first activation passes on its own; later activations must be manifest-only (S5/S5b) |
| (d) `.prettierignore` | One exact-path line, `tools/quality/required-suites.json` (anchored, no glob). Prettier formatting only; no linter, scanner or gitleaks reads `.prettierignore`. **No security effect** |
| (e) Recorded data | `envOverrides` returns NAMES only: upper-cased, with any other character mapped to `_`, filtered by `SKIP_`/`TEST_`; no value is read into output. `summary.json` and `fastlane.json` hold `os` (`type release (platform)`), `cpu_model`, `cores`, `ram_gb`, `docker_version`, `node_version` and `npm_version`, with no host name, user name, IP or home path. Coverage keys outside the root become `<outside>/<basename>`. Failure messages are scrubbed of the repository root and the home directory. The gap is Jest `name`/`classname` (PR23-SEC-08) |
| (f) Traversal and XML injection | `check-evidence` reads blobs by OID from `ls-tree` and never opens a file path. References are `safeRelPath`-checked and must exist in the listing; symlinks (`120000`) and submodules are strays. `heavy` writes only allow-listed names (native report `^[A-Za-z0-9][A-Za-z0-9._-]*\.json$`, no `/`) into `<outBase>/<root>/runs/<stamp>_<sha7>/`. `prune` deletes only `RUN_DIR`-matching `Dirent` directories (symlinks skipped) under fixed roots. Converters return cases, not paths. XML: `escapeXml` covers `& < > " '`, CR, LF and TAB and drops XML-invalid code points; the reader rejects DOCTYPE/ENTITY anywhere, decodes only the predefined and numeric entities, is linear, and checks declared totals against cases. The fuzz shows 0 injections (§2) |
| (g) Lock delta and licences | **None.** `package-lock.json` is unchanged; `package.json` adds four scripts. New imports: `ajv/dist/2020.js` (ajv 8.20.0, MIT, existing root devDependency), Node built-ins, and in-repo `tools/deps/npm-cli.mjs` |

## 6. Relation to open items

- **PR10-SEC-17 (TASK-015):** PR23-SEC-06 adds one more gate to pin. **PR10-SEC-21:** unchanged.
- **PR17-SEC-07/08:** apply to the new step as to every gate. Its `run: |` is literal, so 07 does not apply to it. **PR17-SEC-05 CR note:** recurs as PR23-SEC-07.
- **SEC-P3-07:** items 1–4 are implemented here, with the gaps in 04 and 05. Items 5–6 are TASK-015 (PR23-SEC-02/09). **SEC-TC-48:** the developer's fixtures cover the listed cases. The probes reproduce S0, S2, S3, S4, S9 and S10 independently.
- **D-TASK011-01:**
  - (1) **Correction for the ruling:** the first activation does not fail on its own evidence (S5). The failure appears from the second activation on (S5b).
  - (2) **Schema location:** no security objection, since it is a tooling input read from the base ref.
  - (5) The stale `tooling_inputs`/exclude entries naming the old manifest path are harmless: the new path is outside `docs/**` and therefore never staleness-allowed.

## 7. Merge conditions and overlap

**Overlap with main.**
- Merge base `d38500a` (single). Today's `main` is `360f419` (docs-only commits on top of `84d9299`, the PR #21 merge).
- Paths both sides changed: `package.json` (**owned**: main added `openapi:*`, the PR adds `quality:*`) and `tools/repo/root-scripts.test.ts` (unowned).
- `git merge-tree --write-tree 360f419 f61e55d` is clean. It yields tree `bd197a5f01f758cd5a3ea4409bf2e115df18ce1d`, and its diff to `360f419` touches exactly the PR's net-change paths.
- Open PRs #20 (`9647907`) and #24 (`6f498c4`) share no path with this PR. Dependabot #22 (`804733a`) also changes `package.json`.

**Consequence.** A merge of `main` into the branch brings main's `package.json`, which voids this record (clause (d)). Merge the PR with `--match-head-commit` on the record commit, without merging `main`. If a merge of `main` is needed, a merge-only round must name the merge commit after these checks:
1. `git ls-remote origin` shows the merge commit as the PR head.
2. `git diff --name-only --no-renames <main parent> <merge>` equals the 29 net-change path entries of `d38500a..f61e55d` (28 files plus the renamed-away `docs/05-quality/tests/required-suites.json`).
3. Every blob equals `f61e55d`'s except `package.json` and `tools/repo/root-scripts.test.ts`.
4. Those two equal the `git merge-tree --write-tree <main> f61e55d` result. For `main` = `360f419` the blobs are `0145163` (`package.json`, both `openapi:*` and `quality:*` script sets) and `b0cb255`.
5. No lockfile entry changes.
6. If `main` has meanwhile changed `.github/workflows/ci.yml`, `.prettierignore`, `.github/CODEOWNERS` or `tools/quality/**`, a full delta review replaces the merge-only round.

A fix cycle that adds the PR23-SEC-01 CODEOWNERS line changes an owned path. It therefore needs a new round on the new head.

## 8. Record check (simulated)

Main's `tools/ci/check-security-owned-paths.mjs` (from `git archive 360f419 tools/ci`) runs against a scratch `git clone --shared` checked out at `f61e55d`, with this record copied into its working tree; base is `360f419`, `--pr 23`. The clone was removed afterwards. The gitleaks emulation over the final text of this record found 0 findings, while its control file gave 5.

| Run | Expected | Result |
|---|---|---|
| A: this record in the tree, `--head f61e55d`, `--pr 23` | pass | exit 0, `pass`, 4 owned, satisfied by this record @ `f61e55d` |
| A2: this record committed on top of `f61e55d` (docs-only), `--head` = that commit | pass | exit 0, `pass`, satisfied @ `f61e55d` |
| B: no record in the tree | missing | exit 1, `missing` ("no record named …PR-0023-*.md") |
| C: this record, `--pr 22` | missing | exit 1, `missing` ("no record named …PR-0022-*.md") |
| D: A2 + a later commit changing `.prettierignore` | missing | exit 1, `missing` ("names f61e55d, but .prettierignore changed after it") |
| E: this record with its last verdict changed to FAIL | missing | exit 1, `missing` ("verdict FAIL is not one of …") |

## 9. Verdict

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_CONDITIONS.** No Critical or High finding is open at head `f61e55d`, so the merge rule is met for the security dimension.<br>**What holds:** the lane A step runs the base-ref verifier with no new workflow lever, permission, action or secret. The verifier rejects missing, stale, non-ancestor and tampered evidence (probes S0, S2, S3, S4). The JUnit path is injection-safe, writes and deletes stay inside the evidence tree, and only environment variable names are recorded. There is no lock delta and no new dependency.<br>**Conditions (tracked, with due points):**<br>(1) **PR23-SEC-01 (MEDIUM):** add `/tools/quality/` to `.github/CODEOWNERS` before the first `planned → active` flip or the next `tools/quality` change, whichever is first.<br>(2) **PR23-SEC-02 (MEDIUM):** activation through manifest-only PRs, starting with `unit`/`integration`/`api`/`catalog-c1-c14`/`migrations` by the end of Wave 0; an active-needs-runner test; and a `--profile gate` verifier run plus SEC-P3-07 items 5–6 before G3.<br>(3) **PR23-SEC-03/04/05 (LOW):** due before the first activation.<br>(4) **PR23-SEC-06 (LOW) and the INFO items 07/08/10:** TASK-015, or with the runner that introduces them.<br>PR23-SEC-09 is the accepted SEC-P3-07 residual.<br>**This round authorises `f61e55d` for merge** once this record is committed on top of it as a docs-only commit and lane A is green on that commit, without a further merge of `main` (§7) |

## Round 2 (head c0b1b31)

| Field | Value |
|---|---|
| Head | c0b1b31a2a153892bc424e3adaf9a0d6b528dc83 |
| Commits since R1 | Fix cycle 1 (D-ORCH-028): `de1fae3` (CODEOWNERS line, `REQUIRED_CODEOWNED_PATHS`, mutation tests), `8321ad0` (`--event`, `--report-only` pin, rule-4 wording), `712e25d` (unreadable Jest report, restricted runs to temp). Two merges of `main`: `055d373` (main `61efbb3`) and `c0b1b31` (main `6fd801f`). Merge base `6fd801f`; net change 33 path entries (+5,970 / −223) |
| Lane A evidence | Run [43364590973](https://github.com/sukhchdit/shipcube/actions/runs/43364590973) on `c0b1b31` (`pull_request`, base `6fd801f`). **fast-lane `success`.** "Workflow policy" ran from the base ref and passed. "Lane B evidence" ran in bootstrap mode (head copy, `--event pull_request`, report-only) and printed `no active lane B suite is required for this change; selected suites still planned: unit` and `PASS (report-only)`. **scans:** Gitleaks `no leaks found` (11 commits); Semgrep `success`. Only "Security-owned paths need a review record" failed: 27 owned paths, and the R1 record names `f61e55d`, after which 11 owned paths changed. `ci-gate` failed as a consequence. This round is the missing record |
| Owned paths changed | 27, per lane A. The checker reads CODEOWNERS from the base AND the head, so the new `/tools/quality/` line makes every `tools/quality/**` file of this PR owned in this PR. That includes the verifier, lib, schema, manifest, runners and tests from R1, plus the fix-cycle files. This round covers all of them |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. Git commands ran in the main checkout against commit SHAs, or in a scratch `git clone --shared` (removed afterwards). No command ran in the PR worktree. No install, build, Docker, integration or e2e run: the gate results are the developer's table plus lane A run 43364590973 |

### R2.1 What changed, and how it was checked

- **Fix delta** (`git diff 055d373 712e25d`): 13 files (+437 / −44): `.github/CODEOWNERS`, `.github/workflows/ci.yml`, `tools/ci/check-workflow-policy.mjs` (+2), `tools/ci/check-workflow-policy.test.ts`, `tools/ci/ci-policy.test.ts`, `tools/quality/{check-evidence,heavy}.mjs` with their tests, `tools/quality/required-suites.json`, and three docs.
- **Merges.**
  - The tree of `055d373` equals `git merge-tree --write-tree 61efbb3 f61e55d` (`cf27520`).
  - The tree of `c0b1b31` equals `git merge-tree --write-tree 6fd801f 712e25d` (`50c3a8e`).
  - Both merges are clean, with no manual resolution.
- **Three-way blob compare** over the 33 net-change entries of `6fd801f..c0b1b31`. Every blob equals `f61e55d`'s, with four classes of exception:
  - the 13 fix-cycle paths;
  - `package.json` = `0145163`, the union R1 §7 predicted: main's `openapi:*` scripts plus the four `quality:*` scripts, and nothing else;
  - `tools/repo/root-scripts.test.ts` and `docs/03-architecture/data-model.md`, which are unowned unions.
- **Lockfile.** `package-lock.json` is blob `1453a95` at `d38500a`, `6fd801f`, `c0b1b31` and `origin/main`, so there is no lock delta and no new dependency.
- **Overlap with today's main.** Main moved from `6fd801f` to `1736051` and changed only `docs/sdlc/STATUS.md`, two `docs/05-quality/reviews/` records (including the PR #23 code review r2, APPROVED_WITH_NITS) and agent memory, so no owned path overlaps. R1 §7 item 6 did not trigger: main changed none of `ci.yml`, `.prettierignore`, CODEOWNERS or `tools/quality/**`.

### R2.2 Focus items

| Item | Ruling |
|---|---|
| (a) COND-PR23-1 / PR23-SEC-01 | **Closed.**<br>• `/tools/quality/ @sukhchdit` is in the "CI, workflows, supply chain" section of CODEOWNERS, with a reason comment.<br>• `REQUIRED_CODEOWNED_PATHS` gains `'tools/quality/'`. This PR's own lane A ran main's policy copy, which does not have the entry yet. The pin binds every later PR once this PR merges, because the policy runs from the base.<br>• Four new tests, plus the updated pinned list: present and required; line deleted, ownerless, or commented out → a finding naming `tools/quality/`; a parent `/tools/` line covers it; the sibling `/tools/qualitys/` does not.<br>• The record covers this PR's own `tools/quality` changes: lane A lists them as owned, and simulated run D (§R2.5) shows that a later `tools/quality`-only commit voids this record |
| (b) `--event "$GITHUB_EVENT_NAME"`: can the push skip be reached on `pull_request`? | **No, short of an owned `ci.yml` edit.**<br>• The skip depends only on argv `--event push`. `check-evidence.mjs` does not read `GITHUB_EVENT_NAME` itself, and when `--event` is absent it defaults to `pull_request`, which is fail-closed.<br>• The runner sets `GITHUB_EVENT_NAME` from the event. GitHub documents that a workflow `env:` assignment to a default `GITHUB_*` variable is ignored.<br>• A PR can make a `pull_request` run skip only by editing the step to pass `--event push`, by prefixing `GITHUB_EVENT_NAME=push`, or by an earlier `$GITHUB_ENV` write. The first two edit an owned file, and the third is already a D-ORCH-021 lever. All three are the same class as deleting the step, so this adds no new lever. A literal event value on either line, and a step-level `env:`, fail the head test (`ci-policy.test.ts`, mutation "event hard-coded on the base-ref line").<br>• An event outside `pull_request`/`push` (for example a future `merge_group` or `workflow_dispatch` trigger) exits 2, so the step fails closed.<br>• The base-ref policy still does not pin the step (PR23-SEC-06). The TASK-015 pin must now include the event argument (amended remediation in §R2.3).<br>• Push-to-main behaviour after merge: the pushed range's base is the pre-merge `main`, which has no verifier, so the bootstrap head copy runs with `--event push` and skips. From the next push on, the base copy skips. A squash commit can never satisfy ancestry, so skipping on push removes no control: the pull-request run is the control, as for `check-security-owned-paths` |
| (c) Base-ref copy before head code | **Unchanged.** The step keeps its position: after `npm ci --ignore-scripts` and the audits, before "Prisma engine cache key" and `deps:rebuild`. `ci-policy.test.ts` asserts that order. The step comment now carries the PR23-SEC-03 qualification ("except the locked Ajv"), as R1 asked |
| (d) `--report-only` | **Exactly one**, at the end of the bootstrap head-copy line. The base-ref line has none.<br>• The `ci.yml` net change is 24 added lines and 0 removed.<br>• The lever scan finds no `RANGE_BASE`/`RANGE_HEAD` assignment, and no `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults`, folded `run: >`, `$GITHUB_ENV`/`$GITHUB_PATH`/`$GITHUB_OUTPUT` write, `env:`, `if:`, `shell:`, `permissions`, `uses:`, `${{ }}`, `\|\| true` or `set +e`.<br>• **D-ORCH-021: no lever moves**, and this round rules on it explicitly.<br>• The head test pins both lines in full and runs 9 mutations, each a finding: appended, prefixed, `=true`, in a comment, dropped, doubled, `\|\| true`, event hard-coded, base line run from the head copy |
| (e) Rule 4 rewording | **No credit path.** The `check-evidence.mjs` change to rule 4 is only the soft-reason text. A planned-suite JUnit is still a `soft` reason, `accepted` still requires `reasons.length === 0`, and a run that is not accepted is never credited. Three new pins match R1's S5/S5b:<br>• nothing required → PASS, with the run `rejected`;<br>• a later activation whose run carries the new suite → FAIL, `no accepted lane B evidence for required suite(s): unit`;<br>• the same run with only active suites → accepted.<br>The TEST-STRATEGY §9.2 rule 4, README and manifest `planned_suite_reported` wording now say this correctly (the D-TASK011-01 (1) correction) |
| (f) New fixtures and tests | `check-evidence.test.ts`: the newest-30 window, touched runs outside the window, untouched versus touched tampered runs, a stale touched run, multi-root agreement and disagreement (`profile`, `git_sha`, `stamp` → tampering), and `--event` (push skip, a squash commit with no ancestor evidence, the summary note, exit 2 on an unknown event). `heavy.test.ts`: missing, truncated or empty Jest JSON becomes one error case, and a restricted run writes to `mkdtemp` outside the repository. All fixtures are synthetic. The real gitleaks over the range found nothing |
| (g) `heavy.mjs` changes | `jestCasesFrom` and `coverageFrom` fail closed: an error case, or `null` coverage. All existence checks now run before the first write. A restricted run defaults to a fresh `mkdtemp` directory, which closes R1-n5 (accidental commit of an INVALID run).<br>One note is added to PR23-SEC-08: V8 `JSON.parse` messages carry a quoted fragment of the unparsed text (about 10 characters, measured on Node 24.22). `malformed()` messages are not passed through `scrubPaths`, so a fragment of a home path could reach a committed JUnit message. Fix: scrub `malformed()` messages too |
| (h) Manifest `tooling_inputs` / `exclude` edit | Two entries go: the old manifest path and `docs/05-quality/tests/schema/**`. Neither path exists any more, and nothing reads them: the verifier and schema load from `tools/quality` (D-ARCH-082 (1)). `tools/quality/**` is outside `docs/**`, so a manifest or schema change always makes evidence stale. **No security effect** |

### R2.3 Findings status at `c0b1b31`

| ID | Severity | Status | Note |
|---|---|---|---|
| PR23-SEC-01 | MEDIUM | **Closed** | §R2.2 (a) |
| PR23-SEC-02 | MEDIUM | Open (condition) | Re-stated against D-ARCH-082 in §R2.4 |
| PR23-SEC-03 | LOW | Open | Due point re-stated in §R2.4 |
| PR23-SEC-04 | LOW | Open | Due point re-stated in §R2.4 |
| PR23-SEC-05 | LOW | Open | Due point re-stated in §R2.4. The README now documents the ignored-path residual |
| PR23-SEC-06 | LOW | Open (TASK-015) | **Remediation amended.** (1) The `CI_REQUIRED_GATES` pin must match the base line in full, including `--event "$GITHUB_EVENT_NAME"`. It must refuse a literal `--event <word>` and a `GITHUB_EVENT_NAME=` assignment in the step script, and refuse a `GITHUB_EVENT_NAME` key in any workflow, job or step `env:`. (2) Mirror `check-security-owned-paths`: refuse `--report-only` once the base ref contains `check-evidence.mjs`. This is code review R2-n3 in checker form. (3) Refuse `--event push` together with `--profile wave` or `--profile gate`. Items 2 and 3 (bootstrap `else` branch, no-base exit on `pull_request`) are unchanged |
| PR23-SEC-07 | INFO | Open (TASK-015) | Unchanged |
| PR23-SEC-08 | INFO | Open (with the ZAP/Trivy runners) | Add: scrub `malformed()` messages (§R2.2 (g)) |
| PR23-SEC-09 | INFO | Accepted residual | Unchanged |
| PR23-SEC-10 | INFO | Open (TASK-015) | Unchanged |

**New findings this round: none.** No Critical or High finding is open.

### R2.4 COND-PR23-2 against D-ARCH-082, and the due point of PR23-SEC-03/04/05

**COND-PR23-2 (PR23-SEC-02, MEDIUM).** Owners: qa-lead (manifest), devops-engineer (runners, TASK-015), quality-gatekeeper (G3). Probed with the head `lib/manifest.mjs` `selectSuites` on the head manifest, with D-ARCH-082's W0-ACT-1 list set `active`.

1. **W0-ACT-1, right after merge.**
   - It is a manifest-only PR, and it now needs a security record, because `tools/quality/**` is owned.
   - It passes the verifier with nothing required, because the base manifest has no active suite. Any run carried in it is not credited.
2. **An active-needs-runner test must land with W0-ACT-1 or before it.** The test asserts that every `active` suite has a `suite-runners.json` entry.
   - Today only 5 suites have a runner: `unit`, `integration`, `api`, `catalog-c1-c14`, `migrations`.
   - **9 of the 13 W0-ACT-1 suites have none:** `migration-lint`, `config-guards`, `sec-static`, `ci-policy`, `lint`, `typecheck`, `contract-openapi`, `e2e-chromium`, `e2e-webkit`.
   - Probe: with that list active, an `apps/web/**` change selects `e2e-chromium`. `quality:heavy` then writes the error case "no runner entry for active suite", so **every web PR FAILs**.
   - This fails closed and is not a bypass. But it puts the first Wave-1 web PRs under exactly the fix-cycle pressure that SEC-P3-07 names.
   - So W0-ACT-1 either carries runner entries for the suites it activates (devops-engineer, in the same PR), or it activates only suites that already have one.
3. **`api`.** It has a runner, and its tests are on `main`. COND-PR23-2 puts it in the Wave-0-exit set, but D-ARCH-082 lists it at neither checkpoint. Activate it in W0-ACT-1, or at the Wave-0 exit at the latest.
4. **Later activations** (Wave-0 exit, `v0.1.0-m0`, G3) stay manifest-only.
   - After W0-ACT-1, a change to `tools/quality/required-suites.json` alone selects exactly `unit` (probe). The activation PR therefore needs a fresh `unit` run: `npm run quality:heavy -- --profile pr`, which selects only `unit`.
   - A `--profile wave` or `--profile gate` run in that PR would carry the newly activated suites, and rule 4 would reject it as a whole.
   - The activation PR must not touch a path that selects a suite it activates.
5. **G3** is unchanged:
   - quality-gatekeeper's `--profile gate` transcript on the gate SHA;
   - a transcript that says `skipped` (an `--event push` run) is no evidence;
   - SEC-P3-07 items 5 and 6 must be live (TASK-015).

**PR23-SEC-03/04/05: due point re-stated.** R1 and D-SEC-PR23-01 said "before the first activation", and D-ORCH-028 (4) routed them to a devops follow-up before the first activation. D-ARCH-082 now schedules W0-ACT-1 immediately after merge. **Ruling: W0-ACT-1 does not wait for these three.**

**Why.**
- Each of them weakens an enforcement that does not exist until W0-ACT-1, and that missing enforcement is the MEDIUM gap PR23-SEC-02.
- None of them is easier to exploit after activation than the "nothing required" state is today.
- Holding the activation behind three LOW fixes would only prolong the MEDIUM exposure.

**New due point:** merged before the **Wave-0-exit activation PR**. That is the second D-ARCH-082 checkpoint: it activates `rls-cross-tenant`, `rbac-matrix`, `audit-*`, `abuse` and `route-registry`, and it comes before the first `wave` run. That activation PR's security record will be FAIL while any of the three is open.

**Interim controls from W0-ACT-1 until then:**
- **03:** every security record of a PR that changes `package-lock.json` states the `node_modules/ajv` entry (version, integrity, no `link`) and that no non-`@platform` `link: true` entry exists.
- **04:** no `wave` or `gate` run is committed (none is due before the Wave-0 exit). A PR that modifies or deletes a committed run directory is rejected in review.
- **05:** the gate table of each evidence commit states two things: `npm ci --ignore-scripts` and `npm run deps:rebuild` ran in that worktree immediately before `quality:heavy`, and the worktree's `.git/info/exclude` holds no entries.

**Proposed decision text** (for the orchestrator to log as D-SEC-PR23-02): "PR #23 security r2 at c0b1b31 = PASS_WITH_CONDITIONS. COND-PR23-1 closed. COND-PR23-2 re-stated against D-ARCH-082:
- W0-ACT-1 carries an active-needs-runner test, and either runner entries for every suite it activates or only suites that already have one (9 of the 13 listed lack one; `e2e-chromium` would fail every web PR);
- `api` joins W0-ACT-1, or the Wave-0 exit at the latest;
- later activations are manifest-only, with a `--profile pr` unit run.

PR23-SEC-03/04/05 move from 'before the first activation' to 'before the Wave-0-exit activation PR', with the interim controls of §R2.4; W0-ACT-1 proceeds right after merge. PR23-SEC-06 remediation amended (pin `--event "$GITHUB_EVENT_NAME"`; refuse `--report-only` once the base has the verifier; refuse push with wave/gate)."

### R2.5 Record check (simulated)

Main's `tools/ci/check-security-owned-paths.mjs` comes from `git archive origin/main tools/ci` (`1736051`; identical to `6fd801f` under `tools/` and `.github/`). It runs with `--root <clone> --json` against a scratch `git clone --shared` of the main checkout. The clone is checked out at the scenario head, with this record copied into its working tree, `--pr 23`. The clone was removed afterwards. Gitleaks emulation (v8.30.1 default rules, 221 compiled) over the final text of this record: 0 findings, both for the Round 2 section and for the whole file. Three run-time control lines gave 6 findings.

| Run | Expected | Result |
|---|---|---|
| A: this record in the tree, `--base 6fd801f --head c0b1b31` | pass | exit 0, `pass`, 27 owned, satisfied by this record @ `c0b1b31` |
| A1: as A, `--base 1736051` (today's `main`) | pass | exit 0, `pass`, 27 owned, @ `c0b1b31` |
| A2: this record committed on top of `c0b1b31` (docs-only), `--head` = that commit, `--base 1736051` | pass | exit 0, `pass`, @ `c0b1b31` |
| B: no record in the tree (clone at `c0b1b31` as pushed) | missing | exit 1, `missing`: the R1 record names `f61e55d`, and 11 owned paths changed after it |
| C: this record, `--pr 22` | missing | exit 1, `missing` ("no record named …PR-0022-*.md") |
| D: A2 + a later commit changing only `tools/quality/suite-runners.json` | missing | exit 1, `missing` ("names c0b1b31, but tools/quality/suite-runners.json changed after it") |
| E: this record with its last verdict changed to FAIL | missing | exit 1, `missing` ("verdict FAIL is not one of …") |
| F: A2 + a later commit changing only `docs/05-quality/README.md` | pass | exit 0, `pass` (an unowned commit after the named head keeps the record valid) |

### R2.6 Verdict

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_CONDITIONS.** No Critical or High finding is open at head `c0b1b31`, so the merge rule is met for the security dimension. COND-PR23-1 (PR23-SEC-01) is **closed**.<br>**What holds:** `tools/quality/**` is code-owned and pinned in `REQUIRED_CODEOWNED_PATHS`, with mutation tests. In the lane B step, `--event "$GITHUB_EVENT_NAME"` cannot select the push skip on a `pull_request` run without an owned `ci.yml` edit, and an unknown event fails closed. No D-ORCH-021 lever moves. The base-ref copy still runs before head code, except the locked Ajv (PR23-SEC-03). `--report-only` occurs exactly once, on the bootstrap head-copy line. The rule-4 rewording changes text only, and planned-suite runs are still never credited. Both merges are clean, `package.json` is the predicted union, and there is no lock delta.<br>**Conditions (tracked):**<br>(1) **COND-PR23-2 (PR23-SEC-02, MEDIUM)** as re-stated in §R2.4: W0-ACT-1 right after merge, with an active-needs-runner test and runner entries for every suite it activates; `api` by the Wave-0 exit at the latest; later activations manifest-only with a `--profile pr` unit run; at G3 the gate-profile transcript, with SEC-P3-07 items 5–6 live.<br>(2) **PR23-SEC-03/04/05 (LOW):** merged before the Wave-0-exit activation PR, with the §R2.4 interim controls from W0-ACT-1 on. W0-ACT-1 does not wait for them.<br>(3) **PR23-SEC-06 (LOW, amended), 07, 10:** TASK-015. **08:** with the ZAP/Trivy runners, plus `malformed()` scrubbing.<br>PR23-SEC-09 remains the accepted SEC-P3-07 residual.<br>**This round authorises `c0b1b31` for merge** once this record is committed on top of it as a docs-only commit and lane A is green on that commit. A later merge of `main` keeps the record valid only if `main` changed none of this PR's 27 owned paths: `package.json`, `.prettierignore`, `.github/CODEOWNERS`, `.github/workflows/ci.yml`, `tools/ci/check-workflow-policy.mjs`, `tools/ci/check-workflow-policy.test.ts`, `tools/ci/ci-policy.test.ts` and `tools/quality/**`. Today's `main` (`1736051`) changed none of them |
