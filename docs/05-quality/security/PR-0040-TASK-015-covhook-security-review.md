# Security review: PR #40 (TASK-015 merged-coverage hook: merged Jest coverage, US-006 merged gate, diff gate in lane B, gate names as required cases)

| Field | Value |
|---|---|
| Round | 1 (change-scoped, P5) |
| Head | `2b651f7c57c181b351c1edd7a80affdea4f36d1d` |
| Branch | `feat/TASK-015-merged-coverage-hook`: `a7541cf` (feature), `8437586` (implied-count cap), `5262707` (merge of `c0c31a1`), `2b651f7` (evidence only). Merge base `c0c31a1`; main tip when written `cc18451` (docs and agent memory only since the merge base) |
| Reviewer | security-analyst |
| Date | 2026-11-14 |
| Scope | 16 paths. Security-owned (11): `package.json` (the `test:coverage` script only), `tools/ci/coverage-merge.mjs`, `tools/ci/coverage-merge.test.ts`, `tools/ci/coverage-run.mjs`, `tools/ci/coverage-run.test.ts` (all new), `tools/quality/heavy.mjs`, `tools/quality/heavy.test.ts`, `tools/quality/lib/manifest.mjs`, `tools/quality/lib/manifest.test.ts`, `tools/quality/required-suites.json`, `tools/quality/suite-runners.json`. Unowned: `tools/repo/jest-esm.test.ts`, the run directory `docs/05-quality/tests/runs/20261114T0031Z_5262707/` (4 files) |
| Input | PR body with D-TASK015-20..27; DECISIONS D-ORCH-034, D-ORCH-047, D-ORCH-056, D-SEC-PR23-02, D-SEC-PR33-02; my records PR-0023, PR-0028, PR-0031, PR-0033; lane A run 43536312585; the committed lane B run. The code review twin was not yet on main when this was written |
| Result | PASS_WITH_FOLLOW-UPS: 0 Critical, 0 High, 0 Medium, 1 LOW, 5 INFO. PR33-SEC-06 is CLOSED |

## 1. Method and limits

Read: the full three-dot diff `origin/main...2b651f7` (both new `tools/ci` modules end to end, every changed hunk of `heavy.mjs`, the manifest loader, both runner/manifest JSON files, the tests' titles and fixtures), the unchanged code the PR now calls (`tools/ci/coverage-gate.mjs`, `tools/ci/diff-coverage.mjs`, main's `tools/quality/check-evidence.mjs`), the head `ci.yml` evidence step, `CODEOWNERS`, `.gitattributes`, `jest.config.ts`.

