---
name: project-p5-pr8-authz-review
description: PR #8 (TASK-013 authz catalogue, 17-role seed, escalation guard) R1 2026-11-12 PASS_WITH_FOLLOW-UPS; PR8-SEC-01..12; D-058 landed after head; verified facts (migrate deploy, rule-10 upsert gap); checks owed in TASK-016/020/037/060/219/221/231/235
metadata:
  type: project
---

The PR #8 review (TASK-013) is in `docs/05-quality/security/PR-0008-TASK-013-security-review.md`. IDs are PR8-SEC-01..12.
- **R1** (head `efe23df`, 2026-11-12): PASS_WITH_FOLLOW-UPS. 5 LOW, 7 INFO. Merge allowed on security grounds.
- **D-058** (product-manager, main `2e8e1f4`) landed AFTER the head. The fix cycle must regenerate the v1 seed.
  - Self-service set on all 17 roles.
  - Finance gains `order:read`; Admin gains `privacy:delete`.
- **R2 must verify the PR8-SEC-04 conditions 1-5:**
  - the `selfService` flag is bound to the exact constant set, never operatorOnly, reserved or signatureOnly, and its category is session or notification;
  - the Viewer/Auditor carve-out is by flag only;
  - `VIEWER_FORBIDDEN` includes `privacy:delete`;
  - the `SELF_SERVICE_MISSING` invariant exists.
- **R2 should also check, if adopted in the fix cycle:**
  - PR8-SEC-01: the released seed version is SHA-256-pinned in `tools/authz/generate.ts`.
  - PR8-SEC-02: the classifier checks any segment for `any_org`; the audit category matches the resource; signatureOnly ⇔ `webhook:*`; the role key prefix equals the scope.

**Facts verified 2026-11-12:**
- `prisma migrate deploy` never re-applies an edited applied migration. A checksum mismatch is only an advisory warning (Prisma docs). So a migration regenerated in place silently diverges every existing DB.
- **Linter rule 10 gap** (TASK-003 code, `DATA_CHANGING`). `INSERT … ON CONFLICT … DO UPDATE` is NOT flagged with `data-changing: no`; only `UPDATE`, `DELETE`, `TRUNCATE`, `INSERT…SELECT`, `MERGE` and `WITH` forms are.
- **The runtime authz source is the DB** (data-model §3.3 effective-permission query), not `ROLES` in code. Verify seed SQL by re-parsing it and mapping IDs back via `seedId`.
- **After D-058, CUSTOMER_OWNER and CUSTOMER_ADMIN hold identical sets.** A subset ("grant only held") rule cannot enforce REQ-ORG-010 "Owner only by Owner" or AC-05. An explicit `ASSIGNABLE_BY` rank is needed.
- **Accepted ruling:** a generated seed of plain `INSERT … VALUES` new rows is `data-changing: no`. `DELETE` or an upsert makes it `yes` (proposed D-SEC-PR8-01).

**Why:** TASK-013's guard is the T-107/AC-04 control. Its route-level and runtime halves land in later tasks and close only if those reviews check them.

**How to apply.** In these reviews, check:
- **TASK-020** (merge condition PR8-SEC-05): a route-binding check.
  - selfService ⇒ `user` tenancy.
  - `operator-cross-tenant` ⇔ operator-only permission, including `:any_org`.
  - signatureOnly ⇔ signature auth.
  - No `webhook:mock_gateway:receive` route in production.
- **TASK-016:**
  - the rule-10 upsert pattern and fixture, unless the PR fixed it;
  - a migration-immutability check (dirs on the base are byte-identical);
  - the 3 GLOBAL tables in the C1 allow-list and the grant manifest (SELECT only).
- **TASK-028:** classify the authz columns (INT; description and name_key are PUB).
- **TASK-037:** the `trg_membership_roles__scope_matches_org` trigger.
- **TASK-060:** the effective-permission SQL filters role scope against the org type, ACTIVE membership, and `revoked_at IS NULL`.
- **TASK-231/235:** an `ASSIGNABLE_BY` rank table and the AC-05 tests.
- **TASK-221:** the v1 baseline CONFIG_CHANGE back-fill, via a post-migrate reconciler and not a migration INSERT. If TASK-221 is cut, note it at G3.
- **TASK-219:** the T-109 registry rule.
- **REQ-ACCT-016 export task:** the personal-org export contains no rows of other orgs (PR8-SEC-12).

Related: [[project-p5-wave0-db-baseline]], [[project-p3-security-conditions]], [[project-security-review-conventions]]
