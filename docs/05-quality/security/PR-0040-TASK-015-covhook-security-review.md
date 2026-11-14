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

## Delta round 2 (fix cycle 1 + union with PR #38, head e8f4461)

| Field | Value |
|---|---|
| Round | 2 (delta round: fix cycle 1 of D-ORCH-057 plus the union with PR #38 through main; change-scoped, P5) |
| Head | e8f4461f343e9b2949d6dc798d88f36161e006a4 |
| Commits since round 1 | `ee64946` (round-1 record), `0b7ce90` (merge of main `ff9673c`, which carries PR #38 `1735719`: the union), `da2f0a5` (R1-M1 range-tree merge, PR40-SEC-03, PR40-SEC-04), `87c7178` (PR40-SEC-01), `6b07dd6` (PR40-SEC-02), `08637c8` (merge of main `bf8515f`, docs only), `f335e7e` (evidence, now stale), `bc97720` (merge of main `37afe2c`, docs only), `e8f4461` (evidence). The code is final at `08637c8`; `git ls-remote` shows `e8f4461` as the pushed branch tip; main tip when written `f155a0e` (since `37afe2c` only docs and agent memory: the code review twin, DECISIONS, STATUS) |
| Reviewer | security-analyst |
| Date | 2026-11-14 |
| Scope | Security-owned paths the PR changed since `2b651f7` (18 plus `package.json`): `.github/CODEOWNERS`; `tools/ci/`: `check-workflow-policy.mjs` and its test, `coverage-merge.mjs` and its test, `coverage-merge-probe.mjs` (new), `coverage-run.mjs` and its test, `diff-coverage.mjs` and its test, `fixtures/coverage-merge/trials.json` (new), `v8-range-tree.mjs` and its test (new); `tools/quality/`: `check-evidence.mjs` and its test, `heavy.mjs` and its test, `lib/manifest.test.ts`; root `package.json` only through the union (main's `db:generate` line). Unowned: `tools/repo/jest-esm.test.ts`, `tools/repo/path-case.test.ts` (new), the run directories `20261114T0420Z_08637c8/` and `20261114T0437Z_bc97720/` |
| Input | PR body (D-TASK015-28 to -32, D-TASK015-22 restated); the fix-cycle comment (issuecomment-6871969199); sections 7 and 8 of this record; DECISIONS D-SEC-PR23-02, D-ORCH-057; lane A run 43558481519 on `e8f4461`; run `20261114T0437Z_bc97720`; the code review twin, round 2 on `e8f4461` (APPROVED_WITH_NITS, on main at `f155a0e`), read before finalising: its R2-m1 and R2-n2 are cited below, not duplicated |
| Result | PASS_WITH_FOLLOW-UPS: 0 Critical, 0 High, 0 Medium. PR40-SEC-01, -02, -03 and -04 are CLOSED. New: LOW PR40-SEC-07 (a file name with a space hides a changed file from the diff gate), LOW PR40-SEC-09 (the probe CLI's temporary Jest project loads its test environment from the temp directory's ancestors), INFO PR40-SEC-08 (`GIT_LITERAL_PATHSPECS` empties the new pathspec) |

### R2.1 Method and limits

Read: the delta `2b651f7..e8f4461` of every owned path; for the two paths PR #38 also changed, the PR's net change against main (`.github/CODEOWNERS` +4 lines, `check-workflow-policy.mjs` +3 lines, its test +2 fixture lines and one new describe); `diff-coverage.mjs`, `check-evidence.mjs` (changed parts), `coverage-run.mjs` and `coverage-merge-probe.mjs` end to end; the `coverage-merge.mjs` hunks for `fileKey`, `mergeCoverageMaps`, `projectProblems`, `readRanTests` and `readCoverageFinal`; the header, exports and merge entry of `v8-range-tree.mjs`; every `heavy.mjs` hunk; the new tests' titles and the PR40-SEC-01 and -02 test bodies; the lane A log of run 43558481519.

Probed (scripts in the session scratchpad `review/PR-40-sec-r2`; scenario commits live only in two `git clone --shared` scratch clones; nothing was written to the main checkout, and nothing to the PR worktree except this section):

- Diff gate: 19 variants on throw-away repositories, each judged by the round-1 copy (`2b651f7`) and the head copy of `diff-coverage.mjs`, plus three mutants of the head copy and five synthetic diff texts for the second line of defence (R2.5.1).
- Verifier matrix: 10 plumbing scenarios on top of `e8f4461`, each judged by three copies of `check-evidence.mjs`: base-ref `37afe2c` (what lane A runs on this PR), round 1 `2b651f7` (positive control) and head `e8f4461` (what lane A runs on every PR after this merge); a head-only re-run counted the reasons by kind (R2.5.2).
- Merge: synthetic maps for PR40-SEC-03 and -04 on the round-1 and head copies; the 32 committed trials replayed with the head merge and with the round-1 merge (positive control); 3,000 random merges of the port against the installed `@bcoe/v8-coverage` 0.2.3, independent of the developer's 5,000, with a deliberately wrong merge as positive control (R2.5.3).
- Probe CLI: one targeted `runTrial` call with the OS temp directory pointed at a scratch directory that held a planted package, plus a control call without it (R2.5.4).
- Evidence and union: the lane A log; a count-only host-fragment scan with runtime needles (synthetic and real-data controls); the developer's install and heavy logs in the shared scratchpad; `git merge-tree --write-tree` re-derivation of all three merge commits.
- Record check simulation (R2.8).

Not done: no `quality:heavy`, no `test:coverage`, no Docker and no full Jest run (light-commands constraint). The attribute variants were probed with host git 2.52 (Windows); the PR's own temp-repository tests of the same variants ran green on Linux in lane A's unit step (4437 tests), which stands in for the Linux confirmation. The real-Jest generation of `trials.json` (about 96 Jest runs) was not repeated; its committed output was replayed. Lane A run 43558481519 on this exact head: every step green (lint, format, type-check, unit, negative fixtures, build, Gitleaks, Semgrep, lane B evidence) except the record step and the aggregate. The only command run against the PR worktree was the requested read-only validation `node tools/ci/check-security-owned-paths.mjs --root <worktree> --base origin/main --pr 40 --head HEAD` (main's copy, run from the main checkout) after this section was appended: pass, satisfied at `e8f4461`.

### R2.2 Round-1 findings

| Finding | Sev | Status | Evidence |
|---|---|---|---|
| PR40-SEC-01 | LOW | **CLOSED** | `gitDiff` (`diff-coverage.mjs:219-246`) passes `--text --no-textconv --src-prefix=a/ --dst-prefix=b/` (with `-c core.quotePath=false`); `parseUnifiedDiff` throws on a `Binary files ... differ` line for an in-scope file or one whose header it cannot read (`:138-142`); CODEOWNERS owns `/.gitattributes` and `**/.gitattributes`, both in `REQUIRED_CODEOWNED_PATHS` with delete, comment-out and un-own mutation tests. Probe R2.5.1: every round-1 lever (root `-diff`, `binary`, nested, textconv, `.git/info/attributes`, `diff.dstPrefix`, `diff.srcPrefix`) now yields `below`, where the round-1 copy writes a PASSED case. Mutants: without `--text` the throw fails closed; without `--text` and the throw the probe sees the pass again; without `--dst-prefix=b/` `diff.dstPrefix` passes again. Record simulation G and G2: a root or nested `.gitattributes` change after the record now voids it (round 1: G3 passed). Two residuals of the same family: PR40-SEC-07 and -08 |
| PR40-SEC-02 | INFO | **CLOSED** | `satisfiesRequired` (`check-evidence.mjs:300-304`): a `coverage gate:` ID needs the exact name and classname = the suite id; a case under another classname that starts with a reserved prefix is a soft reason (`:359-363`). Matrix R2.5.2: the head copy rejects S1 to S8 and accepts S0; the round-1 copy accepted the decoys S2 and S3; lane A's base-ref copy accepted `bc97720` (log: `run 20261114T0437Z_bc97720 accepted`, PASS). S9, a hand-written case with classname `unit`, passes every copy: Jest cases carry the test-file path as classname (`lib/convert.mjs:152`) and no test file is named `unit`, so only fabricated evidence can carry it, which stays the PR23 residual (D-ORCH-013) |
| PR40-SEC-03 | INFO | **CLOSED** | `projectProblems` (`coverage-merge.mjs:655-687`) requires each project to have run one of its own `jest --listTests --selectProjects <p>` files, read from the run's Jest JSON report (`readRanTests`); no listed file, a listing failure and no readable report fail by name. Probe R2.5.3: the head copy fails `unit-dom` in all four cases (both projects when the report is missing) and passes both when each ran an own file; the round-1 copy passed `unit-dom` in all four. The evidence carries four `coverage merge: project <p> measured` cases, now per project. Residual, no new finding: a project whose files all skip or fail to execute still counts as run (code review R2-n2, optional fix `numPassingTests > 0`; skips are visible in the JUnit and a failed file fails the run) |
| PR40-SEC-04 | INFO | **CLOSED** | `fileKey` (`coverage-merge.mjs:477`) folds case and slashes on `win32` only; one map with two keys that fold together throws (`:495`), heavy turns that into a failed `coverage merge: maps merged` case plus the gate's error cases and `coverage-run` exits 1. Probe R2.5.3: `A.ts` (4/4) plus `a.ts` (0/4) give 2 files and 4/8 on Linux (round 1: 1 file, 4/4) and throw on win32; `C:\...` against `c:/...` across runs still merge into one file on win32. `tools/repo/path-case.test.ts` keeps the tree free of case-colliding paths (green in lane A) |
| PR40-SEC-05 | INFO | open, unchanged | qa-lead with TASK-025; the evidence still shows audit, pricing, money and ledger inactive |
| PR40-SEC-06 | INFO | open; re-run aid shipped | `coverage-merge-probe.mjs` and `trials.json`. Replay with the head merge: 23 equal, 9 below, 0 above the combined run, lines equal in all 32 (round-1 merge over the same trials: 4 above, the positive control). The port equals `@bcoe/v8-coverage` on 3,000 independent random merges (R2.5.3). The "never above" result is a property of these trials only: the code review's targeted TypeScript shapes (async/try-finally, `??`, `?.`, one-line returns) put the merge above one combined run in 3 of 42 trials, +1 or +2 covered branches per file and up to +4.0 pp on a file (R2-m1), with the uncovered count never lower in any of its 133 trials. That confirms this finding as written (an over-report of a few branches, so a borderline 95 % critical scope can pass the merged gate while one combined run would fail it); it stays INFO because the uncovered count is never lower and the net direction is under-report. Added to the G3 action: the code review's R2-m1 (b) and (c) (pin the uncovered-count invariant on every trial; one whole-repository per-file comparison) and a combined-run cross-check of any critical scope within 1 pp of 95 %. PR40-SEC-09 must be fixed before that re-run |

### R2.3 Focus questions

1. **PR40-SEC-01:** closed, see R2.2 and R2.5.1. CODEOWNERS covers both forms; `checkCodeowners` treats each as a literal required entry, and the record checker matched a nested `apps/api/src/.gitattributes` through `**/.gitattributes` (simulation G).
2. **PR40-SEC-02:** closed, see R2.2 and R2.5.2. Lane A keeps verifying with the base-ref copy (`ci.yml:215-216` extracts `git archive "$RANGE_BASE" tools/quality`); on this PR that copy (main's manifest, `unit.required_cases: []`) accepted the run, and from the merge on the head copy is the one that requires the exact names.
3. **PR40-SEC-03 and -04:** closed, see R2.2 and R2.5.3.
4. **Probe CLI and fixture.**
   - `trials.json`: 32 trials (2 fixed, 30 seeded), keys `name`, `lang`, `source`, `tests`, `A`, `B`, `combined`; no path field (the compact entries hold positions and counts; the reader expands them under `/probe/src/m.js|ts`). Host-fragment scan 0 for all 10 needles; the 14 generic `<letter>:\` or `<letter>:/` matches are `default:` lines of generated `switch` statements. A unit test pins the sources and calls to the seeded generator.
   - Child processes: `coverage-merge-probe.mjs` spawns `process.execPath` with argument arrays only: the repository's Jest bin with `--config <temp>/jest.config.json` and `--runTestsByPath` over constant relative names, then Prettier on the output path. No shell; `--seed` and `--trials` are digit-bounded; `--out` and `--report` are operator paths. `coverage-run.mjs` adds `--json` and `--outputFile=<out>/.parts/<group>.jest.json` to its argument array, no shell. No injection point.
   - Temporary files: the probe uses `mkdtempSync(join(tmpdir(), 'covprobe-'))` (random suffix, owner-only on POSIX) and removes it in `finally` (`:221`, `:274`). `coverage-run` deletes its outputs and `<out>/.parts` before running (`:215-217`), so a stale Jest report cannot be read; heavy's reports live in its fresh `mkdtemp` work directory. A missing or unreadable report is `ranTests: null`, which fails closed. One weakness: the temporary Jest project resolves Jest's test environment through the temp directory's ancestors first (PR40-SEC-09).
5. **`v8-range-tree.mjs` port:** the header reproduces the MIT notice of `@bcoe/v8-coverage` 0.2.3 (Copyright 2015-2017 Charles Samborski), identical to the package's `LICENSE.md`; the package's `package.json` and README declare MIT. "Adapted from" names the version and the source files, and the changes are listed. The module imports nothing; `coverage-merge.mjs` imports only `node:` built-ins and the sibling. No dependency change: `package-lock.json` is untouched, and the root `package.json` differs from main only in the `test:coverage` line. The package also ships an ISC `LICENSE.txt` ("Copyright (c) 2017, Contributors"); MIT and ISC are both on LICENSE_ALLOWLIST, and adding that notice too would be belt and braces (nit, no finding).
6. **Pure union:** `git merge-tree --write-tree` of each merge's parents gives exactly the committed tree for `0b7ce90`, `08637c8` and `bc97720`, so no merge carries a hand edit. `package.json` at the head equals round 1 plus main's `db:generate` line; its net change against main is the `test:coverage` line only. `jest.config.ts` is unchanged (`2b651f7..e8f4461` and `37afe2c...e8f4461` both empty). `08637c8` to `bc97720` changes no non-docs path; `bc97720` to `e8f4461` changes only the 4 run files.
7. **Evidence hygiene:**
   - The PR body's evidence table states verbatim "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first (both exit 0), then `npm run quality:heavy -- --profile pr --base origin/main`" and "`.git/info/exclude` is empty (0 bytes)". Corroboration: the developer's install log in the shared scratchpad, written at the run stamp, ends with a completed `npm ci` (1507 packages, no lifecycle output) and `deps:rebuild`; the heavy log starts with `npm ci + deps:rebuild exit=0` and `porcelain=0` and ends with `verdict PASS`; the common `info/exclude` is 0 bytes now. The install command line itself is not in the log; `.npmrc` `ignore-scripts=true` covers that anyway.
   - Host-path scan: 0 over the 4 run files of `bc97720`, the 4 files of the stale run, `trials.json`, the owned code delta and the PR's commit messages (10 needles in 6 labels: user name, its 8.3 stem, home in 4 spellings, temp directory in 2, host name, git e-mail; built at run time; a synthetic control fires every label and `git config --list --show-origin` gives real-data hits). The 6 `tmp/` and 22 `<letter>:/` matches in the JUnit are repository-relative `tmp/` paths in test titles and URL schemes.
   - Content against section 7 item 4: the four `coverage gate:` names pass with classname `unit`; four projects measured; `generated` "has no test files (not required)"; authz active, the other critical scopes inactive; tripwire lines and branches pass; `coverage diff: no changed source file in scope`; verdict PASS. Counts: 4456 = 4437 lane A unit cases + 19 merged-step cases; the 2 skips are Windows-only cases that run on Linux in lane A.
   - The stale run does not confuse lane A: the base-ref copy accepts `bc97720`, rejects `08637c8` as stale (one story file changed since) and `5262707` (87 paths), and passes; the head copy decides the same (S0). A stale committed run is reported and never credited; staleness is computed against each PR's own head, so it cannot help a later PR either.
8. **No existing check weakened:** CODEOWNERS net +4 lines (two comments, two owned patterns), none removed; `REQUIRED_CODEOWNED_PATHS` +2 entries, none removed; `checkCodeowners` unchanged. `check-evidence.mjs`: SEC-TC IDs keep `status === 'passed' && nameHasId` (the only removed code line is that condition, moved into `satisfiesRequired`); the gate IDs are stricter and one soft rule is new. `lib/manifest.mjs`, `required-suites.json` and `suite-runners.json` are unchanged since round 1. `heavy.mjs` removed only the unused `coverageFrom` helper.

### R2.4 New findings

#### PR40-SEC-07: a source file whose name contains a space is invisible to the diff gate (LOW)

git appends a TAB to the `---` and `+++` file names when a name contains a space (the GNU patch convention), so `+++ b/apps/api/src/mod/my x.ts<TAB>` reaches `parseUnifiedDiff` (`tools/ci/diff-coverage.mjs:143-150`), which keys the file as `apps/api/src/mod/my x.ts` plus a TAB; `isCoverageScoped` (`:42`) rejects that key (`.tsx?$` fails on the TAB), `evaluateDiffCoverage` drops the file and heavy writes a PASSED `coverage diff: no changed source file in scope`. Probe R2.5.1 V14 and V18: a fully uncovered 20-line file passes on both the round-1 and the head copy. The parser predates this PR, but this PR makes the gate enforcing and its PR40-SEC-01 fix targets this class (an unowned change that blinds the gate); a file name is not owned, so no record is needed (simulation G4). The PR's own test covers a space in the `diff --git` header (`diff-coverage.test.ts:155`), not in `+++`. On Linux a name holding `"`, `\` or a control character is C-quoted (`+++ "b/..."`) and is skipped the same way (synthetic probe; such names cannot be checked out on the Windows lane B host).

Impact: as PR40-SEC-01: the per-PR changed-line gate (85/75, 95/95 in critical scopes) passes for untested code, while the overall and per-scope gates still bound the aggregate. Likelihood: low (an unusual, visible file name; no lint rule forbids it; 0 such paths today). CWE-693 · A08:2021.

Fix (code level, `tools/ci/diff-coverage.mjs`): in `parseUnifiedDiff`, strip one trailing TAB from the `+++ ` target and fail closed on a target that starts with `"` (or C-unquote it); and, to close the class, list the changed files independently (`git diff --name-only -z --no-renames --diff-filter=AM <base>...<head> -- <same pathspecs>`; `-z` gives raw names) and throw when a coverage-scoped listed file has no parsed `+++` entry. Verification test: a temporary repository with `apps/api/src/a b.ts` at 0 of 20 covered lines must give `below`; a synthetic `+++ "b/apps/api/src/a\"b.ts"` must throw or be measured. Owner: devops, 015-C or the next `tools/ci` change, before G3.

#### PR40-SEC-08: `GIT_LITERAL_PATHSPECS` in the operator's environment empties the new TypeScript pathspec (INFO)

The fix limits the diff to `:(glob)**/*.ts` and `:(glob)**/*.tsx` (`diff-coverage.mjs:238-239`). With `GIT_LITERAL_PATHSPECS=1` git takes both literally, matches nothing and exits 0, and the gate reports no changed file (probe V15; the round-1 copy, which had no pathspec, gives `below`). It is the environment twin of `diff.dstPrefix`, which the fix set out to neutralise; an unowned repository file cannot set the variable for heavy, hence INFO. The PR40-SEC-07 cross-check would not catch it, because it uses the same pathspec. CWE-693 · A08:2021. Fix: put `--glob-pathspecs` before `diff` (probed: git then refuses a literal environment with "global 'literal' pathspec setting is incompatible with all other global pathspec settings", exit 128, so `gitDiff` throws), or remove `GIT_LITERAL_PATHSPECS`, `GIT_DIFF_OPTS` and `GIT_EXTERNAL_DIFF` from the child's `env`. Verification test: `gitDiff` with the variable set must throw or give `below`. Owner: devops, with PR40-SEC-07.

#### PR40-SEC-09: the probe CLI's temporary Jest project loads Jest's test environment from the temp directory's ancestors (LOW)

`runTrial` (`tools/ci/coverage-merge-probe.mjs:220-276`) writes each trial project into `mkdtemp(<os.tmpdir()>/covprobe-)` and runs the repository's Jest with `rootDir` there and `testEnvironment: 'node'` (`:241`). Jest resolves `jest-environment-node` from `rootDir` first, walking up the directory chain, and falls back to its own install only afterwards, so a `node_modules/jest-environment-node` in any ancestor of the temp directory wins. Probe R2.5.4: with the temp directory pointed at a scratch directory under which a planted package sat, the planted module loaded and the trial still produced identical coverage (a silent takeover); the control call without it did not load it. On this host the chain ends in `C:\node_modules`, which any authenticated user may create (`icacls C:\`: Authenticated Users have `AD`); on a shared Linux host it is `/tmp/node_modules` in the world-writable `/tmp`. The tool runs only by hand (qa-lead for PR40-SEC-06: the G3 transcript and tooling bumps), never in lane A or heavy; the unit test replays the committed fixture and spawns no Jest.

Impact: code execution as the developer who runs the probe, and a falsified trial set, which is the PR40-SEC-06 G3 evidence. Likelihood: very low (a second local account on the developer host, or a shared Linux host). Impact Medium × Likelihood Low = LOW. CWE-427 · A08:2021.

Fix (code level, `tools/ci/coverage-merge-probe.mjs`): pass the environment as an absolute path resolved from the repository (`testEnvironment: createRequire(join(REPO, 'package.json')).resolve('jest-environment-node')`), and preferably create the trial project under a git-ignored directory of the repository (for example `coverage/.probe/`) instead of the OS temp directory, so that the lookup chain is the repository's. Verification test: the R2.5.4 probe (planted ancestor package, temp directory below it) must not load the package. Owner: qa-lead with devops, the next change to the probe and in any case before the PR40-SEC-06 G3 re-run.

### R2.5 Probe results

#### R2.5.1 Diff gate (`gitDiff` + `parseUnifiedDiff` + `evaluateDiffCoverage`; changed file with 0 of 20 changed lines covered)

| Variant | Round-1 copy `2b651f7` | Copy at `e8f4461` |
|---|---|---|
| V0 no attribute (control) | `below` 0/20 | `below` 0/20 |
| V1 root `*.ts -diff` | PASSED, no file in scope | `below` |
| V2 root `apps/** binary` | PASSED | `below` |
| V3 nested `apps/api/src/.gitattributes` `* -diff` | PASSED | `below` |
| V4 textconv driver that prints nothing | PASSED | `below` |
| V5 `.git/info/attributes` `* binary` | PASSED | `below` |
| V6 `diff.dstPrefix=zz/` | PASSED (`zz/` key) | `below` |
| V7, V8 `diff.noprefix`, `diff.mnemonicPrefix` | `below` | `below` |
| V9 `diff.srcPrefix=yy/` + `diff.dstPrefix=zz/` | PASSED | `below` |
| V10 to V13, V16, V17: `color.ui/diff=always`, `diff.external`, a `.tsx` file, a non-ASCII name, `GIT_DIFF_OPTS=--unified=3`, `diff.relative` | `below` | `below` |
| V14 file name with a space | PASSED (key ends in a TAB) | **PASSED** (PR40-SEC-07) |
| V15 `GIT_LITERAL_PATHSPECS=1` | `below` | **PASSED**, empty diff (PR40-SEC-08) |
| V18 root `*.ts -diff` and a name with a space | PASSED | **PASSED** (PR40-SEC-07) |

Mutants of the head copy: without `--text`, V1 to V3 and V5 throw "git reported a binary diff for apps/api/src/mod/x.ts" (fail closed, the second line of defence); without `--text` and the throw, V1 to V3 and V5 pass again (the probe sees the hole); without `--dst-prefix=b/`, V6 and V9 pass again. Synthetic texts: a `Binary files` line for an in-scope path, for an unreadable (quoted) header and with no header throws on the head copy and is ignored by the round-1 copy; one for `docs/x.png` is ignored by both; a quoted `+++ "b/..."` target is skipped by both (PR40-SEC-07, Linux names).

#### R2.5.2 Verifier matrix (base `37afe2c`; scenarios edit the committed run's `unit.junit.xml` and rewrite `report_sha256`; a control asserts the committed hash first)

| Scenario | Base-ref copy `37afe2c` (lane A on this PR) | Round-1 copy `2b651f7` | Copy at `e8f4461` (lane A after merge) |
|---|---|---|---|
| S0 committed run as is | accepted | accepted | accepted |
| S1 the four gate cases renamed away | accepted | rejected | rejected: 4 required-case reasons |
| S2 S1 plus four Jest cases whose titles contain the names | accepted | **accepted** (decoy) | rejected: 4 required-case |
| S3 S1 plus four Jest cases titled exactly with the names | accepted | **accepted** (decoy) | rejected: 4 required-case, 4 decoy |
| S4 the real cases (classname `unit`) with a suffix ` (x)` | accepted | accepted | rejected: 4 required-case |
| S5 the real cases failed plus four exact-name Jest decoys | rejected (integrity) | rejected | rejected: failures declared 0 but 4 present |
| S6 authz cases turned `(inactive)` | accepted | rejected | rejected: 2 required-case |
| S7 S0 plus one Jest case titled `coverage merge: project unit measured` | accepted | accepted | rejected: 1 decoy |
| S8 S1 plus exact-name decoys under classname `Unit` | accepted | accepted | rejected: 4 required-case, 4 decoy |
| S9 S1 plus exact-name cases under classname `unit` (fabrication control) | accepted | accepted | accepted (only hand-made evidence can do this, PR23 residual) |

Every rejection on the head copy also carries "declared PASS, recomputed FAIL" and "no accepted lane B evidence for required suite(s): unit".

#### R2.5.3 Merge logic (synthetic maps; trials; port)

| Case | Round-1 copy | Copy at `e8f4461` |
|---|---|---|
| `A.ts` (4/4) and `a.ts` (0/4) in one map, Linux | 1 file, 4/4 | 2 files, 4/8 |
| the same, win32 | 1 file, 4/4 | throws "two entries for one file" |
| `C:\r\src\x.ts` and `c:/r/src/x.ts` in two runs, win32 | 1 file | 1 file, 2/3 (correct) |
| `unit-dom` listed, not in the Jest report | measured | FAIL |
| `unit-dom` lists 0 files | measured | FAIL |
| listing fails for `unit-dom` | measured | FAIL |
| no readable Jest report | both measured | both FAIL |
| both ran one of their own files (control) | both measured | both measured |
| win32 path folding in the per-project check (`C:\R\tests\u.test.ts` against `c:/R/Tests/U.test.ts`) | n/a | measured on win32, FAIL on Linux |
| the 32 committed trials, merged against one combined run | 4 above, 13 equal, 15 below | 0 above, 23 equal, 9 below; lines equal in all 32 |
| port against `@bcoe/v8-coverage` 0.2.3, 3,000 random merges of 2 or 3 runs | n/a | 0 differences; conservative mode never a higher branch percentage, identical covered offsets; wrong-merge control: 200 of 200 differ |

#### R2.5.4 Probe CLI temp project

| Call | Planted `node_modules/jest-environment-node` in an ancestor of the temp directory | Result |
|---|---|---|
| `runTrial` on the fixed trial "review g alone" | present | planted module loaded; coverage identical to the control |
| the same | renamed away (control) | not loaded |

### R2.6 Union with PR #38: the section 7 conditions

| Item | Condition | Status |
|---|---|---|
| 1 | owned overlap only `package.json`, both lines kept | met: the union `0b7ce90` re-derives cleanly; `package.json` holds `db:generate` and the PR's `test:coverage`. The later CODEOWNERS and `check-workflow-policy.mjs` overlap comes from fix-cycle edits after the union and is additive |
| 2 | every other path byte-identical to `2b651f7` | superseded: fix cycle 1 changed owned paths, so this round is a delta round (item 6) |
| 3 | `jest.config.ts` unchanged, no new Jest script | met |
| 4 | fresh evidence with the D-SEC-PR23-02 statements, host scan 0, the listed cases | met: run `20261114T0437Z_bc97720` (R2.3 item 7) |
| 5 | lane A accepts the run; the record names the pushed union head | met: run 43558481519 accepted `bc97720`; the record step is red only because the round-1 record names `2b651f7`; this round names `e8f4461`, the pushed branch tip |
| 6 | an owned fix riding along makes it a delta round with probes 5.1 and 5.2 re-run | done: R2.5.1 and R2.5.2 |

### R2.7 Routing and proposed decision

| ID | Sev | Owner | Due |
|---|---|---|---|
| PR40-SEC-07 | LOW | devops (015-C or the next `tools/ci` change) | before G3 |
| PR40-SEC-08 | INFO | devops, with PR40-SEC-07 | before G3 |
| PR40-SEC-09 | LOW | qa-lead with devops (next change to `coverage-merge-probe.mjs`) | before the PR40-SEC-06 G3 re-run |
| PR40-SEC-05 | INFO | qa-lead with TASK-025, then the pricing, money-path and ledger owners | unchanged |
| PR40-SEC-06 | INFO | qa-lead, with code review R2-m1 (b) and (c) | G3 transcript and tooling bumps, after PR40-SEC-09; any critical scope within 1 pp of 95 % cross-checked against one combined run |

Proposed text for DECISIONS.md (for the orchestrator to log): **D-SEC-PR40-02** · 2026-11-14 · security-analyst · PR #40 delta round 2 (fix cycle 1 + union with PR #38) at `e8f4461` = PASS_WITH_FOLLOW-UPS. CLOSED: PR40-SEC-01 (diff gate passes `--text --no-textconv` and explicit prefixes, fails closed on `Binary files`, CODEOWNERS and `REQUIRED_CODEOWNED_PATHS` own `/.gitattributes` and `**/.gitattributes`; all round-1 levers now give `below`), PR40-SEC-02 (exact name and classname for `coverage gate:` IDs, reserved prefixes under foreign classnames rejected; decoys S2/S3/S7/S8 rejected, lane A base-ref copy still accepts the run), PR40-SEC-03 (per-project "ran an own test file"), PR40-SEC-04 (case folding on win32 only, duplicate folded keys fail closed). New LOW PR40-SEC-07 (git's TAB after a `+++` name with a space, and C-quoted names on Linux, hide a changed file from the diff gate; strip the TAB, refuse quoted targets, cross-check against `--name-only -z`) → devops before G3; new INFO PR40-SEC-08 (`GIT_LITERAL_PATHSPECS` empties the new pathspec; `--glob-pathspecs` or a scrubbed env) → devops with -07; new LOW PR40-SEC-09 (`coverage-merge-probe.mjs` runs Jest from the OS temp dir, so an ancestor `node_modules/jest-environment-node` such as `C:\node_modules` is loaded; absolute environment path or a repository-local temp project) → qa-lead with devops before the PR40-SEC-06 G3 re-run. PR40-SEC-05 unchanged; PR40-SEC-06 stays INFO and is confirmed by code review R2-m1 (merge above one combined run in 3 of 42 TypeScript trials, uncovered count never lower): its G3 action adds R2-m1 (b) and (c) and a combined-run cross-check of any critical scope within 1 pp of 95 %. The `v8-range-tree.mjs` port carries the MIT notice and equals `@bcoe/v8-coverage` 0.2.3 on 3,000 independent random merges; the union is pure (merge-tree re-derivation of all three merges); evidence `20261114T0437Z_bc97720` accepted (verbatim D-SEC-PR23-02 statements, host scan 0). A later main merge voids this record only if main changes a path this PR also changes (`package.json`, `.github/CODEOWNERS`, `tools/ci/check-workflow-policy.mjs` and its test). **Reversibility:** High.

ASVS L2 (touched): V1.14 (build pipeline integrity), V14.1 (CI gates), V14.2 (no new dependency; in-house port with licence notice). No runtime surface, no secret.

### R2.8 Record check simulation (`check-security-owned-paths --pr 40`)

Method: a `git clone --shared --no-checkout` of the main checkout with a sparse checkout of `.github/`, `docs/05-quality/security/` and `tools/ci/`; scenario commits by plumbing on top of `e8f4461`; each scenario checked out detached and judged by its own `tools/ci/check-security-owned-paths.mjs` (equal to main's: this PR does not change it) with base `37afe2c` (A3: base `f155a0e`, the main tip when written), or with a simulated moved main for H and H2 (merge by `git merge-tree --write-tree`).

All 15 scenarios behaved as predicted; in A the checker reports the record satisfied at `e8f4461`. The PR's net owned change against main is 22 paths.

| Case | Scenario | Result |
|---|---|---|
| A | this record (round 2 appended) committed on top of `e8f4461`; base `37afe2c` (lane A's range base) | pass, owned 22, satisfied at `e8f4461` |
| A3 | the same with base `f155a0e` (the main tip when written) | pass, owned 22, satisfied at `e8f4461` |
| B | the head without this round (round 1 names `2b651f7`) | missing: the state lane A run 43558481519 reported |
| C | the record checked as PR 41 | missing |
| D | the last Verdict row FAIL | missing |
| E | this round's Head row names `da2f0a5` (before the PR40-SEC-01 and -02 fixes) | missing |
| E2 | this round's Head row names `08637c8` (the last code commit) | pass (only docs and main's docs after it) |
| F, F2 | after the record: `diff-coverage.mjs` edited / the `test:coverage` line edited | missing |
| G, G2 | after the record: a nested `apps/api/src/.gitattributes` added / the root `.gitattributes` edited | missing, owned 23 (round 1 G3 passed: the CODEOWNERS half of PR40-SEC-01 works at the checker) |
| G3 | after the record: a docs file | pass |
| G4 | after the record: an unowned in-scope source file with a space in its name | pass (PR40-SEC-07 needs no record) |
| H | main moves with a `package.json` script line and the branch merges it after the record | missing (owned overlap) |
| H2 | main moves with docs only and the branch merges it after the record | pass |

This round holds exactly one Head row, and its final Verdict row is the last Verdict row of the record (control D shows the last row decides).

### R2.9 Verdict

| Item | Value |
|---|---|
| Critical / High / Medium open | 0 / 0 / 0 |
| LOW open | 2 (PR40-SEC-07, PR40-SEC-09) |
| INFO open | 3 (PR40-SEC-05, -06, -08) |
| Closed in this round | PR40-SEC-01, -02, -03, -04 |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding. The four fixes hold under differential probes: every round-1 `.gitattributes` and prefix lever now gives `below`, the head verifier rejects every decoy that Jest can produce, a project that ran none of its own files fails by name, and case folding is win32-only with duplicates failing closed. The union with PR #38 is pure and evidence `20261114T0437Z_bc97720` is accepted. Two LOW findings (PR40-SEC-07 file names with a space, PR40-SEC-09 the probe's temp project) and one INFO (PR40-SEC-08) go to devops and qa-lead before G3. This round names head `e8f4461f343e9b2949d6dc798d88f36161e006a4`; later docs-only commits keep it valid |
