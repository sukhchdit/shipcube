---
name: project-p5-task080
description: TASK-080 margin pricing + pricing_config_versions r1 @4a0faee3 PASS_W_COND (main 91a05546, D-SECPR080-01); LOW 01 pricing-purity unprotected, INFO 02-04, 05 C9 lane-B red; delta round owed
metadata:
  type: project
---

TASK-080 (US-140 margin step, SAMPLE_PRICING_CONFIG, `pricing_config_versions` GLOBAL table + insert-only seed, PR076-SEC-07 edits 2/4, CarrierMoney = Money, vocab move to shared root), pre-push round 1 at `4a0faee3` on `e245e6e6`.
- Record `docs/05-quality/security/PR-pending-TASK-080-security-review.md` committed on main `91a05546` (local main, not pushed; it sat on 4 unpushed docs commits incl. code twin `222fdf54`). Sim 8/8 with main's checker.
- 17 owned paths; classifier `security_paths=true` (11). Code twin R1 CHANGES_REQUESTED: R1-M1 `ADMIN` source value vs data-model §1.7 (`OPERATOR`) changes the migration.

Findings:
- **01 LOW.** `platform/pricing-purity` is not in `PROTECTED_RULES` (`tools/lint/check-suppressions.mjs:25-42`). An inline disable with a TASK id passes; the `money-arith` control is refused. Pre-existing since TASK-076. Fix: one line plus a test row.
- **02 INFO** (extends R1-m3). Shadowing that edit 4 misses:
  - `declare const { Date }` and `import type { Money as Date }`: TS accepts both, and lint is clean;
  - a type-only `namespace Date {}`: held only by the unprotected `no-namespace`.
  - Validated fix: refuse any binding named like a watched global (scopeManager walk).
- **03 INFO** (= R1-m1). Template-literal `import()` skips every `checkSource` arm. Fix: `staticSpecifier` from `module-sources.mjs`.
- **04 INFO** (= R1-n7). The AFTER row trigger has no TRUNCATE arm. A statement-level guard was validated (a separate function, because OLD is NULL in statement triggers).
- **05 INFO, merge-relevant.** Catalog C9 will fail: `ck_pricing_config_versions__source` is not in `ENUM_CHECKS`. A 1-value IN list deparses to `=`, so `ck_job_executions__status` escapes C9; 2 or more values deparse to `= ANY`.

**Conditions:**
- C1: the C9 entry.
- C2: lane B on PG 18, with the list in record §7 (including the organisations reseed).
- C3: a delta round. R1-M1 and C1 change owned paths, and TASK-043/051 union merges need a merge-only round.
- C4: rename the record.

**Why:** pricing determinism and config immutability feed quotes, booked snapshots and audit. This is the first audited reference dataset, so durable CONFIG_CHANGE is TASK-221's.

**How to apply:**
- **Delta round:** check the C9 entry against the shipped source list, the R1-M1 CHECK, and whether 01-04 were taken (re-run the 11 bypass cases and 25 fixtures).
- **Card checks:**
  - TASK-221: covers `pricing_config_versions`.
  - TASK-083/101: explanation entries (rule key, rate) are operator-side.
  - M2 admin: `notes` stays non-personal.
  - US-152: TRUNCATE guard if not taken; canonical hash (R1-m2).
- **Kit** (session-scoped, deleted):
  - `lintprobe.mjs`, `matrix.mjs` + `swap.mjs` (patch, run, restore, `cmp`);
  - `tscprobe.mjs` (`ts.createProgram` with the pricing tsconfig, emit);
  - `sqlprobe.mjs` (PGlite with roles, `SET ROLE`, a `uuidv7()` stub, the PR's own seed renderers);
  - `record-sim.mjs` (plumbing merge-ref, 8 scenarios).

Related: [[project-p5-task076]], [[project-p5-task079]], [[project-security-review-conventions]]
