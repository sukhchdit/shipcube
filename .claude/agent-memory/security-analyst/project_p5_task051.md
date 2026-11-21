---
name: project-p5-task051
description: TASK-051 (guest-capable guard, guest binding/claim, C16 amended, operator staff grants) r1 @203d02eb PASS_W_COND (main 5749097f, unpushed, D-SECPR051-01); LOW 01-03, INFO 04/05; SEC-TC-79..81 proposed; PR65-SEC-02 (b) closed; gitleaks false positive + v2 supersede; delta + supersede rounds owed
metadata:
  type: project
---

Round 1, 2026-11-21, pre-push. Record `docs/05-quality/security/PR-pending-TASK-051-security-review.md` and D-SECPR051-01 are committed on local main as `5749097f` (not pushed; the PR is not open yet, so the record must be renamed later). The Head row is `203d02eb`. 20 owned paths. Code twin: CHANGES_REQUESTED (`fa98e4c5`/`b1efe502`). Lane B `20261121T0336Z_203d02e` FAIL: C2/C6 give `23001` on PG 18 (architect), plus one gitleaks-full extra.

**Findings:**
- **01 LOW (= R1-M1).** C16 (b) `has_owner` passes a `NULLS NOT DISTINCT` owner column and `EXCLUDE (org_id WITH <>)`. `btree_gist` is installed, and the exclusion shape also works on TENANT tables. My position: enforce both halves; a "stated limit" only with a "no exclusion constraint in scope" assertion.
- **02 LOW.** The SEC-TC-07 race pairs two organisations, so RLS alone stops the loser and a mutant without `AND org_id IS NULL` passes. Fix: a same-org round now; TASK-146 makes SEC-TC-07 run the repository statement.
- **03 LOW latent.** The grant is checked on INSERT only, so SUSPENDED→ACTIVE of an operator membership needs no grant. Architect: fold now, or at M2 grant removal.
- **04 INFO.** The de-claim trigger is the only control for a childless quote and for a child moved under the guest quote. A later-sorting BEFORE trigger that assigns owner columns bypasses it (TASK-087 catalog row).
- **05 INFO.** The staff list is readable via TenantDb (TASK-089 repository test).

**SEC-TC proposals.** 79 operator grant O1-O6, 80 guest binding/claim (`guest-claim.int`), both for `integration.required_cases`; 81 route-side guest binding, pending, owners TASK-091/146. The next free ID is 82.

**Facts:**
- Lane B: O1-O6, AT-US-080-01..07 and the 16 de-claim cases pass on 18.
- PG 18 parent-side RESTRICT answers `23001`; child-side stays `23503`.
- `app_guest_token_hash()` returns NULL unless the value is `^[0-9a-f]{64}$`.
- gitleaks-full extra = `b34f954e:prisma/tests/catalog/tenant-keys.ts:generic-api-key:75`, a doc comment ``key columns, `child=parent` ``. False positive; D-ORCH-147 route: reword plus v2 squash supersede, baseline unchanged.

**Why:** TASK-089 depends on the operator half; TASK-087 uses C16 as its gate; the supersede changes the head.

**How to apply:**
- **Delta round on the fix head.** Check 01 fixed with planted shapes; 02 (a) same-org round; the R1-m2 pin; SEC-TC tags; C2/C6 changed only with the architect's amendment; the reword passes the no-digit gitleaks emulator.
- **Then a supersede round on the v2 head.** Prove tree equality, and use a record named for the v2 PR.
- **If the operator half is split off,** that PR needs its own record.

**Kit** (session scratch `t051/probes/`, may vanish):
- `setup.mjs`: PGlite bootstrap 00-02 + all migrations as the migrator, plus a pg-like adapter.
- `loadProbe`: patches the PR harness imports.
- `p2-guest`, `p2b-guard`, `p3-c16`, `p4-operator`, `p5-lint`.
- `sim.mjs`: 11 scenarios incl. a union merge.
- `gl-nodigit.mjs`: the faithful gitleaks emulator.

Related: [[project-p5-pr65-task037]], [[project-p5-pr43-task024-rls-generator]], [[project-p5-wave0-rls-spike]], [[project-security-review-conventions]]
