---
name: project-p5-task079
description: TASK-079 Mock carrier r1 @7815e1c8 PASS_W_F-U (d6344f6a, D-SECPR079-01); LOW 01 barrel scan stops at mock entry, LOW 02 latency ignores deadline; INFO 03-05; TASK-097/135/092 checks
metadata:
  type: project
---

TASK-079 (deterministic Mock carrier, `packages/carriers/src/adapters/mock/**`), pre-push round 1 at `7815e1c8` on `f9cc7ca1`.
- Record `docs/05-quality/security/PR-pending-TASK-079-security-review.md` on main `d6344f6a` with D-SECPR079-01. Sim 6/6 (merge-ref form, `--pr 9999`).
- Only owned path: `tools/lint/carrier-wire-boundary.test.ts` (D-TASK079-01: the barrel scan allows exactly `./adapters/mock/index.js`). `security_paths=false`.
- Code twin `docs/05-quality/reviews/PR-pending-TASK-079-code-review.md` APPROVED_WITH_NITS. Its m1/m3/n1/n2/SF-1..4 map onto my 03/02/01/05.

Findings:
- **01 LOW** (= n1). The scan never reads the Mock entry. A `wire` re-export inside `adapters/mock/` (value or type) passes it; the only other guard is the unowned key pin in `mock.units.test.ts`. The fix is a transitive relative-import walk from the barrel; the code is in the record. The walk also closes the pre-existing gaps: double quotes, `import()`, and a hop through a non-adapter module. Due: before TASK-135 (the first wire module).
- **02 LOW** (= m3). The latency sleep ignores `ctx.deadlineAt` and cannot be aborted. The fix is a `nowMs` seam, a cap at the deadline, and `TIMEOUT` (canonical code `TIMEOUT`, not `CARRIER_TIMEOUT`). TASK-097: sandbox-only directives, and the `MOCK:` source in local/test only. Owners: TASK-083/132.
- **03 INFO.** `maxCallRecords` set to NaN, Infinity or a non-number string makes the ring unbounded.
- **04 INFO.** A logger that throws in `finally` replaces the outcome (real adapters copy the wrapper).
- **05 INFO.** The Mock serves production-environment contexts.

**Why:** the Mock is the template that the DHL, FedEx and UPS adapters copy, and TASK-097 wires the untrusted directive sources.

**How to apply:**
- **TASK-097 round:** check 01 (if it lands there), 02 (cap and gating) and 05 (refuse production).
- **TASK-135/139/140:** the walk must be in place, and the logger try/catch must be in the copied wrapper.
- **TASK-092:** records are matched by `correlationId`.
- **Probe kit** (scratch `t079sec/probes`, session-scoped):
  - `hooks.mjs`: `EXTRACT` env, `@platform/*` mapped to the extract, bare packages resolved from main;
  - `p1-net-pii` (wide network traps installed before import, 11 sentinels);
  - `p2-labels` (80k xorshift labels, PDF/ZPL structure checks);
  - `p3-latency`, `p4-records`;
  - `p5-barrel` (the owned scan versus a candidate walk, mutants M1-M8);
  - `record-sim.sh` (plumbing merge-ref sim with 4 controls).
- **Sniffer fact:** isZpl accepts a stray non-magic lead byte by design; isPdf refuses it.

Related: [[project-p5-task075]], [[project-p5-task076]], [[project-security-review-conventions]]
