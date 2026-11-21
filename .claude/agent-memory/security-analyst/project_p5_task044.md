---
name: project-p5-task044
description: TASK-044 (SSE convention) r1 @dc64193f PASS_W_COND (d04731f7, not pushed, PR-pending name); PR44-SEC-13 closed; MED 01 quadratic e-mail regex in privacy guard, LOW 02-05, INFO 06/07; C1-C3 + delta round owed; R1-M1 Cache-Control allow-list ruling
metadata:
  type: project
---

Round 1, 2026-11-21, pre-push. Record `docs/05-quality/security/PR-pending-TASK-044-security-review.md` + D-SECPR044-01 committed on main `d04731f7` (parent `74536b8e`, not pushed). Head row `dc64193f` (base `530629f4`), 11 owned paths (problem-handler{,.test}, platform/sse/* 8 files, tests/api/helpers/contract-validator.ts). Code twin `7ed51854` CHANGES_REQUESTED (R1-M1 cache header + 20 s deadline in production; R1-m1..m6) found most of it first; IDs aligned.

**Findings:** 01 MEDIUM CWE-1333 `EMAIL_VALUE=/[^\s@]+@[^\s@]+\.[^\s@]+/` quadratic, run before the 64 KiB cap (64 KiB 6-9 s, replay re-scans per open); fix `/[^\s@]@[^\s@]+\.[^\s@]/` proven equivalent (exhaustive 8-symbol alphabet to length 7, 2.4M strings, 0 diff). 02 LOW CWE-359 guard walks live object not wire (toJSON), keys never value-checked, key gaps (= R1-m2). 03 LOW CWE-248 `.then(end, onRejected)` misses throws in `end` -> unhandled rejection -> process-errors exit (= R1-m1). 04 LOW CWE-779 disconnect/deadline after headers = ERROR line + 17-line stderr (= R1-m5, execute.ts lock holder); optional: problem handler `res.destroy()` instead of `next()` after headers. 05 LOW CWE-770 T-47 stream caps unwired (TASK-041 `streamSlotRule`/`acquire`/`release` unused; TASK-173 card lacks cap line); rec acquire in pipeline step + `res.once('close', release)`. 06 INFO reader uncapped event data/rescan/retry Infinity. 07 INFO replay conditions for TASK-141/173 (per-stream sequence, bounded replay, RLS-keyed). Ruling: `send()` may keep handler Cache-Control only if token set is exactly `private, no-store` or `private, no-cache, no-store`.

**Conditions:** C1 (01+02) and C2 (03) fixed on this branch, C3 lane B green on fix head; delta round re-runs P2 D1/D2, P3, P1 S3. SEC-TC-84 proposed (next free was 84).

**Kit (session scratch `t044sec-r1/`):** `x/` head extract + `xb/` base extract with node_modules junctions; run `node --conditions=@platform/source --import tsx probes/<p>.mjs <root>` from the extract dir; `p1-app.mjs <appRoot> <sseRoot> <label>` (real createApp, stdout/console.error/unhandledRejection captured, PROBE_DEADLINE_MS, PROBE_ONLY=fast|deadline); `p2-pure.mjs`, `p3-regex.mjs`, `p4-accum.mjs`, `record-sim.mjs <sim> <main sha> <record>` (12 scenarios), `gl-nodigit.mjs`. Probe imports of joi need `createRequire(<root>/package.json)` (probe dir has no node_modules); fixture operationIds must be camelCase.

**How to apply:** fix-cycle push voids binding (sim C5) -> delta round; whichever of PR #80 (TASK-040 v2, also edits problem-handler.ts) and this PR merges second needs a merge-only round (C6) plus the R1-m4 unused `appError` lint edit. Orchestrator renames the record once the PR exists.

Related: [[project-p5-pr44-r2]], [[project-p5-task041]], [[project-p5-task040]], [[project-security-review-conventions]]