Probed (scripts in the session scratchpad `review/PR-40-sec`; nothing written to the main checkout's `.git` or to the PR worktree except this file):

- Verifier matrix: plumbing scenario commits on top of the head in a `git clone --shared` scratch clone, judged by three copies of `check-evidence.mjs` side by side: the base-ref copy (`git archive cc18451 tools/quality`, what lane A runs on this PR), the head copy (`2b651f7`, what lane A runs on every PR after this one merges) and a patched head copy carrying the PR40-SEC-02 fix. Section 5.1.
- PR #38's evidence (`8b3a8ed`) through the head copy (the "PR #40 merged first" case of D-ORCH-056). Section 5.1.
- Diff gate: the head `diff-coverage.mjs` (`gitDiff`, `parseUnifiedDiff`, `evaluateDiffCoverage`) on throw-away repos with `.gitattributes` variants and a fully uncovered lcov. Section 5.2.
- Merge logic: the head `coverage-merge.mjs` on synthetic istanbul maps (case folding, drive-letter case, implied counts, placeholders, project checks, tripwire). Section 5.3.
- `COVERAGE_CASE` regex: boundary strings and a scaling run up to 2 M characters (linear).
- Evidence hygiene: blob hashes against `summary.json`, a count-only host-fragment scan with runtime needles and a synthetic positive control, `info/exclude` size, the developer's evidence script and install log in the shared scratchpad. Section 3.5.
- Registry facts for the rejected `istanbul-lib-coverage`.
- Record check simulation with main's `check-security-owned-paths.mjs`. Section 9.

Not done: no `quality:heavy`, no `test:coverage`, no Jest run and no Docker (light-commands constraint). The merge's "branches are a lower bound" claim was not re-measured against a combined Jest run; it rests on the developer's 162-entry comparison plus my synthetic cases (PR40-SEC-06). Lint, format, type-check, unit (186 suites, 4284 tests), negative fixtures, build, Gitleaks (PR range) and Semgrep ran green in lane A run 43536312585 on this exact head; the only red step is the record step. No Semgrep on the host; a Gitleaks emulation of the pinned v8.30.1 ruleset (runtime positive controls fire) gives 0 findings over the 1997 added code lines and over this record.

## 2. Earlier findings that this PR implements

| Finding | Sev | Disposition | Evidence |
|---|---|---|---|
| PR33-SEC-06 | INFO | **CLOSED** | (1) `unit.required_cases` in `required-suites.json` lists exactly `coverage gate: overall lines`, `coverage gate: overall branches`, `coverage gate: packages/authz lines`, `coverage gate: packages/authz branches`, equal to the names `coverageGateCases` writes (`coverage gate: <scope> <metric>`, `coverage-gate.mjs:283-288`). (2) The committed JUnit carries all four as passing cases with classname `unit` (`unit.junit.xml` lines 4298 to 4301). (3) Probe S1: with the four cases renamed away, the head verifier rejects the run (4 reasons) while today's base copy accepts it, so the gap is closed for every PR judged after this merge. Probe S6: `packages/authz` turned inactive is rejected (2 reasons). (4) The merged `test:coverage` / `coverage:gate` / `coverage:diff` hook exists (`coverage-run.mjs`; lane B `mergedCoverageStep` in every profile, diff gate at `pr`). The G3 gate transcript that PR33-SEC-06 also asked for moves to PR40-SEC-06 |
| PR #33 code review R1-m4 | - | implemented | merged coverage across unit, unit-dom, integration, api (+ generated while it has test files) |

## 3. Answers to the focus questions

### 3.1 Evidence integrity

- **Lane A still reads the base-ref manifest.** `.github/` is not in the diff. The evidence step extracts `git archive "$RANGE_BASE" tools/quality` and runs that copy (`ci.yml:215-216`); the copy loads the manifest next to itself (`check-evidence.mjs:733`). The new loader rule (`lib/manifest.mjs:33`, `:202`) and the four names therefore judge only PRs whose base contains this merge. Lane A on this PR (base `c0c31a1`) accepted run `20261114T0031Z_5262707` with main's manifest (`unit.required_cases: []`).
- **The loader rule** is anchored and linear (`^coverage gate: [a-z0-9][a-z0-9/._-]* (?:lines|branches)$`; 2 M characters in about 3 ms, 10x input gives about 7x time; a trailing newline, upper case, a double blank, `(inactive)` and `../` are refused). Pending entries stay SEC-TC only. The loader is not the weak point.
- **The matching is.** The verifier satisfies a required ID with any passing case whose name CONTAINS it (`check-evidence.mjs:273` `nameHasId`, `:333-335`), whatever the classname. The developer's note says "a test titled with an exact gate name"; a title that merely contains the phrase is enough (probe S2), and an exact title too (S3). PR40-SEC-02.
- **When a decoy matters.** With the head `heavy.mjs` unmodified, the four cases are always written when `unit` runs (`heavy.mjs:1062-1063`; `buildFailed` makes the run FAIL anyway; `parseRunners` refuses `coverage: true` without `merged_coverage`). A decoy cannot hide a FAILING gate case either, because any failure makes the suite and the run FAIL (hard reason). So a decoy only helps when the real cases are absent, which needs an owned-path change (record) or hand-made evidence (fabrication is accepted today anyway, PR23 residual). Hence INFO.
- **D-ORCH-056 fact check.** PR #38's evidence (`20261114T0021Z_cdd3716` and `20261113T2251Z_cb7c12e`) carries the four names with classname `unit`; the head verifier (the post-#40 manifest) accepts `cdd3716` on PR #38's head. Merging #40 first would therefore not have failed PR #38; the chosen order is harmless and stays. Runs older than PR #33 (`20261113T1231Z_5e6ccb7` and earlier) get the four "required case" reasons under the new manifest (positive control that the probe sees the new rule).

### 3.2 Gate weakening

- **Thresholds unchanged.** `coverage-gate.mjs`, `diff-coverage.mjs` and `jest.config.ts` are not in the diff (85/75 overall; 95/95 pricing, audit, authz, the D-QA-003 money paths, both ledger paths). `--coverageThreshold={}` switches Jest's own global threshold off per PARTIAL run only; the same `coverageThreshold.global` is re-applied to the merged total (`coverage tripwire: jest.config.ts global lines|branches`), and a repository test pins `{ lines: 85, branches: 75 }` and the project list. A tripwire that cannot be evaluated is an `error` case. The population the gate judges changes from unit+unit-dom to the merged projects, which is the TEST-STRATEGY section 8 definition.
- **Missing or empty project.** No required project can silently drop out: no run, a non-zero Jest exit, a timeout, an absent, unreadable, malformed or empty map, or an all-placeholder map each fail `coverage merge: project <p> measured` and replace the gate by `coverage gate: summary present` (error). `generated` is required while `jest --listTests` lists a file and when listing fails. A path- or name-filtered runner cannot feed the merge (`heavy.mjs:227`). Residual: the check is per Jest run group, not per project (PR40-SEC-03); it is not a smaller-denominator hole, because `collectCoverageFrom` is global and every partial run lists every in-scope file (untested ones as placeholders).
- **Critical scopes stay fail-closed.** Unchanged `coverage-gate.mjs:232-238`: a scope whose source roots hold a measurable file but has no summary entry is an error; pricing, audit and authz must exist. On the merged map a file no run executed keeps one placeholder and counts as fully uncovered. Only overall and authz are pinned by name at the verifier; the ratchet for the others is PR40-SEC-05.
- **New enforcement point, inherited lever.** The diff gate now enforces at profile `pr` (D-TASK015-27), and an unowned `.gitattributes` (root or nested) turns it into "no changed source file in scope" (probe 5.2). PR40-SEC-01.
- **Merge semantics.** Lines are summed by location (exact). Branches use an implied count capped by the run's own interior line counts; my synthetic cases behave as documented (uncalled in the other run 0/1, elided at the parent's count 1/1, two-line block never implied 0/1). Two residuals: case-folded file keys can merge two distinct files on a case-sensitive file system (PR40-SEC-04), and the "never above a combined run" property is empirical (PR40-SEC-06).

