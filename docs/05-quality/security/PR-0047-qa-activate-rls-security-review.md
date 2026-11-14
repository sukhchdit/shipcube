# PR-0047: manifest-only activation of `rls-cross-tenant`, SEC-TC-29 to required, and the SEC-TC-74 ruling

| Field | Value |
|---|---|
| PR | #47 `test(quality): activate rls-cross-tenant suite and move SEC-TC-29 to required`, https://github.com/sukhchdit/shipcube/pull/47, branch `chore/qa-activate-rls-cross-tenant`. Three commits: `2430a25` (manifest), then `120a2d9` and `be8780b` (evidence only). Merge base with `main` is `47f942d`. `main` was `0ab9502` when this round was written; since the merge base it has only docs, agent notes and the PR #47 code review, and `tools/`, `.github`, `package.json` and the lockfile are the same objects there |
| Head | be8780b3ecb5bcfd7d7482b54f81e0ac4b6f087c |
| Lane A evidence | Run 43597954755 on `be8780b` (`pull_request`, base.sha `2a83b2f`). **fast-lane `success`.** "Lane B evidence" ran the base-ref copy. It accepted run `20261114T1250Z_120a2d9` and rejected `20261114T1218Z_2430a25` (rule 4, and "required case SEC-TC-07 not in a passing test case"), then printed `check-evidence: PASS`. **scans:** every step is green except "Security-owned paths need a review record" (1 owned path, no `PR-0047-*` record). `ci-gate` is red only as the aggregate. This file is the missing record |
| Owned paths changed | 1: `tools/quality/required-suites.json` (+4 / -3). These are the same objects at base, head and `main`: `.github` (`bf677ae`), `tools/ci` (`35a0e2b`), `package.json` (`30f81e5`), `package-lock.json` (`54e8cad`), `tools/quality/suite-runners.json` and `tools/quality/check-evidence.mjs`. The other 12 changed files are the two run directories |
| Reviewer / date | security-analyst, 2026-11-14, round 1. Read-only throughout. Git object reads ran in the main checkout. Probes ran on `git archive` extracts in the session scratchpad. The record simulation used a sparse `git clone --shared`. In the PR worktree I did two things only: I read the untracked D-QA-019 run directory as plain files (no git command), and I wrote this file. No install, build, Jest, Docker or commit. The code-review twin is `docs/05-quality/reviews/PR-0047-qa-activate-rls-code-review.md` on `main` (`0ab9502`, APPROVED_WITH_NITS), and this record cites its IDs |

## 1. Summary

PR #47 is the qa-lead activation PR that D-TASK024-16, D-ORCH-071 and D-SEC-PR43-05 asked for, right after PR #43.

- **The manifest diff is exactly as specified (§5.1).** A leaf-level deep diff of the base and head manifests shows 14 changed leaves, with a positive control. They are:
  - `rls-cross-tenant` becomes `active`, with `min_tests` 126 and `required_cases` [SEC-TC-06];
  - pending SEC-TC-07 (TASK-051, `v0.1.0-m0`);
  - pending `catalog-c1-c14` SEC-TC-74 (TASK-037, `v0.1.0-m0`);
  - `api.required_cases` [SEC-TC-29], with the `api` pending row removed.

  No other suite, gate, rule, profile, path rule, `$comment` or key order changed.
- **The SEC-TC-29 move is backed (§5.2).** 30 of 30 `[SEC-TC-29]` cases pass in the api JUnit, across four files, and one of them is the shared-helper case. No `SEC-TC-29<digit>` ID exists anywhere in the tree. Run against this very run, the base manifest's own `pendingImplemented` reports `api:SEC-TC-29`. I confirm the code review's deviation ruling D1.
- **The two-run method (D-QA-017) is sound under D-ORCH-034 (§5.3).** Both runs use profile `pr`, both sit on ancestors of the head, and only docs follow them. The credited run uses the default base. The run that carries the suite (126 / 0 / 0) is supplementary and uncredited, which D-SEC-PR43-05 (1) allows. The method should not be generalised to *credited* runs with a narrower `--base`: see PR47-SEC-02.
- **SEC-TC-74 (D-QA-018, §6).** Parking it was a mistake. It came from my own D-SEC-PR43-04 wording, which D-SEC-PR43-05 carried forward.
  - The pending list is defined as "IDs that no test on main carries yet".
  - While SEC-TC-74 is parked, a deletion of the 16 C15 cases goes unnoticed by the verifier (probe E).
  - The Wave-0-exit `wave` run would fail.

  **Ruling:** SEC-TC-74 moves to `catalog-c1-c14.required_cases` in the next commit that changes the manifest, before TASK-037 merges and before the first `wave` run. That is not this PR, unless this PR has to take a manifest union commit anyway (D-ORCH-081). The decision text is D-SEC-PR47-01.
