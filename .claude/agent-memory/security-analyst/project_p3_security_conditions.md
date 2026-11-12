---
name: project-p3-security-conditions
description: P3 security review state after G2-C3 closure (§16, 2026-11-12): no Crit/High/Medium open at design; G2-C3 closed; new LOW SEC-P3-34..36 + INFO 37 with task IDs; what to re-check at P5 reviews, G3 and G4-production
metadata:
  type: project
---

The P3 review lives in `docs/05-quality/security/P3-architecture-security-review.md`.
- **§14** (against d5cdfa2): remediation verification.
- **§16** (2026-11-12, against 59f8340): G2-C3 closure verification.

**State after §16.** PASS at design level, class APPROVED_WITH_CONDITIONS.
- **G2-C3 is closed at design level.** RESOLVED: SEC-COND-05/06/07, SEC-P3-30, SEC-P3-32, and SEC-P3-33 items 1–11.
- **SEC-COND-03 is closed** except item 7 (locked anchor sink, RDS break-glass, pgaudit). That item is a G4-production precondition.
- **All 8 architect deviations in §15 are accepted.** Conditions attached:
  - TASK-033: the audit test generator binds each `x-audit.additional` entry to a named fixture.
  - TASK-016: C11 adds the converse check that `platform_definer` owns only the §4.5 functions plus `app_is_operator`.

**New findings raised in §16:**
- **SEC-P3-34 (LOW now; MEDIUM at M5).** Privileged sessions outside the bootstrap lane resolve names through `public`, which the migrator can write. The migrator also owns the DB, so it can run `ALTER DATABASE SET search_path` and `CREATE SCHEMA`. Fixes go in TASK-003, TASK-016 and TASK-034: a role-in-database `search_path` for the bootstrap/master role, the harness connecting with `options`, and a catalog assertion. The break-glass runbook item is G4-production.
- **SEC-P3-35 (LOW).** `payments` has no persisted `cvc_recollection_required` column. Fix in TASK-085.
- **SEC-P3-36 (LOW).** The per-organisation quota share multiplies across the up-to-11 orgs one user can hold. Add a per-user share before TASK-190.
- **SEC-P3-37 (INFO).** Drift items. Includes `ALTER DEFAULT PRIVILEGES … IN SCHEMA platform` placed in `00-roles.sql` before the schema exists (TASK-003), and partition-name squatting (TASK-021).

**Progress at PR #5 (TASK-003, `d8ba197`, PR-0005):**
- **SEC-P3-34, TASK-003 part, RESOLVED.** Items 1, 2 (runner and harness), 3 (local assertion) and 5 (the migrator doesn't own the DB; extensions installed by bootstrap). Remaining: TASK-016 (C13, catalog harness `options`), TASK-034 (rehearsal) and the item 4 runbook.
- **SEC-P3-37 item 1 RESOLVED.** It uses the global `FOR ROLE` form, because `IN SCHEMA … REVOKE` is a PG no-op. data-model §4.4 correction goes to principal-architect.
- See [[project-p5-wave0-db-baseline]].

**SEC-TC changes:**
- SEC-TC-61 amended to cover DROP FUNCTION guard CASCADE and DROP SCHEMA platform CASCADE. Both must be denied by privilege, not by the guard.
- Proposed to qa-lead: SEC-TC-65 (harness path probe), an SEC-TC-62 multi-org extension, and SEC-TC-53 text alignment.

**Why:** G3 needs SEC-TC evidence for every SEC-COND, and the new LOWs are scheduled into specific tasks. Any production release (M5) needs the G4-production checklist in §16.8 C.

**How to apply.** In P5 change reviews of the named tasks, check first:
- every SECURITY DEFINER and audit function has `proconfig` exactly `search_path=pg_catalog, pg_temp`;
- bootstrap files start with the `SET`;
- the migrator owns no schema;
- `cvc_check` is enforced on both the confirm path and the webhook path, using a stored or gateway-derived flag;
- the `quote-create` class and the org share exist, and the user share also exists;
- `--ignore-scripts`, base-ref gate scripts and `npm exec --no` are in place (SEC-P3-31, TASK-007 and TASK-011).

Related: [[project-security-review-conventions]]
