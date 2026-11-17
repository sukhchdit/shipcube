# Code review: PR #60, TASK-289 (TASK-027-F) RBAC matrix follow-up (round 1)

| Field | Value |
|---|---|
| PR | #60 `feat(authz): rbac matrix whole-response foreign checks, oracle subpath, observe deadline (TASK-289)` |
| Branch / head | `feat/TASK-289-rbac-matrix-follow-up` @ `df31b32` (code `1353e78`; `df31b32` adds only `docs/05-quality/tests/runs/20261117T0440Z_1353e78/`, 8 files) |
| Merge-base with current main | `c2b74c1`. Main has since moved to `f81e56a` (PR #59 stage-2 `ci.yml` + docs). No file is changed on both sides. |
| Scope / records | TASK-289 card (WAVE-00) · PR #48 code review R1-m1/m2/m4, R1-n1/n2/n3 · PR48-SEC-01/03/05 (items 1-3)/08 · D-TASK289-01..12 · D-ARCH-109/110/134/137 · D-SEC-PR53-02 |
| Reviewer | code-reviewer · 2026-11-17 · round 1 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Every card AC is met. The foreign comparison now covers the whole response, and the volatile set is the
         minimum needed. The oracle has left the production entry and lint confines it on both arms. observe() fails
         named, inside the 900 s bound. 29 of 32 mutants die. One is equivalent, and two survive as untested
         details (one of them equivalent today); none is a false negative today. The regenerated matrix changes 0 of 4,389 old cells.
         There is no BLOCKER or MAJOR. One MINOR: the signature-header column set is derived by the `-signature`
         suffix, and the comment over-claims that a new provider header gets its column automatically. Six NITs.
```

## 1. Verification I performed myself

| # | Check | Result |
|---|---|---|
| V1 | `git diff origin/main...HEAD --stat`, `git log` | 36 files. Code is in `tests/generated/rbac/*` (runner, matrix-app, suite, new `runner.test.ts`), `packages/authz/src/generator/*` (+ new `index.ts`, `entry.test.ts`), `packages/authz/{package.json,src/index.ts}`, `eslint.config.mjs`, `tools/lint/*`, 7 lint fixtures and the regenerated matrix. Nothing under `apps/*/src` changed. |
| V2 | `npm run typecheck` and `npm run lint` in the worktree | Both rc 0 (lint `--max-warnings 0`; check-suppressions 0 findings). |
| V3 | `prettier --check` on every changed non-evidence file | Clean. |
| V4 | Targeted unit tests: `runner.test.ts`, `packages/authz/src/generator/*`, `negative-fixtures.test.ts`, `image-exports.test.ts`, `rbac-matrix-doc.test.ts` | 8 suites, **450 passed**, 19.7 s. |
| V5 | `rbac-matrix.api.test.ts --selectProjects generated` (the full HTTP matrix) | **26/26 passed**, 23.5 s. This matches the `min_tests` 21 → 26 follow-up of D-TASK289-01..12. |
| V6 | Cell-by-cell comparison of the committed matrix, `origin/main` vs head (scratch `pr60/cmp.mjs`, a markdown-table parser) | Header prefix identical; 133 rows, same keys and order. **0 of the 33 old columns changed in any row.** New columns: 3 × (30 `Y` + 100 `401` + 3 `-`). Every new cell equals that row's `none` cell. `-` appears exactly on the routes whose `Auth` contains `signature`. Outside the table, only the banner sentence and the footer count (`33` → `36 callers`) differ. Generation is deterministic: the order comes from the frozen `CREDENTIAL_HEADER_NAMES`, and the fast-lane drift test passes. |
| V7 | False-negative probe of `responseDifferences` (scratch `pr60/fn-probe.mts`, tsx, synthetic `Observed` pairs) | These are named: an added `Set-Cookie`, a strong ETag, a `detail` member, an unknown extra member. These are not named: a changed `instance`, a missing `x-correlation-id`, and a body-hash ETag where the reference had none. All three are by design or negligible (R1-n4). Changed key order is named (fail-closed). |
| V8 | Mutation run in an archive copy of `1353e78` (`pr60/mut.mjs`; unit project; lint mutants against `negative-fixtures.test.ts`). One api-level mutant was run against the generated suite. | 32 mutants (table in §2): **29 killed**, 1 equivalent (R17), 2 survive (R10 = R1-n2; A3 = R1-n3, equivalent today). The developer's 7 runner mutants are among the kills. |
| V9 | Evidence `20261117T0440Z_1353e78` | Verdict PASS. `git_dirty: false`, `build_clean: true`. Merged coverage is 99.03 % lines / 97.05 % branches. The `rbac-matrix` suite is still "skipped by manifest" (planned), so its proof is V5 plus the generated coverage run. |
| V10 | Main drift since the merge-base | No overlap with the PR files. The card's precondition from TASK-291 (D-ARCH-146: "runner.ts is NOT touched here — TASK-289 already moved it to fetchOnce") holds. |

## 2. Mutation table (V8)

| ID | Mutant | Result |
|---|---|---|
| R1 / R2 | `set-cookie` / `www-authenticate` added to `VOLATILE_HEADERS` | killed (S1 / S2 + the volatile-set pin) |
| R3 | body not compared | killed (S3, S4) |
| R4 | any ETag dropped (not only the body hash) | killed (non-derived ETag case) |
| R5 | foreign block removed | killed (7 tests) |
| R6 | `signal` not passed to `fetchOnce` | killed after 63 s (the 60 s fetchOnce fallback, then the `not FetchOnceTimeoutError` assertion) |
| R7 | timeout reason not used for the name | killed |
| R8 | row continues after a transport failure | killed (`stopped after 5 of 7`) |
| R9 | own-organisation control removed | killed |
| **R10** | header join → last value wins (repeated `Set-Cookie` collapsed) | **survived** (R1-n2) |
| R11 | malformed-problem check removed | killed |
| R12 | `detail` made volatile | killed |
| R13 | refusal that reached the terminal accepted | killed |
| R14 / R15 | deadline ×10 / default ignores the constant | killed (spy pin, D-SEC-PR53-02) |
| R16 | own-organisation request sent to the org-scope app | survives `runner.test.ts` (one origin for both); **killed** by the api-level fixture proof (`got 200`) |
| R17 | every error turned into a row problem (no rethrow) | equivalent (the suite still fails, just without the stack) |
| A1 | admin cookie not presented | killed |
| A2 | signature value changed | killed |
| **A3** | `seamed` ignores `STUBBED_CREDENTIAL_KINDS` | **survived**, equivalent today (the list holds every kind) (R1-n3) |
| G1-G4 | header filter / applies everywhere / falls to `principalOf` / presents `none` | killed |
| G5 | the two synthetic signature callers removed | killed by the column pins; **the PR48-SEC-08 test alone passes** (R1-n1) |
| O1 | whole-segment-only parameter regex restored | killed |
| L1-L4, L6 | specifier pattern / specifier arm / resolved arm / package importers / test exemption | killed |
| L5 | generator folder not self-exempt | killed by the "every other fixture lints clean" sweep (not by the `PR48-SEC-03` tests) |

## 3. Findings

| ID | Severity | File:line | Problem | Why it matters | Fix |
|---|---|---|---|---|---|
| R1-m1 | MINOR | `packages/authz/src/generator/matrix.ts:83-89`; `matrix.test.ts:93-98` | `SIGNATURE_HEADER_NAMES` is `CREDENTIAL_HEADER_NAMES` filtered by the suffix `-signature`. The JSDoc says "a new provider header gets its foreign column without an edit here". That holds only for names with that suffix. A provider header such as `x-<carrier>-hmac` or `x-hub-signature-256` added for TASK-171/261 would go into `CREDENTIAL_HEADER_NAMES` (the `credentials.test.ts` pin is edited) while every matrix test stays green. That is the silent-gap class of PR48-SEC-08, here for D-ARCH-109's header columns. The `toEqual([3 names])` pin catches a new `-signature` name, not a missed one. | PR48-SEC-01 exists so that a real webhook header read on every route fails the matrix (S4). A missed header reopens exactly that gap. The fix costs one assertion. | Pin the partition in `matrix.test.ts`: `expect(CREDENTIAL_HEADER_NAMES.filter((n) => !SIGNATURE_HEADER_NAMES.includes(n))).toEqual(['authorization', 'cookie', 'x-csrf-token', 'x-reauth-proof', 'x-quote-token'])`, so every new credential header forces a decision. Alternatively, export a `WEBHOOK_SIGNATURE_HEADER_NAMES` list from `@platform/shared` and derive both from it. Reword the JSDoc to match. |
| R1-n1 | NIT | `packages/authz/src/generator/matrix.test.ts:99-103`; `tests/generated/rbac/rbac-matrix.api.test.ts:390-395` | The PR48-SEC-08 check (and the D-ARCH-134 "each presented by some caller" line) counts `presentedKind`. That is now `signature` for the `signature-header` callers too, and those callers never apply to a route that declares `signature`. With both synthetic signature callers deleted (G5), the SEC-08 test still passes. The column pins catch it today, so nothing is uncovered. But the test D-TASK289-12 cites to close PR48-SEC-08 is vacuous for `signature`. | A later edit that rewrites the column pins would lose the only check that a declared signature is ever presented. | Require a caller that presents the kind AND applies to a route declaring it, for example `matrixCallers(ROLES).some((c) => presentedKind(c) === kind && appliesTo(c, { ...route, auth: [kind] }))`. |
| R1-n2 | NIT | `tests/generated/rbac/runner.ts:153-157` | The line-feed join of repeated headers (D-TASK289 comment "repeated headers (`Set-Cookie`) joined") is untested. R10 (last value wins) survives. | A reference that already sets one cookie (a future CSRF or consent cookie on every response), plus a foreign credential that adds a clearing `Set-Cookie` before it, would compare equal under last-wins. | Add a fake-server case where the reference sends one `Set-Cookie` and the foreign request sends two (same last value), and pin `(header set-cookie)`. |
| R1-n3 | NIT | `tests/generated/rbac/matrix-app.ts:153-154` | D-TASK289-09 says `STUBBED_CREDENTIAL_KINDS` drives `resolvePrincipal`. A3 (`seamed` ignores the list) survives, because the list holds every kind. The api test pins the list's contents, not its effect. | TASK-052's tripwire compares this list with the mounted authenticators. If the conjunct is lost in a refactor, the tripwire compares a list that resolves nothing. | Let `matrixAuthenticate` take the list as a parameter (default `STUBBED_CREDENTIAL_KINDS`), and add one case: with `session` removed, `CUSTOMER_OWNER` on `getShipment` gets the stub's 401. |
| R1-n4 | NIT | `tests/generated/rbac/runner.ts:76-77` | The JSDoc says `instance` "differs between two identical requests". It does not: `instance` is the request path (`apps/api/src/platform/errors/problem.ts:10`), which is the same for `none` and the foreign cell of a row. Leaving it out is harmless (it is the record's set) but slightly wider than needed. V7 also shows that a missing `x-correlation-id` and a body-hash ETag absent from the reference are not named. Neither is plausible from a credential. | Accuracy of the volatile-set rationale (D-TASK289-02). | Reword it to "the request echo (the same path; left out as in the record)", or compare `instance`. No code change is required. |
| R1-n5 | NIT | `packages/authz/src/generator/org-scope.ts:19` | The in-segment regex enumerates `:name` and `{name}`, but not an Express 5 wildcard (`/files/*orgId`), which also binds `req.params.orgId`. D-TASK289-11's "fail closed on optional groups" holds (`{/:orgId}` is enumerated, and its literal braces then fail the route-reached control). A wildcard is silently skipped. | SEC-TC-01 enumeration completeness (PR48-SEC-05 item 3). No route uses one today. | Match `\*([A-Za-z_]\w*)` too (or refuse it), with one unit row. Alternatively, record it for the R-03 build rule that TASK-060 owns (D-ARCH-134). |
| R1-n6 | NIT | `tools/lint/negative-fixtures.test.ts:1327-1351` | The positive fixture `generator/ok-document.ts` is asserted only by the generic "every other fixture lints clean" sweep. The `[PR48-SEC-03]` cases do not name it (L5 dies only in the sweep). | Running `-t PR48-SEC-03` alone does not show the self-exemption. | Add an `expectClean` case for `layering/authz-matrix-oracle/packages/authz/src/generator/ok-document.ts` under the `[PR48-SEC-03]` tag. |

## 4. Focus items of the dispatch

- **False negatives in the foreign comparison.** None found that a credential can plausibly cause (V7, R1-R5, R12). The weak-ETag exception is exact: it drops only the ETag that equals Express's weak hash of the observed body, so any other ETag, strong or weak, is compared (R4 killed). `transfer-encoding` is framing, and the body is compared, so adding it is sound. The residuals (R1-n2, R1-n4) are untested details, not open paths. One transport note, which is not a finding: `fetchOnce` builds headers from Node's `IncomingMessage.headers`, which discards duplicates of `etag`, `location`, `content-type`, `retry-after` and a few others. A foreign credential that *appends* a second such header is invisible. Express's `setHeader` replaces, so this needs an explicit `append`.
- **Test quality.** No wall-clock bound is added (D-SEC-PR53-02). The 30 s magnitude is pinned by `recordAbortTimeouts`. The 50 ms seam deadline in the hang case is an outcome assertion, not a timing assertion: the fake never answers. Problem strings are pinned exactly with `toEqual`, and the ECONNRESET rows are anchored regexes with the stop count. `fetchOnce` and `closeLoopbackServer` are used throughout (D-TASK289-06), and the old `keepAliveTimeout` workaround is gone.
- **Lint-rule correctness and false positives.** Both arms are load-bearing (L2, L3). In the fixture root the specifier arm fires alone (the specifier does not resolve there), and in the real-repo probes the resolved arm fires. The `TEST_FILES` exception sits before the bcrypt, Supertest and S3 blocks, which re-add the oracle pattern for their own files. The comment states this, and none of those files needs the oracle. I found no false positive: lint is green on the whole repository, and the generator imports itself relatively (exempt through `noneOf`, and the sweep proves it). `prisma/seed` and `tools/` are covered by `no-restricted-imports` only, not by the boundaries arm, so an `import()` there would pass. This is a security flag (INFO), not a finding.
- **Generator determinism.** V6.
- **Conformance.** D-ARCH-109: foreign = the whole response equals `none` (widened from "result and `Cache-Control`" as the record asked). D-ARCH-110: the named rows and the reworded title say where the credential and actor gates are proven (R1-m2). D-ARCH-134: `STUBBED_CREDENTIAL_KINDS` is exported for the TASK-052 tripwire, and the JSDoc names each retiring task. CLAUDE.md: no secrets (the synthetic labels and `t=0,v1=0` verify nothing), the `npm exec` and Prettier conventions are followed, and there is no new dependency.

## 5. Deviation rulings (D-TASK289-01..12)

| Decision | Ruling |
|---|---|
| 02 volatile superset + weak-body-ETag exception | Accepted (§4). |
| 03 `refresh-cookie:unknown` presents `__Host-rt_admin` | Accepted. Both names are now presented as foreign credentials, with no new column (A1 killed). |
| 04 suffix derivation, pinned to 3 | Accepted with R1-m1 (pin the partition). |
| 05 30 s deadline, the row stops, named `cause`, shape-based `causeOf` | Accepted. Worst case with `ROW_CONCURRENCY` 8: 17 batches × one 30 s wait ≈ 510 s, inside the 900 s bound. |
| 06 `fetchOnce` / `closeLoopbackServer` | Accepted. |
| 07, 08 test exemption, two-arm boundaries policy | Accepted (L1-L6). |
| 09 `STUBBED_CREDENTIAL_KINDS` drives `resolvePrincipal` | Accepted. The driving is unpinned (R1-n3). |
| 10 route-reached = mounted and authorised, not handler behaviour | Accepted. That is exactly PR48-SEC-05 item 1. |
| 11 in-segment parameters enumerated | Accepted with R1-n5. |
| 12 PR48-SEC-08 closed here | Accepted with R1-n1 (the check is vacuous for `signature`, though covered by the column pins). |

## 6. Follow-up closure (PR #48 review)

| Item | Status |
|---|---|
| R1-m1 (no negative control for the Cache-Control and foreign checks) | **Closed**: `runner.test.ts`, 17 tests, R1-R13 killed. |
| R1-m2 (truth in labelling) | **Closed**: titles and JSDoc in `matrix-app.ts`, the suite and the generator banner. |
| R1-m4 (observe deadline, named transport error) | **Closed**: R6-R8, R14-R15 killed. |
| R1-n1 (in-segment parameters) | **Closed** (O1 killed); wildcard residual in R1-n5. |
| R1-n2 (admin refresh cookie) | **Closed** (A1). |
| R1-n3 (SEC-TC-01 positive control) | **Closed**: the route-reached control with an unmounted-target fixture (R9, R16 killed). |
| R1-m3 (seam retirement owner) | Routed by D-ARCH-134, out of this card. |

## 7. Merge conditions

1. A security record for PR #60 on the final head (packages/authz, tests/generated/rbac and the lint config are security-owned; the `scans` record step stays red until it lands).
2. A green `ci-gate` on the final head. The branch predates PR #59 (stage-2 `ci.yml`). There is no file overlap, so no union is needed for correctness, but the record push runs under the merge ref's workflow.
3. The activation PR (D-ORCH-092) sets `rbac-matrix` `min_tests` to 26 (V5).
4. R1-m1 and the NITs may ride a later touch of these files. If a fix push happens anyway, R1-m1's one assertion is the one worth taking.

## 8. Security flags (for security-analyst)

- INFO: `./matrix` is not a `./testing` subpath, so `dist/generator` ships in the api and worker images, and the image preflight imports `@platform/authz/matrix` at build time (no side effects; `image-exports.test.ts` is green). It is confined by lint only. The card specified this name, so this is a note against the PR53-SEC-05 convention, not a defect.
- INFO: `prisma/seed/**` and `tools/**` are outside the boundaries arm, so a dynamic `import('@platform/authz/matrix')` there is not refused. A static import is refused by `no-restricted-imports`.
- INFO: `x-csrf-token` and `x-reauth-proof` (also in `CREDENTIAL_HEADER_NAMES`) are never presented as foreign headers. They are not credential kinds, so this is out of PR48-SEC-01's scope. Listed for completeness, with R1-m1.

## 9. Good patterns worth keeping

- The fake-server runner test pins exact problem strings per bend. With the volatile parts randomised on every request, the conformant baseline is itself a check against an over-strict comparison.
- The timeout name comes from `signal.reason`, with the transport error kept as `cause`, so the hang test can prove that the transport was aborted by the observe signal and not by fetchOnce's fallback.
- `entry.test.ts` checks the oracle's absence from the production entry by name and by value identity, so an alias re-export is caught too.
- The SEC-TC-01 route-reached control is proved against an unmounted target on the real app.
