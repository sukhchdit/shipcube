---
name: project-p5-pr52-pr53
description: PR #52 (TASK-285 audit actions v2) R1 @a718dcd PASS_W_F-U with rule-12 approval of 91 blob 9945c349; PR52-SEC-01 LOW shadow-init KEEP bypass; PR #53 (W0-FLAKE) R1 @8a48139 PASS_W_COND (C1 PR53-SEC-04 PR30-SEC-01 magnitude pin lost); timing-bound and heartbeat facts; round-2 triggers
metadata:
  type: project
---

Both records written 2026-11-15, uncommitted, LF, in the PR worktrees (`Shipqube-TASK-285`, `Shipqube-FLAKE`). Code twins on main `cb96be4`: #52 APPROVED_WITH_NITS, #53 CHANGES_REQUESTED (R1-M1 readiness, R1-M2 S3 magnitude). Routing D-ORCH-099.

**PR #52** `PR-0052-TASK-285-security-review.md`, head `a718dcd`, 10 owned paths. **Rule-12 approval: `prisma/bootstrap/91-audit-actions-v2.sql` blob `9945c349e2334c60b1b2238d438ad8827b2a7b22`** (10 `c3d4db9`, 90 `9aab9aa` unchanged). D-SEC-PR52-01 proposed.
- PR52-SEC-01 LOW: KEEP regex `(?:(?!\) ?, ?[a-z])[^;])*\)$` keeps `CHECK (…) NOT VALID|NO INHERIT|NOT ENFORCED, <any action> … (…)` and a same-name CHECK replacing a PK. Code review V6 probed attributes only as a tail and called it "narrow and safe". Fix validated: prefix regex + balanced-paren scan skipping `"…"` (12 cases, 0 mismatch). Due: this PR's fix cycle or before the next bootstrap-lane file.
- PR52-SEC-02 INFO = code R1-m1, routed to TASK-073 AC line by D-ORCH-099.
- Facts: 90 guard admits only `current_user = 'platform_audit_owner'` (line 55); partitions via LIKE + ATTACH get `conislocal=false`; runner sets session lock_timeout + 5 min statement timeout per file.

**PR #53** `PR-0053-W0-FLAKE-security-review.md`, head `8a48139`, 14 owned paths. PASS_WITH_CONDITIONS. D-SEC-PR53-01 proposed.
- C1 PR53-SEC-04 LOW: S3 deadline upper bounds `deadline+1 s` raw → `deadline+20 s` stall-corrected; `bounded()` ×10 mutant survives (code S1). **I first rated it "still detected" (fired vs hung) and missed magnitude; the code review caught it.** C2 delta round.
- INFO 01 timeOperation (= R1-m1), 02 worker slowloris bounds untested (= R1-n2), 03 fetchOnce ignores signal/redirect, chunked body (= R1-n1).
- Seed `createClient` seam accepted (entry passes nothing; assertPinnedSession still runs). runNode 300 s accepted.

**Facts:** on this Windows host `setInterval(20)` fires every ~31.6 ms, so a same-thread heartbeat books ~36 % of an idle wait as stall and subtracts the operation's own sync blocking (1,500 ms reads as 20 ms). A worker_threads heartbeat with threshold 100 ms + SharedArrayBuffer `Atomics.add` reads both correctly (probe). `monitorEventLoopDelay` has the same blind spot as a same-thread heartbeat.

**How to apply (round 2 triggers):** any push to an owned path voids either record. #52: if PR52-SEC-01 is fixed in-PR, re-confirm the 91 blob unchanged plus the new fixtures. #53: re-run S1 (×10) and ×2 mutants on the fixed head, re-check seed seam and process.ts blobs, fresh evidence, record sim. Do not merge main into either (agent-memory stales lane-B evidence). Generic sim: scratch `review/PR-52-53-sec/sim2.mjs` (session-scoped; PR config table, S0-S8).

Related: [[project-p5-pr24-audit-store]], [[project-p5-pr30-s3-adapter]], [[project-p5-pr20-logging]], [[project-security-review-conventions]]
