# PR-0012 / TASK-012: change-scoped security review (SPK-08 spike: audit owner separation, identity DDL guard, signed anchors)

| Field | Value |
|---|---|
| PR | #12 `test(db): audit owner, DDL guard and signed anchor spike for SPK-08 (TASK-012)`, https://github.com/sukhchdit/shipcube/pull/12 |
| Branch | `feat/TASK-012-spk-08-spike-audit-owner` (merge-base with `main`: `c29f89b`). Task commits `6eef1ce`, `cb2c20f`, `2e0aa32`. 7 files, +2,635 / −0 |
| Head | 2e0aa32d4779630df30a712ecbe5d1cb2fa17191 |
| Scope | `prisma/tests/spikes/spk08-audit-owner.int.test.ts`, `prisma/tests/spikes/spk08-anchor.int.test.ts`, `prisma/tests/spikes/spk08/{10-audit.sql, 90-audit-ddl-guard.sql, anchor-prototype.ts, prisma.config.ts}`, `docs/04-plan/spikes/SPK-08.md`. Nothing under `prisma/bootstrap/**`, `prisma/migrations/**`, `apps/**`, `packages/**`, `tools/**` or `.github/**` (verified with `git diff --stat main...2e0aa32`) |
| Dependencies | None. `package.json` and `package-lock.json` untouched |
| Binding items checked | ADR-0007 am. 7 (items 1–7) and am. 8 (items 1–5); data-model §4.4, §4.6 C1/C5/C13/C14, §5.1–§5.6, §7.3, §8.3; SEC-TC-43, SEC-TC-44 (amended), SEC-TC-61 (amended); threat-model T-84, AC-39, RR-04; risks R-ARCH-18; platform.md §4.3 (RDS master break-glass) and §4.8 (anchor sink, `pgaudit`); P3 review SEC-COND-03 item 7, SEC-COND-05, SEC-P3-33 item 10, SEC-P3-34, SEC-P3-37 item 6; D-TASK012-01; D-ORCH-015; merge rule D-ORCH-004 |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. No command was run in the TASK-012 worktree: sources were taken with `git show 2e0aa32:<path>` from the main checkout into scratch. No install, build, Docker or suite run (memory-constrained host, D-ORCH-010). One pure-Node probe (P-A) and PostgreSQL 18 source reading (P-B) |

## 1. Summary

**The GO verdict is security-sound for what the spike tested.** The PR is test-only, adds no dependency and touches no bootstrap or migration lane. Key material stays in memory. The core results hold up on review:

- **Migrator tamper paths.** All 14 SEC-TC-43 statements fail for `platform_migrator` by **privilege** on PostgreSQL 18, and the `DO … EXECUTE` variants produce the identical error. This is the expected result: dynamic SQL makes no difference to a privilege check.
- **Session switches.** `session_replication_role` and `event_triggers` cannot be set by the migrator (F-09).
- **Guard invocation.** The guard fires although `EXECUTE` is revoked from `PUBLIC` (F-06).
- **Pinned definer.** `ensure_audit_partitions` runs as `platform_app` with `proconfig` exactly `search_path=pg_catalog, pg_temp`, `TimeZone=UTC`, `lock_timeout=5s`. It is the only `SECURITY DEFINER` among the three audit functions.
- **Anchors.** The anchor prototype detects SEC-TC-44 (a), (b) and (c). Probe P-A also shows that the two amended SEC-TC-44 cases the suite does not cover already behave as specified (§2).

**The findings are not complete for TASK-021, TASK-033 and COND-G4-PROD.** No Critical or High finding is open. The gaps are:

- **PR12-SEC-02 (MEDIUM): partition-name squatting is a silent time bomb.** The guard does not cover indexes, views, sequences or types. `ensure_audit_partitions` then skips a month silently, because it tests only `to_regclass(...) IS NULL`. The specified readiness check (≥ 2 future partitions) **never** fires for a single missing month: creation runs 3 months ahead, so 2 future months always remain. Audited writes therefore fail platform-wide on the first instant of the squatted month. This corrects my own P3 rating of the same gap (SEC-P3-37 item 6: INFO, "readiness catches it a month ahead"), which was wrong.
- **PR12-SEC-04 (LOW now, MEDIUM at M5 if unaddressed): the RDS residual-risk statement relies on event triggers for detection.** They give none against the master:
  - the guard exempts `current_user = 'platform_audit_owner'`, which the master can reach by self-granting `SET` through its permanent ADMIN row;
  - role grants, `SET ROLE` and `REASSIGN OWNED` fire no event trigger;
  - the platform.md §4.8 `pgaudit` design (`ddl, role`; a filter keyed on `platform_audit_owner`) cannot see `SET ROLE`, and cannot attribute DDL to that role.
- **The guard is still needed, but its role is under-stated (F-05).** Beyond "planted names", it is the only control for:
  - `DROP … CASCADE` of dependents, which PostgreSQL drops without ownership checks;
  - superuser and bootstrap-role accidental DDL;
  - drift to an `INHERIT` membership.

  The escalation primitives that the guard's identity exemption makes critical are untested: `SET ROLE`, `OWNER TO`, `REASSIGN OWNED` and `DROP OWNED` (PR12-SEC-01). The exemption also requires a converse ownership check, and the first-install guard file should not use `CREATE OR REPLACE` (PR12-SEC-03).
- **SPK-08 F-12 ("checking only the latest anchor is sound") needs a qualifier.** The spike's verifier walks every stream from sequence 1 on every run. The production hourly run is incremental (§5.6). A rewrite behind an anchored head that leaves the head row intact is caught only by the nightly full walk (≤ 24 h, which §5.6 already allows). SPK-08 does not say so (PR12-SEC-05).

## 2. Method

