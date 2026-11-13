# Code review: PR #36, qa-lead classification of the 13 D-065 scenarios, gherkin map v1.1, empty KNOWN_DRIFT (D-QA-016), round 1

Reviewer: code-reviewer role (done in one pass with the security review, at the orchestrator's request; the matching security record is `docs/05-quality/security/PR-0036-qa-gherkin-map-security-review.md`). Head reviewed: `3eb7689` (full SHA `3eb7689ed2a85791fd39ee9ba05299a61919b295`); the measured code head is `e88bc46` (`e88bc467078274f938fed3853b6a065604fb5cf5`), the head adds only the evidence commit. Base: `origin/main` at `e4ecff2` (the PR is two linear commits on it; main had not moved when this was written).

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The classification is sensible against TEST-STRATEGY section 7 and the lane function, the map regenerates byte for byte (`npm run quality:gherkin-map -- --check` exits 0; on the base it exits 1 naming the five stories), all 1,599 v1.0 rows are unchanged and in order, and the two test edits are strictly stronger: with the old tests, appending or renaming a scenario in any of the five stories left 32/32 tests green; with the new tests every such mutation fails.
  No BLOCKER or MAJOR. Two MINORs: TEST-STRATEGY repeats a false claim (`reports/` is not git-ignored), and AT-US-066-12 is G3-counted although one leg needs a cuttable Should task. Four NITs.
```

## 1. What I verified myself (and what I did not)

Method: `git archive` extracts of the exact head and of the base, `node_modules` as junctions to main's, Node 24, no Docker, no builds; a scratch `git clone --shared` for the base-ref verifiers. Scratch removed afterwards. The PR's worktree was treated as read only (a few read-only git queries and file reads there, listed in the security record).

| Check | Result |
|---|---|
| `npm run quality:gherkin-map -- --check` on head and on base | head: `up to date`, exit 0. Base (positive control): exit 1, "qa-lead must classify 5 stories", naming US-066 (12 scenarios in the story file, 8 classified), US-121 (7 vs 6), US-129 (10 vs 5), US-137 (8 vs 7), US-222 (10 vs 8) |
| Row-by-row comparison of the base and head maps through the real `parseGherkinMap` | 1,599 base rows: 0 removed, 0 changed in any column (story, DC, title, suite, lane, G3), same relative order. 13 added rows (list in section 2). 1,612 rows, 1,606 G3, 218 stories, per-story numbering contiguous from 01 in every story (0 problems), no duplicate IDs |
| Summary table of the map recomputed from the rows | suite deltas: `unit` +3 (131), `api` +1 (204), `integration` +2 (180), `carrier-contract` +2 (53), `carrier-resilience` +4 (42), `secrets-keys` +1 (9); per-epic: EPIC-03 +4 (106), EPIC-06 +7 (153), EPIC-11 +2 (53). All equal the PR body and the committed tables |
| Count pins left anywhere (`1599`, `1593`, `1,599`, `1,593` over `*.ts`, `*.mjs`, `*.json`, `*.md`, `*.yml`, `*.csv`) | none live. The remaining mentions are history only: DECISIONS D-QA-002 (lines 666, 668), STATUS G2-C5 row (line 83), the PR #35 review records |
| The two owned tests on head | `gen-gherkin-map.test.ts` + `lib/test-ids.test.ts`: 2 suites, 32 tests pass |
| Mutation controls on the head and on the base tests (7 mutants and a control each) | section 3. Head catches all; the base tests are blind to 3 of the 4 mutants that apply to them |
| `tools/quality` + `tools/ci` unit suites on the head extract | 31 suites, 868 tests; 867 pass; the one failure is an artefact of my extract (`check-security-owned-paths.test.ts` lists the committed records with `git ls-files`, and an extract is not a repository); lane A's "Unit tests" step is green on the real head |
| `prettier --check` on the five changed non-evidence files; `eslint --max-warnings 0` on the two test files | pass; pass |
| `quality:trace` on the evidence run, default output | `must-AC 62/1606 (0 Must scenarios unmapped) · NFR 0 verified, 4 partial evidence/91 · SEC-TC 9 passing, 9 present/64 · 94 IDs · 0 orphans · 0 problems`; default output `reports/ac-trace.json` (confirms the TEST-STRATEGY sentence, except "git-ignored", R1-m1) |
| Base-ref `check-evidence` (`--profile pr`, base `e4ecff2`, head `3eb7689`) | run `20261113T1845Z_e88bc46` accepted; verdict PASS (older runs print "not an ancestor", as on every PR after a squash). A hand-added `ac-trace.json` in that run directory: FAIL "unlisted file ac-trace.json (every file needs a SHA-256 in summary.json)" (confirms the sentence on what `check-evidence` rejects) |
| Lane A on the head (run 43486331834) | `fast-lane` green: 33 steps, 31 success and 2 skipped by design (base-ref lint-fixture step, Semgrep rule self-test); commitlint, lint, format, actionlint, type-check, unit, build and Lane B evidence all ran. `scans`: Gitleaks, Semgrep, oasdiff green; red only at "Security-owned paths need a review record" (expected until the security record is committed); `ci-gate` red as the aggregate of that |
| Security-owned paths (`--pr 36`) | owned set = exactly the two test files |

NOT re-run: Docker-bound lane B (`quality:heavy`; this PR needs only `unit`), whole-repo lint, type-check and build (lane A did them on the real head). Not applicable: no production code changed.

## 2. Classification review (the 13 new rows)

Basis: TEST-STRATEGY section 7.1 (suite, lane, zero-skip), section 4.1 (lane A runs `unit` and `carrier-contract`, lane B everything that needs Docker), section 7.4 (contract suite), and the v1.0 sibling rows of the same story. The lane column is a pure function of the suite (`suite_lanes`), and the generator rejects an unknown suite, so only the suite choice needs judging.

| AT ID | Suite / lane | Judgement |
|---|---|---|
| US-066-09, -10, -11 | `unit` / A | Agree. Build-time guard tests over the seed objects, exactly the pattern of the existing `[AT-US-066-03]`, `-04` and `-05` tests in `packages/authz/src/roles.test.ts`, which are `unit` in v1.0. Lane A, so a seed edit fails the hosted PR gate. |
| US-066-12 | `api` / B | Agree, with R1-m2. Three HTTP calls against `/me/sessions`, `/me/notification-preferences` and `/me/sessions/{sessionId}` (section 7.2 API tests). Considered and rejected: `identity-session` (US-027 owns the session semantics and already has "Foreign or unknown session" as its scenario 05), `rbac-matrix` and `abuse` (generated route-by-role and IDOR cells; this scenario is the hand-written positive "own rows only" case, and `api` is the precedent for US-068 and US-072-01). |
| US-121-07 | `carrier-contract` / A | Agree. Same assertions as 03 (capability guard, zero outbound requests), contract case `cancel-capability-not-supported-no-io`; section 7.4 runs it for every adapter in lane A. |
| US-129-06, -07, -08, -09 | `carrier-resilience` / B | Agree. Negative cache, carrier-wide cool-down, per-account cache with sibling accounts still working, per-carrier token bucket: breaker and rate-limit behaviour over `nock` and a fake clock, the section 7.1 `carrier-resilience` row (RES-003/006/007, SEC-TC-26/41/42/62), zero-skip. The PR6 security record proposed the same shape for the UPS case ("integration with nock and the fake clock"). 129-08's title names SEC-TC-68, which is still a provisional ID (not in the 64 adopted cases); that is story text, not a map claim. |
| US-129-10 | `secrets-keys` / B | Agree. Token cache TTL rule; siblings 01, 02 and 05 of the story are `secrets-keys`; `carrier-resilience` would also be defensible and is the same lane. |
| US-137-08 | `carrier-contract` / A | Agree. The README docs check (sibling 05 is `carrier-contract`) plus the evidence-report line; lane A. |
| US-222-09, -10 | `integration` / B | Agree. Saga document step with `recoverLabel`, DB state and retry; the story default. `jobs-resilience` would fit 10's retry, same lane B. |

The 13 rows are `G3 = yes`; the 6 `@live-sandbox` rows are unchanged (1,612 - 1,606).

D-065 claims that no test needs renumbering. Checked: the tests that carry `AT-US-066-NN` today are `-01` (`prisma/tests/authz/authz-seed.int.test.ts:83`), `-02` (`matrix-doc.test.ts`, `tools/authz/generate.test.ts`), `-03`, `-04`, `-05-<row>`, `-07` (`roles.test.ts`), `-06` and `-08` (`authorise.test.ts:22`, `:13`); every title matches the map row at that position (Idempotent seed, matrix document, guard invariants, operator-only permission, Viewer outline, Viewer denied, partner roles unused, permission path). No test in the repository carries an `AT-US-121`, `-129`, `-137` or `-222` ID yet. So nothing is renumbered, and the WAVE sheets' ranges (`066 01-12`, `121 01-07`, `129 01-10`, `137 01-08`, `222 01-10`) already equal the new counts.

## 3. The two test edits, and `KNOWN_DRIFT`

`gen-gherkin-map.test.ts`: `KNOWN_DRIFT` goes from five stories to `string[] = []`; the count pins go from 1599/1593 to 1612/1606; the comment now states the rule. `lib/test-ids.test.ts`: the same count pins. No `skip`, `only`, `todo`, timeout or import change.

With the list empty, `storiesAsMapped()` returns the real story files unchanged, so "renders the committed map byte-identically" compares the generator's output over every real story with the committed map. Before, for the five stories the model was rebuilt from the map's own rows, so that comparison was circular for them. The ratchet test now asserts that `buildRows` over the real stories throws nothing.

Mutation controls (jest `unit` project over the two test files, 32 tests, plus `gen-gherkin-map --check`):

| Mutant | Head tests | Head `--check` | Base tests (old edit) |
|---|---|---|---|
| M0 none | 0 failed | exit 0 | 0 failed (`--check` exit 1: the drift the PR removes) |
| M1 append an unclassified scenario to US-066 | 3 failed (byte-identical, counts, ratchet) | exit 1, names US-066 | **0 failed (blind)** |
| M2 the same to US-129 | 3 failed | exit 1, names US-129 | **0 failed (blind)** |
| M3 rename a scenario title inside US-066, same count | 1 failed (byte-identical) | exit 1, line 340 | **0 failed (blind)** |
| M4 reclassify US-066-12 in the assignments, map not regenerated | 1 failed | exit 1 | not applicable (row absent on base) |
| M5 hand-edit the suite cell of a new map row | 1 failed | exit 1 | not applicable |
| M6 delete a new map row | 2 failed (byte-identical, 1612-row pin) | exit 1 | not applicable |
| M7 rename a title in a story that never drifted (US-067) | 1 failed | exit 1 | 1 failed |

So the edit closes a real blind spot: until this PR any scenario change inside the five stories could not fail a test.

## 4. TEST-STRATEGY v1.4 wording

| Claim in section 6 rule 2 (and the two count edits) | Result |
|---|---|
| `quality:trace` merged in PR #35 | true (squash `dc31a14`) |
| default output `reports/ac-trace.json`, inside the repository root, outside the committed evidence tree | true (`DEFAULT_OUT` in `trace.mjs`; my default run wrote it; `--out` is confined to the root and refused inside the evidence tree) |
| "(git-ignored ...)" | **false**, R1-m1 |
| a run directory "accepts only the files `quality:heavy` hashed into its `summary.json`", so `check-evidence` rejects a hand-placed `ac-trace.json` | true (`check-evidence.mjs`, "unlisted file ... every file needs a SHA-256 in summary.json"; reproduced in section 1) |
| the attachment hook is TASK-015 part 015-B, lane C, due before G3 (D-SEC-PR35-02 correcting D-TASK277-03) | true (`WAVE-00.md` TASK-015 line "QUALITY:HEAVY ATTACHMENT HOOK FOR THE TRACEABILITY REPORTS ... part 015-B; DUE BEFORE G3"; D-SEC-PR35-02 exists) |
| 1,593 becomes 1,606 "at map v1.1" in rule 2 and in section 14 item 4 | true, and no third place needs it |

## 5. Findings

| ID | Sev | Where | Problem | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `docs/05-quality/TEST-STRATEGY.md:189` (section 6 rule 2) | The new sentence calls `reports/ac-trace.json` "git-ignored". It is not: `.gitignore` has no `reports` entry (the only match for "report" is `playwright-report`), `git check-ignore -v reports/ac-trace.json` exits 1 in the PR's own worktree, where the author's trace output sits as an untracked `reports/`, and `.prettierignore` has no entry either, so `prettier --check` warns on the generated file (reproduced), i.e. `npm run format:check` fails locally for anyone who follows the sentence and runs `quality:trace`. The claim is copied from the comment at `tools/quality/trace.mjs:67`; it is PR #35 R2-n1, routed by D-SEC-PR35-02 "with the next `tools/quality` change". | In this PR (unowned file): drop "git-ignored", write "not yet git-ignored: `/reports/` is added to `.gitignore` and `.prettierignore`, both CODEOWNED, with the 015-B hook". Owned fix (devops-engineer, with a security record, before 015-B): `/reports/` in `.gitignore`, `reports/` in `.prettierignore`, a `tools/repo/gitignore.test.ts` row, and the `trace.mjs` comment. Verification: `git check-ignore -v reports/ac-trace.json` exits 0, and `prettier --check .` stays green after a default `quality:trace`. |
| R1-m2 | MINOR | map row `AT-US-066-12` (`yes`), `WAVE-00.md` TASK-013 acceptance list | The classification `api` / B is right, but the row is G3-counted (Must-AC target 100 %) while its second step, `PUT /api/v1/me/notification-preferences`, belongs to US-266, a **Should** story whose task TASK-263 is `Should`, `cuttable = yes` in `task-map.csv`. If TASK-263 is cut under the escalation ladder the scenario cannot pass as written, so Must-AC coverage cannot reach 100 %. TEST-STRATEGY has a route-absent form only for the conditional SEC-TC cases (section 7.11), not for AT IDs. Also, TASK-013's sheet (`WAVE-00.md:486`) lists "AT-US-066-01 ... 12" as its own tests, but 06 and 12 need routes of later tasks (06 is pointed at TASK-027/033 in `authorise.test.ts:22`; 12 has no pointer; sessions legs are TASK-186). Not caused by this PR (D-058 wrote the scenario); it surfaces now that the row exists. | qa-lead with product-manager, non-blocking, before Wave 7: either a conditional G3 rule for AT IDs of cuttable dependencies (assert the route is absent when the story is cut), or move the notification-preferences leg into a US-266 scenario; name TASK-186 (sessions legs) and TASK-263 (preferences leg) as the owners of AT-US-066-12 in the task sheets. |
| R1-n1 | NIT | `tools/quality/gen-gherkin-map.test.ts`, the drift test | `expect(named).toEqual(KNOWN_DRIFT)` with an empty list passes if `buildRows` throws a `MapError` whose text has no `US-nnn (` token. Today the byte-identity test catches that, but the ratchet should not depend on message shape. | Add `expect(KNOWN_DRIFT.length === 0 ? message : '').toBe('')` after the `named` assertion. Takes effect with the next `tools/quality` change, because any owned-path edit after the security record needs a new head row. |
| R1-n2 | NIT | `TEST-STRATEGY.md` header | The `Date` row still reads 2026-11-13; v1.4 and map v1.1 are dated 2026-11-14. The map header (a generator template) also still says "by qa-lead in P4" and "story files v1.3", an unanchored label (the story files carry no version; PRD 1.10 is the trail). | Bump the date; leave the template. |
| R1-n3 | NIT | `TEST-STRATEGY.md:194` (rule 4), `:561` (wave exit), `:427` (layout) | They still say the task's or wave's lane B evidence holds `ac-trace.json`; that is true only after 015-B (rule 2 now says so). | Add "(from 015-B; until then run `quality:trace` and read `reports/`)" to rule 4 and the wave-exit bullet. |
| R1-n4 | NIT | D-QA-016 text in the PR body | "the mechanism is kept so a future story edit that adds scenarios fails by story ID until qa-lead classifies it" misattributes the guard. That behaviour is the generator's (and the empty-list equality tests) and holds whether or not `KNOWN_DRIFT` exists. What the kept code adds is a temporary tolerance (`storiesAsMapped` substitutes map rows for listed stories), and that branch is not exercised by any test while the list is empty. | Reword (suggestion in section 6); either keep the bridge as "reviewed temporary tolerance" or delete it with the next `tools/quality` change. The PR body's "2 skipped (docker.lock directory held ...)" reads as if the skips came from the lock; they are the two POSIX-only `file-secret-provider` cases (O_NOFOLLOW, file mode) that skip on the Windows host and run in lane A. No action. |

## 6. D-QA-016 for the orchestrator to log (PR body text, with the suggested correction)

PR body text, verbatim: "**D-QA-016** The 13 scenarios are classified as in the table; map v1.0 to v1.1 (stories file version unchanged, 1.3); `KNOWN_DRIFT` emptied but the mechanism is kept so a future story edit that adds scenarios fails by story ID until qa-lead classifies it. TEST-STRATEGY v1.4 corrects rule 2 (D-SEC-PR35-02 / D-TASK277-03 corrected). Not done here: renumbering US-066 test titles (not needed after D-065, `authorise.test.ts` `AT-US-066-08` now agrees with the map); the 015-B `quality:heavy` hook."

Suggested wording (R1-n4, R1-m1): "... `KNOWN_DRIFT` is emptied; the byte-identical render and the count pins now run over the real story files, so a story edit that adds or renames scenarios fails by story ID until qa-lead classifies it (the substitution bridge stays only as a temporary, reviewed tolerance). TEST-STRATEGY v1.4 corrects rule 2: `quality:trace` writes `reports/ac-trace.json` by default (`reports/` is not yet git-ignored: `.gitignore` and `.prettierignore` entries are an owned-path follow-up with 015-B, PR #35 R2-n1), and the attachment hook is 015-B (D-SEC-PR35-02). AT-US-066-12 is G3-counted with a leg that depends on TASK-263 (Should, cuttable): qa-lead and product-manager to settle before Wave 7 (R1-m2)."

## 7. Routing

| To | Items |
|---|---|
| qa-lead (this PR, unowned doc) | R1-m1 wording, R1-n2, R1-n3, R1-n4 wording |
| qa-lead + product-manager | R1-m2 (conditional G3 form or story edit; owners in the task sheets) |
| devops-engineer (with 015-B, security record needed) | `/reports/` in `.gitignore` and `.prettierignore`, `gitignore.test.ts` row, `trace.mjs:67` comment (R1-m1 owned half) |
| next `tools/quality` change | R1-n1 (a new owned-path commit voids the security record's head row: batch it) |

Verdict: APPROVED_WITH_NITS. Nothing here blocks the merge; R1-m1's doc half is a one-line edit that does not touch an owned path, so it does not void the security record.
