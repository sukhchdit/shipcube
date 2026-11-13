---
name: project-p5-pr8-authz-review
description: PR #8 (TASK-013 authz catalogue, 17-role seed, escalation guard) R1+R2 2026-11-12 PASS_WITH_FOLLOW-UPS; PR8-SEC-01..14; pin bypass (PR8-SEC-13) unplanned; canAssignRole consumer conditions; checks owed in TASK-007/016/020/060/221/231/235
metadata:
  type: project
---

The PR #8 review (TASK-013) is in `docs/05-quality/security/PR-0008-TASK-013-security-review.md`. IDs are PR8-SEC-01..14.
- **R1** (head `efe23df`): PASS_WITH_FOLLOW-UPS, 5 LOW and 7 INFO.
- **R2** (head `498e3a5`, fix `6e70275`): PASS_WITH_FOLLOW-UPS.
  - Closed: 01 (the in-PR pin), 02, 03, 04 (D-058 conditions 1-5), 06 (the `ASSIGNABLE_BY` table is in `assign.ts`), 08(b)(c).
  - New: 13 LOW, 14 INFO.
  - D-058 seed delta verified as exactly +7 links and −0, 189 in total.

**Facts verified 2026-11-12:**
- `prisma migrate deploy` never re-applies an edited applied migration; a checksum mismatch is only an advisory warning.
- The runtime authz source is the DB (data-model §3.3). Verify the seed SQL by re-parsing it and mapping the IDs back via `seedId`.
- After D-058, Owner and Admin hold identical sets, so a subset rule cannot enforce "Owner only by Owner".
- **PR8-SEC-13: the seed pin is a tripwire, not a lock.** Editing the `SEED_MIGRATIONS` sha256 constant together with the seed passes every shipped check (the R2 P2 probe).
  - The real control is a base-ref check that `git diff --name-status base...HEAD -- prisma/migrations` shows only `A` entries, plus CODEOWNERS.
  - As of `cb69b04`, neither is in any task file (PR5-SEC-04 is also unplanned). Routed to the orchestrator for TASK-007's acceptance list.
- D-ORCH-011 routes PR8-SEC-05/06/07/10 only in DECISIONS.md, not in the task files. Only PR8-SEC-09 is in WAVE-08.md (TASK-221).

**Why:** TASK-013's guard is the T-107/AC-04 control. Its route-level, runtime and immutability halves land in later tasks and close only if those reviews check them.

**How to apply.** In these reviews, check:
- **TASK-007 or TASK-016 (PR8-SEC-13):** the base-ref migration-immutability check and CODEOWNERS for `packages/authz`, `tools/authz` and `prisma/migrations`. **Met at PR #10 `28442b6`** (A-only check runs before any head code). INFO residuals are the symlink mode and base-tip directories (PR10-SEC-10, before M5).
- **TASK-020 (merge condition, PR8-SEC-05): MET at PR #32 `fa67aca`** (PR-0032 §6). (c) is one-directional plus "signature route ⇒ signature-only or `public`" (D-TASK020-03, confirmed with C2 = authz requires an authenticated principal on non-anonymous routes). Original bullets:
  - selfService ⇒ `user` tenancy;
  - `operator-cross-tenant` ⇔ operator-only permission;
  - signatureOnly ⇔ signature auth;
  - no mock webhook route in production.
- **TASK-231/235 (PR8-SEC-06 consumer conditions):**
  - `canAssignRole` must pass for every role the target holds and every role in the new set;
  - the assigner's roles come from the ACTIVE membership in the target org;
  - it is in addition to `org:member:*` and step-up, not instead;
  - self-change and LAST_OWNER stay separate checks.
- **TASK-016:**
  - the 3 GLOBAL tables in the C1 allow-list and the grant manifest (SELECT only);
  - PR8-SEC-14: a key-based predicate plus a planted-row control in the backstop port.
- **TASK-060:** the effective-permission SQL filters role scope against the org type, ACTIVE membership, and `revoked_at IS NULL`.
- **TASK-037:** the `trg_membership_roles__scope_matches_org` trigger.
- **TASK-221:** the v1 baseline CONFIG_CHANGE comes from a post-migrate reconciler. If TASK-221 is cut, note it at G3.
- **First CATALOGUE_VERSION bump (delta renderer):** revocations render as DELETE with `data-changing: yes`, and down.sql reverts only the delta.
- **REQ-ACCT-016 export task:** the personal-org export contains no rows of other orgs (PR8-SEC-12).

Related: [[project-p5-wave0-db-baseline]], [[project-p3-security-conditions]], [[project-security-review-conventions]]