### 3.3 Child-process and file handling

| Item | Result |
|---|---|
| Command construction | `spawnSync`/`runStreaming` with argument arrays and `process.execPath`, no shell (no `cmd.exe` parsing on Windows). Jest bin is a constant; project names pass `^[a-z][a-z0-9-]*$`; `--test-timeout` digits only; `--base` is first validated as a plain ref by `changedPaths` (`lib/host.mjs:170`), and `gitDiff` again refuses a leading `-`, blanks and NUL and passes `--no-ext-diff` |
| `jest --listTests` | parsed from the first stdout line starting with `[`; at list time only the owned `jest.config.ts` executes (type-only import), so an unowned file cannot print a fake empty list; a listing failure makes `generated` required |
| Temporary and output locations | heavy: every coverage directory and Jest JSON under a fresh `mkdtemp` work dir, removed in `finally`. `coverage-run.mjs`: deletes the three outputs and `<out>/.parts` before running, writes outputs only when every project measured; default `coverage/` is git-ignored (`.gitignore:57`). `--out` is an operator argument (it can name any directory and `<out>/.parts` is removed recursively), no trust boundary |
| `jest.config.ts` loading | `import()` of the owned file inside heavy and `coverage-run` (Node 24 type stripping); Jest executes the same file anyway, so no new pre-gate execution point |
| Host paths into committed reports | none found. Coverage map keys stay in memory; the committed summary goes through `relativiseCoverage` (0 `<outside>/` keys); merged-step case messages pass `scrubCases`; `readCoverageFinal` suppresses V8's input-quoting `JSON.parse` message; the summary.md line carries numbers only; diff case names are repo-relative paths from `git diff` |
| Input bounds | coverage JSON 512 MiB and lcov/diff 200 MiB caps; `listTests` 64 MiB buffer and 120 s timeout. A bare `__proto__` map key would be dropped by the plain-object merge (probe 8), but Jest keys are absolute paths, so it is unreachable |

