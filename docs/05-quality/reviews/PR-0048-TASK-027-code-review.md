# Code review: PR #48, TASK-027 RBAC matrix test generator (round 1)

| Field | Value |
|---|---|
| PR | #48 `feat(authz): generate route x role RBAC matrix tests from route metadata (TASK-027)` |
| Branch / head | `feat/TASK-027-rbac-matrix-test-generator` @ `a4f2d51` (8 commits: 4 code/test, 1 evidence, 3 merges of main) |
| Merge-base with current main | `5d2c102`. Main has since moved to `8c65315`, which includes PR #39 (`3f58935`, TASK-014, 197 files, non-docs) |
| Story / records | US-071 (DC) · REQ-RBAC-011 · NFR-SEC-011, NFR-TENANT-002 · T-QA-04 · D-ARCH-107/109/110/125 · PR32-SEC-14/16 · PR43-SEC-01/12 · PR #43 review R2-n2 · SEC-TC-01 · D-TASK027-01..13 · D-ORCH-092 |
| Reviewer | code-reviewer · 2026-11-15 · round 1 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The generator is a correct and independent re-statement of the authenticate -> MFA gate -> authorise rules.
         31 of 33 non-equivalent generator mutants die, mostly in the fast lane through the full-text pin of the
         committed matrix. Production-slot mutants that change a reachable cell die in the contract layer (up to 4,994
         named problems). The work is fail-closed for new routes and roles, PR43-SEC-12 and R2-n2 are met, and the seams
         stay in tests/. There is no BLOCKER or MAJOR. Four MINORs: (1) the runner's Cache-Control and foreign-credential
         checks have no negative control; (2) the matrix never reaches authorise's credential and actor gates, and one
         test title over-claims that it does; (3) no plan card owns retiring the seams; (4) a hung or reset request fails
         the 900 s contract test without naming the cell. Merge needs a union with main after PR #39, fresh lane-B
         evidence on the merged head, a security record and a green ci-gate.
