---
name: project-p5-task076
description: TASK-076 pricing engine + lint; r1 @e01979b (2b8f51e) and r2 @82b5023 (c6bbed87, D-SECPR076-02) PASS_W_F-U; 01-05 and 08 (TS6 TypeFlags) closed; 07 INFO purity residuals and 06 open; TASK-080/085 checks
metadata:
  type: project
---

TASK-076 (pure pricing engine, Money/ratio/units in packages/shared, pricing-purity rule, type-aware money-arith, carriers deep-import pattern), pre-push round 1 at `e01979b` on base `5145d52`.
- Verdict PASS_WITH_FOLLOW-UPS. Record `docs/05-quality/security/PR-pending-TASK-076-security-review.md`, committed on main `2b8f51e` with D-SECPR076-01. Sim 10/10 with main's checker.
- 23 owned paths (eslint.config.mjs, tools/eslint-rules, tools/lint, tests/fixtures/lint). `security_paths=false` (no hosted security-integration).
- Code twin `f938174` APPROVED_WITH_NITS (R1-m1 purity reach, R1-m2 `+=` right side, R1-m3 re-validation). Its state.ts/engine.ts line numbers are multi-file offsets.

Findings:
- **01 LOW.** Purity misses: (a) `uuidv7` from the allow-listed `@platform/shared` root (only impure shared-root export); (b) production import of `src/tests/**` (rule ignores TEST_FILES, no boundaries policy); (c) respellings. Candidate (global-scope `through` pass + import refusals) validated: 31/36 probes, real sources clean.
- **02 LOW.** Helpers validate results not operands: `add(0.5,0.5)`=1, `sub('1050','1')`=1049, `compare('9','10')`=1. Engine safe via isMoney + sum-from-zero. Fix `operand()` validated (only 19 forged rows of 114 change).
- **03-06 INFO:** `'bps' in rate`/isMoney inherited props; messages interpolate before validation; effectMinor double read; carriers pattern lacks a boundaries any-spelling twin (import() held only by no-unresolved while exports = `.`).

Round 2 (C3) DONE 2026-11-20: appended to the same record on main `c6bbed87` with D-SECPR076-02, Head `82b5023` (fix cycle 2; bound to the branch tip because the coordinator's head message had not arrived). Sim 9/9.
- 01-05 closed (measured at `f6de957`, unchanged at `82b5023`). 06 open.
- **08 LOW** (= code twin R2-M1) found on `f6de957`, closed at `82b5023`. money-arith hard-coded TS 5 `TypeFlags`; in TS 6.0.3 those bits are Undefined|BigInt|Union|Intersection (StringLike = 12583968). Fix: checker `isTypeAssignableTo(string)`, not any, not Minor.
- **07 INFO.** Closed: string-named specifiers, navigator. Open: `@platform/shared/queues` `retryDelayMs` (default Math.random; boundaries admits `@platform/shared/**`) and `declare const Date/process/Math` shadowing. The new pin test is root-only and textual.
- Kit: `lintprobe2.mjs`, `typedprobe3/4.mjs`, `rt2-probe.mjs`, harness differential via `node tools/lint/lint-fixtures.mjs` on each extract, `record-sim2.sh` (multi-round record).
- Fact: the checker passes on ANY Head row naming a PR commit with no later owned change; the last Verdict row wins. So appending rounds to one record is fine.

**Why:** pricing determinism (AT-US-138-01/02) and money integrity feed payments/ledger; these helpers are exported to every app.

**How to apply:**
- Round 2 (C3): re-run the kit (scratch `t076/`, session-scoped: `effcfg.mjs` 58-path diff + mutation, `lintprobe.mjs` 40 cases, `typedprobe.mjs` real-brand money-arith, `rt-probe.mjs` 114 rows via `hooks.mjs`, `record-sim.sh`). Check the fixed rule dedupes reports and keeps `new Date(arg)` legal.
- TASK-080 (next pricing step): 01 must be closed by then. TASK-085 (payments): 02 closed first.
- Lesson: an allow-listed import is a bypass channel; grep what the allowed package exports.

Related: [[project-p5-task075]], [[project-security-review-conventions]]