- **Evidence hygiene holds (§5.4).**
  - The D-SEC-PR23-02 statements appear verbatim.
  - The count-only host-path scan finds 0, with two positive controls.
  - Both summaries verify (`git_dirty` false, `build_clean` true, no environment overrides, and each report's SHA-256, `manifest_sha256` and `lockfile_sha256` match).
  - Lane A's Gitleaks step is green.

**Findings:** 0 Critical, 0 High, 0 Medium, 2 LOW (PR47-SEC-01, PR47-SEC-02), 1 INFO (PR47-SEC-03). **Verdict: PASS_WITH_FOLLOW-UPS** (§10).

## 2. Method

| Area | How |
|---|---|
| Diff | `git diff origin/main...be8780b` (13 files). Probe A (`pr47/probes/p1.mjs`) diffed the manifests at leaf level, `47f942d` against `be8780b`. Its positive control is one extra `rbac-matrix.min_tests` edit, which gives exactly one more leaf (15 vs 14). It also compares top-level key order and suite order, and parses the head through the real `parseManifest` |
| Code read | `check-evidence.mjs`: `nameHasId` :275, `satisfiesRequired` :300, `recomputeVerdict` rule 4 :353, `pendingImplemented` :375, the checkpoint rule :610, `accepted` :638, the pending note or problem :647-651. Also `lib/manifest.mjs` (:112 pending definition, `checkpointsReached`), `heavy.mjs` (`--base` :157, :700, :993, :1081), `lib/host.mjs` `changedPaths`, `suite-runners.json`, `.github/CODEOWNERS`, the C15 test file, the security-test-cases catalogue (rows SEC-TC-06/07/29/74 and the proposed-cases adoption notes), the PR body, the commit messages and the code review |
| Evidence (probe C) | Reads git objects at `be8780b`. For each report, its SHA-256 against `summary.json`. `manifest_sha256` against the manifest blob at the run's `git_sha` and at the head. `lockfile_sha256` against the lockfile blob. Profile, `git_dirty`, `build_clean`, `env_overrides`, `invalid_reasons` and any key naming a base. Every JUnit goes through the real `parseJUnit`: counts, non-passing cases, non-passing SEC-TC cases, and the IDs SEC-TC-06/07/29/74 by `nameHasId` and by substring. `SEC-TC-(05/06/07/29/74)<digit>` look-alikes. `activation.test.ts` cases and `coverage …` cases in the unit JUnit |
| Semantics (probe E) | The real `recomputeVerdict` and `pendingImplemented` run on the parsed run `20261114T1218Z_2430a25` under three manifests: base, head, and head with SEC-TC-74 moved into `catalog-c1-c14.required_cases`. A negative control removes the 16 C15 cases from the catalog JUnit. `checkpointsReached` for `pr` and `wave`. `nameHasId` controls |
| Union (probe B) | `git merge-tree --write-tree be8780b 7e9fb3c` (PR #42's head): it exits 0 with no conflicted path. A leaf diff of the merged manifest against this head |
| ID collisions | `git grep -o 'SEC-TC-[0-9]+…'` over the head tree gives every distinct token, then the files that hold the three-digit ones |
| D-QA-019 run | The untracked `20261114T1236Z_120a2d9/unit.junit.xml` in the PR worktree, parsed with the real `parseJUnit` (`p3-fail.mjs`). Counts, case statuses and file names only |
| Host-path scan (`p2-hostscan.mjs`) | Count-only. The needles are computed at run time and never printed: the OS user name, its 8.3 stem, home and temp directory forms (backslash, slash, escaped backslash, lower case), the host name, the git e-mail and the POSIX drive form. It covered both run directories (12 files), the three commit messages and the manifest diff. Controls: a synthetic JSON-escaped home and 8.3 path is detected, and the withdrawn PR #28 run (`d3f2b6d^`) is detected (2) |
| Record simulation (§9) | A sparse `git clone --shared` with plumbing scenario commits. `main`'s `tools/ci/check-security-owned-paths.mjs` (the same object as the base's) is run `--json` per scenario. The base-ref `check-evidence` runs on the record-only commit |
| Gitleaks | Lane A's real Gitleaks step is green on `2a83b2f..be8780b`. The v8.30.1 default-ruleset emulator ran over this record before hand-off, with run-time positive controls (§9) |

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner · due |
|---|---|---|---|---|---|---|
| PR47-SEC-01 | SEC-TC-74 is parked although 16 passing tests carry it. The C15 cases are unenforced, and the Wave-0-exit `wave` run fails (= code review R1-m1) | LOW | CWE-693 | A08 | `tools/quality/required-suites.json:51` (and the pending `$comment` :45); `lib/manifest.mjs:112`; `check-evidence.mjs:375-385, 647-651` | qa-lead · the next commit that changes the manifest; before TASK-037 merges and before the first `wave` run (D-SEC-PR47-01) |
| PR47-SEC-02 | `quality:heavy --base` sets the scope of the US-006 changed-file gate, is not recorded in `summary.json`, and is not constrained by the verifier (code review R1-n1, widened) | LOW | CWE-345 | A08 | `tools/quality/heavy.mjs:157, 700, 993, 1081`; `tools/quality/summary.schema.json`; `check-evidence.mjs` (no rule) | devops-engineer (015-C) · before G3. Interim control from now on (§4) |
| PR47-SEC-03 | A same-SHA re-run after a FAIL run that held two failing `[SEC-TC-29]` cases. The TASK-W0-FLAKE scope misses `health/server.test.ts` | INFO | CWE-1068 | A04 | D-QA-019 / D-ORCH-080; `apps/api/src/platform/health/server.test.ts`; `apps/api/src/platform/routing/pipeline-guards.test.ts` | qa-lead → test-engineer (TASK-W0-FLAKE) · within Wave 1 |

## 4. Finding details

### PR47-SEC-01 (LOW): SEC-TC-74 parked although implemented

- **CWE-693** (Protection Mechanism Failure) · **OWASP A08:2021**.
- **Where.** `tools/quality/required-suites.json:51` parks `catalog-c1-c14: SEC-TC-74` with owner TASK-037. The list's own definition says otherwise. Its `$comment` (:45) reads "SEC-TC IDs taken out of the required_cases of an active suite because no test carries them on main yet", and `lib/manifest.mjs:112` says "SEC-TC IDs of an active suite that have no test on main yet". Yet `prisma/tests/catalog/c15-std-columns-guard.int.test.ts` (:195-389) carries `[SEC-TC-74]` in 16 cases that pass in `catalog-c1-c14` (run `20261114T1218Z_2430a25`: 16 / 16, all with that classname). Two unit cases in `tools/db/render-rls-dr-a14.test.ts` carry it as well.
- **Description.**
  - The verifier reads only `required_cases`. A parked ID is enforced by nothing. It only produces a `pendingImplemented` entry: a note at `pr`, and a problem at `wave` and `gate` (`check-evidence.mjs:647-651`).
  - **Probe E** (the real functions on the run's JUnit) removed all 16 C15 cases from the catalog JUnit:
    - under the head manifest, `recomputeVerdict` gives PASS with no soft reason, and `pendingImplemented` gives `[]`. The deletion is silent.
    - under the moved manifest, the same input gives "catalog-c1-c14: required case SEC-TC-74 not in a passing test case".

    A failing or skipped SEC-TC case is still a hard failure (`secCases`, `zero_skip`). So the gap is deletion or retitling only.
  - **Second effect (D-QA-018, confirmed).** Under the head manifest, run `2430a25` gives `pendingImplemented` `["catalog-c1-c14:SEC-TC-74"]`. A `wave` run therefore fails rule 7 / PR28-SEC-01. At `gate`, the checkpoint rule (:610) also fires for `v0.1.0-m0`.
- **Exploitability / impact.**
  - Deleting or retitling the cases takes a PR that edits `prisma/tests/catalog/`. That path is code-owned (`/prisma/`, CODEOWNERS :58), so such a PR needs a security record.
  - On `main`, no runtime-writable STD table exists yet (the C15 file header says so). So there is no exposure until TASK-037 adds the first one, and TASK-037 is exactly the PR whose evidence should be held to these cases.
  - Rated Low impact × Low likelihood: **LOW**. The cost of keeping the entry is the Wave-0-exit failure plus an unenforced control in the one PR where it matters.
- **Remediation (code level).** Move the ID in the next manifest commit (D-SEC-PR47-01 (2)):

  ```json
  "catalog-c1-c14": { …, "min_tests": <count at that commit>, "required_cases": ["SEC-TC-05", "SEC-TC-74"], … }
  ```

  Then delete `required_cases_pending["catalog-c1-c14"]`. Ratchet `min_tests` in the same commit: it is 14 today against 102 running tests (PR28-SEC-04), and `required_cases` is satisfied by a single passing case.
- **Verification test.** `activation.test.ts` (pending disjoint from required) stays green. The moving PR's check, run with its head manifest against run `2430a25` (or a later catalog-carrying run), accepts it with `pendingImplemented` `[]`. The probe E negative control (C15 cases removed) reports the required case missing.

### PR47-SEC-02 (LOW): the run's `--base` scopes the changed-file gate and is unrecorded and unconstrained

- **CWE-345** (Insufficient Verification of Data Authenticity) · **OWASP A08:2021**.
- **Where.**
  - `heavy.mjs:157` takes `--base` (default `origin/main`). `:993` selects suites from `git diff <base>...HEAD`. `:1081` and `:700` build the US-006 changed-file gate (`coverage diff:` cases) from `diff(repoRoot, base, 'HEAD')`.
  - `summary.json` and `summary.md` record neither the base nor the merge base (probe C: no key names a base in either run).
  - `check-evidence.mjs` re-derives the *suite* selection from the PR's own range. It uses `coverage diff:` names only in the decoy rule (`RESERVED_COVERAGE_PREFIXES`), so nothing ties the diff gate to the range being checked.
  - Lane A runs no diff gate of its own (`ci.yml` "Unit tests" is `npm run test:unit`).
- **Description, with a natural experiment from this PR.** The same source tree gave 14 `coverage diff:` cases under `--base cc2a57d^` (run `2430a25`) and one case, "no changed source file in scope", under the default base (run `120a2d9`). That accounts for exactly the 4739 vs 4726 unit difference (code review V10). Neither artifact says which base was used.
  - Suppose a *credited* run is taken with a base on the branch, such as the parent of the last fix commit. The narrowed change still fires the same path rules (any backend file fires `backend`), so the run carries every suite the verifier requires and is accepted. But its diff gate checks only the files changed since that base.
  - The base-independent `coverage gate:` cases (overall, `packages/authz` and, after PR #42, `packages/audit`) still apply.
- **Exploitability / impact.** The run's author has to pass a non-default `--base`. The effect is a weaker per-change coverage gate, not a security-suite bypass, because selection is re-derived. D-QA-017 makes `--base` part of the documented evidence method, which raises the chance that someone copies it with a narrower base. Medium impact × Low likelihood (author-controlled, not silent to a reviewer who asks) gives **LOW**.
  - **Not the case here.** The credited run used the default base. The wider base on the uncredited run only *enlarged* the gate (14 diff cases, all passed).
- **Remediation (code level).**
  - `heavy.mjs` writes `selection_base: <full sha of git merge-base <base> HEAD>` into `summary.json`. Add it to `summary.schema.json` as required, and print it in `summary.md`.
  - At profile `pr`, `check-evidence.mjs` refuses an accepted run unless its `selection_base` is an ancestor of, or equal to, `git merge-base <range base> <range head>`. A wider base passes; a branch-local one is refused.
  - Interim control from now on: every evidence gate table states the `--base` of each committed run. A *credited* run uses the default `origin/main`, or a base that is an ancestor of the PR's merge base.
- **Verification test.** Three plumbing fixtures in `check-evidence.test.ts`:
  - `selection_base` = the merge base: accepted;
  - an ancestor of it (the `cc2a57d^` shape): accepted;
  - a commit on the branch: refused, naming the field.

  Plus a `heavy.test.ts` case asserting that the field equals `git merge-base` for an explicit `--base`.

### PR47-SEC-03 (INFO): same-SHA re-run after a FAIL with failing `[SEC-TC-29]` cases; flake scope

- **CWE-1068** (Inconsistency Between Implementation and Documented Design) · **OWASP A04:2021**.
- **Facts (real parser, untracked run `20261114T1236Z_120a2d9`).** tests 4726, failures 15, errors 0, skipped 2. Two of the failing cases carry `[SEC-TC-29]`, both in `apps/api/src/platform/routing/pipeline-guards.test.ts`. All 15 are time-bound unit tests (6 to 30 s; the code review counts 13 timeouts and 2 wall-clock bounds). **Four of them are in `apps/api/src/platform/health/server.test.ts`**, a file that D-QA-019 and D-ORCH-080 do not list.
- **Description.** "No failed SEC-TC case in any suite" is a hard rule (`recomputeVerdict`). The credited run is a same-SHA retake in a fresh worktree, so a failing SEC-TC case left the record by re-running.
- **Accepted here**, for three reasons:
  - unit took 710 s against 194 s, which is host load;
  - the same control passed in all 30 api `[SEC-TC-29]` cases (run `2430a25`) and in all 53 unit `[SEC-TC-29]` cases of both committed runs;
  - the retake is disclosed with the case IDs.
- **Remediation.** TASK-W0-FLAKE adds `health/server.test.ts` to its file list. Until TASK-W0-FLAKE lands, any PR that retakes a run after a FAIL containing a SEC-TC case names those case IDs in its gate table, as this PR did (D-ORCH-053 applies).

## 5. Verification of the requested items

### 5.1 Manifest diff

| Leaf (probe A, base `47f942d` → head `be8780b`) | Change |
|---|---|
| `suites.rls-cross-tenant.status` | `planned` → `active` |
| `suites.rls-cross-tenant.min_tests` | 1 → 126 |
| `suites.rls-cross-tenant.required_cases[1]` | `SEC-TC-07` removed; `[SEC-TC-06]` remains |
| `required_cases_pending.rls-cross-tenant[0]` | new: SEC-TC-07, owner "TASK-051 (US-080 guest-capable tables, concurrent claim)", `v0.1.0-m0` |
| `required_cases_pending.catalog-c1-c14[0]` | new: SEC-TC-74, owner "TASK-037 (first standard-columns instances; merge condition, D-ARCH-091)", `v0.1.0-m0` |
| `required_cases_pending.api[0]` | removed (SEC-TC-29, TASK-020) |
| `suites.api.required_cases` | `[]` → `[SEC-TC-29]` |

That is 14 leaves, all listed above (the three pending objects count three leaves each). Top-level key order and suite order are unchanged, and the head parses through `parseManifest`. **Nothing else changed.** The `zero_skip`, `security`, `lane`, `runner`, `nfr`, `path_rules`, `profiles`, `rules`, `security_integration_suites` and `deferred_at_gate` keys are the same, and so is every other suite. `suite-runners.json` already holds `rls-cross-tenant` (PR #43), so the active-needs-runner invariant holds: the 6 `activation.test.ts` cases pass in both committed unit JUnits.

### 5.2 SEC-TC-29 backing and ID collisions

- **Backing.** In api JUnit `2430a25`, 30 of 30 `[SEC-TC-29]` cases pass. They come from four files: `tests/api/contract-validation.api.test.ts` (with the shared-helper case D-ORCH-039 (1) asks for), `tests/api/declared-credentials.api.test.ts`, `tests/contract-stubs/contract-stubs.api.test.ts` and `apps/api/src/platform/errors/problem-handler.api.test.ts`. The suite has 124 tests, 0 failures, 0 errors and 0 skips. The base manifest's own `pendingImplemented` for the run is `["api:SEC-TC-29"]` (probe E), so by the verifier's rule the ID belonged in `required_cases`. The 53 unit `[SEC-TC-29]` cases pass in both runs. **Code review D1 (a move beyond "exactly the D-TASK024-16 diff") is confirmed.** It adds a requirement, weakens nothing, and the D-ORCH-039 (1) / SHEET-FOLD-5 routing assigns it to this PR.
- **Collisions (the PR46-SEC-06 question).**
  - `check-evidence` matches with `nameHasId`, which requires a non-digit after the ID. Controls: "SEC-TC-290" does not match SEC-TC-29, while "[SEC-TC-29]" and "SEC-TC-29a" do.
  - PR #46's `security-integration.mjs` (`12ea6a6`, not merged) matches by substring. Across the head tree the distinct tokens are SEC-TC-01..75, plus SEC-TC-1, -99, -001, -014, -140 and -480. **None is `SEC-TC-29<digit>`.** None extends SEC-TC-05, -06, -07 or -74 either. The four three-digit tokens are decoys in `tools/quality` and `tools/ci` tests (unit project) and appear in no suite of `security_integration_suites`.
  - `api` is not in `security_integration_suites`, so the PR #46 job never checks SEC-TC-29 anyway.
  - Across all five JUnits of run `2430a25`, the look-alike count `SEC-TC-(05|06|07|29|74)<digit>` is 0.
  - **No live collision. PR46-SEC-06 stays INFO and unchanged.** Its fix (import `satisfiesRequired`) stays due in that PR's fix cycle.

### 5.3 The two-run method (D-QA-017) under D-ORCH-034, D-SEC-PR23-02 and D-SEC-PR43-05

| Rule | Result |
|---|---|
| D-ORCH-034 (2): a fresh lane-B `quality:heavy --profile pr` run on an ancestor of the head | Both runs use profile `pr`, with `git_sha` `2430a25` and `120a2d9`, both ancestors of `be8780b`. Only `docs/05-quality/tests/runs/**` follows each. Lane A accepted `120a2d9`, and it is the credited run for `unit`, the only suite that a manifest-only change selects |
| The supplementary run cannot be credited by mistake | Rule 4 is a soft reason (`check-evidence.mjs:353`), so the run is rejected, not marked tampered: `touched && tampered` stays false and lane A passed. After the squash merge, `2430a25` is no longer an ancestor of `main`, so every later check rejects it under R-ARCH-16, as lane A already does for 28 older runs in its log |
| The supplementary run tests the activation tree | `2430a25` is the merge base plus the manifest, and the merge base already contains PR #43 (`cc2a57d`), PR #44 (`35a66ab`) and PR #45 (`4a60ca6`). `main` has added no non-docs change since. `--base cc2a57d^` is an ancestor of the merge base, so it only widens selection (the `backend` and `jobs-and-platform` rules fired) and widens the diff gate |
| D-SEC-PR43-05 (1): its own run shows 126 / 0 / 0, uncredited acceptable | `rls-cross-tenant.junit.xml`: 126 tests, 0 failures, 0 errors, 0 skips, all with classname `tests/generated/rls/cross-tenant.int.test.ts`; 13 of 13 `[SEC-TC-06]` pass |
| D-SEC-PR43-05 (3): `min_tests` equals the count at activation | 126 = 126. Recount inputs are `tools/db/table-classes/**`, `prisma/migrations/**` and `tests/generated/rls/**`, and PR #42 changes none of them |
| D-SEC-PR23-02: no `wave` or `gate` run committed | Both runs are `pr` |
| Alternatives rejected by D-QA-017 | A single rls-carrying run would leave lane A with no accepted `unit` evidence: FAIL. A `--suites` run is never evidence. Both points are confirmed by the code |

**Ruling: sound.** One caution: the method relies on a *wider* `--base`. The same flag on a credited run, with a narrower base, is PR47-SEC-02.

### 5.4 Evidence hygiene

| Check | Result |
|---|---|
| D-SEC-PR23-02 statements, verbatim | PR body gate table, "Install" row: "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first" (then `npm run db:generate`), immediately before each `quality:heavy` run. "Exclude file" row: "`.git/info/exclude` is empty". Both also appear in the `be8780b` commit message. The `120a2d9` commit message (run `2430a25`) does not repeat them, but the PR body states them per run, so this is accepted. The shared `info/exclude` is 0 bytes today |
| Summaries (probe C) | Both: profile `pr`, `git_dirty` false, `build_clean` true, `env_overrides` `[]`, `invalid_reasons` empty, verdict PASS. Every report's SHA-256 equals `summary.json`. `manifest_sha256` equals the head manifest blob, and `lockfile_sha256` equals the lockfile blob at each `git_sha` |
| Counts (real parser) | `2430a25`: api 124 / 0 / 0, catalog-c1-c14 102 / 0 / 0, integration 296 / 0 / 1, rls-cross-tenant 126 / 0 / 0, unit 4739 / 0 / 2. `120a2d9`: unit 4726 / 0 / 2. No non-passing SEC-TC case in either run. The one integration skip and the two unit skips carry no SEC-TC ID |
| Host-path scan (count-only) | **0** for every needle class: both run directories (8 + 4 files), the three commit messages and the manifest diff. Controls: the synthetic form and the withdrawn PR #28 run are both detected |
| Gitleaks | Lane A step green: "3 commits scanned", "no leaks found". The PR body's local base-ref range scan found nothing |
| The untracked FAIL run (D-QA-019) | Outside the diff, under `docs/`, not a clean-tree path. Not evidence. See PR47-SEC-03 and the commit-hygiene note in §7 |

## 6. SEC-TC-74 ruling (D-QA-018) and D-SEC-PR47-01

**Question.** 16 passing `catalog-c1-c14` tests on `main` already carry SEC-TC-74, and keeping it parked fails the Wave-0-exit `wave` run. Should it move to `required_cases` now, in this PR or in a follow-up?

**Answer: it moves, but not in this PR (unless this PR takes a manifest union commit anyway). The move is due before TASK-037 merges.**

- **Why it must move.**
  - The pending list is for IDs that no test carries (PR47-SEC-01). While SEC-TC-74 is parked, the 16 C15 cases are unenforced: deleting them is silent (probe E).
  - The pending entry also does nothing for TASK-037's merge condition. The existing cases already satisfy the entry, and they flag it as implemented, so it cannot detect whether TASK-037 extended the matrix.
  - With the ID *required*, TASK-037's own evidence has to carry passing C15 cases. C15 (a) "committed" derives its in-scope set from the catalogue and asserts the guard trigger on every STD table. It therefore fails if TASK-037's first real tables lack the guard. That is the strongest mechanical form of the merge condition the manifest can express.
- **Why not in this PR.**
  - Any manifest edit makes both runs stale. It would cost another heavy unit run on a loaded host (D-QA-019), a lane A run under the CI-minutes ruling (D-ORCH-077/078), and a delta round.
  - That would delay the 126-case RLS activation. The activation closes the larger gap and has its own deadline (before TASK-037 and the first tenant/user/guest route).
  - The parked state has no exposure until TASK-037 adds the first STD table, and the C15 tests are code-owned (`/prisma/`).
- **When the move costs nothing.** D-ORCH-081 lets PR #42 merge first. In that case this PR must take a union commit of the manifest, plus fresh evidence, anyway, and the move rides in that same commit.

**Proposed decision text (for the orchestrator to log; this role does not edit DECISIONS.md):**

> **D-SEC-PR47-01 · 2026-11-14 · security-analyst · PR #47 r1 PASS_WITH_FOLLOW-UPS; SEC-TC-74 back to required; amends D-SEC-PR43-05**
> - **Decision:** PR #47 r1 at `be8780b` = **PASS_WITH_FOLLOW-UPS** (0 C/H/M; LOW PR47-SEC-01, -02; INFO -03).
>   - The manifest diff is the D-ORCH-071 diff plus the SEC-TC-29 move (D-ORCH-039 (1)). Code review D1 is confirmed: 30 passing api cases, and no colliding ID under either matcher.
>   - The two-run method of D-QA-017 is accepted under D-ORCH-034 (2) and D-SEC-PR43-05 (1)/(3).
>
>   (1) **Amends D-SEC-PR43-05 (1) and withdraws the "SEC-TC-73 and SEC-TC-74 through `required_cases_pending`" part of D-SEC-PR43-04.** An ID that a passing test on `main` carries is never parked. `required_cases_pending` holds only IDs that no test on `main` carries (`lib/manifest.mjs:112`; the manifest's own `$comment`).
>
>   (2) **SEC-TC-74 moves** from `required_cases_pending.catalog-c1-c14` to `suites.catalog-c1-c14.required_cases` in the next commit that changes `tools/quality/required-suites.json`:
>   - (a) this PR's union commit, if PR #42 merges first (D-ORCH-081), followed by a merge-only security round; otherwise
>   - (b) a qa-lead manifest-only PR right after #47 merges. That PR may also carry the SEC-TC-69..75 adoption (SHEET-FOLD-5), the `k6-audit-ab` wording and PR34-SEC-05.
>
>   In the same commit, `catalog-c1-c14.min_tests` is ratcheted to the count at that commit (102 today; PR28-SEC-04). **Due:** merged before TASK-037's PR takes its evidence, and before the first committed or gating `wave` run. **PR #47 merges as is.**
>
>   (3) **TASK-037's merge condition (D-ARCH-091) is unchanged.** Its sheet and its security review carry it, not the manifest:
>   - the PR43-SEC-07 remainder: reset to 1 from version ≥ 2, the back-dated `updated_at` control, both RLS-order cases on a real STD tenant table, and the MERGE forms;
>   - C15 (a) green on the first real tables;
>   - every new case titled `[SEC-TC-74]`.
>
>   Optional, qa-lead's choice, default no: a separate ID for the remainder (the next free ID after a repo-wide grep; 76 on 2026-11-14), parked with owner TASK-037.
>
>   (4) **Adoption PR note on SEC-TC-73.** Passing unit tests already carry it (`tools/db/lint-migrations.test.ts`, `tools/db/sql-text.test.ts`), while its catalogue suite `migration-lint` is `planned`. By (1) it is not parked. qa-lead either adds it to `unit.required_cases` or leaves it out of the manifest until `migration-lint` activates. The SHEET-FOLD-5 wording "via `required_cases_pending` (74 before TASK-037)" is superseded for 73 and 74.
>
>   (5) PR47-SEC-02 goes to devops-engineer (015-C, with code review R1-n1): record `selection_base` and refuse a narrower base at `pr`, before G3. Interim control: credited runs use the default base, or an ancestor of the PR's merge base, and the gate table states the base. PR47-SEC-03: TASK-W0-FLAKE adds `apps/api/src/platform/health/server.test.ts`.
> - **Why:** A parked ID is enforced by nothing (probe: deleting all 16 C15 cases is silent under the parked manifest and reported under the moved one). It also fails every `wave` run by rule 7. A required SEC-TC-74 is the only mechanical way to hold TASK-037's evidence to the guard's committed-state check. Moving it inside this PR would stale both runs and delay the larger RLS activation for a gap that has no exposure before TASK-037.
> - **Alternatives:**
>   - Move now in this PR: rejected for the cost and delay above, except in case (2)(a).
>   - Keep it parked until TASK-037 merges, as the `$comment`'s return rule would read: rejected. TASK-037 could not be held to the cases, and Wave-0 exit fails.
>   - A `decision` key on the pending entry: rejected. It silences the checkpoint rule but not the `pendingImplemented` problem, and it would hide an implemented ID.
> - **Reversibility:** High.

## 7. Sequencing and unions

- **PR #42 (`7e9fb3c`, TASK-025).** `git merge-tree` with this head is clean. The merged manifest differs from this head by exactly two leaves: `unit.required_cases` gains `coverage gate: packages/audit lines` and `… branches` (probe B). Whichever PR merges second:
  - takes a fresh credited run. If #47 is second, its credited unit run must carry the two `packages/audit` gate cases, because the current run only has `coverage gate: packages/audit (inactive)` (code review merge condition 2);
  - needs a merge-only security round, because the owned overlap voids its record. Simulation S5 shows this for this record.

  If #47 is second, the SEC-TC-74 move rides that union commit (D-SEC-PR47-01 (2)(a)). PR #42 changes no RLS-count input, so run `2430a25` stays the 126 / 0 / 0 proof. A new uncredited rls run is needed only if a union touches `tools/db/table-classes/**`, `prisma/migrations/**` or `tests/generated/rls/**`.
- **After #47 merges.** Every open PR that fires a rule selecting `rls-cross-tenant` (#42, #39, #46, TASK-024-F) merges `main` and re-takes evidence carrying the suite: at least 126 tests, a passing `[SEC-TC-06]`, 0 skips. A run taken before merging `main` is rejected for the missing suite (D-ORCH-081).
- **PR #46.** Its `security-integration` job reads `security_integration_suites` with `status: active` from the base manifest, so `rls-cross-tenant` joins that job once #47 is on `main`. No substring collision exists for its required IDs (§5.2).
- **Commit hygiene for this record.** The PR worktree still holds the untracked FAIL run `docs/05-quality/tests/runs/20261114T1236Z_120a2d9/` (D-QA-019, D-ORCH-080). Commit this file **by explicit path** (`git add docs/05-quality/security/PR-0047-qa-activate-rls-security-review.md`), never with `git add -A` or `git add docs/`. Otherwise the FAIL run enters the PR as a touched, rejected run that is not evidence.
- **No further non-docs push.** A docs-only commit of this record keeps both runs fresh: `docs/**` is staleness-allowed (simulation S1c).

## 8. Earlier items

| Item | Status after this round |
|---|---|
| D-SEC-PR43-05 (1): exact diff; own run 126 / 0 / 0 | Done. The diff includes the SEC-TC-29 addition, accepted (D1) |
| D-SEC-PR43-05 (2): merges before TASK-037 and the first tenant/user/guest resource route | For the orchestrator. STATUS shows none of TASK-037/027/048/049/051 started |
| D-SEC-PR43-05 (3): `min_tests` = count at activation | Done (126) |
| PR43-SEC-08 (e): the activation PR carries the generated suite's JUnit | **Closed.** `rls-cross-tenant.junit.xml` in run `2430a25`: 126 / 0 / 0, 13 `[SEC-TC-06]` cases |
| PR28-SEC-04: `min_tests` ratchet | `rls-cross-tenant` done at activation. `catalog-c1-c14` stays at 14 against 102; it is ratcheted with the SEC-TC-74 move or at Wave-0 exit |
| D-SEC-PR23-02 interim controls | Held (§5.4). PR23-SEC-03/04/05 are still due before the Wave-0-exit activation PR |
| Code review R1-m1 / R1-n1 / R1-n2 / R1-n3 | R1-m1 = PR47-SEC-01. R1-n1 is widened by PR47-SEC-02. R1-n2: I agree it is a NIT, since a non-deterministic branch denominator weakens no security gate today (96 % against 75 %). R1-n3: noted for the next activation PR |

## 9. Record validation

The simulation script is `pr47/probes/record-sim.mjs` (session scratchpad). It works in a sparse `git clone --shared` of the main checkout and builds scenario commits on `be8780b` with git plumbing. For each scenario it runs `main`'s `tools/ci/check-security-owned-paths.mjs` (the same object as the base's) with `--json`. Scenario S1c instead runs the base-ref `check-evidence` (the `tools/quality` of `47f942d`). The input was this file, final text.

| Scenario | Result |
|---|---|
| S0: no record (`be8780b` as is; control) | `missing`, exit 1: "no record named docs/05-quality/security/PR-0047-*.md". This is the lane A failure |
| S1: this record on `be8780b`, base `2a83b2f` (lane A's base.sha) | `pass`, satisfied by `be8780b`, 1 owned path |
| S1b: as S1, with base = the `main` tip `0ab9502` | `pass`, satisfied by `be8780b` |
| S1c: base-ref `check-evidence` on the record commit | exit 0; run `20261114T1250Z_120a2d9` accepted; `PASS`. The record is docs-only, so the evidence stays fresh |
| S2: `--pr 46` (control) | `missing` |
| S3: the SEC-TC-74 move committed after the record | `missing`: the record names `be8780b`, but `tools/quality/required-suites.json` changed after it. A manifest commit therefore needs a new security round |
| S4: a docs-only commit after the record | `pass` |
| S5: union with PR #42 `7e9fb3c`, base `7e9fb3c` (as if #42 merged first) | `missing`: the owned overlap voids this record, so a merge-only round is needed (§7) |
| S5b: union with the `main` tip (docs only) | `pass` |
| S6: last `Verdict` row set to FAIL (control) | `missing`: "verdict FAIL is not one of PASS, PASS_WITH_FOLLOW-UPS, PASS_WITH_CONDITIONS" |
| S7: `Head` row names the `main` tip (control) | `missing`: "its head row names no commit of this PR" |

Checks on the file itself:
- It has exactly one table row whose first cell starts with `Head` (the full SHA) and one `Verdict` row, the last table row of §10.
- Gitleaks emulation over this file (v8.30.1 `config/gitleaks.toml`, 222 rules, 221 compiled) found 0 findings. The run-time controls (GitHub PAT, AWS key id, generic API key) all fired.
- The count-only host-path scan of this file is 0 for every needle class.
- Line endings are LF.

## 10. Verdict

| Field | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium, 2 LOW (PR47-SEC-01, PR47-SEC-02), 1 INFO (PR47-SEC-03) |
| Conditions | None |
| Follow-ups | PR47-SEC-01, via D-SEC-PR47-01 (2): qa-lead, in the next manifest commit, before TASK-037 and the first `wave` run. PR47-SEC-02: devops 015-C before G3, with its interim control from now on. PR47-SEC-03: TASK-W0-FLAKE scope. Plus the §7 union obligations |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** The manifest-only activation is exactly as specified plus the backed SEC-TC-29 move. Both runs verify, the credited run satisfies lane A, and the supplementary run proves `rls-cross-tenant` 126 / 0 / 0. SEC-TC-74 returns to `required_cases` under D-SEC-PR47-01. No Critical or High finding is open for this change |