```

## 1. Verification I performed myself

| # | Check | Result |
|---|---|---|
| V1 | `git diff origin/main...a4f2d51 --stat`, `git log` | 26 files, +13,047/-11. Code: `packages/authz/src/generator/{matrix,document,org-scope}.ts` with tests, `packages/authz/src/index.ts` exports, `tests/generated/rbac/*` (6 files), `tests/generated/rls/{api-cases,generator}.ts` + new `api-cases.test.ts`, one `package.json` script, the committed matrix. Nothing under `apps/`. |
| V2 | Three merges of main (`75aa83a`, `9e65e61`, `a4f2d51`) | Each is equal to `git merge-tree --write-tree` of its parents, so they are pure. `a082560` (PR #42) is an ancestor, which confirms D-TASK027-13. `9e65e61..a4f2d51` touches only `docs/sdlc/STATUS.md` and the run directory. |
| V3 | Targeted unit tests, run positionally in the worktree: `jest packages/authz/src/generator tests/generated/rbac/rbac-matrix-doc.test.ts tests/generated/rls/api-cases.test.ts --selectProjects unit` | 5 suites, **31 passed**, 6.3 s. |
| V4 | `jest tests/generated/rbac/rbac-matrix.api.test.ts --selectProjects generated`, run 3 times in the worktree | **21/21 passed** each time. The contract-layer test took 11-15 s, 42.5 s and 37.9 s. The `getLiveness` row took 0.17-0.27 s. Total 18 s, 30 s and 57 s. |
| V5 | `prettier --check` on the 18 changed non-evidence files | clean |
| V6 | `eslint --max-warnings 0` on the 16 changed `.ts` files (4096 MB heap) | rc 0, 44 s |
| V7 | Evidence `20261115T0623Z_9e65e61` | Verdict PASS. In `unit.junit.xml`, `coverage merge: generated coverage run` passed, so the rbac-matrix suite ran green in the merged-coverage step, as the PR says. Merged coverage gives 100/100 lines/branches for `packages/authz` and for `generator/{document,matrix,org-scope}.ts` (53/53, 62/62, 19/19 branches). `rbac-matrix` is listed as "skipped by manifest (planned)", as D-ORCH-092 expects. |
| V8 | Hosted CI on `a4f2d51` (run 43687221665) | `fast-lane` passed. `scans` fails only on "Security-owned paths need a review record" (`packages/authz`, `tests/generated/rls`). `ci-gate` fails as a consequence. |
| V9 | Union with current main `8c65315` (after PR #39) | `git merge-tree --write-tree a4f2d51 origin/main` is clean (tree `b568ee6`). `package.json` (overlapping file) keeps both `authz:matrix` and `test:stack`. `jest.config.ts` from #39 adds only the opt-in `stack` project and its unit ignore. The `generated` project is unchanged. |
| V10 | Seam leak check | `createApp({ pipeline })` already exists on main (`apps/api/src/app.ts:63-66`, "Test seam"). The PR adds no production export. All three seams and the inert runner are in `tests/generated/rbac/matrix-app.ts`. |
| V11 | Generator mutants (scratch copy `git archive a4f2d51` + `node_modules` junction + `@platform/authz` overrides; unit lane only: generator tests + `rbac-matrix-doc.test.ts`) | **31/35 killed.** Details in §3. |
| V12 | Production-slot mutants through the PR's own contract layer (tsx probe that swaps `PipelineSlots`, all 133 operations, `runRow`, no file edits) | Baseline: 0 problems. 4 killed and 4 survived. The survivors are all defence-in-depth branches that valid descriptors and the seams cannot reach. Details in §3. |
| V13 | Plan routing of the seam retirement (D-TASK027-04 names TASK-052/055/091/171/261 and the MFA task) | `grep -ci 'rbac\|matrix\|TASK-027'` inside each card: **0** for TASK-052, 055, 091, 171, 261 and 041. See R1-m3. |
| Not re-run | full `lint`, `typecheck`, `build`, full unit, integration/api/Docker suites, `quality:heavy` | The brief allowed light commands only. I relied on run `20261115T0623Z_9e65e61` and hosted `fast-lane`. That evidence does **not** cover the head after the union with PR #39 (merge condition MC1). |

Host-load note: in a scratch copy under `%TEMP%`, the contract layer ran at about 1-2 s per request, roughly 100 times slower than the worktree (an environmental effect of the copy location). It failed 3 times out of 3 with `TypeError: fetch failed / read ECONNRESET` after 589-1,130 s, and the 120 s tests that followed then timed out. This does not prove a flake on a normal host, but it shows the failure mode behind R1-m4: one transport error aborts the whole contract test and names no cell. My own tsx probe, running the same 4,300 requests outside Jest on the worktree, took between 31 s and 383 s on the same host within one hour.

## 2. Findings

| ID | Severity | Location | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tests/generated/rbac/runner.ts:176-184` (also `:172` `!observed.problem` / `observed.reached`, `:201-203` unknown caller) | The checks behind the generalised D-ARCH-109 / SEC-TC-29 claim (`Cache-Control` equals the private expectation, and a foreign credential's status, code and `Cache-Control` equal the `none` request) have **no negative control**. No test expects a "Cache-Control …" or "a credential outside the route's set changed the answer" problem. The mutation controls pin only 403 strings (`toContain` for no-authorise; `toEqual` for no-MFA and the stale row). Deleting lines 176-184 therefore leaves all 21 tests green. The checks work today: my P6 probe (a foreign credential marks the response private) gave 1,748 named problems, and P8 gave 4,994. The named D-ARCH-109 rows (`rbac-matrix.api.test.ts:299-349`) pin the card's named cases on their own, but "per route x foreign kind" over 4,300 cells rests on these unpinned lines. This is the gap the PR closed for the RLS runner with `api-cases.test.ts` (fake server, 5/5 mutants), but not for this runner. | Add a mutation control or a fake-server unit test for `cellProblems`/`runRow`. Use a slot that marks a foreign credential private and one that answers a foreign credential differently from `none`, and assert the exact problem strings. Also cover a refusal that reaches the terminal, a non-problem refusal and an unknown caller id. In-PR, or route to the next TASK-027 touch. |
| R1-m2 | MINOR | `tests/generated/rbac/matrix-app.ts:120-132` (`resolvePrincipal` resolves only DECLARED kinds; `:125` signature only on `[signature]` routes); `rbac-matrix.api.test.ts:351-370` | The seam builds principals only for kinds in `route.auth`, so production `authorise`'s credential gate (`authorise.ts:47-50`), its signature-credential check (`:34`) and its actor check (`:37`) are **dead in the matrix**. Mutants P1, P2 and P4 each gave 0 problems over all 133 operations. P5 (dropping the defence-in-depth private mark) also survives, because the seam marks the response itself. These branches are covered by `apps/api/src/platform/authz/authorise.test.ts` ([PR32-SEC-02], [D-ARCH-110] at lines 111-231), so this is not a coverage hole. But the D-ARCH-110 test title says "a session on the signature route 401; a signature principal on a session route 401" and the module JSDoc says the rows run "through the real … authorise slots". The 401s come from the seam's own filter plus the authn stub, not from authorise. | Either (a) add one "rogue authenticator" row: a seam that resolves a principal of an undeclared kind (a signature principal on `getShipment`, a session principal on `receiveStripeWebhook`, a refresh principal on an `authenticated` route) and assert 401 from production authorise, or (b) reword the title and JSDoc to say where those refusals are proven and cite `authorise.test.ts`. |
| R1-m3 | MINOR | `tests/generated/rbac/matrix-app.ts:5-17, 134-160`; D-TASK027-04 | Retiring the seams has no owner. None of the TASK-052/055/091/171/261, MFA or TASK-041 cards mention the matrix (V13). The synthetic credentials (`Bearer rbac-matrix.<ROLE>`, `rbac-matrix.valid`, `x-rbac-matrix-signature`) are resolved **before** the production slot. So when a real authenticator lands, the matrix stays green while testing the seam rather than the authenticator's D-ARCH-109 behaviour (ignore foreign kinds, mark private only for declared ones). Nothing fails to force the seam to shrink. | Orchestrator: add one AC line to each of those cards ("replace the rbac-matrix `<kind>` seam with a real test credential; the generator rules stay"), and to TASK-041 the step-0 limiter seam already routed in D-ORCH-092. Optional tripwire: a test that fails once `authenticate.ts` no longer carries the stub contract (for example, a pinned "verifies nothing" marker), so the seam is revisited in the same PR. |
| R1-m4 | MINOR | `tests/generated/rbac/runner.ts:140-149`; `rbac-matrix.api.test.ts:64-72, 232-249` | D-TASK027-12: I **accept the bound values**. The matrix is a correctness suite, not a latency gate (the NFR budgets are k6's). The same 4,300 requests took 31-383 s on this host within one hour (V12), so 120 s per test and 900 s for the contract layer do not mask a defect. The diagnosability around them is weak, though. `observe` sets no per-request deadline and does not catch transport errors, and `JSON.parse` of a problem body can throw. A hang therefore costs 15 minutes and reports only "Exceeded timeout", and an `ECONNRESET` (reproduced 3 out of 3 in the slow copy) aborts all 133 rows with "fetch failed". Neither names a cell. The bounds are also new local constants, against `loopback.ts`'s "one constant, so a later change reaches every such file". | Give `observe` a per-request `AbortSignal.timeout` (for example 30 s). Turn a transport or parse error into a named problem (`<op> x <caller>: request failed: <cause>`) instead of a throw. Keep 900 s as the outer bound. Add `rbac-matrix.api.test.ts` to the TASK-W0-FLAKE file list, so its bounds move with the shared constants and the ECONNRESET mode is judged under the host-load work. It already runs in lane B on every backend PR through the merged-coverage step. |
| R1-n1 | NIT | `packages/authz/src/generator/org-scope.ts:170` | `PATH_PARAMETER` matches only whole-segment parameters. `/x/:orgId.json` or `/x/{orgId}.csv` is not enumerated, so SEC-TC-01 fails open for that shape. Surviving mutants O3 and O6 are equivalent on today's contract, which has no partial-segment parameters. | Add a one-line comment saying the binding rules forbid partial-segment parameters, or match `:orgId` / `{orgId}` anywhere and add a unit row. |
| R1-n2 | NIT | `tests/generated/rbac/matrix-app.ts:80` | The refresh-cookie columns present only `REFRESH_COOKIE_NAMES[0]` (`__Host-rt_web`). The admin cookie never appears as a foreign credential. | Alternate the name between `refresh-cookie:valid` and `:unknown`, or add the admin name to the D-ARCH-109 named row. |
| R1-n3 | NIT | `rbac-matrix.api.test.ts:446-454`, `runner.ts:211-229` | SEC-TC-01 has no positive control. A route that answers 404 for its own organisation as well passes, which is harmless for isolation but hides a broken route. This is acceptable with the inert DB. | Record it for the owner of the T-32 rule (routed in D-ORCH-092): add the own-org call when the first `{orgId}` route has a DB-backed case. |
| R1-n4 | NIT | `packages/authz/src/generator/document.ts:92` | Mutant D6 (`break` -> `continue`) survives. It is equivalent for the generated document (a single table) and for `--check`, which compares the full text first. | none required |

## 3. Mutation and probe tables

### 3.1 Generator mutants (V11, unit lane, scratch copy)

| ID | Mutation | Result |
|---|---|---|
| G1/G2 | dual-mode: drop the `session` condition / drop the held check | killed (cell rules + committed-matrix pin) |
| G3/G4/G5 | signature-only 401 -> 403 / always allow; no actor -> 403 | killed |
| G6 | `authenticated` marker treated as a catalogue permission | killed (5) |
| G7/G8 | foreign treated as declared; drop the invalid-credential 401 | killed |
| G9/G15/G18 | ignore `mfaGateExempt`; no staff-pending; no pending factor | killed |
| G10/G19/G11 | `private` without the declared term / always private; `foreign` always false | killed |
| G12/G13/G14/G16/G17 | signature callers everywhere; no `+mfa` columns; signature always holds; anonymous skips the permission gate; signatureOnly set inverted | killed |
| D1-D5, D7 | drift: cells, metadata, removed rows, removed or added columns, missing row | killed |
| W1/W2 | `--check` passes on drift-free text differences; writer never writes | killed |
| O1/O2/O4/O5 | scope preference, tenancy filter, allow-only caller, findings | killed |
| D6, O3, O6 | `break`->`continue`; lookahead or segment anchor removed | survived, equivalent on today's inputs (R1-n1, R1-n4) |
| D8 | (my own no-op mutant) | equivalent, excluded |

The fast-lane pin `rbac-matrix-doc.test.ts` (full text equal to the generator output over all 133 operations) kills every mutant that changes a rendered cell. `matrix.test.ts` kills the `private`/`foreign` mutants, which are not rendered.

### 3.2 Production-slot mutants through the contract layer (V12)

| ID | Mutation (slot swapped through `PipelineSlots`) | Problems | Verdict |
|---|---|---|---|
| P1 | authorise without the credential gate | 0 | survived: unreachable through the seams (R1-m2), covered by authorise.test.ts |
| P2 | authorise: signatureOnly without the `signature` credential check | 0 | survived, as P1 |
| P3 | authorise: dual-mode `permissionAuthenticated` check removed | 37 | killed |
| P3b | dual-mode check applied to every credential | 7 | killed |
| P4 | authorise without the actor check | 0 | survived: no contract route pairs a non-session kind with an actor permission |
| P5 | authorise without the defence-in-depth private mark | 0 | survived: the seam marks private (authorise.test.ts covers it) |
| P6 | a foreign credential marks the response private | 1,748 | killed (shows the R1-m1 checks work) |
| P7 | MFA gate ignores `mfaGateExempt` | 32 | killed |
| P8 | a foreign credential gives 401 on `[anonymous]` routes | 4,994 | killed |

Scripts (scratchpad, session-scoped): `review/PR-48-cr/mutate-gen.mjs`, `review/PR-48-cr/probe-slots.mts`.

## 4. Focus items from the brief

- **Generator correctness.** Each rule in `matrix.ts:184-230` matches the production slots line for line (`authenticate.ts:32-42`, `mfa-gate.ts:15-21`, `authorise.ts:32-58`) for every reachable principal. There are 33 columns (1 + 17 + 8 + 7, pinned at `matrix.test.ts:75-77`). Credential kinds: a declared but invalid credential gives 401, never 403. A foreign credential equals `none`, including Cache-Control. Dual-mode: `createQuote` and `getQuote`/`streamQuoteResults` match D-ARCH-107 in the committed matrix. Signature routes: the signatureOnly webhooks give Y/403 and `receiveCarrierPush` (`public`) gives Y/Y, as D-ARCH-110 intends. The oracle reads `ROLES`, not the database. D-TASK027-03 is accepted: the seed is SHA-pinned and `authz-seed.int.test.ts` proves it equal to the database.
- **Fail-closed.** Registry rows come from the composed app itself (`mountedTargets`). An empty registry fails (`composed.length > 0`). A mounted route or a new role missing from the committed matrix is named (`:519-541`, subset mode). Any contract operation, role or grant change fails the fast-lane full-text pin. `orgMismatchCases` turns a route with no allowed role into a finding, never a skip.
- **Matrix file.** Generated with the `eol=lf` attribute (`git ls-files --eol`). `--check` compares the full text first, then names cells, rows, columns and metadata. Banner and legend changes report "differs". The version line carries `CATALOGUE_VERSION`.
- **SEC-TC-01.** There are 3 `[SEC-TC-01]` tests. The fixture proof names a leaking route, a route that queries first (inert DB, 500) and an id echoed in `Location`. Registry cases: 0 today. Contract cases: 15, all with a customer caller. The T-32 owner is open (D-ORCH-092). R1-n3 notes the missing positive control.
- **PR43-SEC-12.** `isSuccessStatus` (integer 200..299) is checked both in `routeCaseFindings` and in `runApiCase`. A positive call answered 404 is a problem whatever the case says. The runner test uses a `node:http` fake server (`api-cases.test.ts`, unit lane, no Docker).
- **R2-n2.** (a) Cross directions `tenant-a -> G` and `guest-h -> B` are added only when the route accepts both kinds, and both are pinned. (b) Every header of a refusal is scanned against the row's distinctive values (`ETag`/`Location` case pinned). (c) A fake-server unit test covers the runner.
- **Timeouts.** Accepted, with R1-m4.
- **Test seams.** No leak into production (V10). The retirement is unowned (R1-m3), and the seams hide authorise's credential and actor gates (R1-m2).
- **Coverage.** `packages/authz` is 100/100. The generator files are 100 % on lines, branches and functions in the merged report. No exclusions were added.

## 5. Deviation rulings

| Item | Ruling |
|---|---|
| Card file list asks for a `required-suites.json` entry `rbac-matrix` (security: true) | Accepted as already ruled by D-ORCH-092: a manifest-only qa-lead PR after merge, with `min_tests` 21 and `required_cases` [SEC-TC-01]. Until then the suite runs in lane B through `projects_if_suites` and fails the verdict through `coverage merge: generated coverage run` (V7). |
| D-TASK027-03 `ROLES` instead of a database read | Accepted (§4). |
| D-TASK027-05 contract layer with two normalised quirks | Accepted: neither `permissionJustification` nor the NONE-audit `entity` affects a gate. The api-designer routing stands. |
| D-TASK027-10 `registryCaseFindings` exported from `tests/generated/rls` | Accepted. |
| D-TASK027-12 120 s / 900 s | Accepted, with R1-m4 (per-request deadline and named transport errors; TASK-W0-FLAKE scope). |
| D-TASK027-13 no extra merge for PR #42 | Verified (V2). It is superseded by MC1: main now contains PR #39. |
| `/tests/generated/rbac/` not CODEOWNED | Routed by the PR to qa-lead and security-analyst. Agreed: add it beside `/tests/generated/rls/` in the activation PR. |

## 6. Merge conditions

- **MC1.** Merge `origin/main` (`8c65315` or later, which includes PR #39 `3f58935`) into the branch. The merge is clean (V9). Then take fresh lane-B evidence on the merged head. PR #39 changed `jest.config.ts`, `package.json`, the lock and 190+ other files, so `20261115T0623Z_9e65e61` no longer covers the head.
- **MC2.** A security-analyst record on the final head, so that the `scans` record step and `ci-gate` pass.
- **MC3.** Squash with a Conventional Commits title.
- R1-m1, R1-m2 and R1-m4 can be fixed in-PR, which I prefer because the code is fresh, or routed to a named owner with a due point. R1-m3 is an orchestrator routing action (card AC lines) and needs no code in this PR.

## 7. Good patterns worth keeping

- A pure oracle in a 95 %-gated package, with the HTTP runner kept in `tests/`. The generator can be mutation-tested in seconds.
- The full-text pin of the committed matrix in the fast lane. One file turns every rule change into a reviewed diff.
- Runners that return problems instead of asserting, plus mutation controls in the suite (no authorise, no MFA gate, stale expectation) that pin exact strings.
- The inert DB proxy for SEC-TC-01, which makes "refuse before any query" mechanically checkable.
- A fake-server unit test for the RLS runner with pinned problem strings. The RBAC runner should get the same (R1-m1).

## 8. Security flags (for security-analyst)

- R1-m2: the matrix does not exercise authorise's credential, signature-credential or actor gates. They rely on `authorise.test.ts` alone. Confirm that this is sufficient for PR32-SEC-02/16 and D-ARCH-110.
- R1-m3: synthetic test credentials are resolved ahead of the production authenticator, and nothing forces the seam to be removed when TASK-052 and the other authenticator tasks land.
- SEC-TC-01 enforcement owner (T-32) is still open (D-ORCH-092). The first `{orgId}` route fails the matrix by design until the owner exists.
- R1-n1: SEC-TC-01 does not enumerate partial-segment `orgId` parameters.