### 3.4 Supply chain

No dependency change: `package-lock.json` and every workspace `package.json` are untouched; the root `package.json` change is the `test:coverage` script line. Both new modules import only `node:` built-ins and sibling `tools/ci` modules. The rejected `istanbul-lib-coverage` is 3.2.2, BSD-3-Clause, registry `time.modified` 2023-11-08 (older than the 18-month rule), present only as a transitive dependency of Jest: D-TASK015-20 is correct.

### 3.5 Evidence hygiene (run `20261114T0031Z_5262707` on `5262707`)

| Check | Result |
|---|---|
| Gate table states `npm ci --ignore-scripts` first | yes, verbatim ("`npm ci --ignore-scripts` ran first (exit 0), then `npm run deps:rebuild` (exit 0), then `npm run quality:heavy -- --profile pr --base origin/main`"). Corroborated by the developer's evidence script in the shared scratchpad (that order, then the `info/exclude` byte count and the porcelain count before heavy) and its install log, written at 00:31Z (the run stamp) and ending in a completed install |
| Gate table states `.git/info/exclude` empty | yes, verbatim ("empty (0 bytes)"); the common git dir's `info/exclude` is 0 bytes now |
| Host-path scan | 0 over the 4 run files (10 labels: user name, its 8.3 stem, home in 4 spellings, temp dir in 2, host name, git e-mail; needles built at run time; a synthetic control fires every label). Also 0 over the code diff and the 4 commit messages |
| Integrity | `lockfile_sha256` and `manifest_sha256` equal the `5262707` blobs; both report hashes match; only the 4 run files changed after `5262707`; `summary.json.coverage` is the merged one (98.17 / 96.24) |
| Suite counts | 4303 cases = 4284 lane A unit cases + 19 merged-step cases; the 2 skips are Windows-only cases that run on Linux in lane A |
| Parked SEC-TC, D-ORCH-053 rows | present; no parked ID in a passing case |

## 4. Findings

### PR40-SEC-01: an unowned `.gitattributes` blinds the diff-coverage gate that this PR makes enforcing (LOW)

`gitDiff` (`tools/ci/diff-coverage.mjs:185-206`) runs `git diff --unified=0 --no-color --no-ext-diff --no-renames --diff-filter=AM <base>...HEAD --` in the lane B checkout. git takes diff attributes from the work tree, so a PR that adds `*.ts -diff`, `apps/** binary` or a nested `apps/api/src/.gitattributes` with `* -diff` makes git print `Binary files ... differ` without a `+++` line; `parseUnifiedDiff` (`:105-129`) then records no changed file, and `diffCoverageCases` (`heavy.mjs:708-711`) writes a PASSED `coverage diff: no changed source file in scope`. Probe 5.2: a changed file with 0 of 20 changed lines covered fails as `below` without attributes and passes in all three attribute variants; `--text --no-textconv` restores `below` in each. `.gitattributes` is not in CODEOWNERS, so the lever needs no security record (simulation G3). A related host-config residual: `diff.dstPrefix` in the operator's git config gives `+++ zz/apps/...`, which is out of scope and passes the same way (`diff.noprefix` and `diff.mnemonicPrefix` happen to parse correctly).

Impact: the per-PR changed-line gate (85/75, 95/95 in critical scopes) passes for code that has no test; the overall and per-scope gates still bound the aggregate, so a large module can absorb poorly tested changes. Likelihood: low (a deliberate, visible attribute line). CWE-693 · A08:2021.

