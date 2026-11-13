# Code review: PR #33 (TASK-015 part 015-A: US-006 coverage gate, oasdiff, CODEOWNERS and bootstrap immutability, gitleaks baseline, lane A pins)

| Field | Value |
|---|---|
| Round | 1 |
| Branch / head | `feat/TASK-015-spk-07-lane-c-full` @ `3ed048466667bff670610d1bd6f830253b9553c7` |
| Merge base | `d53fbc7` (main has since moved by non-docs PRs #26 and #30, see §4) |
| Reviewer | code-reviewer |
| Date | 2026-11-13 |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The coverage gate itself is sound and fail-closed where it matters, the CODEOWNERS / REQUIRED_CODEOWNED_PATHS /
  bootstrap-immutability / __mocks__ / npm-exec work is well mutation-tested (33 of 35 mutants killed, 2 survivors listed),
  and the 015-A/B/C split is acceptable. Three MAJORs sit in code that has not run yet and starts to matter at the
  v0.1.0-m0 tag: the oasdiff container reads a 0700 temp dir as uid 65534 (expected EACCES on ubuntu), one sanctioned break
  turns every later unrelated PR red until the next tag (probed), and the D-QA-003 / TEST-STRATEGY section 8 money paths
  and the ledger path are not in the gate. All three fixes are small. Round 2 is a delta check.
```

## 1. What I verified myself, and what I did not

Done on a `git archive` extract of `3ed0484` with a node_modules junction (no writes to the TASK-015 worktree; extracts, junctions and temp dirs removed afterwards; worktree `git status` clean, node_modules count 748 before and after, no `C:\node_modules`):

- Targeted Jest, unit project: `tools/ci/{coverage-gate,diff-coverage,openapi-breaking.test,check-workflow-policy,check-install-flags,check-migration,check-security-owned,ci-policy,sec-static,check-porcelain}` = 10 suites, 347 tests, all green.
- The same sweep on the merge tree of the head with main (`git merge-tree`, tree `437ec39`, clean, no conflicts): `tools/ci`, `tools/repo`, `tools/quality` = 37 suites, 970 tests green; `check-workflow-policy.mjs --root .` exit 0; `check-install-flags.mjs --root .` exit 0.
- 35 source mutations on the head extract (CODEOWNERS lines, jest.config pattern, coverage-gate thresholds and branches, heavy wiring, openapi-breaking logic and ci.yml step, typegen, bootstrap immutability, `**/` pattern conversion, check-evidence push guard, reserved-env, mocks rule, exec rule). Results in §3.
- Probes: `checkOpenapiBreaking` in a temp git repo with a fake docker runner (tag, sanctioned break, unrelated follow-up PR, junk tags, substring record); 31-line `nonCanonicalNpmExec` / `segmentFindings` battery; in-memory `checkWorkflow(..., {requiredGates:true})` over 11 edits of the real ci.yml; `check-evidence` on the head against the old base and on a real merge commit of head + current main (clone, plumbing only).
- Baseline fingerprints: all 17 commits are ancestors of `origin/main`, every `path:line` exists, key names are token-ish OpenAPI example keys (I printed key names only, never values).
- `gh`: run 43417165257 on the exact head: `fast-lane` success with no skipped step (so Lane B evidence, lint, porcelain-after-lint, format, typecheck, unit, build, base-ref fixtures all ran), `scans` red only at "Security-owned paths need a review record" (expected, no PR-0033 record yet), which makes the new `openapi-breaking` step SKIPPED in CI: it has not executed on any runner.

Not re-run (and whose evidence I relied on): Docker (the oasdiff int test, the gitleaks 17 to 0 claim, actionlint image), `test:integration`, `test:api`, `test:coverage`, full `lint`/`typecheck`/`build` (lane A fast-lane is green on the head; the developer's gate table covers the rest), e2e. Brief constraint: no Docker, no full suites.

## 2. Findings

| ID | Sev | Where | Problem | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `tools/ci/openapi-breaking.mjs` `checkOpenapiBreaking` (`mkdtempSync`) + `oasdiffArgs` (`--user 65534:65534`, `--cap-drop ALL`) | The spec dir is created by `mkdtempSync`, mode 0700 and owned by the runner user (uid 1001). It is bind-mounted into a container that runs as uid 65534 with all capabilities dropped, so the container cannot traverse `/specs` (`EACCES` on `/specs/base.yaml`). Windows Docker Desktop (where the int test ran) does not enforce POSIX modes; the CI step has never executed (no tag, and the step is skipped behind the red record step). The first real run is therefore the first PR after `v0.1.0-m0`, on ubuntu-24.04, and the symptom is `oasdiff exited N` = exit 2 on every PR. | `chmodSync(dir, 0o755)` and write the two files `0o644` (or run the container as the runner's uid), and prove it once on Linux. Cheapest durable proof: in the no-tag branch also run the container once on the head contract against itself (smoke), so every PR exercises pull + mount + parse; or one recorded ubuntu run. Add a test that asserts the dir/file modes. |
| R1-M2 | MAJOR | `tools/ci/openapi-breaking.mjs` `changedAdrs` (merge-base..head), `latestReleaseTag`, `decide` | **(a) A sanctioned break poisons every later PR.** The record is searched only in ADRs the PR itself adds or modifies, but the comparison is always `tag` vs head and the step is unconditional. Probe: tag, PR1 breaks `getThing` with an ADR (passes), PR1 merges, PR2 changes only `README.md`: `verdict: fail`, "1 breaking change(s) against v0.1.0-m0 and no deprecation record". Main is red for everyone until the next tag. **(b) Tag choice:** `git tag --list 'v*' --sort=-v:refname` first line; with tags `v0.1.0-m0`, `v0.1.0-rc1`, `vnext` the probe selects `vnext`. **(c) Record match is a substring:** an ADR that says "breaks getThingList only" covers a break of `getThing` (probe: pass). | (a) Search records in ADRs added or modified `tag..head` (a record stays valid until the next tag), with a test: PR1 sanctioned + PR2 unrelated passes, PR2 with a new break fails. (b) Restrict to `^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`, ideally tags reachable from the base (`git tag --merged`). (c) Match the key with identifier boundaries (`(?<![A-Za-z0-9_])id(?![A-Za-z0-9_])`). Tests for each. |
| R1-M3 | MAJOR | `tools/ci/coverage-gate.mjs` `COVERAGE_THRESHOLDS.critical` (and `diff-coverage.mjs` `thresholdFor` which reads it) | TEST-STRATEGY section 8 and D-QA-003 (accepted decision, "blocking gates remain ... the D-QA-003 paths") put the 95/95 gate on `apps/api/src/modules/payments/service/**` and `packages/shared/src/money/**` (M1 money movement) and the ledger on `apps/api/src/modules/ledger/**`. The gate knows only `packages/ledger`, a path no document plans (ADR-0003: no ledger package, module in M4). Result: the M1 money paths (QR-03, exposure 15) are not gated at all, and the ledger scope will stay inactive forever (fail open by wrong name). No task AC, plan-data line or D-TASK015 entry owns this (grep of `D-QA-003` in docs/04-plan finds nothing). | Add the three scopes (required:false, inactive-until-the-path-exists, with a "measurable" probe that treats the scope itself as the source root) and drop or alias `packages/ledger`; extend the tests (AT-US-006-03 variant per path, a diff-coverage threshold case for `payments/service`). If you prefer to defer, record it as a numbered decision with an owner task whose AC names D-QA-003, before M1 payments work starts. |
| R1-m1 | MINOR | `tools/quality/heavy.mjs:703` | The single line that wires the US-006 gate into the pipeline (`if (item.runner.coverage) cases.push(...coverageGateCases(...))`) can be deleted and all 36 heavy + coverage-gate tests stay green (mutant `heavy-wiring` SURVIVED). check-evidence does not require the cases either, so a refactor in 015-B silently disables the only place the gate runs. | A heavy test that runs a coverage suite with a stub Jest report below threshold and expects the suite to fail with the named case; or add the case names to the `unit` suite `required_cases` in required-suites.json (the verifier then rejects evidence without them). |
| R1-m2 | MINOR | `check-workflow-policy.mjs` `CI_REQUIRED_GATES` entries `openapi-breaking`, `porcelain after lint`, `porcelain` | The three new pins are tripwires. In-memory edits of the real ci.yml that PASS the base-ref policy: `... --summary "$GITHUB_STEP_SUMMARY" \|\| true`, `; true`, `true \|\| node ...`, `>/dev/null 2>&1`, `--base "$RANGE_HEAD"`, a step-level `env: GATE_OPENAPI_BREAKING: ./evil.mjs` (runs a head copy; the step-env rule applies only to gates that declare `env`), moving "Lint must not mutate the tree" before Lint or to the end of the job. The Lane B evidence step, pinned in the same PR, resists all of these (`env: {}`, exact script). D-TASK015-08 pins them "ahead of the PR17-SEC hardening", which the sheet forbids ("before any further gate is pinned"). | Accepted as a recorded deviation only if the three new entries get what the evidence entry has: `env: {}`, an anchored exact run line for openapi-breaking (`^node "\$GATE_OPENAPI_BREAKING" --root ... --summary "\$GITHUB_STEP_SUMMARY"$`), and a relative-order check (porcelain-after-lint immediately after the lint step). A one-line mutation test per form. The rest of PR17-SEC-07/-08 stays in 015-C. |
| R1-m3 | MINOR | PR body / D-TASK015-08 deferral lists (D-ORCH-043 (4)) | Not delivered here and not named in 015-B/015-C: PR31-SEC-03 (the 13-case table additions), PR31-SEC-05 (verifier-side host-path scan in check-evidence, "required, not optional" in D-ARCH-098 (1)(f)), PR #31 N1 and N2, and the RustFS digest in `tools/quality/suite-runners.json` `testcontainers_images` (D-ARCH-098 (6); PR30 has merged, `storage/tests/rustfs.ts` exists). Deadlines clash: D-ARCH-098 (5)(6) are due "before the Wave-0-exit activation PR", but 015-C is dated "before G3". PR31-SEC-01 is named only in D-ORCH-043, not in the PR body. | Name every remaining item in 015-B/015-C with its checkpoint, and either do the RustFS digest line here (3 lines plus a test) or give it a Wave-0-exit deadline. Correct the PR-body list. |
| R1-m4 | MINOR | `heavy.mjs` coverage suite = `unit` only; TEST-STRATEGY section 8 | Section 8 says the whole-repo 85/75 and the 95/95 packages are judged on coverage "merged across workspaces (unit + integration + API)". heavy judges the `unit` suite alone (today 94.95 % / 96.58 %; authz 100 %). The first integration-covered code in `packages/audit` (TASK-025 store) cannot reach 95/95 on unit alone, and an `integration` suite with `coverage:true` would fail the overall gate. `coverage:gate` after a full `test:coverage` is the right shape but is not wired anywhere. | State this in D-TASK015-11 and make the merged `test:coverage` + `coverage:gate` + `coverage:diff` hook a named 015-B deliverable with a checkpoint (before the first Wave-1 module with integration-only coverage). |
| R1-m5 | MINOR | `check-install-flags.mjs` `nonCanonicalNpmExec` | The PR claims "only `npm (-w <ws> )*exec --no -- <bin>` passes". Shell-expanded command words pass: `npm $FLAGS exec -- evil`, `npm "$@" exec -- evil`, `npm ${A} exec -- evil`, `npm $(echo exec) -- evil` give 0 findings in both `segmentFindings` and `checkCommandText`. The other 27 forms I tried (aliases `x`/`exe`, `--yes`, `--package=`, `-w $X`, `npm.cmd`, absolute path, quoted npm, `env`/`sudo` prefix, `-ws`, `--workspaces`, `--prefix=`) are caught. Not a regression (previously also uncaught). | Treat an expansion (`$`, backtick) among the words between `npm` and the first `--` as non-canonical, or soften the claim to "not total". Route to 015-C if preferred. |
| R1-n1 | NIT | `check-migration-immutability.mjs` `checkRepository` | The out-of-order rule compares added bootstrap files with the released set at the **merge base**. A branch behind main adding `04-x.sql` while main released `05-y.sql` passes. Same class exists for migrations (pre-existing). | Use the base tip (`--base`) for `lastReleased`. |
| R1-n2 | NIT | `openapi-breaking.mjs` design | oasdiff compares the **whole** contract at the tag, which already lists 133 operations while M0 implements a handful. Any M1 refinement of an unimplemented operation that oasdiff rates ERR (new required property, tightened type) now needs a superseding ADR. oasdiff honours `x-stability-level`; architect to decide whether unimplemented operations are marked, or accept the friction (README says so). | Architect note in api/README section 18; no code change required here. |
| R1-n3 | NIT | `check-workflow-policy.mjs` `checkJestManualMocks` | Reads `git ls-files` only when `.git` exists and skips nested checkouts; fine for CI. The `**/__mocks__/` CODEOWNERS pattern covers it. No action; recorded so 015-C's "scope" work keeps the nested-checkout skip in mind. | none |

## 3. Mutation results (head extract)

Killed (test that turned red): all seven CODEOWNERS removals (`/apps/*/vite.config.ts`, `**/__mocks__/`, `**/package.json`, `/prisma/`, `/packages/shared/src/ids/`, `/apps/api/src/platform/`, `/tools/db/`), `/__mocks__/` dropped from jest.config and from `jest.base-fixtures.config.json`, coverage-gate (authz lines 90, audit branches 90, overall branches 70, pricing optional, `>=` to `>`, measurable probe off, null summary passing), oasdiff (ERR level, no-tag short circuit, any ADR as record, uncovered ignored, `--network none` dropped, ci.yml step dropped, `--head` redirected, image env swapped), Lane B `--report-only`, typegen `--workspaces`, bootstrap immutability (status check, out-of-order), `**/` regex conversion, check-evidence push+profile guard, reserved-env, mocks rule, npm-exec rule.

Survivors: `heavy-wiring` (R1-m1) and `openapi-breaking ... || true` (R1-m2). The planted `__mocks__` test has its own negative control (without the pattern Jest serves the planted file), which I accept.

## 4. Rulings

- **Split 015-A / 015-B / 015-C (D-TASK015-08, D-ORCH-043 (4)):** acceptable. 015-A carries what is due before Wave-0 exit, the tag or the first Wave-1 feature merge; the gitleaks full-history runner and the integration jobs need Docker/lane C that does not exist. Conditions: R1-m3 (complete lists, consistent deadlines) and R1-m2 (new pins no weaker than the evidence pin).
- **D-TASK015-10 (95/95 in `coverage-gate.mjs`, not Jest path keys):** accepted. Jest errors on a path key that matches no files (pricing and audit hold only `index.ts`) and subtracts path-matched files from `global`; the Jest global 85/75 stays as a second tripwire. Fail-open analysis of the gate: absent required package = error; package with measurable source but no summary entry = error; zero measured lines, missing `total`, malformed counters = error; `index.ts`-only package = inactive (safe because `barrel-reexport-only` lint keeps barrels re-export-only). Percentages use covered/total, so 84.9 % fails. The one real hole is scope naming (R1-M3).
- **D-TASK015-05 (typegen string `npm -w apps/web -w apps/admin exec --no -- react-router typegen`):** accepted; the sheet's `npm exec --no -w ... --` form breaks the `exec --no --` adjacency. `apps/web` and `apps/admin` are the only workspaces with a `typegen` script (checked), so nothing is dropped.
- **D-TASK015-02 (baseline in `tools/quality/gitleaks-baseline.txt`, not `/.gitleaksignore`):** accepted. File is CODEOWNED through `/tools/quality/`, named so the `gitleaksignore` policy rule is untouched, lane A is test-pinned to neither mount nor reference it. Only the file exists in this PR: how the future runner consumes it (base/gate ref extraction, read-only mount, `--gitleaks-ignore-path`, ancestry of the gate SHA instead of `--all`) is comment-only today and belongs to the 015-B runner review. I could not re-run the 17 to 0 claim (no Docker); the fingerprints verify structurally (ancestor of main, line exists, example-key shape).
- **D-TASK015-03 record rule / D-TASK015-04 (step in `scans`, not a new job):** accepted in principle; see R1-M2 for the rule's persistence and matching defects. Does it start enforcing automatically at the tag? Yes: `git tag --list 'v*'` on the `fetch-depth: 0` checkout; before any tag it prints `no release tag`, exit 0. The enforcement flip is automatic, which is why R1-M1/M2 must be fixed before the tag.
- **Evidence staleness:** evidence `2e17530` is valid for this head (`check-evidence --profile pr --base d53fbc7 --head 3ed0484` = PASS, reproduced). After merging current main (non-docs PRs #26 and #30) the same check reports `stale: 51 path(s) ... changed since 2e17530`, and any fix commit touching `tools/ci` / `.github` has the same effect. Fresh `quality:heavy --profile pr` evidence on an ancestor of the final head is therefore needed (D-ORCH-034). Merge of main into the branch is textually clean (merge-tree, and a real merge commit in a clone).

## 5. Acceptance against the sheet (015-A scope)

| Item | Result |
|---|---|
| AT-US-006-01..03 with IDs in titles | Met at tool level; wired only through `heavy.mjs` (R1-m1); money/ledger scopes (R1-M3) |
| oasdiff step, digest pin, no network, "no release tag", seeded fixture | Pin and logic met; Linux execution unproven (R1-M1), persistence (R1-M2) |
| PR24-SEC-04/-06, PR26-SEC-07 | Met; mutation-proven both in policy and in check-security-owned-paths cases |
| PR25-SEC-01 baseline, PR25-SEC-02 Dependabot/gitleaks parse | Baseline structure met, runner half deferred (015-B); Dependabot mutations M8-M10 in sec-static |
| PR23-SEC-06 as amended, D-ORCH-032, R2-n2, R2-n3 | Met and exact (cleanest pin in the PR) |
| PR4-SEC-13 (porcelain after lint, typegen, vite CODEOWNERS) | Met; pin strength R1-m2 |
| PR4-SEC-11 / PR17-SEC-09 | Met including the planted-mock negative control |
| PR21-SEC-04 | Met (exact generated paths, scope test tracks `git ls-files`) |
| Diff-coverage gate | Tool and tests delivered; hook deferred to 015-B (D-TASK015-11), consistent with D-ORCH-043 |

## 6. Good

- `LANE_B_EVIDENCE_SCRIPT` exact-line pin with one message per refused probe, plus the `CI_TRIGGERS` check that a new trigger must extend check-evidence `EVENTS` first. This is the shape to copy for the other pins.
- The planted-`__mocks__` test with a negative control, and the REQUIRED_CODEOWNED_PATHS tests being mutation-sensitive (19 red tests per removed line).
- `coverageGateCases` as ordinary JUnit cases: the evidence schema is unchanged and a failing scope fails the suite by name; the committed run shows the seven gate cases.
- Coverage gate fail-closed design with one threshold constant shared with diff-coverage; thresholds computed from counts rather than rounded percentages.
- Exact-path coverage exclusions with a test that equals the tracked `*.generated.ts` / `*.gen.ts` list.
- Bootstrap immutability lane reusing the migration rule plus the runtime-ledger ordering rule, with 6 cases.
- Honest PR body: gate table with the P1001 test:coverage incident disclosed and re-run, deferrals with checkpoints, bootstrap-ahead-of-PR17 deviation stated.

## 7. Security flags for security-analyst

1. R1-M1/M2: container hardening (`--network none`, read-only, cap-drop, non-root, digest pin) is right in intent; confirm after the permission fix that the fix does not widen the mount (still read-only, still a private temp dir).
2. R1-m2: step-level `env` override of `GATE_OPENAPI_BREAKING` lets a head workflow run a head copy of the checker; same class as PR17-SEC-07, but this gate is new and tag-relevant.
3. `tools/quality/gitleaks-baseline.txt`: confirm the 17 to 0 run on the pinned image, and review the future runner design (extraction from base/gate ref only, ancestry scan, no `--all`).
4. `reserved-env` rule (`GITHUB_*`/`RUNNER_*` except `GITHUB_TOKEN`): confirm no legitimate workflow needs one, including the planned `nightly.yml` and `workflow_dispatch` jobs.
5. `**/package.json` and `/apps/api/src/platform/` ownership: every dependency or platform PR now needs a security record. Confirm that is the intended cost (PR24-SEC-04, PR26-SEC-07).
6. A PR-0033 record naming the final head is required: `scans` is red on that step only.

## 8. Merge conditions

1. R1-M1, R1-M2, R1-M3 fixed with tests; R1-m1, R1-m2 (the three new pins) and R1-m3 (lists/deadlines) done in this PR or recorded with an owner and a checkpoint.
2. Fresh lane B evidence (`quality:heavy --profile pr`, after `npm ci --ignore-scripts` + `deps:rebuild`) on an ancestor of the final head; merge main first if main is to be picked up.
3. Security record `PR-0033-*` naming the final head with a PASS-class verdict; lane A fully green on that exact head (`fast-lane` and `scans`, including the previously skipped `openapi-breaking` step, which will run for the first time).
4. Squash merge with a Conventional Commits title; orchestrator updates D-TASK015-08 / D-ORCH-043 lists (R1-m3).
5. Round 2 is a delta check on the fix commits (probe files: tag/persistence/substring probe, permission test, scope tests, heavy wiring test, the §3 mutation list).

## 9. Handoff

Verdict CHANGES_REQUESTED: 3 MAJOR, 5 MINOR, 3 NIT. The probe scripts and mutation harness are in the session scratchpad (`review/PR-33-cr`); nothing was committed.


---

## Round 2 (head d3a46a2)

| Field | Value |
|---|---|
| Round | 2 (delta after fix cycle 1) |
| Branch / head | `feat/TASK-015-spk-07-lane-c-full` @ `d3a46a20cc7c5c0f001f36b9d3886bb9c077a769` |
| Delta reviewed | `70196e8` (exact pins, ASCII-only), `beaba11` (oasdiff modes, smoke, merged strict-semver tags, Accepted records), `63e2b6e` (money-path scopes, heavy wiring test), `e02c4f9` (merge main), `d3a46a2` (evidence) |
| Date | 2026-11-13 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: All three r1 MAJORs are fixed and each fix is mutation-proven (31 of 32 source mutants killed; the one
  survivor is an equivalent mutant). The oasdiff container now has a per-PR Linux proof (lane A run 43440981589 ran
  the smoke on ubuntu-24.04: 0 changes, PASS), a sanctioned break stays sanctioned until the next tag while a new
  break fails, and the D-QA-003 money paths are gated (inactive until source exists, then fail closed). The merge of
  main is a pure union. Open items are one MINOR (GATE_* via $GITHUB_ENV is still unpoliced, an overclaim in the new
  gate-env wording) and NITs, none blocking.
```

### R2.1 What I verified myself, and what I did not

Done on a `git archive` extract of `d3a46a2` (node_modules junction to the TASK-015 worktree, then `git init` + one base commit for the git-dependent suites). The TASK-015 worktree was not written to; extract and junction removed afterwards, worktree `git status` clean, node_modules count 748 before and after, no `C:\node_modules`, probe temp repos removed.

- Targeted Jest, unit project, `tools/ci` + `tools/quality` + `tools/repo`: 37 suites, 1011 tests. 36 suites green (981 tests). `check-evidence.test.ts` failed 30 tests with `No space left on device` (the host disk was at 100 % at that moment, error text is git `copy-fd` / `unable to create temporary file`), not a code failure; I re-ran the real check instead: `check-evidence --base 2957609 --head d3a46a2 --event pull_request` (reads git only) = `run 20261113T1409Z_e02c4f9 accepted`, PASS. The other two suites that failed on the first sweep (`gitignore`, `check-security-owned-paths` record-format tripwire) failed only because the bare archive had no git root / no `docs/05-quality/security` records; both are green after `git init`.
- Prettier `--check` on the 10 changed tools files: clean.
- Probes (scripts in the session scratchpad `review/PR-33-cr2`): `probe-oas2.mjs` (real temp git repos, fake Docker runner), `probe-wf2.mjs` (in-memory edits of the real ci.yml through `checkWorkflow(..., {requiredGates:true})`), `probe-cov.mjs` (`evaluateCoverage` over a temp tree), `mutate3.mjs` (32 source mutants against the targeted suites).
- `gh`: run 43440981589 is on the exact head. `fast-lane` success with no skipped step; `scans` red only at "Security-owned paths need a review record" (expected until a PR-0033 record names the head). The `openapi-breaking` step ran for real this time: `smoke: oasdiff compared the head contract with itself: 0 change(s)` then `PASS: no release tag`.
- Merge `e02c4f9`: `git merge-tree --write-tree 63e2b6e 34505b0` gives tree `c449bd3`, `git diff --stat <tree> e02c4f9` empty, so the merge commit is byte-identical to a clean re-merge, no hand resolution. The only file changed on both sides is `tools/lint/negative-fixtures.test.ts` (merged textually). main has moved to `2957609` since, by docs and agent-memory files only (no non-docs delta), so no further merge is needed for evidence.

Not re-run (evidence relied on): Docker (oasdiff int test; the Linux proof is lane A's smoke), `test:integration`, `test:api`, `test:coverage`, full `lint`/`typecheck`/`build` (fast-lane on the exact head ran all of them green).

### R2.2 Round 1 findings, closure

| ID | Result | Evidence |
|---|---|---|
| R1-M1 oasdiff Linux perms | **Closed** | `writeSpecsDir`: folder 0755, files 0644 (explicit `chmod`, injectable, test observes the calls since Windows stores no POSIX bits); mount unchanged (read-only, private temp dir). No-tag branch now runs a smoke comparison of the head contract with itself, fail-closed (non-zero exit or any ERR change is an error). Linux proof: lane A run 43440981589, ubuntu-24.04, smoke 0 changes. Mutants killed: dir chmod off, file chmod off, dir mode 0700, smoke off, smoke-error ignored. |
| R1-M2 (a) persistence | **Closed** | Probe, tag `v0.1.0-m0`: PR1 break + Accepted ADR = pass; PR2 (README only, after PR1 merged) = **pass**; PR3 new break `deleteThing` with no record = **fail**. Records are searched `tag..head`. Mutant (base..head) killed. |
| R1-M2 (b) tag choice | **Closed** | Listing `v0.1.0-m0`, `v0.1.0-rc1`, `vnext`, `v0.1.0-m0.5`, `v0.1.0+build` selects `v0.1.0-rc1`; `compareReleaseTags` ordering checked (rc1 > m0, release > rc, rc.10 > rc.9, 0.1.10 > 0.1.9, numeric < alphanumeric). A tag `v9.9.9` that exists only on a PR branch is ignored (`git tag --merged <base>`; chosen tag stays `v0.1.0-rc1`). Mutants killed: no `--merged`, no strict-semver filter. |
| R1-M2 (c) substring | **Closed** | `getThingList` does not cover `getThing` (`deleteThingList` does not cover `deleteThing`); `GET /things` is not covered by `GET /things/{id}/x`; `DELETE /things/{id}` exact and `` `deleteThing`. `` (punctuation after) are covered. Mutant (`text.includes`) killed. |
| Accepted status (new in fix cycle) | **Closed** | `Proposed`, `Superseded by ...`, `Draft`, `Rejected`, no status line, and "Proposed first, Accepted later" all fail; `Accepted` and `Accepted (amended)` pass. First status line wins. Mutant (accept anything) killed. |
| R1-M3 coverage scopes | **Closed** | Scopes `apps/api/src/modules/payments/service`, `packages/shared/src/money`, `apps/api/src/modules/ledger` at 95/95, `required:false`, source root = the scope itself; `packages/ledger` kept (D-TASK015-14, literal AT-US-006-03 path). Probe over a temp tree: nothing present = inactive/pass; test-only or `tests/` folder = still inactive; source without a summary entry = error (fail closed); 94/100 lines fails, 95/100 lines with 94/100 branches fails, 95/95 passes; sibling `servicex/` does not leak into the scope; a `money/index.ts` barrel counts as measurable source (correct: Jest only excludes `packages/*/src/index.ts`); backslash keys handled. Mutants killed: threshold 90 on payments and on money branches, wrong source root on each of the three scopes, measurable probe off. `diff-coverage` reads the same constant (test added). |
| R1-m1 heavy wiring | **Closed** | New end-to-end heavy test with a stub Jest (84 % lines fails the suite by case name `coverage gate: overall lines`, 90/80 passes with the inactive cases listed). The r1 survivor (`heavy-wiring`, line 703 deleted) is now **killed**. The `required_cases` route was declined with a reason (case names change when a scope activates) and moved to the 015-B hook (D-TASK015-19). Accepted. |
| R1-m2 pin strength | **Closed (one residual, R2-m1)** | `openapi-breaking`, `porcelain after lint`, `porcelain` (after build) are held to one exact ASCII command line with `env: {}`; each porcelain gate must directly follow the step it guards (`after`); `OASDIFF_IMAGE` must equal the script constant at workflow level and may not be set at job level; `--image` is accepted only when it equals the script's constant; new repository-wide `gate-env` rule (see R2.3); ci.yml is ASCII outside comment lines; `commandLines` trims only ASCII blanks. Every form I used in r1 is now caught (R2.3 table). |
| R1-m3 deferral lists | **Closed** | PR body "Split (D-TASK015-08) and every deferred item": 015-B lists the merged-coverage hook (R1-m4, due before TASK-025 per D-ORCH-047, split into its own devops PR) and the RustFS digest line (due before the Wave-0-exit activation PR); 015-C lists PR31-SEC-01 and PR31-SEC-03, PR31-SEC-05 (named "required"), PR #31 N1 and N2, PR31-SEC-02, PR #31 code review M1/M3 (M2 before the tag), D-ORCH-038 `temp-cleanup` (Wave-0-exit deadline) and R1-m5. Deadlines are consistent with D-ARCH-098 (5)(6). |
| R1-m4 merged coverage | **Closed as a named deliverable** | D-TASK015-19 and D-ORCH-047 (2): hook split out of 015-B, due before TASK-025 merges. |
| R1-m5 npm-exec expansions | Deferred to 015-C by name (PR body); acceptable, not a regression. |
| R1-n1..n3 | Unchanged, NITs. |

### R2.3 Pin and policy mutations (in-memory edits of the real ci.yml, base-ref policy)

All of the following are **caught** (`required-gates`, `gate-env`, `continue-on-error`, `yaml-subset` or workflow-env rule): openapi step with `|| true`, `; true`, `true || node`, `>/dev/null 2>&1`, `--base "$RANGE_HEAD"`, an extra argument (`--json`), an extra command line, step `env: GATE_OPENAPI_BREAKING`, step `env: OASDIFF_IMAGE`, step `env: GATES_DIR`, `continue-on-error`, `if: false`, a trailing NBSP, a typographic quote in the line; workflow `OASDIFF_IMAGE` changed or removed, job-level `OASDIFF_IMAGE` (YAML subset duplicate key / job rule), workflow `GATES_DIR` / `GATE_CHECK_PORCELAIN`, job `GATE_OPENAPI_BREAKING`; porcelain-after-lint with `|| true`, step env, extra line, no `--summary`, moved before Lint, a step inserted between Lint and the porcelain step; porcelain-after-build with `|| true`, `; true`, NBSP, moved before Build, moved to the end of the job; non-ASCII in an env value and in a trailing comment on a key line. A non-ASCII character in a pure comment line is allowed by design.

Source mutants (jest, targeted suites): 31 killed, 1 survivor.
- Killed: `heavy-wiring`; oasdiff: adr-from-base, no `--merged`, no tag filter, `namesKey` = includes, accepted-always, dir chmod off, file chmod off, dir mode 0700, smoke off, smoke errors ignored, image check off, `clean` identity; workflow policy: `after` off (lint and build), `gate-env` off, exact-line check off, `env: {}` off (openapi and porcelain), image pin off, job image off, raw-line ASCII scan off, `commandLines` Unicode blanks, `commandLines` trimEnd; coverage: payments 90, money branches 90, three wrong source roots, measurable probe off.
- Survivor `wf-ascii-exact-off` (removing the `nonAsciiProblem` call inside `exactRunProblems`) is an **equivalent mutant**: the exact comparison against an ASCII expected line already fails on any non-ASCII byte, and the ci.yml-wide raw-line scan (mutant killed) is the real guard. No action.

### R2.4 Findings (round 2)

| ID | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `check-workflow-policy.mjs` `envEntryFindings` rule `gate-env`; D-TASK015-17; header comment | The new rule polices only `env:` keys. The wording ("gate locations come only from the base-ref gate-tooling steps through $GITHUB_ENV", "a head copy cannot be pointed at") overclaims: a head step that writes `GATE_OPENAPI_BREAKING=./evil.mjs` (or `GATES_DIR`, `GATE_CHECK_PORCELAIN`) to `$GITHUB_ENV` between the tooling step and the gate passes the policy (probe: "step writes GATE_OPENAPI_BREAKING to GITHUB_ENV (before)" = PASSES). Same class as the r1 step-env form, one level more indirect. Backstops: `.github/` is CODEOWNED and the security-owned-paths record applies, so this is a tripwire gap, not a hole. | Route to 015-C with the PR17-SEC-07/-08 remainder: refuse a `run:` that writes a `GATE_*`/`GATES_*` name to `GITHUB_ENV`/`GITHUB_PATH` outside the two named tooling steps, plus a one-line mutation test. Until then soften the header and D-TASK015-17 wording to "env: entries". |
| R2-n1 | NIT | `check-workflow-policy.mjs` `requiredGateFindings` (workflow `OASDIFF_IMAGE` = base script constant) and `checkOpenapiBreaking` (`image !== OASDIFF_IMAGE`) | Both read the **base-ref** constant, so an oasdiff image bump (ci.yml and script changed in one PR) is red on its own PR in `scans`, and a script-first PR leaves main red until ci.yml follows. Not wrong (the base governs), but the first routine bump will look like a broken gate. By reading, not probed. | Document the bump procedure in the `openapi-breaking.mjs` header or `tools/ci` README: either a two-step with a temporary two-element allow-list constant, or the reviewed bootstrap exception used for other pins. |
| R2-n2 | NIT | `openapi-breaking.mjs` `checkOpenapiBreaking` | The baseline is a tag merged into the **base**, compared with the PR **head**, which is the PR head SHA (not the merge ref). A PR branch created before the latest tag and not updated sees the tag's own changes as removed in head (possible false ERR, for example a removed operation). Only affects stale branches across a release. | Note in api/README section 18 (merge main first), or compare against `git merge-tree` of base and head. No change needed now. |
| R2-n3 | NIT | `namesKey` | The lookbehind/lookahead also reject a key directly followed by `}`, `/` or `-` (for example `{getThing}` or a hyphen right after the id), so such a prose form is "uncovered". Fails closed, so harmless; the author can reword the ADR. | none |
| R2-n4 | NIT | `docs/03-architecture/api/README.md` section 18 item 3 | Says "needs a superseding ADR" but not that the record must be Accepted or that it persists until the next tag; the rule lives in the script header and D-TASK015-16. Architect-owned. | Add one sentence in the next architect pass. |

No BLOCKER and no MAJOR open.

### R2.5 Rulings

- **Smoke-in-no-tag branch (D-TASK015-15):** accepted. It also catches the case the permission fix cannot: a changed image, a broken pull, a parser regression. Cost is one container run per PR.
- **Step order (before the record step):** accepted; the result is visible even when the record step is red, as shown by run 43440981589 (both lines printed while `scans` was red on the record).
- **`packages/ledger` kept (D-TASK015-14):** accepted; one inactive case, justified by the literal AT-US-006-03 path.
- **Heavy test instead of `required_cases` (D-TASK015-19):** accepted with the 015-B/hook checkpoint recorded; the stable `overall` names should go into `required_cases` then (PR33-SEC-06).
- **Evidence:** run `20261113T1409Z_e02c4f9` is on an ancestor of the head, differs from the head by the evidence files only, and `check-evidence` accepts it. main has moved by docs only since.

### R2.6 Security flags for security-analyst (round 2)

1. R2-m1: `$GITHUB_ENV` writes of gate locations from a non-tooling step are still unpoliced (tripwire gap, CODEOWNED backstop).
2. R1 flag 1 (container hardening): confirm the 0755/0644 modes do not widen the mount: it is still read-only, `--network none`, `--read-only`, `--cap-drop ALL`, no-new-privileges, uid 65534, per-run private temp dir under the runner's temp root (the directory is now world-traversable on a shared runner, but hosted runners are single-tenant and the files are public repo contract text).
3. Record forgeability remains (an ADR the PR itself adds); the script header states it as a residual for 015-C (PR33-SEC-03 (iii)).
4. The PR-0033 security record must name `d3a46a2` (or the final head); `scans` is red only on that step.

### R2.7 Merge conditions

1. Security record `PR-0033-*` naming the final head with a PASS-class verdict, committed so that `scans` (record step) goes green on that exact head. If any further code or workflow commit lands, fresh lane B evidence on an ancestor is needed (`check-evidence` staleness rule); a docs-only commit does not.
2. Squash merge with a Conventional Commits title; orchestrator updates D-TASK015-08 / D-ORCH-043 deferral lists with R2-m1 (015-C) and R2-n1 (bump procedure note).
3. After merge, the first PR to run after the `v0.1.0-m0` tag is the first real tag-path execution (oasdiff with two different files); the mount and parse path is already proven by the smoke.

### R2.8 Handoff

Verdict **APPROVED_WITH_NITS**: 0 BLOCKER, 0 MAJOR, 1 MINOR (R2-m1), 4 NIT. Probe and mutation scripts are in the session scratchpad (`review/PR-33-cr2`); nothing was committed.
