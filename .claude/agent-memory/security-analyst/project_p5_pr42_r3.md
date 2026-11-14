---
name: project-p5-pr42-r3
description: PR #42 (TASK-025) delta round 3 @96bd37a 2026-11-14 PASS_WITH_FOLLOW-UPS; 13 (as filed), 14, 16 closed; new MEDIUM 17 deferred-start write escapes settle (H2 fix probe-validated), LOW 19 voided write = process exit (= code R3-m1), INFO 18 lint gate env unpinned; SEC-TC-74 stays with qa-lead PR; round-4 triggers
metadata:
  type: project
---

Round 3 appended to `docs/05-quality/security/PR-0042-TASK-025-security-review.md` in worktree `Shipqube-TASK-025` (uncommitted, LF, 1264 lines; committed prefix unchanged). Head row `96bd37a…` (code `6e3ec99`), 61 owned paths (main's checker, base `d753027`: pass). Code twin r3 on main `1be9a74` = APPROVED_WITH_NITS (R3-m1 = my 19, R3-n1 fixture row, R3-n2 allow-list two-hop, R3-n3 = PR44-SEC-11 crash).

**Verdict PASS_WITH_FOLLOW-UPS.** Open: MED 01 (TASK-284), MED 17; LOW 04, 15, 19; INFO 08-11, 18.
- **17 MEDIUM:** `settle` only sees work registered before its last look; a write whose START is deferred (1+ microtask hops, after a detached statement, `void (async () => { await read; await write })()`, timer) is refused by `track` after revoke -> COMMIT WITHOUT ENTRY. Code review called it "inside D-TASK025-23 residual" (gap only); probe shows wider. Fix H2 = guard registers every started statement (`guardResult` first `then` -> inFlight) + settle loops until a `setImmediate` turn adds nothing: closes K1-K50/B1/B3, only timers left. Owner: this PR's next code cycle else TASK-029; TASK-047; TASK-033 backstop.
- **18 INFO:** `CI_REQUIRED_GATES` lint entry has no `env` pin: `NODE_OPTIONS: ${{ github.event.pull_request.title }}` and `BASH_ENV` beside it pass (PR17-SEC-08 class). Fix: exact env on lint gate, same value on every lint step (#46 lane-c.yml), refuse `${{` in NODE_OPTIONS. devops 015-C.
- **19 LOW:** `write` async arrow returns a new promise; voided failing write = unhandledRejection -> `process-errors.ts:88` exit(1).

**Facts:** Node 24.22.3 refuses `--env-file`, `--env-file-if-exists`, `--experimental-config-file`, `--experimental-default-config-file` in NODE_OPTIONS (accepts `--conditions`). Prisma 7.10.1 `_transactionWithCallback` awaits the callback past the itx timeout; the TransactionManager rolls back and a late COMMIT throws. PR #46 (`ad30316`) and #39 (`c85d5e5`) add the IDENTICAL lint heap line; merge-tree conflict is comment-only. SEC-TC-74 home = qa-lead manifest PR (D-SEC-PR47-01 (2)(b), #47 merged first).

**How to apply (round 4 if R3-n1/R3-m1/H2 land; any of them voids r3):** new capture fixture row + mutants; write's returned promise handled, no unhandledRejection on both paths; Probe B L8-R1 + M1-M4; K1/B1/B3 with H2; fresh evidence; record sim. Union with #46/#39/qa-lead manifest PR -> merge-only round (one heap line; manifest = its move + 2 audit names).

Related: [[project-p5-pr42-r2]], [[project-p5-pr42-audit-writer]], [[project-p5-pr47-rls-activation]], [[project-p5-pr46-015b-lane-c]], [[project-p5-pr17-fixture-subset]], [[project-security-review-conventions]]