Fix (code level, `tools/ci/diff-coverage.mjs`): add `'--text', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/'` to the `gitDiff` arguments; fail closed in `parseUnifiedDiff` when a `Binary files ` line names a coverage-scoped path; add a CODEOWNERS line `/.gitattributes` plus `**/.gitattributes` (eol and diff attributes affect other gates too). Verification test: a throw-away repo with a nested `.gitattributes` `* -diff` and a changed in-scope file whose lcov lines are 0 must yield a `below` verdict, plus a `-c diff.dstPrefix=zz/` variant. Owner: devops (015-C or the next `tools/ci` change, whichever is first), before G3. Interim: a PR that adds or edits a `.gitattributes` gets a security look at its diff-coverage cases.

### PR40-SEC-02: required gate names are matched as substrings and without the classname (INFO)

`recomputeVerdict` accepts a required ID when any passing case name contains it (`check-evidence.mjs:273`, `:333-335`). For SEC-TC IDs that is the intended convention; for the new `coverage gate:` names it means any Jest test whose title contains `coverage gate: overall lines` satisfies the requirement. Probe 5.1: with the four real cases renamed away, the head verifier accepts the run when four Jest cases (classname = their test file) carry the phrases inside longer titles (S2) or as exact titles (S3); 0 such titles exist in the committed run today. Exploitability is limited as argued in section 3.1 (needs absent real cases). CWE-345 · A08:2021.

Fix (code level, base-ref verifier `tools/quality/check-evidence.mjs`, effective once on main): for an ID that starts with `coverage gate: `, require `c.name === id && c.classname === suite.name` (heavy writes classname = `merged_coverage.suite`, Jest cases carry the test-file path); optionally reject a run in which a case whose classname is not the suite id starts with `coverage gate:`, `coverage merge:`, `coverage tripwire:` or `coverage diff:`. The patched copy in probe 5.1 accepts the real run (S0) and rejects S1, S2, S3 and S6. Verification test: the S2 and S3 fixtures in `check-evidence.test.ts`. Owner: devops, 015-C, before G3.

### PR40-SEC-03: `coverage merge: project <p> measured` is decided per run group (INFO)

`projectProblems` takes the first source whose `projects` include the project (`coverage-merge.mjs:442-456`); unit and unit-dom share one Jest run, as do integration and api in a coverage-only run. Probe 5.3 (7): `unit-dom` is reported measured from the group's map. A project of a group with zero test files therefore passes its case by name. The numbers stay honest (global `collectCoverageFrom` puts its files in as placeholders), so this is about what the evidence claims, not a hidden denominator. CWE-693 · A04:2021. Fix: for every always-required project also require `listProjectTests(root, p).length > 0` (fail closed on listing failure), or rename the case to `coverage merge: group <a+b> measured`. Verification test: a fake Jest whose `--listTests` returns `[]` for unit-dom must fail `project unit-dom measured`. Owner: devops, next `tools/ci` change, before G3.

### PR40-SEC-04: case-folded file keys merge distinct files on a case-sensitive file system (INFO)

`fileKey` lowercases the whole path (`coverage-merge.mjs:279`), and `mergeCoverageMaps` (`:286-303`) merges entries with equal folded keys, including two keys of the same run. Probe 5.3 (1): `src/A.ts` (4 of 4 lines covered) and `src/a.ts` (0 of 4) give one entry at 4 of 4 instead of 4 of 8, so the untested file disappears and its lines are absorbed. On this Windows lane B host such a pair cannot be checked out side by side, and the head tree has 0 case-colliding paths, so there is no effect today. It matters once heavy or `test:coverage` runs on Linux (015-B lane C / nightly). CWE-178 · A04:2021. Fix: fold case only on `win32` (or only the drive letter), and fail closed when one run's map holds two keys that fold together; add a repository invariant test "no two tracked paths differ only in case". Verification test: the probe's two-file map must give two entries (or an error) on Linux. Owner: devops, 015-B, before any Linux runner merges coverage.

### PR40-SEC-05: only overall and `packages/authz` are pinned by name; the other critical scopes need a ratchet (INFO)

