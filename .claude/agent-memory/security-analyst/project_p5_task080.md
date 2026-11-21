---
name: project-p5-task080
description: TASK-080 margin pricing + pricing_config_versions; r1 @4a0faee3, r2 delta @3d3a7775 PASS_W_COND (main f44c4aed, D-SECPR080-02); 01-05 closed, new INFO 06 import=require/computed import(); C2 lane B, C4 rename open
metadata:
  type: project
---

TASK-080 (US-140 margin step, SAMPLE_PRICING_CONFIG, `pricing_config_versions` GLOBAL table + insert-only seed, PR076-SEC-07 edits 2/4, CarrierMoney = Money, vocab move to shared root). Base `e245e6e6`.
- Round 1 at `4a0faee3`: record `docs/05-quality/security/PR-pending-TASK-080-security-review.md` on main `91a05546`. Lane B at `4a0faee3` failed only on C9, which 05 predicted (D-ORCH-147).
- **Round 2 (delta, C3) at `3d3a7775`:** appended to the same file, committed on local main `f44c4aed` (not pushed) with D-SECPR080-02. Owned paths: 27 (`--base 965a5a34`). Classifier: 12. Sim 10/10 with main's checker. Code twin R2 (`965a5a34`): APPROVED_WITH_NITS.

Findings:
- **01-05 closed** in round 2. Fixes: pricing-purity added to `PROTECTED_RULES`; a by-name binding pass in `Program:exit`; `staticSpecifier`; a BEFORE TRUNCATE statement trigger; C9 `['OPERATOR','SAMPLE','SEED']`. 05's PG 18 proof is C2.
- **06 INFO (new, pre-existing since TASK-076).** pricing-purity has no `TSImportEqualsDeclaration` visitor and skips non-static `import()` specifiers.
  - `import q = require('@platform/shared/queues')` is accepted by TS 6 under the pricing options and emitted via `createRequire`. Only the unprotected `no-require-imports` reports it.
  - `import('…' + '…')` and `import('…' as string)` are held only by the unprotected `static-module-specifier`.
  - An inline disable of either rule plus a TASK id makes it lint-clean, and the suppression checker accepts it.
  - Validated 8-line patch: report a computed `import()`, and `checkSource` the import-equals reference. Route: the next `pricing-purity.mjs` change, before US-141.
- Erratum written into round 2: `platform_app` HAS `USAGE` on `platform` (bootstrap 01). A function call is refused by the EXECUTE default privileges (42501). The owner gets 0A000 on a direct trigger-function call.

**Conditions now:**
- C2: lane B on PG 18 at the final head (§7, plus the TRUNCATE case and C11 on the new function).
- C4: rename the record.
- C3 stands for any later owned-path change, which needs a delta round; the 06 fix would trigger one. It also stands for a TASK-043/051 union merge, which needs a merge-only round.

**Why:** pricing determinism and config immutability feed quotes, booked snapshots and audit. This is the first audited reference dataset, so durable CONFIG_CHANGE is TASK-221's.

**How to apply:**
- **Merge-only or next delta round:**
  - re-run the 49-case matrix (13 round-1 bypasses, 30 N-cases) and the 31 fixtures;
  - if 06 was taken, check the two new fixtures;
  - re-simulate with the record renamed.
- **Card checks:**
  - TASK-221: covers `pricing_config_versions`.
  - TASK-083/101: explanation entries are operator-side.
  - M2 admin: `notes` stays non-personal.
  - US-152: canonicalJson = RFC 8785 only for well-formed strings. Lone surrogates are escaped, not refused, and a cycle gives RangeError.
- **Probe facts:**
  - After running bootstrap `01-schemas.sql` in a PGlite session, issue `RESET search_path`. The file does `SET search_path = pg_catalog, pg_temp`, and unqualified `uuidv7()` then fails with 42883.
  - In `run()`, issue `ROLLBACK` on error, or one failed `BEGIN…` aborts every later probe (25P02).
  - The `canonicalize` package (RFC 8785) throws on lone surrogates, so wrap the differential.
- **Kit** (session-scoped): `t080r2/probes/` holds `mknm.mjs`, `matrix.mjs`, `tscprobe.mjs`, `patch-sec06.mjs`, `sqlprobe.mjs`, `mig-mutants.mjs`, `hooks.mjs`, `p-money-cj.mjs`, `record-sim.mjs`, `commit.mjs` and `gl-nodigit.mjs`.

Related: [[project-p5-task076]], [[project-p5-task079]], [[project-security-review-conventions]]
