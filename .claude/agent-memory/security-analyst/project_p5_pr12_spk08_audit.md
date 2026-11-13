---
name: project-p5-pr12-spk08-audit
description: PR #12 (TASK-012 SPK-08 audit owner/guard/anchors spike) R1 2026-11-13 PASS_WITH_FOLLOW-UPS; PR12-SEC-02 MEDIUM partition squatting (supersedes SEC-P3-37 item 6); verified PG18 event-trigger/pgaudit facts; checks owed in TASK-021/033/116 and G4-production
metadata:
  type: project
---

The PR #12 review (TASK-012, spike, test-only) is in `docs/05-quality/security/PR-0012-TASK-012-security-review.md`. IDs are PR12-SEC-01..08.
- **R1** (head `2e0aa32`, 2026-11-13): PASS_WITH_FOLLOW-UPS. 02 MEDIUM; 01, 03, 04, 05 LOW; 06–08 INFO. The GO verdict stands for what was tested.
- **02 MEDIUM supersedes my own SEC-P3-37 item 6 (INFO).** Its premise "readiness catches it" was wrong. `ensure(3)` keeps 3 future months, so one squatted month always leaves 2 future partitions, and the "< 2" readiness rule never fires. The fix is a contiguity check from `pg_inherits`, not a row count.
- **Recommended in the PR's fix cycle:** SPK-08 §6.2 residual sentence (04) and the F-9/F-12 full-walk qualifier (05).

**Facts verified 2026-11-13 (PG REL_18_STABLE source, PG 18 docs, pgaudit README). Re-verify after upgrades.**
- **`REASSIGN OWNED` fires no event trigger** (utility.c:925, "no event triggers for global objects"). Role grants, `SET ROLE` and commands on event triggers fire none either (docs §38.1).
- **The guard is blind to `GRANT`/`REVOKE`.** `pg_event_trigger_ddl_commands()` returns `objid` NULL for them (event_trigger.c:2236), so a guard with `CONTINUE WHEN objid IS NULL` skips them.
- **`ENABLE ALWAYS` closes only replica mode.** Event triggers in `ENABLE` (origin) state are skipped in replica mode; `ALWAYS` ones fire. `event_triggers=off` disables all of them.
- **`DETACH PARTITION … CONCURRENTLY` commits `inhdetachpending` mid-command** (tablecmds.c:21776), before `ddl_command_end`. A guard can only abort the second half.
- **`DROP OWNED` / `REASSIGN OWNED` need privileges of the source role** (user.c:1596/1625).
- **pgaudit cannot see `SET ROLE` or the current role.** `%u` is the login user (elog.c:2947), and pgaudit has no current-role field. `SET ROLE` needs pgaudit class `MISC_SET` (`ddl, role` misses it). So a filter keyed on a NOLOGIN role name can never match.
- **`DROP … CASCADE`** drops dependents without ownership checks. A schema owner can drop any object in its schema.
- **Node `crypto.verify` accepts high-s ECDSA** (no low-s rule), so malleation detection rests on the byte-exact table/sink comparison.

**Why:** O4 (audit immutability) closes only if TASK-021, TASK-033 and TASK-116 carry these items, and G4-production needs the corrected RDS residual statement.

**How to apply.** In these reviews, check:
- **TASK-021:** all items below were verified in PR #24 R1 (2026-11-13), except the first, which stays open as PR24-SEC-01 (side-effect squats; merge condition C1). See [[project-p5-pr24-audit-store]].
  - the guard matches the object's own name for every relkind and type;
  - `ensure` fails loudly on a name collision (`AUDIT_PARTITION_NAME_TAKEN`);
  - readiness is catalogue contiguity, current to current + 2, non-pending;
  - the first-install guard uses plain `CREATE`;
  - C14 asserts the guard/evt owner, the converse set of audit-owner functions (only `ensure` is definer), that the schema owner owns nothing, and that no audit object depends on a non-catalogue object;
  - no FORCE RLS on `audit_entries` (it is SYSTEM);
  - the shadow init has the fail-closed `datdba` assertion;
  - the lane-reorder F-01 option is rejected.
- **TASK-033:**
  - privilege-denial tests for `SET ROLE`, `OWNER TO platform_audit_owner`, both `REASSIGN OWNED` directions, `DROP OWNED`, and `SET ROLE platform_definer` then `OWNER TO`;
  - superuser guard cases, including `DETACH CONCURRENTLY` run through `execute()`;
  - the `CASCADE` dependency case and the `INHERIT`-drift case;
  - the SEC-TC-61 operator-plant and caller-path variant;
  - C13 `has_parameter_privilege` rows.
- **TASK-116:**
  - SEC-TC-44 variant (d), behind-head rewrite with the head row intact: nightly only;
  - the nightly walk starts from `ZERO32` and ignores `last_verified_*`;
  - the algorithm and malleation rows;
  - `failure_kinds` and equal paging;
  - the A-6 clamp;
  - the `evtenabled`/`tgenabled` tripwire.
- **G4-production:**
  - `pgaudit.log='ddl, role, misc_set'`;
  - shape-allow-listed DDL filters;
  - alarms on `SET ROLE`/`GRANT` of the no-member roles, event-trigger commands and `REASSIGN`;
  - M5 checks (g) `SET pgaudit.log` by the master and (h) the upgrade window;
  - conditional S3 puts on the anchor sink.

Related: [[project-p3-security-conditions]], [[project-p5-pr11-rls-review]], [[project-p5-wave0-db-baseline]], [[project-security-review-conventions]]
