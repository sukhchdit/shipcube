# PR-0024 / TASK-021: change-scoped security review (audit store SQL in the bootstrap lane, identity DDL guard, catalogue readiness, shadow init)

| Field | Value |
|---|---|
| PR | #24 `feat(db): audit store SQL in the bootstrap lane with identity DDL guard (TASK-021)`, https://github.com/sukhchdit/shipcube/pull/24 |
| Branch | `feat/TASK-021-audit-store-sql-partitioned-audit`. Task commits `6f28dd7`..`4fcf55c` plus a merge of main at `6ac9836` (the merge-base). 85 files, +4,251 / −1,222. Main has since moved to `20d01ea` (includes PR #21 `62e4961`); the branch has not merged it |
| Security-owned paths (CODEOWNERS on main, as lane A run 43357618208 computed them) | `eslint.config.mjs`, `prisma/bootstrap/10-audit.sql`, `prisma/bootstrap/90-audit-ddl-guard.sql`, `tools/db/audit-ddl-reviewers.json`, `tools/db/lint-migrations.ts`, `tools/lint/tenant-context-exemptions.test.ts`, `tools/tsconfig.json` (7). The PR body's wider list (`prisma/**`, `apps/api/src/platform/**`, `tools/db/**`, `openapi.yaml`) is the D-ARCH-021 security-critical set, not CODEOWNERS (PR24-SEC-04) |
| Dependencies | None. `package.json`, `package-lock.json`, `.npmrc` and `.github/**` are untouched (`git diff --stat 6ac9836 6f498c4 -- …` empty), so there is no lock delta and no D-ORCH-021 lever (`RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, folded `run: >`, `$GITHUB_ENV`/`$GITHUB_PATH`) is touched |
| Binding items checked | D-ARCH-076 (PR12-SEC-02/03/04/08), D-ARCH-077, D-SEC-PR12-01, D-TASK012-02, D-TASK021-01 items 1–7; data-model §4.4, §4.6 C6/C7/C14, §5.1–§5.3, §5.7, §7.3, §8.1, §8.3 rule 12; SEC-TC-43, SEC-TC-61; my PR12-SEC-01..08 (PR-0012) and the TASK-021 checks recorded with them; PR11-SEC-11 c/h, PR11-SEC-17 c; PR9-SEC-11; SEC-P3-27, SEC-P3-34; ADR-0005, ADR-0007 am. 7–9; TASK-021 sheet (WAVE-00.md) |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. No command was run in the TASK-021 worktree: sources came from `git archive 6f498c4` / `git archive 6ac9836` in the main checkout into scratch. One Docker probe (P-1) under the shared `docker.lock` directory (held about 90 s, one container, `--network none`, `--rm`). The record-check simulation ran in a scratch `git clone --shared`, removed afterwards |

## 1. Summary

**The audit store is sound where it matters most: immutability holds for every role I could exercise, and the three-layer squatting defence works.** I verified this on a real PostgreSQL 18 (probe P-1, the PR's lane 00→90 applied as written):

- **Immutability.** Under `session_replication_role = replica` the bootstrap superuser's `UPDATE`, `DELETE`, `TRUNCATE` and `MERGE … UPDATE` on the parent and directly on a partition all raise `AUDIT_IMMUTABLE`. Its `DISABLE TRIGGER ALL` on a partition and its `DETACH PARTITION` are refused by the guard. Every audit trigger, including each partition's cloned row trigger and its own `TRUNCATE` trigger, and both event triggers read `'A'`.
- **`ensure_audit_partitions`.** It fails loudly on a squatted name (`AUDIT_PARTITION_NAME_TAKEN`, the whole call rolls back). It is stable under hostile `DateStyle`/`IntervalStyle`. It cannot be hijacked through `pg_temp`, because `platform_app` has no `TEMP` privilege.
- **Readiness.** It reads the catalogue and reports free-standing types.
- **Shadow init.** It refuses before its `DROP SCHEMA`, and it is deny-by-default.

**One guard gap needs fixing before the guard file becomes immutable.** The guard has one live prevention gap: the `multirange_type_name` side effect (PR24-SEC-01). The code reviewer found the same gap independently (R1-M2) on PGlite 17.5; P-1 confirms it on PG 18. It is LOW on the security matrix, because layers 2 and 3 hold (proved) and the migrator credential already holds equivalent availability levers. But it is a **merge condition**: `90-audit-ddl-guard.sql` becomes immutable at its first apply, and the post-loop invariant that closes it also closes the latent schema-move variants (P-1 L2–L4) and the procedure/aggregate plants.

**Further findings, all LOW or INFO:**

- **PR24-SEC-02 (LOW).** The readiness SQL qualifies `~` but not `=`. A migrator-planted `public.=(oid, integer)` operator hides type squats from readiness (proved), and an ungranted plant turns readiness into a permanent 503.
- **PR24-SEC-03 (LOW).** The new rule-11 DO-body reader trusts a `RESET lock_timeout` found in a message literal, a dead branch or an unused string. Three files that the base linter flags now pass, which is a narrow regression.
- **PR24-SEC-04 (LOW).** CODEOWNERS covers none of the new O4 controls outside the bootstrap SQL.
- **INFO 05–09.** Rule-12 lexical residuals (E-strings, concatenation, `chr()`), marker binding, the advisory-lock key, the decision-1 out-of-window squat, and the Wave-0 gap until TASK-090.

**Rulings.** I grant decisions 2, 3, 4, 5 and 6, and support decision 1, which the architect ratifies as implemented (D-ARCH-081, pending). **Decision 7 (rule-12 approval):** approval is granted for `10-audit.sql` as reviewed. For `90-audit-ddl-guard.sql` it is granted only for the blob that carries the PR24-SEC-01 fix, which I will confirm in round 2 (§5).

## 2. Method

| Probe | What it did | Result |
|---|---|---|
| **P-1** PostgreSQL 18.6 (`postgres:18@sha256:e3d24f69…`, the harness digest), one container, `--network none` | Applied the head's `00`→`90` files with psql (`-1` per file, `ON_ERROR_STOP`, empty password variables). Then ran scripted cases as `platform_migrator`, `platform_app` and the superuser (scratch `probe/{m1,a1,s1,m2,a2,m3,a3}.sql`) | Lane OK. Results are in §3 and in the findings. Container removed, lock released |
| **P-2** Linter, head versus base | Imported `lintMigrations`/`lintBootstrap` from the head and from `6ac9836` under Node 24 type stripping (resolve hook `.js`→`.ts`). Ran them over scratch fixtures w0–w4 (rule 11) and u0, e1–e4, c0 (rule 12) | Rule 11: w1/w2/w3 flagged by base, clean on head (PR24-SEC-03). w0/w4 controls unchanged. Rule 12: `U&` now flagged (decision 6). E-string, concatenation and `chr()` forms flagged by neither (PR24-SEC-06). The c0 control is flagged by both |
| **P-3** Shadow rendering | `renderShadowInit(readBootstrapLane(head))`, plus five adversarial inputs | The first statement is the ownership guard. 55 statements kept, 59 stripped (roles 13, GRANT/REVOKE 22, OWNER TO 13, ADP 3, SET/RESET ROLE 2, event triggers 4, guard function 1, role DO 1). `ALTER EVENT TRIGGER`/`DROP SCHEMA`, `CREATE SCHEMA public` and multi-action `OWNER TO` are refused. `SELECT pg_catalog.set_config(…)` is kept, which is harmless: it runs as the migrator on its own empty DB |
| **P-4** Record check | Main's `tools/ci/check-security-owned-paths.mjs` against a scratch `clone --shared` checked out at the head, with negative controls | §8 |
| Source review | All 85 files. In depth: both SQL files, `shadow-init.ts`, `audit-partitions.ts`, `catalog-reader.ts`, `audit-chain.ts`, `readiness.ts`, `runtime.ts`, `map-db-error.ts`, the `lint-migrations.ts` diff, `table-classes*`, `grants.manifest`, `prisma.config.ts`, `audit-external-tables.ts`, `eslint.config.mjs`; the PR12-SEC-02 test matrices in `audit-owner.int.test.ts` and `c11-c14-audit.int.test.ts` | — |
| Evidence relied on | Lane A run 43357618208 on `6f498c4`: fast-lane green; scans green except the record step; gitleaks (PR range, first-parent) and Semgrep green. Developer gate table: integration 213 passed / 1 skipped, coverage 97.89 % / 97.01 %. Code review R1 (`docs/05-quality/reviews/PR-0024-TASK-021-code-review.md`, on main `20d01ea`) | Not re-run (memory-constrained host) |

## 3. Probe P-1 results (PostgreSQL 18.6, the PR's lane)

| # | As | Statement | Result |
|---|---|---|---|
| C1–C11 | migrator | In `public`/`platform` under a partition name: `CREATE INDEX`, `CREATE SEQUENCE`, `ADD CONSTRAINT … UNIQUE`, `RENAME CONSTRAINT`, enum, inline identity `SEQUENCE NAME`, `ADD COLUMN … IDENTITY (SEQUENCE NAME …)`, serial then `ALTER SEQUENCE … RENAME`, composite type, domain in `platform`, function overload `public.ensure_audit_partitions(text)` | **all refused** (guard 42501) |
| **B1** | migrator | `CREATE TYPE public.probe_r AS RANGE (subtype = int4, multirange_type_name = audit_entries_2027_09)` | **accepted**. The multirange is `typtype 'm'`, owned by the migrator |
| **B1b** | migrator | the same through `DO … EXECUTE`, month 2028-06 | **accepted** |
| B5 / B6 | migrator | `CREATE PROCEDURE public.ensure_audit_partitions(bigint)`; `CREATE AGGREGATE platform.audit_forbid_mutation(int)` | **accepted** (the guard's routine branch keys on `object_type = 'function'` only) |
| A0 | app | `CREATE TEMP TABLE` | 42501, no `TEMP` (so `pg_temp` in the definer path is inert) |
| A1 | app | `SET DateStyle='SQL, DMY'; SET IntervalStyle='sql_standard'; SELECT ensure_audit_partitions(3)` | `0`, no `BOUNDS_MISMATCH` |
| A2 | app | `ensure_audit_partitions(12)` with B1 in place | `42501 AUDIT_PARTITION_NAME_TAKEN`, `DETAIL audit_entries_2027_09`. The partitions stay at 4: the whole call rolled back |
| A3 | app | the readiness SQL, verbatim | 4 verified partitions plus the 2027-09 and 2028-06 rows as `kind type` |
| S1–S5 | superuser | `ALTER SCHEMA public\|platform OWNER TO platform_schema_owner`; `COMMENT ON SCHEMA public`; `OWNER TO postgres`; `RENAME` | OK, OK, OK; then guard, guard. Both schemas are still owned by `platform_schema_owner` |
| I1–I6 | superuser, replica | `UPDATE`, `DELETE`, `TRUNCATE`, `MERGE … UPDATE`, on the parent and on partition `2026_11` | all `AUDIT_IMMUTABLE`; the row is still there |
| I7 / I8 | superuser, replica | `ALTER TABLE audit_entries_2026_12 DISABLE TRIGGER ALL`; `DETACH PARTITION audit_entries_2027_02` | guard, guard |
| state | — | `tgenabled` (10 triggers), `evtenabled` (2) | all `A`. Event triggers are owned by the bootstrap role |
| L1 | migrator | table in a hypothetical writable schema `evil` with an index named `audit_entries_2027_05`, then `SET SCHEMA public` | refused (the PR12-SEC-02-a fix works) |
| **L2–L4** | migrator | in `evil`: an owned sequence moved with its table, a matview's index moved with the matview, a view-owned sequence moved with the view | **accepted**: 3 squats land in `public`. **Latent**: the migrator has no `CREATE` on the database (`db_create = f`), so no such schema exists today |
| **H1** | migrator, then app | `CREATE OPERATOR public.= (oid, integer)` over a function returning `false`, `GRANT EXECUTE` to `platform_app`; then the readiness SQL | `1::oid = 1` → `f`. **The two multirange rows vanish** from readiness; relation rows stay |
| **H2** | migrator, then app | `CREATE OPERATOR public.= (oid, regnamespace)`, not granted; then the readiness SQL | `permission denied for function …`: the load rejects, so the critical component reads `unavailable` |
| R1 / R2 / R3 | migrator | drop the B1 range type; drop the moved sequence; drop the moved matview | allowed, allowed, **refused**: the `sql_drop` `c_idx` prefix covers the matview's squat index |

## 4. Findings

### PR24-SEC-01: The guard misses squats that PostgreSQL creates as a side effect of another object's command: the `multirange_type_name` type (live); indexes and owned sequences moved by `SET SCHEMA` (latent); procedure and aggregate plants under audit routine names (LOW; merge condition)

| | |
|---|---|
| Severity | **LOW** on the threat-model matrix. Impact M, assessed as the *delta*: no audit integrity is lost. Layer 2 (`ensure` identity test) and layer 3 (readiness) catch the squat (A2, A3). With decision 1, the first effect is a fleet-wide readiness 503, but the actor (the migrator credential, or a migration that evades the linter through dynamic SQL, since rule 12 catches the literal name) already holds equivalent availability levers. The migrator can remove its own multirange (R1). Likelihood L. **Merge condition** regardless of severity: `90-audit-ddl-guard.sql` is immutable from its first apply (§8.1 ledger sha), and afterwards a fix needs a new NN file with the §5.2 DISABLE → replace → ENABLE ceremony. Same item as code review R1-M2 |
| CWE / OWASP | CWE-386 Symbolic Name not Mapping to Correct Object (secondary CWE-693 Protection Mechanism Failure) · A04:2021 Insecure Design |
| Location | `prisma/bootstrap/90-audit-ddl-guard.sql:57–107` (`ddl_command_end` loop: own-name branch :62–69, routine branch :80–82, relation branch :83–99). `prisma/tests/audit/audit-owner.int.test.ts:516–533` (`KINDS`) and `:572–600` (`IMPLICIT`, `KNOWN_GUARD_GAP = []`) |
| Description | The guard decides per row of `pg_event_trigger_ddl_commands()`, which reports the object the command *returns*, not everything the command creates or moves. (a) **Live.** `CREATE TYPE r AS RANGE (…, multirange_type_name = audit_entries_YYYY_MM)` reports only `r`. The multirange gets an arbitrary name in `public` or `platform` (B1, B1b; code review P1b for `platform`). (b) **Latent.** `ALTER TABLE\|VIEW\|MATERIALIZED VIEW … SET SCHEMA` moves the relation's indexes and owned sequences (`AlterIndexNamespaces`, `AlterSeqNamespaces`) but reports only the relation. The PR12-SEC-02-a branch covers indexes for `table`-like rows only, not `materialized view`, and covers no sequences (L2–L4). This is unreachable today, because `platform_migrator` has no `CREATE` on the database and therefore no non-protected schema. It reopens the day any writable schema exists (for example the M5 dedicated `audit` schema migration, or an extension schema). (c) **Plants.** The routine branch matches `object_type = 'function'` only, so `CREATE PROCEDURE`/`CREATE AGGREGATE` under an audit routine name in a protected schema pass (B5, B6). This is harmless today: callers use `SELECT` with exact signatures and triggers bind by OID. But it contradicts the comment "also stops overloads planted under an audit name". The PR's claims "no relation or type can squat a partition name" and the sheet's "every pg_type kind" are therefore not met |
| Exploitability / impact | (a) needs a migration whose dynamic SQL builds the name, because rule 12 refuses the literal. The effect is immediate and loud: readiness `unavailable` plus the `audit_partition_squatted` event (A3), and the daily `ensure` raises (A2). Writes of that month would fail closed only if both alarms were ignored until the month started. (b) and (c) have no effect today |
| Remediation (TASK-021, this PR, before merge) | Add a **post-loop invariant** at the end of the `ddl_command_end` branch, after the `FOR` loop, so that it also runs for commands that report no rows. It checks the catalogue state the command left, whatever object kind or side effect produced it: `IF EXISTS (SELECT FROM pg_catalog.pg_class c WHERE c.relnamespace = ANY (v_ns) AND c.relname ~ c_tbl AND c.relowner <> v_owner) OR EXISTS (SELECT FROM pg_catalog.pg_type t WHERE t.typnamespace = ANY (v_ns) AND t.typname ~ c_tbl AND t.typowner <> v_owner) OR EXISTS (SELECT FROM pg_catalog.pg_proc p WHERE p.pronamespace = ANY (v_ns) AND p.proname = ANY (c_fn) AND p.proowner <> v_owner AND p.oid <> 'platform.audit_ddl_guard()'::pg_catalog.regprocedure) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'audit objects are immutable (SEC-P3-03)', DETAIL = 'an object squats an audit name in a protected schema'; END IF;`. Use this rather than the narrower `pg_range.rngmultitypid` check, which leaves (b) and (c) open. **Consequences to accept and document in the header:** (1) while any squat exists in `public`/`platform`, every DDL by a non-audit-owner role fails, so migrations stop until break-glass removal. This generalises decision 3's "refuses DDL on a table carrying a squatted index" and is the intended fail-closed behaviour. (2) Dropping the squat itself still succeeds, because the invariant reads the post-drop state. (3) The audit owner's own objects (`audit_entries_YYYY_MM`, their `…_pkey`/`…_idx`, row types) are excluded by `relowner`/`typowner = v_owner`. Correct the R1-n3 comment wording in the same edit |
| Verification | `audit-owner.int.test.ts`: (1) `IMPLICIT` gains `range_multirange` (`CREATE TYPE public.squat_range AS RANGE (subtype = integer, multirange_type_name = public.{name})`) and a `platform` twin, with `KNOWN_GUARD_GAP = []`. (2) A superuser-created writable schema inside the rolled-back transaction, with the L2, L3 and L4 statements → guard 42501. (3) `KINDS` gains `procedure` and `aggregate` under `ensure_audit_partitions`/`audit_forbid_mutation` in `platform` → guard 42501. (4) A control: after a squat planted with the event triggers disabled (rolled back), an unrelated `CREATE TABLE public.ok (id int)` by the migrator → guard 42501, and `DROP` of the squat → OK. (5) The existing 13 `KINDS` and 9 `IMPLICIT` rows, `ensure(12)` and the sanity DDL are unchanged |
| Owner | senior-developer → database-engineer (TASK-021 fix cycle). Round-2 security delta review |

### PR24-SEC-02: The readiness squat detector can be blinded, or turned into a permanent 503, by an operator planted in `public` (LOW)

| | |
|---|---|
| Severity | LOW (Impact M: layer 3 loses same-day detection of type squats. The missing-month check still works, because an operator can only filter rows, not fabricate an audit-owned partition, so a squat surfaces at the latest once its month enters [current, current + 2]. The ungranted variant is a permanent fleet 503. Likelihood L: needs a migration that creates an operator, which no linter rule refuses, and, for the stealth form, `GRANT EXECUTE … TO platform_app`, which is invisible to the guard) |
| CWE / OWASP | CWE-426 Untrusted Search Path (CWE-427 class, the CVE-2018-1058 pattern) · A08:2021 Software and Data Integrity Failures |
| Location | `apps/api/src/platform/health/checks/audit-partitions.ts:32–46` (`PARTITION_CATALOGUE_SQL`): bare `=` at `i.inhparent = …to_regclass(…)` (oid = regclass), `c.relnamespace = 'public'::pg_catalog.regnamespace` and `t.typnamespace = …` (oid = regnamespace), `t.typrelid = 0` (oid = integer). Only `~` is written `OPERATOR(pg_catalog.~)`. `prisma/bootstrap/00-roles.sql:55` (`platform_app` `search_path = pg_catalog, public`); `00-roles.sql:46` (migrator `CREATE` on `public`) |
| Description | `pg_catalog` first in the path stops a *same-signature* plant, but not a *better-match* plant. With `public.=(oid, integer)` in place, the exact match beats `pg_catalog.=(oid, oid)`, which needs a coercion (H1: `1::oid = 1` is `f`). In the readiness SQL that silently drops every `typrelid = 0` row, so multirange, enum and domain squats disappear from A3's output. A plant on `(oid, regnamespace)` without the grant makes every readiness load fail with `permission denied` (H2), so readiness reads `unavailable` until an operator investigates |
| Exploitability / impact | Same actor class as PR24-SEC-01. Combined with PR24-SEC-01 (a), a type squat is hidden from readiness, and only `ensure`'s daily failure remains as an early signal. That is an alert that does not exist until TASK-090 |
| Remediation | (1) **TASK-021 fix cycle (recommended, cheap; `audit-partitions.ts` is not under CODEOWNERS, so it can be changed in any commit):** write every operator in `PARTITION_CATALOGUE_SQL` (and in `LATEST_VERIFICATION_SQL`, for consistency) as `OPERATOR(pg_catalog.=)` / `OPERATOR(pg_catalog.<>)`, or cast both sides to `oid` so that only same-signature resolution applies. (2) **Class fix (principal-architect → TASK-024):** a C-series catalog assertion that `pg_operator` in `public`/`platform` holds only extension members (`pg_depend` `deptype = 'e'`), plus a rule-16-style lint refusal of `CREATE OPERATOR` in `prisma/migrations`. Runtime SQL of security controls is fully qualified (the data-model §4.2 standard) |
| Verification | `prisma/tests/health/audit-readiness.int.test.ts`: plant `public.=(oid, integer)` with the grant, plus a multirange squat (with the guard disabled in the rolled-back transaction, or the SEC-01 test fixture) → the evaluation still lists the `type` row. Plant `(oid, regnamespace)` without the grant → the query still succeeds. A unit test asserts that the SQL text has no bare comparison operator outside `OPERATOR(pg_catalog.…)` |
| Owner | senior-developer (TASK-021 fix cycle, else TASK-033 with the readiness guard-disabled variant). principal-architect / TASK-024 for the class fix |

### PR24-SEC-03: Rule 11's new DO-body reader clears a raised `lock_timeout` on a RESET that never executes (narrow regression against the base linter) (LOW)

| | |
|---|---|
| Severity | LOW (Impact M: rule 11 is the D-ARCH-071 control that keeps a raised `lock_timeout` from leaking into later files, so migration lock waits do not stall application traffic. A regression lets such a file pass. Likelihood L: `prisma/migrations` is a security-owned path, and the evasion is visible in review) |
| CWE / OWASP | CWE-697 Incorrect Comparison (secondary CWE-1287) · A04:2021 |
| Location | `tools/db/lint-migrations.ts:310–378` (`DO_LOCK_TIMEOUT`, `doBlockLockTimeouts`: "every literal is read as possible dynamic SQL") and `:664–668` (the events update `sessionLockTimeoutMs`, a `reset` clears it) |
| Description | Reading every literal as dynamic SQL is fail-closed for SETs and **fail-open for RESETs**. P-2 against the base linter `6ac9836`, each file starting `SET lock_timeout = '10s';`: w1 `DO $$ BEGIN RAISE NOTICE 'RESET lock_timeout'; END $$;`, w2 `DO $$ BEGIN IF false THEN RESET lock_timeout; END IF; END $$;` and w3 `DO $$ DECLARE s text := 'RESET lock_timeout'; BEGIN PERFORM 1; END $$;` are all **flagged by base (rule 11) and clean on head**. `doBlockLockTimeouts` returns `[{kind:'reset'}]` for w1 and w2. The w0 (raised, no reset) and w4 (top-level reset) controls are unchanged |
| Exploitability / impact | Only a deliberately written or careless DO body, but it defeats the "outcome control: the next file's own leading `SET lock_timeout`" only for the next file. The leak persists for the rest of the migrate session |
| Remediation (TASK-021 fix cycle, recommended; otherwise TASK-024 with the setter-key half) | Make RESETs asymmetric. A DO-body `reset` event never lowers the tracked value. Only a top-level `RESET lock_timeout` or a top-level `SET` at or below the role default does. Alternatively, count a DO-body RESET only at nesting depth 0, outside any literal, not after `IF`/`THEN`/`ELSE`/`ELSIF`/`WHEN`/`LOOP`/`EXCEPTION`, and after the last DO-body SET. Under the simple form the `do_set_then_reset` fixture flips to a finding, and that is acceptable: add the one-line top-level RESET. Also list the depth > 4 behaviour (code review R1-n1) in "Stated limits", or fail closed there |
| Verification | `tools/db/lint-migrations.test.ts`: w1, w2 and w3 as fixtures under `lock-timeout-do-body`, expected rule 11. A unit case `doBlockLockTimeouts("DO $$ BEGIN RAISE NOTICE 'RESET lock_timeout'; END $$")` must not yield a clearing event |
| Owner | senior-developer (TASK-021 fix cycle) or TASK-024 |

### PR24-SEC-04: The new O4 controls outside the bootstrap SQL are not security-owned, so they can be weakened without a security record (LOW)

| | |
|---|---|
| Severity | LOW (Impact M: an unreviewed edit could neuter squat detection, the shadow-init refusal, the C6/C7/C14 assertions or the C5 oracle. Likelihood L: a deliberate weakening still needs to get past code review) |
| CWE / OWASP | CWE-1220 Insufficient Granularity of Access Control (process control) · A04:2021 |
| Location | `.github/CODEOWNERS` on main. Not covered: `apps/api/src/platform/health/checks/audit-{partitions,chain}.ts`, `catalog-reader.ts`; `tools/db/shadow-init.ts` (pre-gate: it runs at every `prisma.config.ts` load, including `deps:rebuild`, the PR4-SEC-13 class); `prisma.config.ts`; `tools/db/sql-text.ts` (the tokenizer rules 11–16 depend on); `tools/db/table-classes.ts` and `tools/db/table-classes/audit.json` (the C7 `immutable` oracle); `prisma/sql/grants.manifest` (the C5 oracle); `prisma/tests/audit/**`, `prisma/tests/catalog/**`, `prisma/tests/health/**` |
| Description | Lane A's record step binds a security review only to CODEOWNERS paths (7 here). D-ARCH-021's security-critical set (`prisma/**`, `apps/api/src/platform/**`, …) drives a hosted `security-integration` job that does not exist yet (TASK-015), so nothing binds those paths today. Weakening an *oracle* (removing `immutable: true`, deleting a C14 row, dropping the squat branch of `evaluatePartitions`) needs no owned-path change. Code review R1-m3 (bootstrap-file immutability is checked only at runtime) is the sibling gap |
| Exploitability / impact | Silent weakening of evidence for O4/O5, which then stays green |
| Remediation | devops-engineer (TASK-015, which also owns R1-m3 and PR10-SEC-20): add to CODEOWNERS `/prisma/` (whole: tests, sql, schema), `/tools/db/`, `/prisma.config.ts`, `/apps/api/src/platform/` (or at least `…/health/checks/` and `…/db/`), and `/packages/audit/` (already listed). Also extend `check-migration-immutability.mjs` to `prisma/bootstrap/*.sql` (modified or deleted files refused, added allowed; R1-m3) |
| Verification | `check-security-owned-paths.test.ts` cases: a change to `apps/api/src/platform/health/checks/audit-partitions.ts` and one to `tools/db/table-classes/audit.json` each require a record |
| Owner | devops-engineer (TASK-015); orchestrator to schedule (CODEOWNERS is itself owned) |

### PR24-SEC-05 (INFO): Rule 12's lexical residuals in the bootstrap lane extend beyond `U&`

P-2 shows that `EXECUTE E'SET ROLE platform\x5faudit_owner'`, `EXECUTE 'SET ROLE platform' || '_audit_owner'` and `'DROP TABLE public.' || chr(97) || 'udit_partitions'` in a bootstrap DO block need no marker. These are the same class as decision 6 (and PR11-SEC-16 for E-strings in migrations). The guard still refuses any later DDL on audit objects by name or owner, and the bootstrap lane is security-owned. The exception is a `SET ROLE platform_audit_owner` reached this way, which makes the guard exempt. **Fix (TASK-024, with PR11-SEC-16; consistent with decision 6):** in `prisma/bootstrap`, any `escaped` string token, or any `EXECUTE` whose operand is not a single plain literal, counts as audit DDL needing the marker. Keep the `AUDIT_OWNER_CREATION_BLOCK` hash exemption so that the immutable `00-roles.sql` is unaffected. Fixtures e1–e4.

### PR24-SEC-06 (INFO): The rule-12 marker records a reviewer and a date, not a review of specific content

Once `security-analyst` is in `audit-ddl-reviewers.json`, any bootstrap file can carry `-- @audit-ddl security-approved: security-analyst 2026-11-13` and pass rule 12. An in-place edit of `10-audit.sql` or `90-audit-ddl-guard.sql` keeps a valid marker. The binding is therefore:

1. this record's blob SHAs (§5, decision 7);
2. the ledger sha after the first apply;
3. lane A's owned-path record (both files are owned).

Recommended: R1-m3's base-versus-head immutability check for `prisma/bootstrap` (TASK-015). Optionally, a marker that carries the file's content hash in a later linter revision (TASK-024). No change is required in this PR.

### PR24-SEC-07 (INFO): `ensure_audit_partitions`' advisory-lock key can be held by any role; the registry is app-writable

`pg_advisory_xact_lock(hashtext('audit:partitions'))` (`10-audit.sql:340`) can be pre-empted. `platform_app` can hold `pg_advisory_lock` on the same key at session level, which survives `idle_in_transaction_session_timeout`. Every `ensure` call then fails after `lock_timeout = 5s`. The effect is delayed and detected: readiness reads `degraded` when current + 3 is missing, and `unavailable` about a month later. Concurrent `ensure` calls without the lock fail loudly anyway (duplicate `CREATE TABLE`).

`public.audit_partitions` is `INSERT`/`UPDATE` for `platform_app`, and `ensure` uses `ON CONFLICT DO NOTHING`, so a pre-inserted row keeps its forged `range_*`.

**TASK-090:** the job alerts on every `ensure` failure, including a lock timeout. Archive and close logic must verify each registry row against the catalogue (`pg_inherits`, bounds), never trust it (the D-ARCH-076 principle). If `ensure` is ever revised in a new NN file, lock an audit-owned table with no grants instead of an advisory key.

### PR24-SEC-08 (INFO): Decision 1: out-of-window squats and the Wave-0 gap until TASK-090

(a) **A squat outside the window.** A squat outside [current, current + 2] takes every API and worker instance out of rotation today, although writes are unaffected until its month. My PR12-SEC-02 item 3 wording ("`unavailable` … whatever the month") assumed that the readiness status was the only reliable signal.

Once code review R1-m2 lands (the squat event at `error` through the security sink, D-ORCH-025), the event is the signal. Code review R1-m1 therefore proposed: for an out-of-window squat, emit the event and report `degraded`; an in-window squat already reads as a missing month. After the PR24-SEC-01 invariant, only a superuser or a guard-disabled session can plant a squat at all.

The architect's SHEET-FOLD-2 ruling (D-ARCH-081, being written in the main checkout during this review) ratifies decision 1 **as implemented**, with `unavailable` for any squat, and routes the event through the PR #20 sink at `error`. **Security accepts that ruling.** The fleet-wide 503 is a deliberate fail-closed amplification of an event that, after C1, requires superuser-level tampering.

(b) **No daily `ensure` caller exists until TASK-090** (Wave 2, batch 2.4). A long-lived database bootstrapped in month M therefore reads `unavailable` from M + 2. This is operational, not security; route it to senior-developer/devops: a compose or `db:migrate` step calling `ensure_audit_partitions(3)` as `platform_app`, or documented `db:reset`.

### PR24-SEC-09 (INFO): Agreement with code review items that touch security

| Item | Agreement |
|---|---|
| R1-m2 | Log `security.audit_partition_squatted` at `error` through the security-event sink. For the PR #20 union, allow-list `name`/`kind`/`reason` (never an owner). |
| R1-n2 | `pendingCheck('audit_partitions')` now reads `ok`, which reverses PR9-SEC-11 for any future mis-wiring. Make `pendingCheck` throw for `audit_*`. |
| R1-n4 | Do not cache an `unavailable` evaluation for 60 s. |

None of these blocks the merge on its own.

## 5. Rulings on D-TASK021-01

| # | Decision | Ruling |
|---|---|---|
| 1 | `audit_partitions` critical with three states; openapi enum gains `unavailable` | **Supported.** It implements data-model §5.3 item 3 / D-ARCH-076 (3), and the `unavailable` path never leaks internals: the body carries the component state only, while names, kinds and reasons go to the log event. Counts go to the start-up line. `degraded` from a component without it in the enum fails closed. The architect ratifies it as implemented (SHEET-FOLD-2, D-ARCH-081, pending commit), and security accepts that, including `unavailable` for out-of-window squats (PR24-SEC-08 (a)) |
| 2 | Schema branch admits the no-op `ALTER SCHEMA public\|platform OWNER TO platform_schema_owner` | **Granted.** The post-state rule admits exactly the commands that leave a protected schema named `public`/`platform` and owned by `platform_schema_owner`. Only the superuser or the NOLOGIN, member-less schema owner can issue them. `OWNER TO` another role and `RENAME` still raise (S3, S4). The one widening, `COMMENT ON SCHEMA`/`SECURITY LABEL` on those schemas (S2), is harmless. A future protected schema with another name (M5 `audit`) is outside `c_nsnm`, so it fails closed. Reword the comment (R1-n3) |
| 3 | PR12-SEC-02-a fixed in place (index names of the altered relation) | **Granted.** Neither file exists on main or in any shared database, so in-place editing is correct (the same reasoning makes PR24-SEC-01 a merge condition). L1 and C3/C4 prove the fix. Its residuals (matview, owned sequences) are closed by the PR24-SEC-01 invariant. The `c_idx` drop block makes a migrator-owned relation carrying a squat index undroppable by the migrator (R3), so recovery is break-glass. Put this in the TASK-090 runbook |
| 4 | Audit files deliberately not idempotent | **Granted.** Plain `CREATE` refuses planted objects (PR12-SEC-03), and the ledger applies each file once |
| 5 | Shadow init refuses a non-empty `public` | **Granted** (security-positive, beyond PR12-SEC-07). P-3: the guard is the first statement and runs before `DROP SCHEMA IF EXISTS platform CASCADE`. Keep it |
| 6 | Any `U&` token in the bootstrap lane needs the marker (refused, not decoded) | **Granted.** P-2 u0 is flagged, and this closes PR #5 R2-n1. It covers `U&` only; E-strings, concatenation and `chr()` remain (PR24-SEC-05 → TASK-024) |
| 7 | `security-analyst` added to `audit-ddl-reviewers.json`; markers dated 2026-11-13 | **Reviewer entry: approved.** **Rule-12 approval:** `prisma/bootstrap/10-audit.sql` at blob `c3d4db9f3125d4915c0ff9d1ce1132d0e8e0e713` is **approved**. `prisma/bootstrap/90-audit-ddl-guard.sql` at blob `de730298eeca4024ee853cc589880921cb64383e` is **not approved as final**: approval is granted for the blob that implements the PR24-SEC-01 invariant, to be confirmed by blob SHA in round 2. The marker date may stay 2026-11-13 if the fix lands today |

## 6. Immutability per database role (O4)

| Role | UPDATE / DELETE / TRUNCATE on `audit_entries` and partitions | DDL on audit objects | Evidence |
|---|---|---|---|
| `platform_app` | Privilege (SELECT, INSERT only; zero privileges on partitions) | Privilege (no CREATE) | AT-US-094-01/02 (C5), `grants.manifest` |
| `platform_migrator` | Privilege | Privilege; guard for planted names (PR24-SEC-01 residual) | AT-US-094-01/05, SEC-TC-43 (24 statements ×2), P-1 C1–C11 |
| `platform_erasure` (NOLOGIN until M4/M5) | No privilege on `audit_entries`. Vault `DELETE` only through `audit_vault_guard` | Privilege | `10-audit.sql:399–401`; generated per-role suite → TASK-033 |
| `platform_definer`, `platform_schema_owner` | No privilege. The schema owner could `DROP SCHEMA … CASCADE` → guard `sql_drop` (name fallback) | Guard | C14 converse (the schema owner owns 0 objects); TASK-033 per-role suite |
| `platform_audit_owner` (NOLOGIN, no members) | Triggers raise (`AUDIT_IMMUTABLE`) | Owner and guard-exempt by design; no member can reach it (C13) | `c11-c14` AT-US-094-01 (owner) |
| Bootstrap superuser | Triggers `ENABLE ALWAYS` raise, also in replica mode (P-1 I1–I6) | Guard (I7, I8). **Not covered:** `event_triggers = off`, `ALTER EVENT TRIGGER … DISABLE`, `REASSIGN OWNED` (documented limits, D-ARCH-076 (5); TASK-116 tripwire; COND-G4-PROD) | P-1, C6/C14 |

## 7. Union with main (PR #21) and the next round

**Overlap.** `comm -12` of `git diff --name-only 6ac9836 origin/main` and `… 6ac9836 6f498c4` gives `docs/03-architecture/api/openapi.yaml` (unowned) and **`eslint.config.mjs` (owned)**. Merging main into the branch therefore **voids this record** (clause d). Code review R1-M1 shows that the merge is required and is not a pure union. `git merge-tree --write-tree 6f498c4 origin/main` is clean.

The next security round (a delta round: the PR24-SEC-01 fix plus the merge) must check the following:

1. **The merge commit is the pushed head.** `git ls-remote origin` shows the PR branch at the merge commit, and the record names it, not a local commit.
2. **Changed paths.** `git diff --name-only <main parent> <merge head>` equals the PR's net-change paths plus R1-M1's `packages/shared/src/api/types.gen.ts` and `tests/api/contract-validation.api.test.ts`. Both are unowned.
3. **`eslint.config.mjs`.** The blob equals the `git merge-tree` result: main's `types.gen.ts` global ignore and the two PR #21 blocks (`tools/openapi/drift.test.ts`, `tests/api/**/*.api.test.ts` with the `^(?:\.\./)+apps/api/src/` ignore, PR21-SEC-09 / TASK-020), plus this PR's `spk08` exemption removal, and nothing else.
4. **`openapi.yaml`.** The `HealthReady.audit_partitions` enum is `ok, degraded, unavailable`, and the `getReadiness` description is three-state (R1-M1 c). `openapi:types --check` exits 0, and the contract test uses `isCriticalComponent`.
5. **Other owned blobs.** Every other owned blob equals this round's, except `90-audit-ddl-guard.sql` (PR24-SEC-01). Re-verify its marker line and confirm its new blob SHA for decision 7.
6. **If PR24-SEC-03 is fixed in-PR,** `tools/db/lint-migrations.ts` changes too. Re-run P-2 w1–w3.
7. **Gates on the final head.** Lane A green; integration re-run with the new `audit-owner` rows.
8. **The PR #20 union applies to whichever PR merges second** (R1-m2): `DbSecurityEvent` gains `audit_mutation_rejected`/`audit_partition_squatted` in `RUNTIME_SECURITY_EVENTS`/`SECURITY_EVENT_LEVEL`, and the squat fields are allow-listed.

## 8. Record-check simulation (P-4)

Main's `tools/ci/check-security-owned-paths.mjs` (extracted with `git archive origin/main tools/ci`) was run with `--root <scratch clone --shared, checked out at the head, this record copied in> --head <ref> --pr <n> --json`. `--base` was `6c70178` (the `RANGE_BASE` of run 43357618208) unless noted. The clone was removed afterwards.

| Case | Input | Result |
|---|---|---|
| A | this record, `--pr 24`, head `6f498c4` (also with `--base` = main tip `360f419`) | `pass`, 7 owned paths, satisfied by this record at `6f498c4` |
| B | `--pr 23` | `missing` (no `PR-0023-*` record) |
| C | last Verdict row rewritten to `FAIL` | `missing` (verdict not accepted) |
| D | a scratch commit on top of the head appending a comment to `90-audit-ddl-guard.sql` (the shape of the C1 fix) | `missing`: "`90-audit-ddl-guard.sql` changed after it" |
| E | a scratch merge of main (`360f419`) into the head, `--base 360f419` | `missing`: "`eslint.config.mjs` changed after it" (the §7 union) |
| F | a scratch commit on top of the head changing `apps/api/src/platform/health/checks/audit-partitions.ts` | `pass`: an unowned change to the squat detector keeps the record valid (PR24-SEC-04) |

## 9. Routing

| ID | Severity | Owner | Due |
|---|---|---|---|
| PR24-SEC-01 | LOW (merge condition) | senior-developer → database-engineer | **Before merge** (TASK-021 fix cycle); round-2 delta review |
| PR24-SEC-02 | LOW | senior-developer (TASK-021 fix cycle, recommended); principal-architect / TASK-024 (class fix) | Fix cycle, else TASK-033 |
| PR24-SEC-03 | LOW | senior-developer (TASK-021 fix cycle, recommended), else TASK-024 | Fix cycle, else TASK-024 |
| PR24-SEC-04 | LOW | devops-engineer (TASK-015); orchestrator | TASK-015 |
| PR24-SEC-05 | INFO | TASK-024 (with PR11-SEC-16) | TASK-024 |
| PR24-SEC-06 | INFO | TASK-015 (bootstrap immutability, R1-m3); TASK-024 (optional content-bound marker) | TASK-015 |
| PR24-SEC-07 | INFO | TASK-090 | TASK-090 |
| PR24-SEC-08 | INFO | (a) none further: D-ARCH-081 ratifies as implemented; (b) senior-developer / devops (Wave-0 `ensure` caller) | (b) before long-lived stacks reach M + 2 |
| PR24-SEC-09 | INFO | senior-developer (R1-m2 in-PR; R1-n2/n4 optional) | Fix cycle |

**Closed by this PR (verified):**

- PR12-SEC-02 items 1–3, apart from the PR24-SEC-01 residual, which the merge condition closes.
- PR12-SEC-03 (plain `CREATE`, C14 owner, converse and `pg_depend`).
- PR12-SEC-04 item 3 (`ENABLE ALWAYS` everywhere, P-1 state).
- PR12-SEC-07 (shadow refusal; the F-01 lane reorder was not adopted).
- PR12-SEC-08 (no RLS on `audit_entries`; a real marker).
- PR11-SEC-11 c (prefix-only mapping, 23514 included).
- PR11-SEC-11 h (not needed).
- PR #5 R2-n1 (`U&`).
- PR9-SEC-11 for the real wiring (see R1-n2 for the stub).
- The PR12 TASK-021 check list from my memory.

**Still owed elsewhere:** TASK-033 (PR12-SEC-01 privilege-denial cases, the guard-disabled readiness variant, `DETACH … CONCURRENTLY` residue, the per-role suite, PR12-SEC-06 operator plants for `ensure`), TASK-116 (`evtenabled`/`tgenabled` tripwire), and COND-G4-PROD (PR12-SEC-04 `pgaudit`).

## 10. ASVS / OWASP mapping

| ASVS 4.0.3 | Status | Findings |
|---|---|---|
| V7.3.3 (security logs protected from modification) | Met for every non-superuser role; against the superuser, by triggers plus detection (documented limits) | PR24-SEC-01, -07 |
| V1.4.1 / V4.1.3 (trusted enforcement points, least privilege) | Met: owner separation, a no-member owner, one definer with a pinned path and qualified calls (P-1 A0/A1) | PR24-SEC-01 |
| V1.14.x / V14.1.x (build and deployment hardening; pre-gate code) | Partially: `prisma.config.ts` now executes `tools/db/shadow-init.ts`, both unowned | PR24-SEC-04 |
| V14.2.x (dependency and configuration integrity of security controls) | Partially: readiness SQL is not fully qualified | PR24-SEC-02 |
| V7.1.x / V7.4.1 (no sensitive data in logs or errors) | Met: readiness body is states only; `mapDbError` never copies the message; rendering previews blank literals | — |

OWASP 2021 categories as in §4.

Sources: PR #24 at the head below (all 85 files, via `git archive`); merge-base `6ac9836` (linter base); PostgreSQL 18.6 behaviour observed in P-1; code review R1 (`docs/05-quality/reviews/PR-0024-TASK-021-code-review.md`, main `20d01ea`); lane A run 43357618208; `.github/CODEOWNERS` and `tools/ci/check-security-owned-paths.mjs` on main; DECISIONS.md D-ARCH-021, D-ARCH-076, D-ORCH-021, D-ORCH-022, D-ORCH-025, D-TASK021-01; PR-0012 (PR12-SEC-01..08); WAVE-00.md TASK-021, WAVE-02.md TASK-090.

## Round 1 (head 6f498c41169bc098a0d7a5a028d72ce000cdf062)

| Field | Value |
|---|---|
| Head | 6f498c41169bc098a0d7a5a028d72ce000cdf062 |
| Scope | Net change `6ac9836..6f498c4` (85 files). Owned: `eslint.config.mjs`, `prisma/bootstrap/10-audit.sql`, `prisma/bootstrap/90-audit-ddl-guard.sql`, `tools/db/audit-ddl-reviewers.json`, `tools/db/lint-migrations.ts`, `tools/lint/tenant-context-exemptions.test.ts`, `tools/tsconfig.json` |
| Findings | 0 Critical, 0 High, 0 Medium. 4 LOW: PR24-SEC-01 (merge condition), 02, 03, 04. 5 INFO: 05–09 |
| Conditions | **C1** PR24-SEC-01 fixed in this PR with the §4 verification rows. **C2** A round-2 delta record naming the final pushed head (the SEC-01 fix plus the merge of main, §7), which confirms the rule-12 approval of the final `90-audit-ddl-guard.sql` blob. Recommended in the same fix cycle: PR24-SEC-02, PR24-SEC-03, R1-m2 |
| **Verdict** | **PASS_WITH_CONDITIONS.** No Critical, High or Medium finding is open at head `6f498c41169bc098a0d7a5a028d72ce000cdf062`. Audit immutability holds for every role exercised. The three-layer squat defence holds (layers 2 and 3 proved on PG 18). Decisions 2–6 are granted and decision 1 is supported. Rule-12 approval is granted for `10-audit.sql` (blob `c3d4db9`); for `90-audit-ddl-guard.sql` it is granted for the blob that implements PR24-SEC-01 (C1), to be confirmed in round 2 (C2). Merging main (owned overlap `eslint.config.mjs`) or committing the C1 fix voids this record for lane A, by design |

## Round 2 (head 7662672)

| Field | Value |
|---|---|
| Head | 766267223e2adba6e29c14d5e34c9c86dec3128c |
| Delta reviewed | Fix commits `2318e55` (C1 guard invariant), `3fd85d0` (readiness SQL, squat event, R1-n2/n4), `362f9f2` (rule 11, R1-n1), `5020ac6` (three-state contract). Also the normal merges of main: `1fb76c1` (main at `6fd801f`) and the head `7662672` (main at `ccc1082`). Developer comment: https://github.com/sukhchdit/shipcube/pull/24#issuecomment-6846588883 |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. No command ran in the TASK-021 worktree: sources came from `git archive` / `git show` in the main checkout into scratch. One Docker probe ran under the shared `docker.lock` directory (held about 2 min, one container, `--network none`, `--rm`, released). The record-check simulation ran in a scratch `git clone --shared`, which was removed afterwards |

### R2.1 Summary

**C1 is met, and the round-1 conditions close.** This record is C2.

- **PR24-SEC-01 closed.** The post-loop invariant in `90-audit-ddl-guard.sql` refuses every side-effect squat from round 1 on real PostgreSQL 18.6:
  - multirange in `public`, in `platform`, and through `DO … EXECUTE`;
  - procedure and aggregate plants;
  - `SET SCHEMA` moves L2–L4.

  It also refuses three variants round 1 did not list: range and multirange **constructor routines** named like audit routines (G6–G8). The same cases run against the round-1 guard blob in a second database are all accepted, which is the mutation control.
- **PR24-SEC-02 closed.** With both operator plants in place, the head's readiness SQL still reports the type squats (H1) and still loads (H2). The round-1 SQL under the same plants hides the rows and then fails, which is the positive control.
- **PR24-SEC-03 closed.** The three never-executed RESETs (w1–w3) are flagged again, as are the DO-body lowering SET (w5) and the depth-5 literal (R1-n1).
- **Rule-12 approval (decision 7): granted for `prisma/bootstrap/90-audit-ddl-guard.sql` at blob `9aab9aaab73fcb53e3f8a5e835d7d451af606be3`.** `prisma/bootstrap/10-audit.sql` at blob `c3d4db9f3125d4915c0ff9d1ce1132d0e8e0e713` is unchanged and stays approved.

**Two new items, neither blocking:**

- **PR24-SEC-10 (LOW).** `CREATE INDEX CONCURRENTLY` (CIC) under an audit name survives the guard's refusal as an INVALID index. It is live for the migrator credential outside the linted lane, it predates this round, and the guard cannot fix it.
- **PR24-SEC-11 (INFO).** Rule 11 trusts a top-level RESET inside a transaction that is rolled back. This predates the PR.

**Correction to round 1.** PR24-SEC-08 (a) says that after the invariant "only a superuser or a guard-disabled session can plant a squat at all". That is wrong for CIC (PR24-SEC-10). The D-ARCH-081 acceptance still stands, because the migrator credential can already take the fleet out of rotation by other means, for example by revoking `platform_app`'s grants.

### R2.2 Round-1 §7 checklist

| # | Check | Result |
|---|---|---|
| 1 | The merge commit is the pushed head | **Met.** `git ls-remote origin` shows `refs/heads/feat/TASK-021-audit-store-sql-partitioned-audit` and `refs/pull/24/head` at `7662672`. Its parents are `5020ac6` (first) and `ccc1082` (main). The merge-base with main is `ccc1082` |
| 2 | Changed paths | **Met.** `git diff --name-only ccc1082 7662672` gives 94 paths: round 1's 85 net-change paths (none removed), plus `packages/shared/src/api/types.gen.ts`, `tests/api/contract-validation.api.test.ts`, `apps/api/src/platform/health/health.int.test.ts` and the six w1–w3 fixture files under `tools/db/fixtures/lint/migrations/lock-timeout-do-body/`, all unowned. Under main's CODEOWNERS (`5107f1e`, which adds `/tools/quality/` from PR #23) the owned set is the same 7 paths as round 1 |
| 3 | `eslint.config.mjs` equals `merge-tree` | **Met.** The head blob `b782cfc` equals the `eslint.config.mjs` blob of `git merge-tree --write-tree 6f498c4 ccc1082` and of `… 5020ac6 ccc1082`. The net delta against main is exactly round 1's SPK-08 exemption removal (3 lines). The head tree `4b47e3a` equals `merge-tree(5020ac6, ccc1082)`, so there are no hand edits in the merge. The first merge `1fb76c1` equals `merge-tree(6f498c4, 6fd801f)`. The tree diff from `merge-tree(6f498c4, ccc1082)` to the head is exactly the 24 paths of the four fix commits |
| 4 | `openapi.yaml` and generated types | **Met.** The `HealthReady.components.audit_partitions` enum is `ok, degraded, unavailable`, with a contiguity description. The `getReadiness` description states the three-state rule and cites D-ARCH-081. `types.gen.ts` carries `'ok' \| 'degraded' \| 'unavailable'` and both descriptions. `contract-validation.api.test.ts` imports and uses `isCriticalComponent`. I did not re-run `openapi:types --check`; the developer reports exit 0, and lane A's fast-lane is green |
| 5 | Other owned blobs; new `90` blob and marker | **Met.** These are unchanged from round 1: `10-audit.sql` `c3d4db9`, `audit-ddl-reviewers.json` `50b43eb`, `tenant-context-exemptions.test.ts` `169152d`, `tools/tsconfig.json` `7ac5ee0`. Changed: `90-audit-ddl-guard.sql` (`de73029` to `9aab9aa`, only in `2318e55`), `lint-migrations.ts` (`d9a2190` to `56853be`, only in `362f9f2`) and `eslint.config.mjs` (merge only). The `90` diff adds the header paragraph, three variables, the `procedure`/`aggregate` widening, the schema-comment rewording (R1-n3) and the invariant block, and nothing else. Marker line 3 still reads `-- @audit-ddl security-approved: security-analyst 2026-11-13`. The head linter over the real `prisma/migrations` and `prisma/bootstrap` gives 0 findings. With an empty reviewer list, the control flags exactly `10-audit.sql` and `90-audit-ddl-guard.sql` |
| 6 | PR24-SEC-03 fixed in-PR | **Met** (P-2, §R2.4) |
| 7 | Gates | **Met for security.** Lane A run 43383529879 on `7662672`:<br>- fast-lane is green: lint, type-check, unit, build and porcelain, the base-ref negative fixtures, `quality:check-evidence`;<br>- in scans, gitleaks (PR range, first-parent) and Semgrep are green;<br>- the record step fails as expected, because round 1 is void.<br><br>The developer's integration run (218 passed, 1 skipped) was on `70afa8b`, and coverage (97.79 % / 97.02 %) on `5fef0e1`:<br>- `70afa8b` differs from the head only in PR #23 and PR #25 paths (`tools/quality/**`, `tools/ci/**`, `.github/**`, `.gitleaks.toml`, `package.json`, `.prettierignore`, `tools/repo`), so none under `prisma/`, `apps/` or `tools/db/`;<br>- `git diff 5fef0e1 7662672 -- . ':!docs' ':!.claude'` has the same patch-id as PR #25's delta `4bb6dc6..600232d`.<br><br>I did not re-run these suites |
| 8 | PR #20 union | **Open, by design** (§R2.6). PR #20 (`fafa3b5`) is unmerged and lists neither event |

### R2.3 Probe P-1 round 2 (PostgreSQL 18.6, `postgres:18@sha256:e3d24f69…`, `--network none`)

**Setup.**

- The head's lane `00`→`90` is applied to database `probe`.
- The same lane with the **round-1** `90` blob is applied to `probe_r1`, as the mutation control.
- Each file runs with psql `-1`, `ON_ERROR_STOP` and empty password variables.

| # | As | Case | Round-1 blob (`probe_r1`) | Head blob (`probe`) |
|---|---|---|---|---|
| N0 | migrator | `CREATE TABLE public.mig_t` right after the lane | — | OK: no lane object trips the invariant |
| C1–C11 | migrator | The 11 squat controls of round 1 | (refused in round 1) | all refused (42501) |
| B1 / B1p / B1b | migrator | `multirange_type_name = audit_entries_2027_09` in `public`; in `platform`; through `DO … EXECUTE` (2028-06) | accepted (B1, B1p) | **refused**, invariant DETAIL `CREATE TYPE leaves type public.audit_entries_2027_09 squatting an audit name, by platform_migrator` (and the `platform`/2028-06 twins) |
| B5 / B5p / B6 / B6p | migrator | `CREATE PROCEDURE {public,platform}.ensure_audit_partitions(bigint)`; `CREATE AGGREGATE platform.audit_forbid_mutation(int)` / `public.audit_vault_guard(int)` | accepted (B5, B6) | **refused** by the widened loop branch (`CREATE PROCEDURE on procedure …`, `CREATE AGGREGATE on aggregate …`) |
| G6 | migrator | `CREATE TYPE public.probe_ep AS RANGE (…, multirange_type_name = public.ensure_audit_partitions)`. The type name is outside `c_tbl`; the side effects are the constructor routines `ensure_audit_partitions()`, `(probe_ep)` and `(probe_ep[])` | accepted | **refused**, routine arm |
| G7 | migrator | `CREATE TYPE platform.ensure_audit_partitions AS RANGE (subtype = int4)`: constructor overloads `(int, int)` and `(int, int, text)` of the real routine | accepted | **refused**, routine arm |
| G8 | migrator | the multirange `platform.ensure_audit_partitions`, whose zero-argument constructor would make a bare `ensure_audit_partitions()` call ambiguous, because the real one has `DEFAULT 3` (no such caller today) | — | **refused**, routine arm |
| G1–G3, G5 | migrator | Self-exception: `public.audit_ddl_guard()`, `platform.audit_ddl_guard(integer)`, procedure `platform.audit_ddl_guard(text)`, multirange `public.audit_ddl_guard` | — | all refused (the loop for G1–G3, the invariant type arm for G5) |
| G4 | migrator | `CREATE FUNCTION platform.audit_ddl_guard()` again | — | 42723 duplicate, before any trigger |
| M1–M3 | migrator | Range with a non-audit multirange name (OK); `ALTER TYPE … RENAME` of that multirange to a partition name (refused); `DROP TYPE` (OK) | — | as stated |
| state | migrator | Every `pg_class`/`pg_type` row under an audit name not owned by the audit owner; every `c_fn` routine not owned by it | 6 squats (2 multiranges, 1 range, procedure, aggregate, 5 constructor routines) | 0 / 0 / exactly one routine: `platform.audit_ddl_guard()`, owned by the bootstrap role (the excepted OID) |
| S1–S4, I0–I8, triggers | superuser | Schema branch, replica-mode immutability, `DISABLE TRIGGER`, `DETACH` (unchanged files; re-run) | — | identical to round 1: S1/S2 OK, S3/S4 guard; I1–I6 `AUDIT_IMMUTABLE`; I7/I8 guard; 10/10 triggers and 2/2 event triggers `A` |
| L1 | migrator | Table carrying a squat index moved from the superuser-made writable schema `evil` into `public` | — | refused, loop branch (PR12-SEC-02-a) |
| **L2 / L3 / L4** | migrator | Owned sequence with its table; matview index with the matview; view-owned sequence with the view, all by `SET SCHEMA` into `public` | (accepted in round 1) | **refused**, invariant (`ALTER TABLE` / `ALTER MATERIALIZED VIEW` / `ALTER VIEW leaves relation public.audit_entries_2027_0{8,7,10} …`) |
| L5 | migrator | Control: a non-audit owned sequence moved | — | OK |
| H1 | migrator → app | `public.=(oid, integer)` returning `false`, granted to `platform_app`; plus two multirange squats planted by the superuser with `event_triggers = off` | — | `1::oid = 1` gives `f` (the plant is live). The **head** `PARTITION_CATALOGUE_SQL` (verbatim) returns 4 partitions plus **both type rows**. The **round-1** SQL returns the 4 partitions only, so the type rows are hidden |
| A1 / A2 | app | `ensure_audit_partitions(6)` while the two squats exist; then `ensure(12)` | — | `3` created: the audit-owner path is exempt from the invariant. Then `AUDIT_PARTITION_NAME_TAKEN` (DETAIL `audit_entries_2027_09`), rolled back; 7 partitions remain (layer 2) |
| X1–X3 | migrator | While the squats exist: `CREATE TABLE`, `COMMENT ON TABLE`, `GRANT` (a command that reports no row to the loop) | — | all refused, invariant DETAIL naming the squat |
| X4 / X5 / X6 | migrator | `DROP TYPE` of one of two squats; `DROP TYPE a, b`; `CREATE TABLE` again | — | **X4 refused**, because the post-state still holds the other squat. X5 OK; X6 OK |
| H2 | migrator → app | `public.=(oid, regnamespace)`, not granted | — | The **head** SQL succeeds (7 partitions). The **round-1** SQL fails with `permission denied for function probe_oid_ns_eq`. `LATEST_VERIFICATION_SQL` (head) runs under both plants |
| SU1–SU3 | superuser | A superuser-owned squat planted with `event_triggers = off`; then `CREATE TABLE`; `DROP TYPE` of the squat; `CREATE TABLE` | — | SU1 refused (the invariant binds every role but the audit owner); SU2 OK; SU3 OK |
| K0 / K10 | migrator | An ordinary `CREATE INDEX CONCURRENTLY`; `REINDEX INDEX CONCURRENTLY` of an index named `audit`, whose transient `audit_ccnew`/`audit_ccold` names match `c_tbl` | — | both OK, no leftover |
| **K1–K9, BG1–BG3** | migrator, then superuser | `CREATE INDEX CONCURRENTLY audit_entries_2029_01 ON public.mig_t (id)` and follow-ups | — | **PR24-SEC-10.** Refused with the loop DETAIL, but the index **remains**: `relkind i`, `indisready t`, `indisvalid f`, migrator-owned. Then:<br>- K2: unrelated DDL is refused (invariant);<br>- K3: `DROP INDEX` is refused (`sql_drop` `c_idx`);<br>- K4: `ALTER INDEX … RENAME TO mig_t_k1_idx` passes (post-state clean), and K5 DDL works again;<br>- K6: two leftovers on one table;<br>- K7: renaming either is refused while the other remains;<br>- K8 / K9: `DROP INDEX a, b` and `DROP TABLE` are refused;<br>- BG1: the superuser's `DROP INDEX` is refused too;<br>- BG2: with `SET event_triggers = off`, the drop is OK;<br>- BG3: DDL works again. Final state: 2/2 event triggers `A`, 0 squats |

### R2.4 Probe P-2 round 2: linter, three versions

Base is main `ccc1082`, round 1 is `6f498c4`, and the head is `7662672`. Each was imported under Node 24 type stripping and run over scratch fixtures.

| Case | Base | Round 1 | Head |
|---|---|---|---|
| w0 raised, never reset (control) | 11 | 11 | 11 |
| w1 RESET in a `RAISE NOTICE` literal | 11 | — | **11** |
| w2 RESET in a dead `IF false` branch | 11 | — | **11** |
| w3 RESET in an unused string | 11 | — | **11** |
| w4 top-level RESET (control) | — | — | — |
| w5 DO-body lower `SET lock_timeout = '1s'` after a top-level raise | 11 | — | **11** |
| w6 / w7 / w8c DO-body raise (`SET`, `set_config(…, false)`, depth 3) | — | 11 | 11 |
| w8 raise at nesting depth 5 (R1-n1) | — | — | **11** |
| w9 top-level `SET lock_timeout = DEFAULT` after a raise | — | — | — |
| w10 `SET '10s'; BEGIN; RESET lock_timeout; ROLLBACK;` | — | — | — (**PR24-SEC-11**) |
| w11 top-level RESET, then a DO-body message naming a SET | — | — | — |
| k1 / k1q / k1u: CIC under `audit_entries_2029_01` (plain / quoted / `U&`) in a migration | 12 / 12 / 16 | 12 / 12 / 16 | 12 / 12 / 16 |
| k0 ordinary CIC (control) | — | — | — |
| u0 `U&` identifier (bootstrap) | — | 12 | 12 |
| e1 / e3 E-string / concatenation `SET ROLE` (bootstrap) | — | — | — (PR24-SEC-05, unchanged) |
| c0 plain `SET ROLE platform_audit_owner` (control) | 12 | 12 | 12 |

The head's `doBlockLockTimeouts` still reports `reset` for w1, by design: the consumer ignores it. For w8 it reports one `set` carrying the unread literal, which is the fail-closed path.

### R2.5 Rulings asked for in this round

**The accepted consequence (invariant consequence 1) adds no new denial-of-service path for the migrator.**

- **Who is bound.** Every role except `platform_audit_owner` is bound (X1–X3 for the migrator, SU1 for the superuser). The audit write path and `ensure` are untouched (A1, A2).
- **How a squat can arise.**
  - Every squat that a command creates or moves is refused by that same command (C, B, G, L, M rows), so the blocked state normally needs superuser-level tampering.
  - The one exception is a CIC leftover (PR24-SEC-10). It is reachable by the migrator credential outside the linted lane, because rules 12 and 16 refuse the name in migration files (k1, k1q, k1u) and CIC cannot run inside `DO` or a function.
  - The migrator has no other way to create catalogue rows without DDL: no `CREATE`/`TEMP` on the database, and therefore no `CREATE EXTENSION` of trusted extensions either. Event triggers fire for every non-shared DDL.
- **What the blocked state costs.**
  - The only non-superuser role that runs DDL is the migrator, so the blocked state stops the migrator's own migrations. It can already do that with any failing migration or a held lock, and it already holds stronger availability levers: it owns every application table and can revoke `platform_app`'s grants.
  - The superuser keeps break-glass (BG2).
  - Each DDL pays one extra namespace-filtered regex scan of `pg_class`, `pg_type` and `pg_proc`, which is negligible.
- **Recovery has to be planned (TASK-090 runbook).** Dropping or renaming away the last squat passes (X5, K4, SU2). With two or more squats, every single-object command is refused (X4, K7), so either remove them all in one command, or use break-glass as the bootstrap superuser:
  1. `SET LOCAL event_triggers = off` in one transaction;
  2. the drop;
  3. assert `evtenabled = 'A'` for both triggers afterwards.

**The guard's self-exception is tight.**

- It excludes exactly one OID, `to_regprocedure('platform.audit_ddl_guard()')`. That routine is the bootstrap-owned guard (C14: never the audit owner).
- Same-name routines in another schema, overloads, procedures and a multirange constructor named after the guard are all refused (G1–G3, G5). The exact signature cannot be re-created (G4).
- After the probe, the guard is the only non-audit-owned routine under a `c_fn` name.
- **Residual, from reading, not probed; no finding.** The exception resolves the guard by name at call time. Suppose the bootstrap superuser renamed the guard function (the loop admits it, because neither the owner nor the new name matches). The lookup would then return NULL, and the routine arm would match no row, so G6–G8-style constructor plants would pass again; direct plants stay refused by the loop. This is superuser-only, inside the D-ARCH-076 (5) documented limits. The TASK-116 tripwire should assert that both event triggers' `evtfoid` is `platform.audit_ddl_guard()` by name.

**Decision 7.** Rule-12 approval is **granted** for `prisma/bootstrap/90-audit-ddl-guard.sql` at blob `9aab9aaab73fcb53e3f8a5e835d7d451af606be3`, and remains granted for `prisma/bootstrap/10-audit.sql` at blob `c3d4db9f3125d4915c0ff9d1ce1132d0e8e0e713`. Any other blob of either file needs a new security record. After merge, the ledger sha applies (PR24-SEC-06).

### R2.6 Findings and status

#### PR24-SEC-10: `CREATE INDEX CONCURRENTLY` under an audit name leaves an INVALID index that the guard's refusal cannot roll back. Under the invariant it then blocks every later DDL, and the `sql_drop` branch refuses its removal (LOW)

| | |
|---|---|
| Severity | **LOW.** Impact M, availability only:<br>- readiness goes `unavailable` fleet-wide (D-ARCH-081: any squat);<br>- migrations stop;<br>- `ensure` refuses only the squatted month (layer 2), and audit writes to other months continue;<br>- detection is immediate (readiness, plus `security.audit_partition_squatted` at `error`).<br><br>Likelihood L: it needs the migrator credential used outside the reviewed lane (P-2 k1, k1q, k1u: rules 12 and 16 refuse the name in a migration; CIC cannot run in `DO` or a function). It **predates this round**: round 1's loop raised at the same point. The C1 invariant only widens the blocked set from DDL on the carrying table to all DDL. Not a merge condition: no guard-side fix exists (see Remediation) |
| CWE / OWASP | CWE-460 Improper Cleanup on Thrown Exception (secondary CWE-386) · A04:2021 Insecure Design |
| Location | `prisma/bootstrap/90-audit-ddl-guard.sql:118–122` (loop raise), `:125–145` (invariant), `:150–169` (`sql_drop`, `c_idx` index branch). PostgreSQL `DefineIndex` commits the CIC catalogue and build phases before `ddl_command_end` runs, so only the final validation transaction is rolled back |
| Description | P-1 K1–K9 and BG1–BG3 (§R2.3). The refused CIC leaves a migrator-owned `public.audit_entries_2029_01` with `indisvalid = f`. The invariant then refuses every later DDL. `DROP INDEX`, a multi-object drop and `DROP TABLE` of the carrying table are refused by the `sql_drop` `c_idx` branch, for the superuser too while the guard is active. One leftover can be renamed away by its owner. Two leftovers self-lock the migrator, so break-glass is needed |
| Exploitability / impact | The actor already holds equivalent availability levers (§R2.5). The new element is recovery cost: the operator needs the rename-away step or break-glass. No audit row is affected |
| Remediation | **No guard change is requested.** An event trigger cannot undo committed CIC phases, and `ddl_command_start` gets no object identity (parsing `current_query()` would be fragile). Instead:<br>(1) principal-architect: data-model §5.2 "stated limits" records that the guard refuses but cannot remove a CIC leftover, and that layers 2 and 3 detect it.<br>(2) TASK-090 runbook:<br>- detection: readiness `unavailable` with `kind i`;<br>- recovery when exactly one migrator-owned leftover exists: `ALTER INDEX … RENAME TO <non-audit name>; DROP INDEX …` as the migrator;<br>- otherwise: superuser break-glass `SET LOCAL event_triggers = off` + drop in one transaction, then re-check `evtenabled = 'A'`.<br>(3) Keep the migrator credential used only by the deploy job (TASK-014/090 secret handling); a direct session with it is the only path. |
| Verification | TASK-033 integration case:<br>1. CIC under a partition name as the migrator gives guard 42501, and an INVALID index remains.<br>2. The readiness evaluation is `unavailable` with that name.<br>3. The migrator's unrelated DDL is refused.<br>4. The rename-away recovery as the migrator succeeds, followed by unrelated DDL OK |
| Owner | principal-architect (stated limit); TASK-090 (runbook); TASK-033 (test) |

#### PR24-SEC-11 (INFO): Rule 11 clears a raised `lock_timeout` on a top-level RESET inside a transaction that is rolled back

`SET lock_timeout = '10s'; BEGIN; RESET lock_timeout; ROLLBACK;` passes the base, round-1 and head linters (P-2 w10). PostgreSQL reverts a SET or RESET made in a transaction that rolls back (the `SET` reference page; not exercised in P-1), so the raised value survives into later files.

This predates the PR and is the top-level sibling of PR24-SEC-03. **Fix (TASK-024, with the setter-key half):** either a RESET or lowering SET between `BEGIN`/`START TRANSACTION` and `ROLLBACK` does not lower the tracked value, or rule 1/11 refuses transaction control in migration files. Prisma runs each file as one script, so the files have no legitimate use for it.

#### Status of round-1 findings at `7662672`

| ID | Status |
|---|---|
| PR24-SEC-01 | **Closed** (C1). Verified by P-1 and by the new `audit-owner.int.test.ts` rows: `range_multirange` with a `platform` twin and `KNOWN_GUARD_GAP = []`; L2–L4 in a rolled-back writable schema with a non-audit control; procedure and aggregate in F-05; the "squat exists" control; the F-08 unrelated-DDL row |
| PR24-SEC-02 | **Closed** in-PR: P-1 H1/H2 with positive controls; integration H1/H2; the bare-operator unit check with a negative control. The class fix (catalogue assertion on `pg_operator`, lint refusal of `CREATE OPERATOR`) stays with TASK-024: P-1 shows the guard still admits operator plants, by design |
| PR24-SEC-03 | **Closed** in-PR (P-2 w1–w3, w5, w8; fixtures `20261113001{0,1,2}00_*`) |
| PR24-SEC-04 | Open, TASK-015 (unchanged; P-4 case F still passes) |
| PR24-SEC-05 / 06 | Open, TASK-024 / TASK-015 (unchanged; P-2 e1/e3) |
| PR24-SEC-07 | Open, TASK-090 |
| PR24-SEC-08 | (a) accepted, with the correction in §R2.1; (b) open (Wave-0 `ensure` caller) |
| PR24-SEC-09 | R1-m2 in-PR part done: `log.error('security.audit_partition_squatted', {component, partition_name, kind, reason})`, never an owner. R1-n2 (`pendingCheck` refuses `audit_*`) and R1-n4 (`unavailable` not cached) are done. Sink routing is pending (union below) |

### R2.7 Union, overlap and evidence notes

- **PR #20 sink routing** (D-ARCH-081 (4), D-ORCH-029) is owed by whichever of PR #20 and PR #24 merges second. That PR must:
  - add `audit_partition_squatted` and `audit_mutation_rejected` to `RUNTIME_SECURITY_EVENTS`, with `SECURITY_EVENT_LEVEL` `error`;
  - set the per-event allow-lists `partition_name, kind, reason, sql_state` and `sql_state`, relaxing PR #20's `['sql_state']`-only test to a per-event one;
  - use `securityEventSinkFrom(log)` in `apps/api/src/platform/db/runtime.ts` in place of `log.error`.

  PR #20 at `fafa3b5` lists neither event.
- **Owned overlap with other open PRs.** If any of these merges first, PR #24's next merge of main brings main's side of an owned path in this PR's net change. That voids this record (clause d), so a merge-only round must name the merge commit and repeat §R2.2 items 1–3:
  - PR #20: `eslint.config.mjs`, `tools/tsconfig.json`;
  - PR #26: `tools/tsconfig.json`;
  - PR #27: `eslint.config.mjs`.

  PR #28 and PR #30 have no owned overlap with this net change.
- **D-ORCH-034, lane-B evidence.** PR #28 has merged (§R2.8), so this PR needs a `quality:heavy --profile pr` run on an ancestor of its head, after the PR28-SEC-02 scrub lands (D-ORCH-035).
  - An **evidence-only `docs/**` commit after `7662672` keeps this record valid** (P-4 case L).
  - So does a merge of main that brings only paths outside this PR's owned net change, such as PR #28's or the devops PR's `tools/quality/**` (case M).

### R2.8 Record-check simulation P-4, round 2

Main's `tools/ci/check-security-owned-paths.mjs` was extracted with `git archive origin/main tools/ci` (main `5107f1e`). It ran with `--root <scratch clone --shared, checked out at the case head, this record copied into the work tree> --base <base> --head <case head> --pr <n> --json`.

The base is `ccc1082`, the `RANGE_BASE` of run 43383529879, unless noted. The clone was removed afterwards. The results are in the table below.

| Case | Input | Result |
|---|---|---|
| A | This record, `--pr 24`, head `7662672`; also with `--base` = the main tip at each of the two runs, `656ec94` and `b06fa9f` | **`pass`**, 7 owned paths, satisfied by this record at `7662672`. The note "names `6f498c4`, but … changed after it" shows that the round-1 head is correctly voided |
| B | `--pr 23` | `missing`: the PR-0023 record names no commit of this PR |
| C | The last Verdict row rewritten to `FAIL` | `missing`: verdict FAIL is not accepted |
| D | The record without this round, as committed on main | `missing`: `6f498c4` is voided by `eslint.config.mjs`, `90-audit-ddl-guard.sql` and `lint-migrations.ts` |
| E | A scratch commit on the head appending a line to `90-audit-ddl-guard.sql` | `missing`: "`90-audit-ddl-guard.sql` changed after it" |
| F | A scratch commit on the head changing `apps/api/src/platform/health/checks/audit-partitions.ts` (unowned) | `pass` (PR24-SEC-04 is unchanged) |
| L | A scratch evidence-only commit on the head adding a file under `docs/05-quality/` | **`pass`**: a lane-B evidence commit keeps this record valid |
| M | A scratch main commit touching only `tools/quality/required-suites.json` (owned, outside this net change), merged into the head; `--base` = that commit | **`pass`** |
| N | A scratch main commit touching `eslint.config.mjs`, merged into the head; `--base` = that commit | `missing`: "`eslint.config.mjs` changed after it". This is the owned-overlap trap of §R2.7 |

**State of main at hand-off** (re-fetched; main is `b06fa9f`, and the PR branch is still `7662672`):

- PR #28 (W0-ACT-1) merged as `ab42cc6`, so **D-ORCH-034 now applies to this PR**. Per D-ORCH-035, its evidence commit waits for the devops staleness and scrub PR (PR28-SEC-02).
- `git diff --name-only ccc1082 origin/main` shares **no path at all** with this PR's net change, and `git merge-tree --write-tree 7662672 origin/main` is clean. A merge of today's main into the branch therefore keeps this record valid (case M class). Repeat the overlap check before each merge of main; the devops PR touches `tools/quality/**` only.
- Code review round 2 (`f56b12f`) is APPROVED_WITH_NITS:
  - R2-n1 agrees with §R2.5: the `sql_drop` branch also refuses dropping table, view, matview, index and function squats, so those need break-glass.
  - R2-n3 is the self-exception residual of §R2.5.
  - Its ruling "the migrator can no longer create a squat" is qualified by PR24-SEC-10 (the CIC leftover).

### R2.9 Routing (round 2)

| ID | Severity | Owner | Due |
|---|---|---|---|
| PR24-SEC-10 | LOW | principal-architect (data-model §5.2 stated limit); TASK-090 (runbook: rename-away, break-glass, `evtenabled` re-check); TASK-033 (integration case) | TASK-033 / TASK-090 |
| PR24-SEC-11 | INFO | TASK-024 (rule 11, with the setter-key half) | TASK-024 |
| PR #20 union | — | whichever of PR #20 / PR #24 merges second | that merge |
| Overlap round | — | orchestrator: a merge-only security round if PR #20, #26 or #27 merges first | before PR #24 merges |
| TASK-116 note | — | tripwire asserts both event triggers' `evtfoid` = `platform.audit_ddl_guard()` by name (§R2.5 residual) | TASK-116 |

| Field | Value |
|---|---|
| Head | 766267223e2adba6e29c14d5e34c9c86dec3128c |
| Scope | Delta `6f498c4..7662672` (four fix commits plus two normal merges of main). The net change is `ccc1082..7662672` (94 paths). Owned paths changed after round 1: `eslint.config.mjs` (merge only, blob `b782cfc` = `merge-tree`), `prisma/bootstrap/90-audit-ddl-guard.sql` (`9aab9aa`), `tools/db/lint-migrations.ts` (`56853be`) |
| Findings | 0 Critical, 0 High, 0 Medium. Closed: PR24-SEC-01 (C1), 02, 03. New: PR24-SEC-10 LOW (CIC leftover; predates this round; no guard-side fix), PR24-SEC-11 INFO. Still open and routed: 04 (TASK-015), 05 (TASK-024), 06 (TASK-015), 07 (TASK-090), 08 (b), 09 (sink union) |
| Rule-12 approval | **Granted:** `prisma/bootstrap/90-audit-ddl-guard.sql` blob `9aab9aaab73fcb53e3f8a5e835d7d451af606be3`; `prisma/bootstrap/10-audit.sql` blob `c3d4db9f3125d4915c0ff9d1ce1132d0e8e0e713` (unchanged since round 1) |
| Conditions | C1 met; C2 met by this round. No new merge condition. Process items (§R2.7): a merge-only round if an owned-overlap PR merges first; the PR #20 union for the second merger; D-ORCH-034 lane-B evidence, now due because PR #28 has merged, after the D-ORCH-035 scrub PR (an evidence-only `docs/**` commit, or a merge of main with no owned overlap, keeps this record valid) |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open at head `766267223e2adba6e29c14d5e34c9c86dec3128c`. The guard's post-state invariant closes every side-effect squat probed on PostgreSQL 18.6, with a round-1-blob mutation control. Readiness resists both operator plants, and rule 11 no longer trusts unexecuted DO-body RESETs. The rule-12 approval of both bootstrap audit files is confirmed by blob SHA. |
