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