The base-ref verifier now insists that overall and authz are evaluated and passing. `packages/audit`, `packages/pricing`, the money paths and both ledger paths are still inactive (no measured source), so their names cannot be required yet (the case reads `... (inactive)` and every run would be rejected). When the first measured source of a scope lands, its two names should join `unit.required_cases` in that same PR; they then bind every later PR at the verifier, independent of the head `heavy.mjs`. The primary control (the fail-closed file-system walk in `coverage-gate.mjs`) is unchanged and sufficient while `heavy.mjs` is unmodified, so this is defence in depth. CWE-693 · A04:2021. Owner: qa-lead with TASK-025 for `packages/audit` (the first such task, D-ORCH-047), then the pricing, money-path and ledger owners. Verification: the task's lane B run carries `coverage gate: packages/audit lines|branches` as passing cases and the next PR's base-ref check requires them.

### PR40-SEC-06: "branches never above a combined run" is an empirical property (INFO)

The implied-count rule (`coverage-merge.mjs:174-178`) is sound for V8's block-range elision and for uncalled functions, and the developer measured 0 entries above a single combined Jest run on this tree (162 entries). It depends on v8-to-istanbul behaviour and on all projects mapping the same source positions (one shared transform today); a change there could make the merge over-report a critical scope without any test failing. CWE-682 · A04:2021. Fix: keep the one-off comparison as a script and re-run it whenever Jest, v8-to-istanbul, `@swc/jest`, the swc options or the Jest transform change, and once for the G3 transcript (at least `packages/authz`, `packages/audit` and the overall total); the G3 gate transcript asked for by PR33-SEC-06 includes it. Owner: qa-lead, G3.

## 5. Probe results

### 5.1 Verifier matrix (base `cc18451`, scenario commits on top of `2b651f7`)

| Scenario | Base-ref copy (lane A today) | Head copy (lane A after merge) | Head copy with the PR40-SEC-02 fix |
|---|---|---|---|
| S0 committed run as is | accepted | accepted | accepted |
| S1 the four gate cases renamed away | accepted | rejected, 4 required-case reasons | rejected, 4 |
| S2 S1 plus four Jest cases whose titles contain the names | accepted | **accepted** (decoy) | rejected, 4 |
| S3 S1 plus four Jest cases titled exactly with the names | accepted | **accepted** (decoy) | rejected, 4 |
| S6 authz cases renamed to `coverage gate: packages/authz (inactive)` | accepted | rejected, 2 | rejected, 2 |
| PR #38 head `8b3a8ed` (its run `cdd3716`) | accepted | accepted | not run |

Every scenario updated `report_sha256` in `summary.json` (positive control asserted in the script), so the integrity checks pass and only the required-case rule decides.

### 5.2 Diff gate and `.gitattributes` (head `diff-coverage.mjs`, changed file with 0 of 20 changed lines covered)

| Variant | Verdict |
|---|---|
| no attribute (control) | `below` (0/20) |
| root `*.ts -diff` | no changed file, heavy writes a PASSED case; git printed `Binary files ... differ` |
| root `apps/** binary` | same |
| nested `apps/api/src/.gitattributes` `* -diff` | same |
| root `*.ts diff=nosuchdriver` (no config) | `below` (0/20) |
| root `*.ts -diff`, with `--text --no-textconv` | `below` (0/20) |
| nested `* binary`, with `--text --no-textconv` | `below` (0/20) |
| prefixes (host config): none / `diff.noprefix` / `diff.mnemonicPrefix` / `diff.dstPrefix=zz/` / `dstPrefix` with explicit `--dst-prefix=b/` | `b/` / bare path (parsed correctly) / `b/` / `zz/` (out of scope, passes) / `b/` |

### 5.3 Merge logic on synthetic maps (head `coverage-merge.mjs`)

| Case | Result |
|---|---|
| 1 `A.ts` (4/4) and `a.ts` (0/4) in one map | 1 file, 4/4 (unmerged 4/8): PR40-SEC-04 |
| 2 same file, drive letter `C:` versus `c:` across runs | 1 file, 3/3 (correct) |
| 3 block 0 in run A, function never called in run B | branches 0/1 (correct) |
| 4 block 0 in A, elided at the parent's count in B | 1/1 (correct) |
| 5 two-line block (no interior line), parent ran in B | 0/1 (lower bound, as documented) |
| 6 a real function named `(empty-report)` against a placeholder | 0/3 or 3/3 by run order, never above the real count |
| 7 `projectProblems` for unit, unit-dom (shared map), api (placeholders only) | unit measured, unit-dom measured, api FAIL: PR40-SEC-03 |
| 8 own `__proto__` key | dropped (unreachable from Jest) |
| 9 tripwire with `statements: 1` but no statements metric | fails closed |

