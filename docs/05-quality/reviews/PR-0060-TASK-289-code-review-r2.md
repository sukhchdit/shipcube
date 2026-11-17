# Code review: PR #60, TASK-289 (TASK-027-F) RBAC matrix follow-up (round 2, narrow)

| Field | Value |
|---|---|
| PR | #60 `feat(authz): rbac matrix whole-response foreign checks, oracle subpath, observe deadline (TASK-289)` |
| Branch / head | `feat/TASK-289-rbac-matrix-follow-up` @ `c912a0a` (evidence `20261117T1247Z_f2a7411`, 8 files only) · code head **`f2a7411`** = merge of main `d173d8f` (PR #56 `27f0189` + docs) into fix commit **`b66f450`** |
| Delta reviewed | `df31b32..c912a0a`: fix cycle 1 (`b66f450`, 8 code files, +125/-15), merge `f2a7411`, evidence `c912a0a`. Commits `89c24d8`/`cb3bf8d` are the r1 records. |
| Scope / records | r1 record `docs/05-quality/reviews/PR-0060-TASK-289-code-review.md` (`89c24d8`) · D-ORCH-122 · D-SEC-PR60-01 (PR60-SEC-02 = R1-m1) · D-TASK289-13 (in D-ORCH-125) · D-ORCH-123 (merge main inside fc1) |
| Reviewer | code-reviewer · 2026-11-17 · round 2 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: All six fix-cycle items close (R1-m1 = PR60-SEC-02, n1, n2, n4, n5, n6). Each new test is load-bearing: 6 of 6
         new mutants die, and the r1 survivors R10 and G5 now die. Comparing `instance` keeps the full HTTP matrix green
         (26/26). The main merge is byte-identical to git's automatic merge, and the oracle policy is still last.
         No BLOCKER, MAJOR or MINOR. One new NIT: fillPath does not fill the wildcard that R1-n5 now enumerates.
         defineRoute refuses that shape, so it cannot be reached. R1-n3 stays deferred.
```

## 1. Verification I performed myself

| # | Check | Result |
|---|---|---|
| V1 | `git fetch`. Local and `origin/feat/TASK-289-rbac-matrix-follow-up` are both `c912a0a`. `git diff 89c24d8 b66f450 -- packages tests tools` was read line by line, and the changed files were read in full context: runner `observe`/`responseDifferences`/`runOrgCase`/`fillPath`, `credentials.ts` READERS, `problem.ts` `instanceOf`, and the org-scope fixtures of the suite. | 8 code files changed: `matrix.ts`, `index.ts`, `org-scope.ts`, `runner.ts`, and 4 test files. No product code under `apps/*/src` changed. |
| V2 | Merge `f2a7411`: `git merge-tree --write-tree b66f450 d173d8f` → `6d1f1cb`; `git diff --stat 6d1f1cb f2a7411` | **Empty**. The merge commit equals the automatic merge, so no hand resolution exists. The only file changed on both sides is `eslint.config.mjs`. Since the merge-base `c2b74c1`, PR #56 added a category (`api-pipeline-composition`) and widened the capture allow; PR #60 added the oracle category and policy. The edits sit in separate hunks. `authz-matrix-oracle` is still the **last** `BOUNDARIES_POLICIES` entry (l. 683-684), so last-match semantics hold, and PR #56's allow (l. 663) does not interact with it. |
| V3 | Current main drift: `origin/main` = `80dce9e` (PR #57 `7db21b7` + docs) | `merge-base(c912a0a, origin/main)` = `d173d8f`. `comm -12` of the two file sets is **empty**, and `git merge-tree` is clean (rc 0). No re-merge is needed for correctness. |
| V4 | Targeted unit tests at `c912a0a`: `packages/authz/src/generator/*`, `tests/generated/rbac/runner.test.ts`, `tools/lint/negative-fixtures.test.ts` (`--selectProjects unit --json`) | **430 passed, 0 failed.** Every new case is listed and passes: the R1-m1 totality, the R1-n1 SEC-08, R1-n2, R1-n4, R1-n5 and the two `[PR48-SEC-03] allowed fixture` cases. |
| V5 | Full HTTP matrix `rbac-matrix.api.test.ts --selectProjects generated` in an archive copy of `c912a0a` | **26/26 passed** (81 s). This is the proof for R1-n4: `instance` is now compared on every foreign cell and causes no false positive. The suite is still "skipped by manifest" in lane B. |
| V6 | `prettier --check` and `eslint --max-warnings 0` (type-aware) on the 8 changed files plus `eslint.config.mjs` | Clean. |
| V7 | Mutation run in an archive copy of `c912a0a` (node_modules junction; scratch `pr60r2/mut*.mjs`) | 6 of 6 killed (table §2). |
| V8 | Probe of the R1-n5 widening end to end (scratch `pr60r2/fill.mts`, plus a wildcard fixture added to the suite in the copy) | `pathParameterNames('/api/v1/organisations/files/*orgId')` = `['orgId']`, but `fillPath(…, { orgId: FOREIGN })` returns the path **unchanged**. A wildcard fixture route, however, is refused at module load: `RouteDefinitionError: path segments "*orgId" are not literal or :param`. So no wildcard route can reach the generator today (R2-n1). |
| V9 | Evidence `20261117T1247Z_f2a7411` | Verdict PASS. `git_dirty: false`, `build_clean: true`. Results: unit 6,763, api 173, integration 331, rls 126, catalog 102, all 0 failures. Merged coverage is 99.06 % lines / 97.09 % branches. The evidence binds `f2a7411`, the code head, and `c912a0a` adds only the run directory. |
| V10 | CI: `gh pr view 60` on `c912a0a` | `fast-lane` SUCCESS, `security-integration` SKIPPED, `ci-gate` FAILURE. The failure is the expected red record step, since no r2 security record exists yet (D-ORCH-126, run 44093161786). |

Not re-run by me: `npm run typecheck`, `npm run build` and the lane-B heavy suites. The worktree is read-only, and `tsc -b` emits into it. For these I rely on V9 (`build_clean: true`) and on the type-aware ESLint pass in V6.

## 2. Mutation table (V7)

| ID | Mutant | Result |
|---|---|---|
| R10 (r1 survivor) | `observe` header join → last value wins | **killed** by `PR #60 R1-n2` (the clearing Set-Cookie before the same last value) |
| G5' (r1 survivor, test-side) | the SEC-08 helper drops `appliesTo(c, declaring(kind))` (the old check) | **killed**: the inline control (`presentedWhereDeclared(non-synthetic, 'signature') === false`) fails |
| I1 | `instance` back in `VOLATILE_PROBLEM_MEMBERS` | **killed**: the volatile pin and the behavioural R1-n4 case both fail |
| U1 | an extra `UNPRESENTED_CREDENTIAL_HEADERS` entry (`authorization`) | **killed** by the `toEqual` pin of the exclusion map |
| W1 | `PATH_PARAMETER` back to `:`/`{}` only | **killed** by `PR #60 R1-n5` |
| L5 (r1: sweep only) | generator folder not self-exempt (`noneOf: ['test']`) | **killed**, now also by the named `[PR48-SEC-03] allowed fixture: the generator folder …` case. Several unrelated cases also fail, as known false failures of an archive copy (the `@platform/source` resolver). |

The R1-m1 totality check also has an inline control: `x-hub-signature-256` appended to the names is reported as the only gap. And the partition pin (`CREDENTIAL_HEADER_NAMES` minus `SIGNATURE_HEADER_NAMES` = the 5 named headers) catches any new header that lacks the `-signature` suffix.

## 3. Fix-cycle items

| r1 item | Status | Evidence |
|---|---|---|
| **R1-m1** (= PR60-SEC-02) suffix-derived signature headers, JSDoc over-claim | **Closed** | `matrix.ts:84-101`: the JSDoc now states the suffix rule and its failure mode. `UNPRESENTED_CREDENTIAL_HEADERS` (`x-csrf-token` → TASK-048, `x-reauth-proof` → TASK-187) is frozen, exported from the `./matrix` subpath only, and pinned in `entry.test.ts`. The totality test in `matrix.test.ts:100-127` says every credential header is presented or excluded, and pins the non-signature partition. It goes slightly beyond r1's fix by mapping kinds to headers, so a new presentable kind with a new header also forces a decision. `KIND_HEADER` is a test-local copy of `credentials.ts` READERS (l. 65-68). It is verified equal, and a missing entry fails closed (the header counts as unpresented). |
| R1-n1 SEC-08 vacuous for `signature` | **Closed** | `matrix.test.ts:130-144` requires a presenting caller that applies to a route declaring the kind, with a G5 control. The D-ARCH-134 api line (`rbac-matrix.api.test.ts:391-399`) uses the same rule over the contract rows. |
| R1-n2 Set-Cookie join unpinned | **Closed** | `runner.test.ts:195-209` (the R1-n4 case is l. 183-193). Exactly one problem is pinned, for `refresh-cookie:valid`. `refresh-cookie:unknown` (`__Host-rt_admin`) correctly stays equal. R10 is killed. |
| R1-n3 STUBBED list drive unpinned (A3) | **Open, deferred** (not in D-ORCH-122's take list) | Equivalent today. It belongs with TASK-052's tripwire, together with PR60-SEC-03 (D-SEC-PR60-01). |
| R1-n4 `instance` not volatile | **Closed, stronger than asked** (D-TASK289-13) | `runner.ts:76-81`: `instance` is compared. It equals `instanceOf(req.originalUrl)` with the query string dropped (`problem.ts:34-38`, `problem-handler.ts:119/162`), and that is the same URL for the reference and every cell of a row. V5 shows no false positive. The card (WAVE-00 l. 1715) lists `instance` as excluded, so this narrows the volatile set and fails closed; accepted. |
| R1-n5 Express 5 wildcard not enumerated | **Closed** (enumeration), with a residual NIT (R2-n1) | `org-scope.ts:20` matches `[:*]name`. The unit row covers `*orgId` and `{/*path}`. |
| R1-n6 ok-document only in the sweep | **Closed** | `negative-fixtures.test.ts:1761-1767` names both positive fixtures under `[PR48-SEC-03]`. L5 now dies in a named case. |

## 4. Findings

| ID | Severity | File:line | Problem | Why it matters | Fix |
|---|---|---|---|---|---|
| R2-n1 | NIT | `tests/generated/rbac/runner.ts:101-106` vs `packages/authz/src/generator/org-scope.ts:20` | The R1-n5 regex now enumerates a `*orgId` route as an SEC-TC-01 case. But `fillPath` keeps its own copy of the old regex (`:name`/`{name}` only), so the case's "foreign {orgId}" request would send the literal `*orgId` and never the foreign id (V8). A route that echoes the id in a header (`probeOrgHeaderLeak`-shaped) would then pass vacuously. **Unreachable today**: `defineRoute` refuses a `*` segment ("not literal or :param", V8), and OpenAPI paths cannot carry one. My r1 fix advice named only the enumeration regex; the second copy is the root cause. | If `defineRoute` ever admits wildcards, the enumeration widening turns a silent skip into a silent pass. | At the next touch, share one parameter regex between `pathParameterNames` and `fillPath`, or make `fillPath` throw on an unfilled `*name`. Alternatively, record in the R1-n5 unit row that `defineRoute`'s segment rule is the actual guard. |

There is no other new issue. The r1 NIT R1-n3 is carried forward unchanged.

## 5. Deviation rulings

| Decision | Ruling |
|---|---|
| D-TASK289-13 `instance` compared (narrows D-TASK289-02 and the card's volatile list) | Accepted: the comparison is stricter and fails closed, and V5 shows it green on the real matrix. |
| `UNPRESENTED_CREDENTIAL_HEADERS` as an owned exclusion map (vs r1's alternative of a `WEBHOOK_SIGNATURE_HEADER_NAMES` list in `@platform/shared`) | Accepted. It also covers the CSRF and re-auth proofs, which PR60-SEC-02 / r1 §8 (INFO) listed, and names each one's owner. |
| Merge of main inside fc1, before the evidence (D-ORCH-123) | Accepted. V2 proves it is a pure automatic merge, and the evidence binds the merged code head `f2a7411`. |

## 6. Merge conditions

1. A security record for r2 on the final head (`ci-gate` is red only on the record step, V10).
2. Green `ci-gate` on the final head. Main has moved to `80dce9e` (PR #57) with no file overlap and a clean merge-tree (V3), so no further union is needed unless the lane policy requires the branch to be current.
3. Unchanged from r1: the activation PR (D-ORCH-092) sets `rbac-matrix` `min_tests` to 26 (V5).
4. R2-n1 and R1-n3 go to the next touch of these files: TASK-052 for R1-n3, and TASK-060's R-03 build rule for R2-n1 if `defineRoute`'s segment rule changes.

## 7. Security flags

- None new. PR60-SEC-02 is closed by R1-m1 (§3). The R2-n1 residual is an unreachable SEC-TC-01 vacuity; I mention it for completeness, and it is not a finding for the security record.

## 8. Good patterns worth keeping

- Every new pin carries an inline negative control: the grown header list, the G5 caller filter, and the clearing cookie. Each test therefore proves it can fail, without a separate mutation run.
- The exclusion map names its owner task per entry and is pinned with `toEqual`. A silent addition is caught (U1).
- The merge commit message states that the remerge-diff is empty, and that claim was verifiable in one command.
