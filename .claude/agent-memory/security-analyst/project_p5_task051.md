---
name: project-p5-task051
description: TASK-051 (guest-capable guard, guest binding/claim, C16 amended, operator staff grants) r1 @203d02eb PASS_W_COND (5749097f); r2 delta+supersede @39cac6e5 PASS_W_COND (a385cc9c, D-SECPR051-02); 01/02a/03 closed; new INFO 06 to TASK-298; O7 joins SEC-TC-79; owed lane B, rename, hosted job
metadata:
  type: project
---

**Round 1**, 2026-11-21, pre-push, head `203d02eb`. Record `docs/05-quality/security/PR-pending-TASK-051-security-review.md` + D-SECPR051-01, main `5749097f`. LOW 01 (C16 (b) NND / `WITH <>`), 02 (SEC-TC-07 cross-org only), 03 latent (grant on INSERT only); INFO 04 (trigger order, template pin), 05 (staff list readable). SEC-TC-79..81 proposed. gitleaks-full extra `b34f954e:…tenant-keys.ts:generic-api-key:75` = false positive (no digit check in v8.30.1).

**Round 2**, 2026-11-21: delta `203d02eb..a79facce` plus the supersede on `feat/TASK-051-guest-capable-tables-atomic-claim-v2` (`c1c8a6ec` squash on `530629f4`, `39cac6e5` titles only). Appended to the same pending record, D-SECPR051-02, main `a385cc9c` (unpushed). 21 owned paths (template added).
- **Closed:** 01 (B1/B2 enforced, the exclusion half too), 02 (a) (same-org rounds + predicate control), 03 (UPDATE clause = rulings §3.4 = my proposal; O7), the pin half of 04, L-2 (gitleaks).
- **Open, routed:** 02 (b) on TASK-146; 04 on TASK-087 (OWNER COLUMN ASSIGNER); 05 on TASK-089 (STAFF GRANT READS).
- **New: 06 INFO.** The T2-O entry column is parsed from the joined `rest` text (`child=parent,…`), so a quoted `"a=x"` column plus a CHECK on `a` hides the key, and a guest row naming org A's parent is accepted. Fix on TASK-298: return the pairs as an array (entry check and sibling compare) and plant `c16_g_eq`.
- **O7 joins SEC-TC-79.** The O7 title tag is a follow-up before G3, not a merge condition. Adding it in the PR voids the binding (simulated).
- **Concurred:** D-ARCH-216 (TASK-298 plants are tagged SEC-TC-76) and D-ARCH-215 arm (d).
- **Merge conditions:** C4 lane B green at `39cac6e5` (gitleaks-full included; the `c1c8a6ec` run was VOID); C7 rename for the v2 PR and the merge-ref check; C8 the hosted security-integration job. C5 stays in force for later changes.

**Facts:**
- The PG 18 parent-side RESTRICT answers `23001`; the child-side check stays `23503`.
- `app_guest_token_hash()` returns NULL unless the value is `^[0-9a-f]{64}$`.
- The lifecycle trigger is `AFTER INSERT OR UPDATE OF user_id, org_id, status`. `user_id` and `org_id` are immutable.
- `ACTIVE → ACTIVE` without a grant is ok: the stated D-ARCH-214 residual, bound on M2.
- An ON CONFLICT probe needs `created_by` = the actor, otherwise the std guard answers first.

**Why:** TASK-089 depends on the operator half. TASK-087 uses C16 as its gate. TASK-298 carries C16 arms (c)/(d) and 06.

**How to apply:**
- After the rename, check the merge ref and the lane B on `39cac6e5`.
- Any owned-path change (the O7 tag included), or a union merge on `grants.manifest` / `grants-manifest.test.ts` / `tenant-db.real-client.test.ts`, needs a new round (merge-only for a union).
- At TASK-298: check 06 fixed, `conenforced` (PG 18 only) and the SEC-TC-76 tags.
- Before G3: the threat-model SEC-TC-79/80/81 rows and T-35 (mine).

**Kit** (session scratch `t051/probes/` for setup, hooks and gl-nodigit; `t051sec2/` for round 2: `p8-c16.mjs` behaviour-vs-classification with the old rules as control, `p9-operator.mjs`, `p10-claim.mjs`, `sim2.mjs` 14 scenarios, `norm.cjs` titles-only compare).

Related: [[project-p5-pr65-task037]], [[project-p5-pr43-task024-rls-generator]], [[project-p5-wave0-rls-spike]], [[project-security-review-conventions]], [[project-p5-task040]]