## 6. Checks with no finding

- Lane A pins and workflow: `.github/` untouched; lane A runs no coverage step; `test:coverage` is not called by any workflow.
- `parseRunners` refuses `coverage: true` without `merged_coverage`, a host suite that is not a coverage Jest suite, and a coverage runner with `paths` or `testNamePattern`; a repository test pins the three coverage runners and every `jest.config.ts` project into `merged_coverage`.
- A failing test in a coverage-only run, its timeout, or a non-zero Jest exit fails its own `coverage merge:` case (end-to-end heavy tests and lane A unit green).
- The merged step's cases are scrubbed before they join the JUnit, and the host suite's counts are recomputed (`junitFor`), so a failing gate case fails `unit` and the run.
- `relativiseCoverage` is unchanged and now receives the merged summary; the committed keys are repository-relative.
- No secret, credential or personal data in the diff, the tests or the run files.

## 7. Union with PR #38 (D-ORCH-056): what the merge-only round must see

PR #38 merges first; this branch then merges main and takes fresh evidence. The union voids this record (simulation H) because both sides change the owned `package.json`; the record survives a union without that overlap (H2), and a record naming the merge commit passes (H3). The follow-up stays merge-only if all of the following hold:

1. Owned overlap is `package.json` only: PR #38 adds `db:generate`, this PR changes `test:coverage`; `git merge-tree --write-tree 8b3a8ed 2b651f7` is clean today and the simulated union holds both lines.
2. Every other path of this PR is byte-identical to `2b651f7` in the union (the 4 `tools/ci` files, the 6 `tools/quality` files, `tools/repo/jest-esm.test.ts`; simulation: 0 differ). PR #38's own owned changes (`.github/CODEOWNERS`, `tools/ci/check-workflow-policy.mjs`, `tools/ci/check-security-owned-paths.test.ts` and others) arrive from main and are not in this PR's net change.
3. `jest.config.ts` is unchanged by both PRs, so the `merged_coverage` project pin and the 85/75 tripwire pin still hold, and PR #38 adds no Jest script (the `jest-esm.test.ts` list is unchanged).
4. Fresh lane B evidence on the union commit (or an ancestor with only docs after it), with the D-SEC-PR23-02 table stating verbatim that `npm ci --ignore-scripts` ran first and that `.git/info/exclude` is empty, a count-only host-path scan of 0, and in `unit.junit.xml`: the four `coverage gate:` names as passing cases with classname `unit`; `coverage merge: project unit|unit-dom|integration|api measured` passing; `generated` still "has no test files (not required)" (PR #38 adds no `tests/generated/**/*.{api,int}.test.*` file; if that changes, `generated` must be measured); authz active, the other critical scopes inactive (PR #38 adds no measured source under `packages/audit`, `packages/pricing`, the money or ledger paths); a `coverage diff:` result against the new main (expected: no changed source file in scope, since this PR changes no coverage-scoped source); verdict PASS.
5. Lane A on the union: the base-ref verifier accepts the new run; the record step is satisfied by a round that names the union merge commit, confirmed with `git ls-remote` to be the pushed head.
6. If any owned fix rides along (for example PR40-SEC-01 in `diff-coverage.mjs`, simulation F4), the follow-up is a delta round: re-run probes 5.1 and 5.2 on the new head.

## 8. Routing and proposed decision

| ID | Sev | Owner | Due |
|---|---|---|---|
| PR40-SEC-01 | LOW | devops (015-C or the next `tools/ci` change) | before G3; interim: security look at any PR that touches a `.gitattributes` |
| PR40-SEC-02 | INFO | devops, 015-C | before G3 |
| PR40-SEC-03 | INFO | devops, next `tools/ci` change | before G3 |
| PR40-SEC-04 | INFO | devops, 015-B | before any Linux runner merges coverage |
| PR40-SEC-05 | INFO | qa-lead with TASK-025 (audit); then pricing, money-path and ledger owners | in the PR that lands each scope's first measured source |
| PR40-SEC-06 | INFO | qa-lead | G3 transcript; and on any Jest, v8-to-istanbul, `@swc/jest` or transform change |

Proposed text for DECISIONS.md (for the orchestrator to log): **D-SEC-PR40-01** · 2026-11-14 · security-analyst · PR #40 r1 at `2b651f7` = PASS_WITH_FOLLOW-UPS. PR33-SEC-06 CLOSED (the four `coverage gate:` names are required and the merged gate runs in every lane B profile; probe: the post-merge verifier rejects a run without them and an inactive authz). New LOW PR40-SEC-01 (an unowned `.gitattributes` `-diff`/`binary` blinds the now-enforcing diff gate; fix `--text --no-textconv` plus explicit prefixes, fail closed on `Binary files`, CODEOWN `.gitattributes`) → devops before G3. New INFO PR40-SEC-02 (substring decoys satisfy the gate names; exact name plus classname at the verifier) → 015-C; -03 (per-group "project measured") → devops; -04 (case-folded keys on Linux) → 015-B; -05 (critical-scope name ratchet) → qa-lead with TASK-025; -06 (combined-run comparison in the G3 transcript) → qa-lead. Fact for D-ORCH-056: PR #38's run already carries the four names and passes the post-#40 manifest, so the order is harmless but not required. The union with PR #38 voids this record (`package.json` overlap); the follow-up is merge-only under the conditions of section 7. **Reversibility:** High.

ASVS L2 (touched): V1.14 (build pipeline integrity), V14.1 (CI gates), V14.2 (no new dependency). No runtime surface, no dependency, no secret.

## 9. Record check simulation (`check-security-owned-paths --pr 40`)

Method: `git clone --shared --no-checkout` of the main checkout with a sparse checkout of `.github/`, `docs/05-quality/security/` and `tools/ci/`; scenario commits by plumbing; each scenario checked out detached and judged by its own `tools/ci/check-security-owned-paths.mjs` (equal to main's: this PR does not change it). PR #38 is simulated as a squash of `8b3a8ed` onto `cc18451`.

All 17 scenarios behaved as predicted; in A the checker reports the record satisfied at commit `2b651f7`.

| Case | Scenario | Result |
|---|---|---|
| A, A2 | this record committed on top of the head; base `cc18451` / base `c0c31a1` (lane A's range base) | pass, owned 11 |
| B | head without a record | missing |
| C | checked as PR 41 | missing |
| D, D2 | last Verdict row FAIL / no Verdict row | missing |
| E | the Head row names `a7541cf` (coverage-merge.mjs changed after it) | missing |
| F, F2, F3, F4 | after the record: `coverage-merge.mjs` / `required-suites.json` (authz branches name dropped) / `package.json` / `diff-coverage.mjs` edited | missing (F4: owned 12) |
| G, G2, G3 | after the record: `tools/repo/jest-esm.test.ts` / a docs file / `.gitattributes` with `*.ts -diff` | pass (all unowned; G3 shows PR40-SEC-01 needs no record) |
| H | union with the simulated PR #38 squash after the record | missing (`package.json` overlap) |
| H2 | the same union without PR #38's `package.json` line | pass |
| H3 | union plus a record naming the merge commit | pass |

## 10. Verdict

| Item | Value |
|---|---|
| Critical / High / Medium open | 0 / 0 / 0 |
| LOW open | 1 (PR40-SEC-01) |
| INFO open | 5 (PR40-SEC-02 to -06) |
| Closed by this PR | PR33-SEC-06 |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding. PR33-SEC-06 is CLOSED: the four gate names are required at the base-ref verifier from the merge on, the merged gate fails closed for a missing, empty or failing project, thresholds are unchanged and the critical scopes keep their fail-closed rule. Evidence `20261114T0031Z_5262707` is accepted (verbatim `npm ci --ignore-scripts` and empty `info/exclude`, host-path scan 0). This record names head `2b651f7`; the union with PR #38 voids it, and the follow-up is a merge-only round under section 7 |