| Probe | What it did | Result |
|---|---|---|
| **P-A** `probe/malleate.mjs` (scratch) | Imported the PR's `anchor-prototype.ts` directly under Node 24.22.3 type stripping (pure functions, no DB). Checks: golden vectors as a positive control; DER `(r, n−s)` malleation written to the table row only; malleation written to table and sink; `algorithm = 'ED25519'` | Golden `headsDigest` and `anchorHash` match SPK-08 §5.2. Node `crypto.verify` **accepts** the malleated signature (no low-s rule). Table-only malleation → step (ii) `[]`, step (i) `ANCHOR_MISSING@i: table and sink records differ`. Table plus sink malleated → no failure (content unchanged). `ED25519` → `CHECKPOINT_SIGNATURE_INVALID: unsupported algorithm ED25519`. The amended SEC-TC-44 cases therefore behave as specified, but the PR suite does not test them |
| **P-B** PostgreSQL REL_18_STABLE sources (raw GitHub, read only) | `tcop/utility.c`, `commands/event_trigger.c`, `commands/tablecmds.c`, `commands/user.c`, `utils/error/elog.c` | `REASSIGN OWNED` runs with "no event triggers for global objects" (utility.c:925–928). `pg_event_trigger_ddl_commands()` returns `objid` NULL for `GRANT`/`REVOKE` (event_trigger.c:2236–2256), so the guard's `CONTINUE WHEN r.objid IS NULL` skips them. In replica mode, `ENABLE`/origin event triggers are filtered out and `ALWAYS` ones fire (event_trigger.c:604–613); `event_triggers = off` disables all of them (:749 ff.). `DETACH PARTITION … CONCURRENTLY` commits `inhdetachpending = true` **before** the command ends (tablecmds.c:21712–21715 and 21776–21777). `DROP OWNED` and `REASSIGN OWNED` require privileges of the source role, and `REASSIGN` additionally the ability to `SET ROLE` to the target (user.c:1596, 1625–1632). `log_line_prefix %u` is `MyProcPort->user_name`, the login user, which is unchanged by `SET ROLE` (elog.c:2944–2947) |
| **P-C** Documentation | PG 18 §38.1 *Overview of Event Trigger Behavior*; pgaudit README | Event triggers do not fire for roles ("role definitions and role memberships"), databases, tablespaces, parameter privileges, `ALTER SYSTEM`, or commands on event triggers. pgaudit `MISC_SET` is the class that logs `SET ROLE`; `ddl, role` does not. pgaudit records no current-role field (the user comes from `%u`). Statements inside functions are logged as substatements of the call |
| Source review | All 7 files at `2e0aa32`; spec cross-check against data-model §5.2/§5.3/§5.5/§5.6, ADR-0007 am. 7/8, SEC-TC-43/44/61, platform.md §4.3/§4.8 | — |
| Hygiene | `git diff main...2e0aa32` grep for key and secret patterns; lane check | No private key, password, token or connection string with credentials. The private key is never exported: only `publicKey.export({type:'spki'})` (anchor test :453); `pub.pem`, `sig.der` and `anchor_hash.bin` go to `mkdtemp` under `tempDir`, which `afterAll` removes (:467). Role passwords come from the harness. No lane files changed |

## 3. Privilege versus guard: who stops each tamper path

The question was whether the guard is still needed on PostgreSQL 18, and whether it is correctly scoped. In the table, "guard" means `platform.audit_ddl_guard()` on `ddl_command_end`/`sql_drop`. "Silent" means no event trigger fires at all.

