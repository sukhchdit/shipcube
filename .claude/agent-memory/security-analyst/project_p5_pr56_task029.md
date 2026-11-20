---
name: project-p5-pr56-task029
description: PR #56 (TASK-029 audit capture) R1-R3 then R4 @e81d0c9 PASS_W_F-U (record 99f3025): merge of main pure union, store SQL passes PR #54 raw guard, SEC-14 closed; open 03 MED (TASK-041), 05 LOW, 06/07/12/13 INFO carded; merge-ready
metadata:
  type: project
---

Record `docs/05-quality/security/PR-0056-TASK-029-security-review.md`, committed and pushed by me as `38aaef9` plus `66a59a8` (code-review cross-ref) on `feat/TASK-029-automatic-audit-capture` (worktree `Shipqube-TASK-029`); main's checker: pass @4b02531, no-record control exit 1. 33 owned paths. Code twin landed ON THE BRANCH (not main) as `f376377` mid-round, CHANGES_REQUESTED: R1-M1 returned non-2xx commits = my **09 MEDIUM** (I missed it first; check returned-vs-thrown paths of tx slots); R1-m2=01, R1-m3=03, R1-m1=08. Fix cycle certain -> round 2.

**Verdict PASS_WITH_FOLLOW-UPS.** Closed: PR42-SEC-15 (a)(b)(c) (JSON bodies only), -17 (H2 as sketched; T0 residual; TASK-033 generator still "planned" so no backstop yet), -19, R3-n1.
- **01 MEDIUM:** `filterSummary` passes raw query strings as PII values; writer `boundedText` refuses NUL (`%00` via node:querystring), '' and >8,192 -> NORMAL list released with NO entry, SENSITIVE 503. Probe P2 on real capture. Fix: JSON-escape when unstorable + length bound.
- **03 MEDIUM:** 403 audit write precedes route rate limit (DR-A08), limiter stub; = threat model T-39 (aggregation unbuilt). Owner TASK-041.
- **02 LOW:** `tx/execute.ts:47` re-exports `createAuditCapture`; X1-X6 lint-clean from modules; P3 forged DELETE as another user. R3-n2 scan only covers AUDIT_WRITER_ALLOW_LIST, not platform/tx.
- **04 LOW:** `x-audit.additional[]` ignored (createQuoteShare SEC-P3-32, checkoutOrder SEC-P3-28). 05 LOW X-Client-App. 08 LOW TASK-028 deferral ACCEPTED: conditions = wiring before first audited/catalogued route in `moduleRegistry` (empty today; TASK-026 likely first) + boot assertion. INFO 06 null-org entry accepted in tenant tx, 07 no target_org/roles/session.

**Kit (session scratch `pr56/`):** `hooks.mjs` (registerHooks: @platform -> worktree packages src, .js->.ts, strip types) lets probes import the PR's real api sources from the worktree read-only; `lintprobe.mjs`, `p-filter.mjs`, `p-forge.mjs`, `p-storable.mjs`.

**Round 2 (2026-11-17, fc1 f750cc4, D-TASK029-16..24):** returned >=400 now throws RouteReturnedError inside the tx (rollback), FAILED in own tx. Regression found: executeSlot still schedules route.afterCommit for the returned (rolled-back) result (probe P5 A1-A5) = **PR56-SEC-10 MEDIUM, C1**. 11 LOW: recordFailure skips FAILED when clientGone (I had concurred with R1-m4 in r1, revised). 12 INFO scan misses import-then-export; Y1-Y3 composition imports lint-clean. 13 INFO handler 403 no DENIED. Prisma 7.10 rethrows the callback error instance after awaiting rollback (read in runtime). Kit adds `p-r2.mjs` (real createApp + createWithTenantTx over a fake client, afterCommit queue, raw-socket disconnect), `p-mount.mjs`, `lintprobe-r2.mjs`.

**How to apply (round 3, after fix cycle 2):** re-run P5 A1-A5 (afterCommit absent after rollback, present for 201 and none-tx routes; A5 FAILED written if 11 taken), checker on new head. Earlier round-2 triggers: any push to the 33 owned paths voids the record. Re-run P1 (X1-X6 must be reported if 02 fixed), P2 (N1-N3 must write the entry), a mount-refusal test for 04, and the checker with `--root <worktree>`. Don't merge main again before squash (agent-memory stales lane-B evidence).

Related: [[project-p5-pr42-r3]], [[project-p5-pr42-audit-writer]], [[project-security-review-conventions]]

**Round 3 (2026-11-17, fc2 683a57d, D-TASK029-25/26):** run returns {result, committed}; afterCommit gated; FAILED skip only for the request own disconnect abort instance (abortable rejects with signal.reason, so a disconnect-aborted call matches; deadline is a different instance). P5 re-run A0-A10 (p-r3.mjs adds call route with 300 ms deadline, none-route 400/throw). INFO 14: transaction none route returning 400 still schedules afterCommit (D-TASK029-25 by design, JSDoc says otherwise). RouteReturnedError #result: no sentinel in inspect/JSON/String. Record b5f2d9f; checker pass @0ecd317. Merge-ready from security; any owned-path push voids.

**Round 4 (2026-11-17, merge 4e7f696 of main 0309d71 + e81d0c9):** merge-tree == commit tree; overlap tenant-db.ts(+test), execute-phases.test, start-api, eslint. PR #54 refusedRawStatement runs in taggedOnly BEFORE the statement starts, so SEC-17 tracking unaffected. P7 (p-store-guard.mjs): real writer+store through merged createTenantDb: 6 statement shapes pass (set_config(...,true) allowed), controls COMMIT / set_config false / SET refused. Since PR #55 the record step runs in the ci-gate job and the checker base is the NEW merge base (0309d71): main-side changes to PR-owned paths void older Head rows. Record 99f3025, checker pass @e81d0c9.
