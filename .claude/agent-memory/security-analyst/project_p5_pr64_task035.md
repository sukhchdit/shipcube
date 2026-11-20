---
name: project-p5-pr64-task035
description: PR #64 (TASK-035 BullMQ queues, DLQ, payload v2) security r1 @90ef83f PASS_W_COND (55fdc1c); r2 @266abb6 PASS_W_F-U, C1 discharged (record + D-SEC-PR64-02 on main); 01/02/03/05 closed, 08 partly; new INFO 12 pending gauges before first ready, 13 factory scan reach (TASK-043 cond); BullMQ/ioredis facts; probe kit
metadata:
  type: project
---

Record `docs/05-quality/security/PR-0064-TASK-035-security-review.md`, on **main** (worktree reserved for lane B, like PR #63). Round 1 at `90ef83f` (`55fdc1c`, D-SEC-PR64-01); round 2 appended on main 2026-11-18 with D-SEC-PR64-02 (`0f393f3`, pushed; main was `b651bea` after PR #67 merged as `591d0f5`).

**Round 2** (fix `266abb6`, amended locally from never-pushed `7ca95f4`; evidence-only tip `4eab6c2`; Head row = `266abb6` full SHA, evidence after it passes the checker):
- 01 MEDIUM C1 **closed / discharged**: `openQueue` factory with class-only listener. P2r2 leak probe: head 0 copies, r1 112, M1 (no factory listener) 113, M3 (no Worker listener) 12.
- 02 MEDIUM **closed**: `persistedFailure` (reason code only), `updateData(redactValue)` on PAYLOAD_INVALID, `stackTraceLimit: 0`. Residual by design: free text under unrecognised keys survives in the record and the stored refused payload.
- 03 LOW **closed**: `queue` profile (2 s timeout, 1 retry, no offline queue) + 2 s `/metrics` deadline. P5: 503 at ~2.02 s in every outage shape; r1 no response in 6 s.
- 05 LOW **closed**: W3C `isTracestate`, 0 differences over 300k fuzz strings vs a char-level ABNF reading, linear.
- 08 **partly closed**: record id `<id>.dead.<attempts>`.
- New INFO 12: `metrics()` before the first `ready` never settles (~31 KB/scrape, 18 scripts each on recovery). Fix: single-flight. Owner: TASK-039.
- New INFO 13: test (b) is lexical (misses renamed/namespace import, subclass, `Reflect.construct`, a second `Worker`). This matches code review R2-n5. **TASK-043 condition:** every `queueFor` queue goes through `openQueue` with the `queue` profile.
- I agreed with D-ORCH-133 (rewriting never-pushed commits), on three conditions: backups stay local; check `branch -r --contains` before amending; rotate any real secret.

**Still open:** LOW 04 (architect/TASK-039) and 09 (CODEOWNERS; now also `open-queue.ts` and `job-handler.ts`). INFO 06 (`__proto__` still validates), 07, 10, 11.

**Watch:**
- Whichever of #58 (bullmq 6.7.2) and #64 merges second re-runs `open-queue.test.ts` (a) and the SEC-02 int case.
- Any later change on PR #64 to the worker queues, health, shared queues or the 6 owned paths needs a delta round, enforced by the orchestrator: the round-1 record alone passes the gate (sim F1).

**Facts (bullmq 6.7.0, ioredis 6.0.0):**
- BullMQ `client` getter = `initializing`. `waitUntilReady` resolves only on `ready` and rejects only on `end`, so with a never-giving-up retry strategy every Queue call pends until the first `ready`. `enableOfflineQueue: false` and `commandTimeout` only act after that.
- `Job.moveToFailed` persists `err.message` as `failedReason`. `updateStacktrace` empties `stacktrace` iff `opts.stackTraceLimit === 0`.
- `Worker.handleFailed` treats errors named `DelayedError`/`WaitingError`/`WaitingChildrenError` and the `RATE_LIMIT_ERROR` message specially. Sanitising turns them TRANSIENT (D-TASK035-10).
- ioredis 6 sends `HELLO 3 AUTH user pw`. A fake that answers `-ERR unknown command 'HELLO'` makes it downgrade to RESP2 and send `AUTH`. With `enableReadyCheck: false` it is `ready` right after; BullMQ then sends `INFO`, which needs a bulk reply with `redis_version:`.

**Kit** (session scratch `pr64r2/probes/`, session-scoped):
- `hooks.mjs` stubs `@platform/api/runtime` with options/log/readiness only.
- `p2-child.mjs`/`p2-run.mjs` leak probe.
- `p4-failedset.mjs`: the real `Job.prototype.moveToFailed` on `Object.create(Job.prototype)` with a capturing backend.
- `p5-failfast.mjs` (fake modes refuse/silent/closed/ready-silent/ready-drop, minimal RESP parser), `p6-pending.mjs`, `p7-tracestate.mjs`, `p8-scan.mjs`.
- `gl-generic.mjs` (full generic-api-key emulation), `gl-over.mjs`, `sim.mjs` (merge-ref record sim, 12 scenarios).

Related: [[project-p5-pr61-task028]], [[project-p5-pr20-logging]], [[project-p5-pr10-ci-lane]], [[project-p5-pr63-task036]], [[project-security-review-conventions]]