| # | Path | `platform_migrator` (local PG 18) | Cluster superuser (local) | RDS master at M5 (after self-granting `SET` through its ADMIN row) | Spike evidence |
|---|---|---|---|---|---|
| 1 | `ALTER TABLE audit_entries` `DISABLE TRIGGER`, `NO FORCE`/`DISABLE RLS`, `DETACH PARTITION`; `DROP TRIGGER`/`POLICY`/`TABLE`; partition `DROP`/`DISABLE` | Privilege ("must be owner") | Guard (owner match), unless `session_replication_role = replica` or `event_triggers = off` | `SET ROLE platform_audit_owner` → **guard exempt** → nothing stops it | Migrator: tested (14 × 2). Superuser: **untested** (only schema rename tested) |
| 2 | `DETACH PARTITION … CONCURRENTLY` | Privilege at preparation, before any commit | Guard fires only in the second transaction; the **detach-pending state is already committed** (P-B) | As row 1 | Untested (cannot run inside `attempt()`'s `BEGIN`) |
| 3 | `TRUNCATE` parent or partition | Privilege | Statement trigger (parent) and per-partition trigger (from `ensure`); bypassed in replica mode | As row 1, or in replica mode | Migrator tested; superuser untested for `audit_entries` (the anchors owner case was tested) |
| 4 | `UPDATE`/`DELETE` rows | Privilege | Row trigger (cloned to partitions); bypassed in replica mode | Replica mode, or `DISABLE TRIGGER` under `SET ROLE` | Superuser `UPDATE` tested → `AUDIT_IMMUTABLE` |
| 5 | `COPY` | `COPY FROM` needs `INSERT` (none); `COPY TO` needs `SELECT` (none) | n/a | n/a | No new capability: for `platform_app`, `COPY` is `INSERT`/`SELECT`, the append path it already has |
| 6 | `GRANT`/`REVOKE` on audit objects | Privilege (no grant option) | **Guard blind**: `objid` is NULL, so the row is skipped. C5 is the control ("no privilege on any partition") | As superuser | Migrator `GRANT` tested |
| 7 | `CREATE OR REPLACE` of the audit functions | Privilege | Guard (owner and name) | Guard exempt under `SET ROLE` | Migrator tested |
| 8 | Plant an audit-named **table or function** | **Guard** | Guard | Exempt | Tested (4 cases) |
| 9 | Plant an audit-named **index, view, sequence, composite or enum type** (`audit_entries_YYYY_MM`) | **Not blocked** (PR12-SEC-02) | Not blocked | Not blocked | Not tested |
| 10 | `DROP <object> CASCADE` where an audit object depends on it | **Guard only** (`sql_drop`). PostgreSQL drops dependents without ownership checks. Latent: no such dependency exists today | Guard | Exempt | Not tested |
| 11 | `DROP`/`ALTER SCHEMA public\|platform` (rename, owner, `CASCADE`) | Privilege (schema owner `platform_schema_owner`) | Guard (OID match) | Under `SET ROLE platform_schema_owner` the guard still blocks (only the audit owner is exempt) | Migrator tested; superuser rename tested (C14 b) |
| 12 | `ALTER`/`DROP EVENT TRIGGER` | Privilege | **Silent** (no event trigger fires for event-trigger commands) | AWS documents that the master may do this. Silent | Migrator tested |
| 13 | `SET session_replication_role` / `event_triggers` | Privilege | Allowed | M5 check (d) | Migrator tested |
| 14 | `SET ROLE platform_audit_owner`; `ALTER … OWNER TO platform_audit_owner`; `REASSIGN OWNED`; `DROP OWNED BY platform_audit_owner` | Privilege (no membership; user.c checks) | `REASSIGN OWNED` is **silent**, and the guard then fails closed on all later DDL (empty `v_ns`). `DROP OWNED` → guard | **Full bypass.** Role grants and `SET ROLE` fire no event trigger | **Not tested** (PR12-SEC-01) |
| 15 | A `SECURITY DEFINER` function owned by the audit owner with attacker-influenced DDL | n/a | n/a | n/a | Only `ensure_audit_partitions` is definer, with an `integer` argument bounded 0–12. The converse set is not asserted (PR12-SEC-03) |
| 16 | Search-path hijack of `ensure_audit_partitions` | Pinned path (asserted via `proconfig`) and qualified calls | n/a | n/a | Plant test passes, but cannot fail on the fixed function (PR12-SEC-06) |

**Ruling on F-05.** The classification of the 14 statements is correct: privilege, not the guard, stops every one of them on PG 18. The conclusion "the guard is reached by the migrator only for creations under audit names" is **too narrow** to drive TASK-033's test design. The guard is load-bearing for rows 1–4 (superuser accidents), 8–10, owner-change aftermath (name plus namespace match), and an `INHERIT`-only membership drift: privilege would admit the drifted role, but `current_user` is not the audit owner, so the guard still blocks it. Its scope is right for tables, functions and schemas. It is too narrow for other relation kinds and types (row 9).

Some blind spots are inherent to PostgreSQL and must be stated in data-model §5.2 "What it does not cover", with the control that covers each:

| Blind spot | Covering control |
|---|---|
| `GRANT`/`REVOKE` (row 6) | C5 |
| `REASSIGN OWNED`, role commands and event-trigger commands (rows 12, 14) | C13/C14 plus `pgaudit` |
| The first phase of `DETACH … CONCURRENTLY` (row 2) | Readiness contiguity check (PR12-SEC-02) |

## 4. Findings

### PR12-SEC-01: The escalation primitives the guard's identity exemption depends on, and the guard-only paths, are not tested (LOW)

| | |
|---|---|
| Severity | LOW (Impact M: missing evidence for the SEC-COND-03/05 closure; a regression would go undetected. Likelihood L) |
| CWE / OWASP | CWE-269 Improper Privilege Management · A01:2021 |
| Location | `prisma/tests/spikes/spk08-audit-owner.int.test.ts:273–330` (tamper sets) and `:376–401` (SEC-TC-61 subset); SPK-08.md:368 (F-05), :373 (F-10) |
| Description | The guard returns early for `current_user = 'platform_audit_owner'` (`90-audit-ddl-guard.sql:22–24`). Every path that lets a non-audit-owner principal act **as** that role is therefore a complete bypass, and only privilege stops it. The spike tests none of these paths: `SET ROLE platform_audit_owner`, `ALTER FUNCTION <own fn> OWNER TO platform_audit_owner` (planting a definer as the audit owner), `REASSIGN OWNED BY platform_migrator TO platform_audit_owner`, `REASSIGN OWNED BY platform_audit_owner TO platform_migrator` and `DROP OWNED BY platform_audit_owner`. The guard-only paths of §3 rows 1–3 (superuser `DISABLE TRIGGER`, `DETACH`, `TRUNCATE`) and row 10 (`CASCADE` dependents) are not tested either, nor is `DETACH … CONCURRENTLY` (row 2) |
| Exploitability / impact | Not exploitable today: PostgreSQL denies all five (user.c:1596 and 1625–1632; `check_can_set_role`), and C13 asserts zero `pg_auth_members` rows. The risk is regression. A later grant (for example a `GRANT platform_audit_owner TO platform_migrator WITH SET TRUE` added to make a migration "work") would pass every planned SEC-TC-43/61 test, because those tests assert the statements of rows 1 and 11 only |
| Remediation | TASK-033 `immutability.int.test.ts`, plus a SEC-TC-61 text amendment by qa-lead. As `platform_migrator`, each in `attempt()`, expect `42501` with the **privilege** message: (1) `SET ROLE platform_audit_owner` ("permission denied to set role"); (2) `CREATE FUNCTION public.spk() RETURNS int LANGUAGE sql AS 'SELECT 1'; ALTER FUNCTION public.spk() OWNER TO platform_audit_owner` ("must be able to SET ROLE"); (3) both `REASSIGN OWNED` directions ("permission denied to reassign objects"); (4) `DROP OWNED BY platform_audit_owner` ("permission denied to drop objects"); (5) `SET ROLE platform_definer; ALTER FUNCTION … OWNER TO platform_audit_owner` (the migrator **does** hold `SET` on `platform_definer`, `00-roles.sql`). As the test superuser, expect the **guard** message for `ALTER TABLE audit_entries DISABLE TRIGGER ALL`, `DETACH PARTITION <p>`, `TRUNCATE audit_entries` (expect `AUDIT_IMMUTABLE`) and `TRUNCATE <partition>`. Run `DETACH PARTITION <p> CONCURRENTLY` through `execute()` (outside a transaction), then assert `pg_inherits.inhdetachpending` and document the residue (PR12-SEC-02 item d). For the `CASCADE` case: as the superuser under `SET ROLE platform_audit_owner`, add `ALTER TABLE audit_entries ADD CONSTRAINT ck_probe CHECK (public.migrator_fn(id))` where the migrator owns `migrator_fn`; then as the migrator run `DROP FUNCTION public.migrator_fn(uuid) CASCADE` → expect the guard message (`sql_drop`, table constraint on `audit_entries`). For `INHERIT` drift, grant the migrator `platform_audit_owner WITH INHERIT TRUE, SET FALSE` inside the rolled-back transaction, then `DISABLE TRIGGER ALL` → expect the guard message |
| Verification | Each case asserts the exact message class through the existing `classify()` helper. Mutation check: temporarily granting `SET` must turn case (1) green-to-red |
| Owner | TASK-033 (tests); qa-lead (SEC-TC-61 row text) |

### PR12-SEC-02: Partition-name squatting by non-table objects makes `ensure_audit_partitions` skip a month silently, and readiness never detects it (MEDIUM)

| | |
|---|---|
| Severity | **MEDIUM** (Impact H: on the first instant of the squatted month every audited write fails, platform-wide; integrity holds, because the failure is closed. Recovery for the index variant needs break-glass. Likelihood L: needs a migration that names an index, view, sequence or type `audit_entries_YYYY_MM`. The linter catches literal names, but it is not a boundary, and dynamic SQL evades it). **Supersedes SEC-P3-37 item 6 (INFO)**, whose "readiness catches it" premise is wrong |
| CWE / OWASP | CWE-386 Symbolic Name not Mapping to Correct Object (secondary: CWE-400) · A04:2021 Insecure Design |
| Location | `prisma/tests/spikes/spk08/10-audit.sql:140` = data-model §5.3 (`IF pg_catalog.to_regclass('public.' \|\| v_name) IS NULL`); `90-audit-ddl-guard.sql:45–56` = §5.2 (relation branch: an `index` maps to its **table**; `view`, `sequence`, `materialized view`, `composite type`, `type` and `domain` fall through with `v_hit = false`); data-model.md:3295 and WAVE-00.md:798 (readiness "≥ 2 future partitions", counted from `audit_partitions` rows) |
| Description | (a) **Squatting.** As the migrator, `CREATE INDEX audit_entries_2027_05 ON public.<own table>(id)`, or a view, sequence, matview or composite type of that name, passes the guard. `ensure_audit_partitions` then finds `to_regclass('public.audit_entries_2027_05')` non-NULL and **skips** the month without error. An enum or domain of that name has no `pg_class` row, so `CREATE TABLE` fails with 42710 and the whole call errors. That variant is loud. (b) **Readiness arithmetic.** `ensure(3)` keeps current + 3 months. With one month X missing, the strictly-future count is 2 when X is +3, +2 or +1, and 3 once X is current. The rule "degraded when < 2" therefore **never** fires. The first symptom is 23514 "no partition of relation audit_entries found for row" on every audited transaction at 00:00 UTC of X. (c) **Recovery.** The guard's `sql_drop` index pattern `audit_entries_` (`c_idx`) blocks the migrator from dropping its own squatting index, so removal needs the superuser with the guard bypassed (`event_triggers = off` or replica mode). A view or sequence can be dropped by the migrator. (d) **Related residue.** A superuser `DETACH PARTITION … CONCURRENTLY` leaves `inhdetachpending = true` committed even when the guard aborts the second phase (P-B). The `audit_partitions` row remains, so readiness stays green while that month's writes fail and its rows disappear from the parent, which the verifier then reports as `SEQ_GAP`. (e) Readiness counts rows in `audit_partitions`, which `platform_app` can `INSERT` and `UPDATE`, rather than catalogue state |
| Exploitability / impact | A time bomb: it can be planted years ahead and is invisible to every specified check until the month starts. The impact is availability of the whole booking/payment write path, because the audit write is in the business transaction (§5.4). No audit integrity is lost |
| Remediation (data-model §5.2/§5.3 amendment by principal-architect/data-architect **before TASK-021 starts**; TASK-021 implements; TASK-033 tests) | **1. Guard: match the object's own name for every `pg_class` and `pg_type` object in a protected schema.** In the `ddl_command_end` loop, before the existing relation branch: `IF r.object_type IN ('index','sequence','view','materialized view','composite type','foreign table') THEN SELECT c.relnamespace = ANY (v_ns) AND c.relname ~ c_tbl INTO v_hit FROM pg_catalog.pg_class c WHERE c.oid = r.objid; END IF; IF NOT COALESCE(v_hit,false) AND r.object_type IN ('type','domain') THEN SELECT t.typnamespace = ANY (v_ns) AND t.typname ~ c_tbl INTO v_hit FROM pg_catalog.pg_type t WHERE t.oid = r.objid; END IF;`. For `index`, OR this with the existing owner-of-table check. Prisma never emits such names (F-08 already constrains them). Audit-owner DDL stays exempt, so the partitions' own `audit_entries_YYYY_MM_*` indexes are unaffected. **2. `ensure_audit_partitions`: replace the name test with an identity test that fails loudly.** `SELECT c.relkind, c.relowner, i.inhparent, i.inhdetachpending INTO v_kind, v_relowner, v_parent, v_pending FROM pg_catalog.pg_class c LEFT JOIN pg_catalog.pg_inherits i ON i.inhrelid = c.oid WHERE c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relname = v_name; IF FOUND THEN IF v_kind <> 'r' OR v_parent IS DISTINCT FROM 'public.audit_entries'::pg_catalog.regclass OR v_relowner <> pg_catalog.to_regrole('platform_audit_owner') OR v_pending THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUDIT_PARTITION_NAME_TAKEN', DETAIL = v_name; END IF; CONTINUE; END IF; IF EXISTS (SELECT FROM pg_catalog.pg_type t WHERE t.typnamespace = 'public'::pg_catalog.regnamespace AND t.typname = v_name) THEN RAISE … END IF;` The daily job already alerts on any failure. **3. Lookahead and readiness from the catalogue, not from `audit_partitions`.** The `audit_partitions` readiness check must be **contiguity**, not a count: for each month m in [current, current + 2], an attached, non-pending partition of `public.audit_entries` named `audit_entries_<YYYY_MM>`, owned by `platform_audit_owner`, must exist (`pg_inherits` ⋈ `pg_class`; `platform_app` can read the catalogue). In addition, any `pg_class` row matching `^audit_entries_[0-9]{4}_[0-9]{2}$` in `public` that is not such a partition, or any `pg_type` row with `typrelid = 0` of that name, means `unavailable` plus a security event, whatever the month. This catches a far-future squat on the day it is planted. **4.** Add these cases to the §5.2 "What it does not cover" list and to C14 |
| Verification | TASK-033: as the migrator, `CREATE INDEX audit_entries_<now+5 months> ON public.probe(id)` → guard message. With the guard check disabled in a variant (superuser `ALTER EVENT TRIGGER … DISABLE` inside a rolled-back transaction): (i) `SELECT ensure_audit_partitions(6)` raises `AUDIT_PARTITION_NAME_TAKEN`; (ii) the readiness query returns `unavailable`. Repeat (i) with `CREATE TYPE … AS ENUM` and with `CREATE VIEW`. Unit test of the readiness arithmetic: one missing month at +1, +2 or +3 → `unavailable` |
| Owner | principal-architect / data-architect (spec), TASK-021 (DDL, readiness check `apps/api/src/platform/health/checks/audit-partitions.ts`), TASK-033 (tests) |

### PR12-SEC-03: Guard install and identity-exemption hardening: `CREATE OR REPLACE` keeps a pre-existing owner; no converse ownership or dependency assertion (LOW)

| | |
|---|---|
| Severity | LOW (Impact M: the guard could be neutralised, though privilege still holds for rows 1 and 11. Likelihood L) |
| CWE / OWASP | CWE-693 Protection Mechanism Failure · A04:2021 |
| Location | `90-audit-ddl-guard.sql:7` = data-model §5.2 (`CREATE OR REPLACE FUNCTION platform.audit_ddl_guard()`); `spk08-audit-owner.int.test.ts:235–249` (function assertion filtered by `proname IN (…)`) |
| Description | (a) **`CREATE OR REPLACE` keeps the existing owner.** If the function exists, PostgreSQL keeps its owner and ACL. The bootstrap lane is ledger-incremental (§8.1). TASK-021 will apply `90-audit-ddl-guard.sql` to databases where migrations already ran (developer, CI and rehearsal databases), and the migrator holds `CREATE` on `platform`. A migration that had created `platform.audit_ddl_guard()` (`RETURNS event_trigger`, the type is public) would leave the migrator owning the guard after the superuser's `CREATE OR REPLACE`. The migrator could later replace the body with a no-op. That `CREATE OR REPLACE` itself fires `ddl_command_end` with the new body already in place. (b) **The identity exemption makes every audit-owner `SECURITY DEFINER` function a guard bypass by construction.** The spike asserts `prosecdef` only for the three named functions. It does not assert that the audit owner owns **only** these (plus `audit_vault_guard`), nor that `platform_schema_owner` owns no function or relation. That role can `DROP` any object in its schemas: `RemoveObjects` allows the namespace owner. (c) **Dependencies.** `DROP … CASCADE` removes dependent objects without ownership checks. Today no audit object depends on a non-catalogue object. Note that the prototype's FORCE RLS and placeholder policies diverge from data-model §3 (`audit_entries` is SYSTEM, no RLS; PR12-SEC-08). A future audit policy, default or check that calls a migrator-owned helper (for example `platform.app_org_id()`) would make the guard's `sql_drop` the only stop. A `CREATE OR REPLACE` of that helper would change audit semantics with no guard involvement at all |
| Remediation | (1) The first-install file uses plain `CREATE FUNCTION platform.audit_ddl_guard()`, which fails closed if the function exists. Later replacement files (§5.2 "Changing the guard later") first assert `NOT EXISTS (SELECT FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::pg_catalog.regnamespace AND p.proname = 'audit_ddl_guard' AND p.proowner <> (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user))`, then `DISABLE` → replace → `ENABLE`. (2) C14 asserts the guard function's owner and `pg_event_trigger.evtowner` = the bootstrap role. (3) C14 converse: `SELECT p.oid::regprocedure, p.prosecdef FROM pg_catalog.pg_proc p WHERE p.proowner = 'platform_audit_owner'::regrole` equals exactly {`audit_forbid_mutation()` f, `audit_vault_guard()` f, `ensure_audit_partitions(integer)` t}, and `platform_schema_owner` owns 0 `pg_proc` and 0 `pg_class` rows (mirrors the TASK-016 C11 converse for `platform_definer`). (4) C14 dependency check: no `pg_depend` row whose dependent object belongs to an audit-owned relation or function references an object outside `pg_catalog` whose owner is not `platform_audit_owner` or the bootstrap role |
| Verification | C14 negative fixtures: a migrator-owned `platform.audit_ddl_guard()` before the lane runs makes the lane fail; a second audit-owner definer fails C14; a check constraint on `audit_entries` calling a migrator function fails C14 |
| Owner | principal-architect (§5.2 text), TASK-021 (file and C14) |

### PR12-SEC-04: The COND-G4-PROD residual statement counts on event-trigger detection that does not exist for the RDS master; the `pgaudit` design cannot see the path (LOW now, MEDIUM at M5 if unaddressed)

| | |
|---|---|
| Severity | LOW for this run (no RDS, no production data, AS-2); **MEDIUM at M5** if the text and the `pgaudit` design are not corrected before G4-production (Impact H: undetected rewrite beyond the anchor window by the break-glass role. Likelihood L) |
| CWE / OWASP | CWE-778 Insufficient Logging · A09:2021 |
| Location | SPK-08.md:307 (§6.2 "Immutability against `rds_superuser` has to come from detection (audit and event triggers)"); SPK-08.md:254, :272, :411–412 (`ENABLE ALWAYS` as the mitigation); platform.md:345 (`pgaudit.log='ddl, role'`), :453 (metric filter "DDL against `audit_*` objects by any user other than `platform_audit_owner`") |
| Description | (1) The master keeps an ADMIN-only row on `platform_audit_owner` that it cannot revoke, because the grantor is `rdsadmin` (SPK-08 §6.2). At any time it can run `GRANT platform_audit_owner TO CURRENT_USER WITH SET TRUE; SET ROLE platform_audit_owner;` and then any audit DDL. The guard **returns early** for that identity, and neither the role grant nor `SET ROLE` fires an event trigger (P-C). Event triggers therefore provide neither prevention nor detection on this path. (2) `REASSIGN OWNED` and `ALTER`/`DROP EVENT TRIGGER` are silent for event triggers too (P-B, P-C). (3) `ENABLE ALWAYS` closes only the `session_replication_role = replica` bypass. It does not close `event_triggers = off` (if the master can set it: M5 check d), `ALTER EVENT TRIGGER … DISABLE` (documented for the master) or the `SET ROLE` path. If adopted, `ensure_audit_partitions` must also set `ALWAYS` on each per-partition TRUNCATE trigger, and C6/C14 must expect `'A'` instead of the spike's `'O'`. (4) `pgaudit.log='ddl, role'` does not log `SET ROLE`, `SET session_replication_role` or `SET event_triggers` (class `MISC_SET`/`MISC`). pgaudit has no current-role field, and `%u` is the login user (P-B elog.c). The platform.md:453 filter can never see `platform_audit_owner` (NOLOGIN). It will either fire daily on `ensure_audit_partitions`' substatements under the `platform_app` login (false positives) or, if those logins are exempted, miss the master |
| Remediation | **SPK-08 §6.2, in this PR's fix cycle (text only):** replace the residual sentence with the statement in §6 below. **principal-architect / platform-architect (G4-production checklist item 1):** `pgaudit.log = 'ddl, role, misc_set'`. Metric filters and alarms on: (a) `SET ROLE` or `GRANT … platform_audit_owner\|platform_schema_owner` outside a declared bootstrap change window; (b) DDL on `audit_*` objects whose statement text is not one of the five `ensure_audit_partitions` templates (an allow-list by statement shape, not by user); (c) `ALTER`/`DROP EVENT TRIGGER`, `REASSIGN OWNED`, `DROP OWNED`, `SET session_replication_role`, `SET event_triggers`, `SET pgaudit.log`. Keep the `GetSecretValue` alarm (platform.md:344) as the primary signal. Add M5 checks (g) whether the master can `SET pgaudit.log = 'none'` in-session (if yes, connection and credential-retrieval alarms are the only signal) and (h) whether the major-upgrade event-trigger drop and re-create is done with migrations frozen, followed immediately by C14. **TASK-116:** the hourly verifier also asserts `evtenabled` of both event triggers and `tgenabled` of every audit trigger and partition clone (a tripwire for persistent disables), and emits `audit_chain_broken` on any change |
| Verification | M5 rehearsal on RDS 18: perform each path (a)–(c) as the master and confirm one alarm per path in CloudWatch; record the results in the G4-production dossier |
| Owner | principal-architect, platform-architect, release-manager (G4-production checklist); database-engineer (SPK-08 text) |

### PR12-SEC-05: Anchor verifier: SPK-08 F-12/F-9 hold only with the full walk the spike ran every time; amended SEC-TC-44 cases and A-1/A-6 need security conditions (LOW)

| | |
|---|---|
| Severity | LOW |
| CWE / OWASP | CWE-345 Insufficient Verification of Data Authenticity · A09:2021 (as T-84) |
| Location | `spk08-anchor.int.test.ts:365–379` (`verifyAll`, commented "the hourly verifier", walks every stream from seq 1); SPK-08.md:219 (F-9), :222 (F-12), :233 (A-1), :238 (A-6); `anchor-prototype.ts:320–328` (table/sink content mismatch reported as `ANCHOR_MISSING`) |
| Description | (1) **F-12 needs a qualifier.** In production (data-model §5.6) the hourly chain walk is **incremental** (`stream_seq > $after_seq`, taken from `last_verified_*`, which `platform_app` can update). Step (iii)(b) probes only the anchored head row. A superuser rewrite *behind* an anchored head that leaves the head row intact passes (iii-a), (iii-b) and the incremental walk. It is caught only by the nightly full walk (`PREV_HASH_MISMATCH` at the head or `HASH_MISMATCH` at the tampered row), within ≤ 24 h as §5.6 states. SPK-08 calls the latest-anchor check "sound" without that condition, and its "hourly" verifier is really the nightly shape. (2) The amended SEC-TC-44 rows `algorithm ≠ ECDSA_P256_SHA256` and "malleated `(r, n−s)` written only to the table → `ANCHOR_MISSING`" are not in the spike suite. P-A shows the prototype behaves correctly. Node accepts high-s, so detection of malleation rests **entirely** on step (i)'s byte-exact comparison. (3) **A-1.** A table/sink *content* mismatch is proof of tampering, but it is reported under the same kind as a sink outage (`ANCHOR_MISSING`) |
| Remediation | (a) SPK-08 F-12/F-9 text (this PR's fix cycle): "sound **together with a full walk from seq 1 in the same run (nightly)**. The hourly incremental run detects head-row changes. Behind-head rewrites with an intact head row are detected by the nightly full walk (≤ 24 h, §5.6)". Fix the `verifyAll` comment to match. (b) TASK-116: add SEC-TC-44 variant (d) "behind-head rewrite, head row intact": the hourly incremental run has no failure (documented), and the nightly full run reports `PREV_HASH_MISMATCH`/`HASH_MISMATCH`. The nightly run starts each stream from `ZERO32` at seq 1 and **ignores** `last_verified_*`. Add the `algorithm` and malleation rows. The sink comparison stays a string comparison of the JCS line (A-3), never a parsed or semantic one. (c) A-1 ruling: accept the precedence **and** keep every step's event; add `failure_kinds text[]` (or the details) to `audit_chain_verifications`; give the table/sink content mismatch a distinct detail code (for example `ANCHOR_SINK_MISMATCH` under `ANCHOR_MISSING`); `audit_anchor_missing` pages at the same severity as `audit_chain_broken`. (d) A-6 ruling: accept the time-based window, but apply it only when the newest anchor's signed `created_at` lies within [verifier now − 15 min, now + 2 min]; a future-dated anchor is a failure. (e) M5 sink: S3 `PutObject` under Object Lock still creates **new versions** of an existing key. The writer uses a conditional `If-None-Match: *` put, and the verifier treats more than one version per anchor key as a differing duplicate. An in-browser verifier takes public keys from an out-of-band published set, never from the API it is verifying. Key rotation records each `key_id`'s `anchor_seq` range in the sink, so a retired key that is later compromised cannot sign verifiable new anchors. (f) The `audit_chain` readiness check reads `audit_chain_verifications`, which `platform_app` can write. The security event emitted at failure time is the primary signal; readiness is secondary |
| Verification | TASK-116 tests (b), with test titles carrying SEC-TC-44; unit tests for (c) and (d) |
| Owner | database-engineer (SPK-08 text), principal-architect (A-1/A-6 wording in §5.6), TASK-116 (verifier and tests), platform-architect (item e at M5) |

### PR12-SEC-06: The SEC-TC-61 search-path plants cannot fail against the fixed function (INFO)

| | |
|---|---|
| CWE / OWASP | CWE-426 Untrusted Search Path · A08:2021 |
| Location | `spk08-audit-owner.int.test.ts:403–445`; SPK-08.md:109–114 |
| Description | Every call in `ensure_audit_partitions` is `pg_catalog.`-qualified with exact casts (§5.3 "three layers"). The two planted function overloads are therefore defeated by qualification alone, and the test would pass even with the `SET search_path` clause removed. The positive control proves only that the plants win for an *unqualified* call in the migrator's own session. The pin itself is asserted only by the `proconfig` catalog check, which is the real evidence. The SEC-TC-61 text says the plants "try `ALTER TABLE … DISABLE TRIGGER ALL`"; the prototype plants only insert a marker |
| Remediation (TASK-033) | Make the test discriminate between the layers. (1) Call `ensure` from a session with `SET search_path = public, pg_catalog`. (2) Also plant exact-signature **operators** in `public` (for example `public.\|\|(text, text)` and `public.>=(timestamptz, timestamptz)` writing the marker), which would win if `public` came first in the function's path. (3) Positive control at function level: a scratch copy of the function without the `SET` clause, called with that path, hits the operator plant. Add to C13: `has_parameter_privilege(<role>, 'session_replication_role' \| 'event_triggers' \| 'pgaudit.log', 'SET')` is false for `platform_migrator` and `platform_app` (`pg_parameter_acl` grants are invisible to F-09's one-shot `SET` test once granted) |

### PR12-SEC-07: Rulings on the F-01 options and the F-02 shadow rendering (INFO)

- **F-01 (security-neutral; generated window approved).** `tables.external` only hides drift from Prisma. C13/C14 own the audit catalogue. The 60-name generated window (a pure function, no database access) is acceptable. **The lane-reordering alternative ("first `migrate deploy` before `10-audit.sql`") is rejected on security grounds.** It runs migrator DDL before the audit objects and the guard exist. On any later database that ordering lets a migration pre-create `audit_*` names or a migrator-owned `platform.audit_ddl_guard()` (see PR12-SEC-03 a). The M5 dedicated `audit` schema remains the preferred long-term option.
- **F-02/F-03.** Dropping and re-creating `platform` in the shadow rendering is acceptable. The rendered `DROP SCHEMA IF EXISTS platform CASCADE` runs with the migrator credential against whatever `SHADOW_DATABASE_URL` points to. Where the real lane ran, privilege and the guard stop it. On a non-bootstrapped database (a fresh developer database in which the migrator owns `platform`) a mis-set URL would wipe it. TASK-021: make the rendered init's first statement fail closed: `DO $$ BEGIN IF (SELECT d.datdba FROM pg_catalog.pg_database d WHERE d.datname = pg_catalog.current_database()) <> (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN RAISE EXCEPTION 'shadow init refused: not a migrator-owned database'; END IF; END $$;`. Shadow databases are migrator-owned (SPK-08 §0), and the real database is not (D-ARCH-045).
- **F-06 and F-09 confirmed.** Keep the `REVOKE ALL … FROM PUBLIC` on the guard.

### PR12-SEC-08: Hygiene and port warnings (INFO)

1. **Verified.** Keys are generated in memory. Only SPKI, signatures and hashes reach a `mkdtemp` directory that is removed in `afterAll`. Nothing is added to the bootstrap or migration lanes. There are no secrets in the diff, no new dependencies and no lint relaxations.
2. **Do not port the prototype's FORCE RLS.** `10-audit.sql:74–80` enables and forces RLS with placeholder policies on `audit_entries`, and the catalog test asserts `rls: true, force: true` (`:233`). data-model §3 classifies `audit_entries` as **SYSTEM (no RLS)**, with the viewer repository applying the scope, and C1 allow-lists it. TASK-021/033 must not copy either. If RLS were ever added, the partitions (which do not inherit `relrowsecurity`) must keep zero privileges (C5).
3. **The `@audit-ddl security-approved: spike-only (SPK-08) 2026-11-12` header records no security approval.** It does not match the linter's regex (`lint-migrations.ts:114`), so a copy into `prisma/bootstrap/**` would fail closed. TASK-021 must use a real reviewer entry from `tools/db/audit-ddl-reviewers.json`.
4. **Spike file lifecycle.** Deleting the spike files (SPK-08 §8 Q4) is tracked with TASK-033/TASK-021. Process note for the orchestrator: the sheet's DoD says "throwaway code is not merged", while this PR merges test-only spike code. This follows the SPK-03 precedent and has no security impact.

## 5. Rulings on the spike findings (for principal-architect and the consuming tasks)

| ID | Security ruling |
|---|---|
| F-01 | Accept the generated window; reject lane reordering (PR12-SEC-07) |
| F-02, F-03 | Accept, with the fail-closed shadow assertion (PR12-SEC-07) |
| F-04 | No security impact (performance only) |
| F-05 | Classification correct; conclusion too narrow (§3; PR12-SEC-01) |
| F-06 | Confirmed; keep the `REVOKE` |
| F-07 | Accept the regex. `mapDbError` keys on the `AUDIT_IMMUTABLE:` prefix only (PR11-SEC-11 c) |
| F-08 | Accept, and extend to the object's own name for every relation kind and type (PR12-SEC-02 item 1) |
| F-09 | Confirmed; add the `has_parameter_privilege` C13 rows (PR12-SEC-06) |
| F-10 | Accept the pattern, plus the missing cases of PR12-SEC-01 |
| F-1, F-2, F-3 (anchor) | Accept. F-1 needs a test with ≥ 11 anchors in TASK-033/116. F-3's `uuidv7()` inside the `audit:anchors` lock is required |
| F-4..F-11 (anchor) | Accept. F-9 and F-12 need the full-walk qualifier (PR12-SEC-05) |
| A-1 | Accept the precedence and every step's event, plus `failure_kinds` or details and equal paging (PR12-SEC-05 c) |
| A-2 | Accept: ADR-0007 am. 6 points to data-model §5.5 (`stream_id ‖ be64(entry_count) ‖ head_hash`, raw-UUID order, empty set = SHA-256("")) |
| A-3 | Accept JCS. The comparison is byte-exact on the line (PR12-SEC-05 b) |
| A-4 | Accept (`clock_timestamp()` rendered by PostgreSQL) |
| A-5 | Accept the WebCrypto P1363 note. TASK-116 uses a strict DER parser (reject non-minimal integers and long-form lengths) |
| A-6 | Accept, with the clamp (PR12-SEC-05 d) |
| A-7 | Accept. Step (iii) runs on the latest anchor that passed (i) and (ii); the run is FAILED regardless |
| RDS §6.1–§6.5 | Desk results accepted. §6.2's residual sentence corrected (PR12-SEC-04). Add M5 checks (g) and (h) |

## 6. Proposed COND-G4-PROD residual-risk statement (replaces SPK-08 §6.2 "Residual risk"; for the G4-production dossier)

> On RDS the master user (a member of `rds_superuser`) keeps an ADMIN-only membership in `platform_audit_owner` and `platform_schema_owner` that it cannot revoke. With it, the master can at any time grant itself `SET`, `SET ROLE platform_audit_owner` and run any audit DDL. The identity guard exempts that role, and PostgreSQL fires no event trigger for role grants, `SET ROLE`, `REASSIGN OWNED` or commands on event triggers. **Against the master, the database therefore provides no prevention, and event triggers provide no detection.** `ENABLE ALWAYS` closes only the `session_replication_role = replica` bypass.
>
> Tamper evidence against this actor consists of:
> 1. The signed anchors:
>    - a change to an anchored head is detected within 1 h;
>    - a rewrite behind an intact anchored head is detected by the nightly full walk within 24 h;
>    - entries newer than the latest anchor (≤ 1 h plus the 15-minute sink retry) can be rewritten undetected.
> 2. The locked anchor sink (Object Lock compliance mode, conditional puts).
> 3. `pgaudit` with `ddl, role, misc_set`, exported to a log group no app, CI or master-adjacent role can alter, with the alarms of PR12-SEC-04.
> 4. The break-glass alarm on every `GetSecretValue` of the master secret.
>
> M5 checks (a)–(h) of SPK-08 §6 and PR12-SEC-04 are G4-production preconditions.

## 7. Routing and follow-ups

| ID | Severity | Owner | Due |
|---|---|---|---|
| PR12-SEC-02 | MEDIUM | principal-architect / data-architect (§5.2, §5.3, readiness rule); TASK-021 (DDL, readiness); TASK-033 (tests) | Spec before TASK-021 starts (batch 0.6); code at TASK-021 merge |
| PR12-SEC-01 | LOW | TASK-033; qa-lead (SEC-TC-61 text) | TASK-033 merge (batch 0.10) |
| PR12-SEC-03 | LOW | principal-architect (§5.2 text); TASK-021 (file, C14) | TASK-021 merge |
| PR12-SEC-04 | LOW (MEDIUM at M5) | database-engineer (SPK-08 §6.2 text, **this PR's fix cycle recommended**); principal-architect / platform-architect (platform.md §4.8 `pgaudit` and filters); TASK-116 (tripwire); release-manager (G4-production checklist) | Text: this PR or before TASK-021; design: before G4-production |
| PR12-SEC-05 | LOW | database-engineer (SPK-08 F-9/F-12 text and `verifyAll` comment, **this PR's fix cycle recommended**); principal-architect (A-1/A-6 in §5.6); TASK-116 | TASK-116 merge |
| PR12-SEC-06 | INFO | TASK-033; TASK-016/021 C13 rows | TASK-033 merge |
| PR12-SEC-07 | INFO | principal-architect (F-01 option); TASK-021 (shadow assertion) | TASK-021 |
| PR12-SEC-08 | INFO | TASK-021/033 (do not port the RLS or the marker); orchestrator (DoD wording) | TASK-021 |
| SEC-P3-37 item 6 | superseded | — | Superseded by PR12-SEC-02 (re-rated MEDIUM) |

The G4-production checklist (P3 review §16.8 C) gains: PR12-SEC-04 (`pgaudit` classes and filters, M5 checks g/h, the upgrade-window procedure) and PR12-SEC-05 item (e).

## 8. ASVS / OWASP mapping

| ASVS 4.0.3 | Status | Findings |
|---|---|---|
| V7.3.3 (security logs protected from unauthorised access and modification) | Design holds against the migrator and `platform_app`. Against a superuser, protection relies on detection | PR12-SEC-04, -05 |
| V7.3.4 (time sources synchronised) | Met: `created_at` comes from `clock_timestamp()` and is signed | PR12-SEC-05 d |
| V1.4.1 / V4.1.3 (trusted enforcement points, least privilege) | Met by owner separation and the no-member roles | PR12-SEC-01, -03 |
| V6.2.1 / V6.2.2 (approved algorithms, fail securely) | Met: ECDSA P-256 / SHA-256, fixed algorithm, key registry by `key_id` | PR12-SEC-05 |
| V1.14.x / V14.1.x (configuration and deployment hardening) | Partially: availability of the audit write path | PR12-SEC-02 |

OWASP 2021 categories as in §4.

Sources: PR #12 @ `2e0aa32` (all 7 files); PostgreSQL REL_18_STABLE `src/backend/tcop/utility.c` (:194–213, :925–928, :1818–1822), `src/backend/commands/event_trigger.c` (:138–143, :597–620, :749, :2236–2256), `src/backend/commands/tablecmds.c` (:21700–21800), `src/backend/commands/user.c` (:1590–1633) and `src/backend/utils/error/elog.c` (:2944–2947), fetched 2026-11-13; PostgreSQL 18 documentation §38.1 *Overview of Event Trigger Behavior*; pgaudit README (classes, log format, substatements); data-model.md §3, §4.4, §4.6, §5.1–§5.6, §7.3, §8.1, §8.3; ADR-0007 am. 7/8; platform.md:344–345, :451–453; security-test-cases.md rows SEC-TC-43/44/61; WAVE-00.md TASK-012/021/033 and WAVE-03.md TASK-116; `prisma/bootstrap/00-roles.sql` and `01-schemas.sql` on `main`; `tools/db/lint-migrations.ts:114`.

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open at head `2e0aa32d4779630df30a712ecbe5d1cb2fa17191`, so the D-ORCH-004 merge rule ("no Critical/High open") is met. 1 MEDIUM (PR12-SEC-02), 4 LOW (PR12-SEC-01, 03, 04, 05) and 3 INFO (06–08). The SPK-08 GO verdict stands for what was tested. It is complete for TASK-021/033 and COND-G4-PROD only with the conditions in §7. The SPK-08 text corrections in PR12-SEC-04 (§6.2) and PR12-SEC-05 (F-9/F-12) are recommended in this PR's fix cycle. PR12-SEC-02 needs a principal-architect spec amendment before TASK-021 starts |
