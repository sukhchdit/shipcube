---
name: project-p5-pr24-audit-store
description: PR #24 (TASK-021 audit store SQL, guard, readiness, shadow init) R1 @6f498c4 2026-11-13 PASS_WITH_CONDITIONS; PR24-SEC-01..09; PG18 probe facts (multirange side effect, SET SCHEMA moves, operator better-match hijack); round-2 checks; Docker lane-probe recipe
metadata:
  type: project
---

The PR #24 review is `docs/05-quality/security/PR-0024-TASK-021-security-review.md`, written uncommitted into the main checkout.

**R1** (head `6f498c4`, 2026-11-13): PASS_WITH_CONDITIONS. 0 Critical/High/Medium.
- **01 LOW, merge condition (C1).** The guard misses side-effect squats:
  - `CREATE TYPE r AS RANGE (…, multirange_type_name = audit_entries_YYYY_MM)` is accepted (live);
  - `SET SCHEMA` moves of indexes and owned sequences (matview/view/table) are latent;
  - `CREATE PROCEDURE`/`AGGREGATE` under audit routine names are accepted.
  - Fix: a post-loop catalogue invariant over `pg_class`/`pg_type`/`pg_proc` in `v_ns` (not owned by the audit owner). Same item as code review R1-M2.
- **02 LOW.** Readiness SQL uses bare `=`. A migrator-planted `public.=(oid, integer)` granted to `platform_app` hides type squats. An ungranted plant gives a permanent 503.
- **03 LOW.** The rule-11 DO-body reader accepts RESETs that never run (literal, dead branch, unused string). Three files flagged by the base linter pass on head.
- **04 LOW.** CODEOWNERS does not cover readiness checks, `shadow-init.ts`, `prisma.config.ts`, `sql-text.ts`, `table-classes/audit.json`, `grants.manifest` or `prisma/tests/**`.
- **05–09 INFO:**
  - 05: E-string, concatenation and `chr()` evade rule 12 in the bootstrap lane;
  - 06: the marker is not content-bound;
  - 07: the advisory-lock key can be held by `platform_app`, and the registry is app-writable;
  - 08: decision 1 out-of-window squats (D-ARCH-081 ratified as implemented; accepted), and no daily `ensure` until TASK-090;
  - 09: agreement with R1-m2 / n2 / n4.
- **Decisions.** 2–6 granted; 1 supported. **Decision 7:** rule-12 approval granted for `10-audit.sql` blob `c3d4db9`. For `90-audit-ddl-guard.sql` it is granted only for the blob with the 01 fix, to be confirmed in round 2 (C2).
- **Sim** (main's checker, scratch shared clone): A pass. Controls B (pr 23), C (FAIL), D (owned commit after head) and E (merge of main, `eslint.config.mjs` overlap) all `missing`. F (unowned `audit-partitions.ts` commit) `pass`, which illustrates 04.

**Facts probed on PG 18.6, 2026-11-13** (re-verify after upgrades):
- **Multirange side effect.** `ddl_command_end` reports only the range type for `CREATE TYPE … AS RANGE`; the multirange with an explicit name is never reported.
- **`SET SCHEMA` moves.** `ALTER TABLE|VIEW|MATERIALIZED VIEW … SET SCHEMA` reports only the relation. Its indexes and owned sequences move silently (views can own sequences).
- **Migrator has no schema of its own.** `platform_migrator` has no `CREATE`/`TEMP` on the DB, because `00-roles` runs `REVOKE ALL ON DATABASE FROM PUBLIC`. Its only writable schemas are `public` and `platform`, which are both protected.
- **Better-match operator hijack.** `pg_catalog` first in `search_path` stops same-signature operator plants but not better-match ones (`oid = integer`, `oid = regclass`, `oid = regnamespace`).
- **Replica mode.** The superuser's UPDATE/DELETE/TRUNCATE/MERGE on the parent and on a partition all raise `AUDIT_IMMUTABLE`. Cloned partition triggers are `'A'`.
- **`sql_drop` `c_idx` prefix.** A migrator-owned matview carrying a squat index cannot be dropped by the migrator; recovery is break-glass.
- **DateStyle.** `ensure` bounds are stable under `DateStyle`/`IntervalStyle` changes (both sides are rendered in-session).

**Docker lane-probe recipe** (scripts in session scratch `review/PR-24-sec/probe/`):
1. Acquire the lock with a background `until mkdir docker.lock; do sleep 3; done` plus an owner file; it was contended by 4 agents.
2. Run `postgres:18@<harness digest>` with `--network none --rm -e POSTGRES_HOST_AUTH_METHOD=trust` and the probe dir mounted `:ro`.
3. Apply the lane with `psql -1 -v ON_ERROR_STOP=1 -v db_name=probe -v migrator_password= -v app_password=` (empty means a NULL password, so no secret literal is involved).
4. Run the cases as `psql -U platform_migrator|platform_app`; trust auth works over the socket.
5. Strip CRs from `run.sh` inside the container.

**Why:** C1/C2 gate the merge, and the LOW/INFO items land in other tasks.

**How to apply:**
- **Round 2 (delta: 01 fix + merge of main).**
  - Confirm the pushed head with `ls-remote`.
  - Confirm the new `90` blob, and that the invariant runs after the loop (also for row-less commands) and excludes the guard function.
  - Confirm test rows: `range_multirange` plus a `platform` twin, L2–L4 in a rolled-back writable schema, procedure/aggregate rows, and the "unrelated DDL refused while a squat exists" control.
  - Check the `eslint.config.mjs` blob against `merge-tree`, the `openapi.yaml` enum and description, and that `types.gen.ts` is regenerated.
  - If 02/03 are fixed: re-run the H1/H2 and w1–w3 probes.
  - PR #20 union: both new events in `RUNTIME_SECURITY_EVENTS` at `error` with the field allow-list.
- **TASK-015:** 04 CODEOWNERS plus R1-m3 bootstrap immutability.
- **TASK-024:** 02 class fix (operator catalog check, `CREATE OPERATOR` lint), 05, 06 optional.
- **TASK-090:** 07 (alert on lock timeout; verify registry rows against the catalogue) and the break-glass runbook for index squats.
- **TASK-033:** PR12-SEC-01/06 cases still owed.

Related: [[project-p5-pr12-spk08-audit]], [[project-p5-pr10-ci-lane]], [[project-p5-wave0-db-baseline]], [[project-p5-pr21-openapi-pipeline]], [[project-security-review-conventions]]
