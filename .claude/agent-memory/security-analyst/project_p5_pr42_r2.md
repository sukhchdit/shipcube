---
name: project-p5-pr42-r2
description: PR #42 (TASK-025) delta round 2 @d2ef478 2026-11-14 PASS_WITH_FOLLOW-UPS; 02/03/05/06/07/12 closed; new 13 MEDIUM detached write, 14 INFO pin stripper, 15 LOW steerable 500s, 16 LOW writer via platform/audit (= code R2-M1); round 3 owed; union facts #43/#44/#45
metadata:
  type: project
---

Round 2 appended to `docs/05-quality/security/PR-0042-TASK-025-security-review.md` in worktree `Shipqube-TASK-025` (uncommitted, LF, 856 lines; prefix byte-identical to the committed round 1). Head row `d2ef478…`, 44 owned paths (checker, base `162a132`).

**Verdict PASS_WITH_FOLLOW-UPS.** Closed vs `e7dfbac` control: 02 (latch: L1–L7 rollback 500/503, r1 committed), 03 (13 bypass forms SAFE), 05 (named forms), 06, 07, 12. Open: 01 MED (TASK-284), 04 LOW narrowed (JSON keys → TASK-028 accepted with an e-mail-key test), 08–11 INFO.
- **13 MEDIUM** detached write (`void w.write()` / `.catch()` without await, lint-clean) commits without entry, deterministic even without PII (2nd statement hits TENANT_TX_CLOSED). Fix: `TenantDbLatch.track` + `handle.settle()` before the latch check. Fix cycle 2 or before TASK-029; TASK-047 port.
- **14 INFO** (= code R2-n2) pin `stripComments` regex hides a setter between `'/*'`…`'*/'` literals or on a `//`-led template line. Repo-wide: `UPDATE pg_settings … name = ${k}` and DO-block concatenated setters are lint-invisible → noted for PR44-SEC-05 / 020-D.
- **15 LOW** (⊇ R2-m1) colliding normalised keys refused → 500; `uaParsed`/`entityId` unvalidated → 500; jsonb rejects lone-surrogate escapes (reasoning) → TASK-029 AC 400 for NUL + lone surrogates.
- **16 LOW** (= code R2-M1) `apps/api/src/platform/audit/writer.ts` importable by any api module (7/7 shapes clean). Fix in cycle 2.

**Facts:** code review r2 on main `f26c335` = CHANGES_REQUESTED (R2-M1) → fix cycle 2 voids round 2 → round 3 delta. main gained PR #43 (`cc2a57d`: eslint.config.mjs + negative-fixtures.test.ts overlap) → any main merge voids; #45 files alone don't (but evidence goes stale, 3 paths). #42+#44 (`443c2f1`) union conflicts in negative-fixtures.test.ts only. The integration skip is SPK-03 (d) benchmark (`SPK03_BENCH=1`), not SEC-TC-43 (PR body and my r1 header wrong). D-TASK025-21 names exact; S1 rename: base verifier accepts, head rejects (2 reasons).

**Kit** (session scratch `review/PR-42-sec-r2/probes/`): `p2-entry-r2.mjs` (31 TOCTOU cases), `p-latch.mjs`/`p-latch-d.mjs` (20 latch cases, real withTenantTx over recording fake client), `lintprobe-r2.mjs` (B/W/T/E/K + head pin emulation), `lint-r2m1.mjs`, `lint-repo.mjs`, `p-wf.mjs`, `scen-ev.mjs` (gate-name scenarios), `record-sim.mjs` (S0–S9 incl. unions and evidence staleness), `hostscan-file2.mjs`. Importing `check-security-owned-paths.mjs` runs its CLI too (stderr noise, exports still work).

**How to apply (round 3):** re-run lint-r2m1 V0–V9 + new fixture spellings, lintprobe-r2 W/B, Q1/Q2 if 13/14/R2-n1 ride the cycle (L8/L8c/L8d must not commit without entry), fresh evidence, record-sim with the then-main; if main merged, §7 items 1–5 + #43 eslint lines.

Related: [[project-p5-pr42-audit-writer]], [[project-p5-pr44-020c]], [[project-p5-pr40-covhook]], [[project-security-review-conventions]]
