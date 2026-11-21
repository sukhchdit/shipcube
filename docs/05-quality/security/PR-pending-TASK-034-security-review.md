# PR-pending: TASK-034 backup/restore rehearsal, migration-linter rule R and zero-downtime probe, security review

**File name.** The pull request does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-034-security-review.md`. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>` (D-ORCH-136, D-ORCH-138).

**Finding IDs.** This round opens the series `PR034-SEC-nn` (TASK-034). They are not the `PR34-SEC-nn` findings of PR #34 (TASK-276).

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-034-backup-restore-rehearsal-zero-downtime` (worktree `../Shipqube-TASK-034`), not pushed. Three commits on the merge base `530629f4`: `6feac2e8` (feature), `9c40d31e` (fix cycle 1), `3ee36f01` (fix cycle 2). Developer decisions D-TASK034-01 to -14 are in the commit bodies |
| Head | 3ee36f010e91cdceaba257991bb6e7025700a7a4 |
| What was reviewed | The diff `530629f4..3ee36f01` in full: 40 files, 5,877+/79-. 39 of them are security-owned as main's checker counts them (`check-security-owned-paths.mjs --base 530629f4 --head 3ee36f01`): `.dockerignore`, `package.json`, `tools/tsconfig.json`, 3 files under `tools/ci/`, 29 under `tools/db/` (4 of them lint fixtures) and 4 under `prisma/tests/`. The runbook `docs/07-ops/runbooks/backup-restore.md` is not owned; I read it as the operator contract |
| Base and main | Merge base `530629f4`. `origin/main` tip when this round was written: `22bd1f02`. Since the merge base, main has taken #80 to #84: 160 paths outside `docs/` and `.claude/`, including 4 migrations, all `data-changing: no`. The one path both sides change is `package.json`, which is security-owned, so the merge with main needs a merge-only round (C3). This record is committed on the local main on top of `88fd7360` |
| Lane B | `20261121T1443Z_3ee36f0` PASS on PostgreSQL 18 (D-ORCH-164), still uncommitted in the worktree. Unit 8,403 (2 pre-existing platform skips in `packages/config`). Integration 430, which includes 6 backup-restore cases, 5 C4 harness CLI cases and 3 zero-downtime cases. Api 179, catalog 113, rls 157 |
| Lane A | None: not pushed, and hosted CI is billing-blocked (D-ORCH-146). The changed `tools/db/**` and `prisma/**` paths match the `security-integration` trigger list |
| Binding items read | The brief `docs/04-plan/briefs/TASK-034.md` (card verbatim). Data-model §8.3 (rules 10, 14 and 16), §8.6 with the SEC-P3-03 amendment, §8.7 and OI-16. Threat model T-81. The code review record `PR-pending-TASK-034-code-review.md`, rounds 1 and 2 (D-CRPR034-01, APPROVED_WITH_NITS at `3ee36f01`). D-ORCH-160, -164 and -169; D-ARCH-172; D-SECPR293-02 |
| Reviewer / date | security-analyst, 2026-11-21, round 1, pre-push.<br>**Host rule:** no Docker, no `npm test`/`build`/`lint`, every command in the foreground.<br>**Slip:** at the start I ran `git status`, `git log` and `git fetch` once in `../Shipqube-TASK-034`. These are read-only, apart from a remote-ref update of the shared object store. Everything else read the branch through the main checkout's object store, or read files.<br>**Method:** single-process Node 24.22.3 probes on `git archive` extracts of `tools/db` at `3ee36f01` and, as the positive control, at `530629f4`. A load hook strips the types. PGlite 0.4.3 (PostgreSQL 17.5) answers the PostgreSQL behaviour questions. A gitleaks v8.30.1 git-mode emulation scans the diff. `.env*` was not opened |

## 1. Summary

**No Critical or High finding.** There is 1 MEDIUM, 4 LOW and 3 INFO findings.

The card's security items hold:

- **PR5-SEC-14 closed.** `connectPrivileged` refuses a missing or empty `connectionString` before any client exists, and the type carries the rule. `resetTarget` returns the validated URL, and `main` uses nothing else.
- **PR11-SEC-11 d closed.** D-TASK034-12 is accepted (§6).
- **PR293-SEC-04 (a) closed for rule 10.** A differential fuzz finds 0 fallback misses over 20,562 write-bearing bodies. A comment-blanking mutant, the positive control, misses 646 of 10,256.
- **PR293-SEC-04 (b) kept fail closed.**
- **Rule 14 refuses CREATE CAST and CREATE AGGREGATE** (D-ARCH-172).
- **A live rule-10 bypass on main that needs no E-string is also closed.** On `530629f4`, `DO $$ BEGIN EXECUTE 'SELECT 1; -- c<LF>UPDATE …'; END $$` lints clean under every rule, and PostgreSQL runs the UPDATE. At the head, rule 10 reports it.

The new tools handle credentials well:

- no password on any command line;
- no URL, password or row value printed by any message the tools build themselves;
- every value that reaches an argv is regex-checked, and every argv is an array, with no shell;
- `wx` on the archive, manifest and schema;
- loopback-only targets.

The findings:

- **PR034-SEC-01 MEDIUM** (CWE-250). The restore runs as the cluster superuser, so `pg_restore`'s data load runs routines that migrations wrote:
  - a table CHECK, a domain CHECK or a STORED generated column can call a routine that does nothing for the migrator and escalates when `current_user` is a superuser;
  - such a migration lints clean on base and head;
  - on PostgreSQL the migrator's own writes leave it harmless, and a superuser load makes the migrator a SUPERUSER;
  - `pg_dump` places a validated CHECK inside `CREATE TABLE`, so it is active during the data load.

  The restore also targets the live cluster, not the fresh stack of §8.6 step 4.
- **PR034-SEC-02 LOW** (CWE-276). The archive and its folder are created with default modes.
- **PR034-SEC-03 LOW** (CWE-532). Row data reaches the deploy-failure detail on stderr and in `restore-report.json`: 4 of 5 PostgreSQL shapes leak a sentinel.
- **PR034-SEC-04 LOW** (CWE-354). The row fingerprint uses the bare alias `t`. On a table with a column named `t`, the checksum ignores every other column.
- **PR034-SEC-05 LOW** (CWE-184). A range type's `subtype_diff` reaches a writer that rule 10 cannot see. It is the sibling of the cast and the aggregate that D-ARCH-172 closed.
- **PR034-SEC-06 INFO.** The E-string line-break decoding of R1-M2 never runs in the real lint path. Rule 16 keeps the shape fail closed.
- **PR034-SEC-07 INFO.** The rule R records are unsigned. This is accepted until M5, with a review step.
- **PR034-SEC-08 INFO.** The Prisma child processes inherit the superuser URL and the role passwords.

I concur with the code review's R2-m1 (the record binds re-read bytes) and R2-n2 (the out-of-order rule relies on the merge base).

## 2. What I verified

All probes are in the session scratch `t034sec/probes/` and may vanish. The results are kept here.

| # | Probe | Result |
|---|---|---|
| P1 | `p1-lint.mjs`: 21 migration shapes declared `data-changing: no`, through `lintMigrations` of base and head; the rules reported, per shape | Controls: `SELECT 1` is clean, and a plain DO UPDATE is rule 10 on both. R1-M2 shapes C, D, E, a comment holding `;` and `'`, a nested `/* */`, a CR-ended comment, a continuation after a comment and a routine body: rule 16 only at the base, rules 10 and 16 at the head. **N1** (`EXECUTE 'SELECT 1; -- c<LF>UPDATE …'`, no E-string): **clean at the base**, rule 10 at the head. N2 (a dollar-quoted dynamic SQL with a block comment): rule 10 on both. X1 to X4, E-string escapes in `EXECUTE` (`\x3b`, `\x27`, `\x2a\x2f`, `\n`): rule 16 only, on both (PR034-SEC-06) |
| P1b | `p1b-lint.mjs`: the four escalation shapes of PR034-SEC-01 with `SET lock_timeout` first and `NOT VALID` plus `VALIDATE CONSTRAINT`. The routine is `IF current_user is superuser THEN <privileged statement>`, used by a CHECK, and the privileged statement is `ALTER ROLE platform_migrator SUPERUSER`, `GRANT pg_execute_server_program`, `COPY … TO PROGRAM` or a `pg_authid` read | **Clean under every rule, on base and head.** Without the lock-timeout and NOT VALID forms only rules 11 and 6 fire, and both are style rules the author satisfies |
| P2 | `p2-linear.mjs`: `tolerantRead` and the rule-10 body check on 10 adversarial families (comment runs, unclosed nested comments, dollar pairs, string runs, backslash E-strings, unclosed tags, long near-miss tags, `;'` runs, nested E-string bodies, continuations), size n to 4n | Ratios 0.1 to 4.5 for `tolerantRead` and 3.1 to 5.1 for the body check. Linear; quadratic would be 16. The control loop gave 8.9 |
| P3 | `p3-mask.mjs`: the head's `deployOutcome` on P3018 texts in the schema engine's template (`Migration name:` / `Database error code:` / `Database error:`), with a random sentinel in the row data | **The sentinel is in `detail`** for `DETAIL: Failing row contains (…)` (23514 and 23502), for a `RAISE` message and for a debug line with an escaped quote. It is masked for the `Key (…)=(…)` control. The `maskValues` quote control is masked (PR034-SEC-03) |
| P4 | `p4b-pglite.mjs`: PostgreSQL behaviour behind PR034-SEC-01, -04 and N1 | (a1) The migrator creates the CHECK routine, adds the constraint `NOT VALID`, validates it and writes through it: `mig` stays NOSUPERUSER. (a2) A superuser loads rows into a table with the same CHECK: **`mig` is SUPERUSER**. (b) `pg_dump --schema-only` (pglite-tools) emits the validated CHECK inside `CREATE TABLE`, with no separate `ADD CONSTRAINT`, so the CHECK is present during `pg_restore`'s COPY. (c) The head's `tableFingerprintSql` on a table with a column `t`: editing another column leaves the checksum unchanged, while the control table's checksum changes. (d1 to d3) PostgreSQL runs the N1 shape, a single-statement `EXECUTE '-- c<LF>UPDATE …'` and `'/* c */ UPDATE …'` |
| P4c | `p4d-vectors.mjs`: the other load-time call sites | A domain CHECK and a STORED generated column (an IMMUTABLE wrapper that `PERFORM`s the volatile routine) also make `mig` SUPERUSER on a superuser load of text-sourced values, which is what COPY supplies. The migrator's own writes again leave it harmless |
| P5 | `p5b-fuzz.mjs`: 60,000 random bodies that lex, from 47 units (comments, strings, E-strings, quoted names, dollar bodies, `;`, PL/pgSQL starts, DML forms, `E`, `$`, `\`). The lexed verdict is compared with the fallback verdict of the same body behind a PG-valid E-string continuation | Head: 20,562 write-bearing, **0 misses**, 396 over-approximations (fail closed). Mutant control (`p5m-fuzz.mjs`, `tolerantRead` without `--` comment blanking): **646 misses** in 30,000 |
| P6 | `p6-mark.mjs`: the R1-M2 decoding in the real path | The raw body is rule 10. `sqlText(stmt, true)`, which is what `doBlockChangesData` passes, is **not** rule 10: the `ESCAPE_STRING_MARK` ends in U+2063, a non-ASCII character, so `isIdentifierChar` treats the following `E` as an identifier character and the literal lexes as a standard string (`escape` false). Control: a real LF in a standard string is rule 10 |
| P7 | `p7-range.mjs`, `p7b-split.mjs`, `p7c-transitive.mjs`: code review flag 5 | PostgreSQL: an IMMUTABLE `subtype_diff` that `PERFORM`s a volatile writer **writes during a GiST build** (`n` = 51 after 200 rows). Linter: the same DDL split into two migrations (types, then `CREATE INDEX CONCURRENTLY` alone) is **clean on base and head**. Control: rule 10 does follow writers transitively and does see a CHECK call site by name (3 of 3 shapes are rule 10). Fingerprint candidates: `(t.*)::text` and `ROW(t.*)::text` give the whole row even with a column `t` |
| P8 | `p8-catalog.mjs`: the catalog control proposed for PR034-SEC-01 (§5) | 3 rows for the planted table CHECK, domain CHECK and generated column. 0 rows for a control table whose CHECKs and generated column use built-ins only |
| P9 | `gl-emu.mjs`: gitleaks v8.30.1 git-mode emulation with the default rules plus main's `.gitleaks.toml`, over `530629f4..3ee36f01` (3 commits) | 6,210 added lines in 304 fragments: **0 findings**. Runtime-built controls (a GitHub PAT, an AWS key id, a generic key) give 3 findings |
| P10 | Reads and greps | No CHECK, domain or generated column in the 12 migrations on main calls a non-built-in routine today. The only routine calls are in RLS policy `WITH CHECK` clauses, which a superuser bypasses. There is no column named `t` and no range type. `/reports/` is git-ignored and now docker-ignored. The test passwords are random per run, and the int suites assert that no secret appears in output |

## 3. The card's security items

| Item | Status at `3ee36f01` |
|---|---|
| PR5-SEC-14 | **Closed.** `PrivilegedUrlConnection` in the type, plus a run-time refusal before `new pg.Client`. `resetTarget` returns `bootstrapUrl`, and `main` passes only `target.*`. Unit: "URL unset: returns 1, connectPrivileged never called". The harness passes a URL (random base64url password) |
| PR11-SEC-11 d | **Closed.** One open with `O_RDONLY \| O_NONBLOCK \| O_NOFOLLOW`, `fstat` of the descriptor, and a bounded read of max + 1. D-TASK034-12 adds a re-resolution after the open, the root check again, and the same device and inode as the descriptor. Ruling in §6 |
| PR293-SEC-04 (a) | **Closed for rule 10** (P1, P5). `tolerantRead` is linear (P2). Residual: PR034-SEC-06 (INFO) |
| PR293-SEC-04 (b) | **Kept fail closed**, pinned by a test. I concur |
| D-ARCH-172 rule 14 | **Closed.** CREATE CAST and CREATE [OR REPLACE] AGGREGATE are refused, with one fixture each, and pin rows 4 and 5 are removed. The next sibling is PR034-SEC-05 |
| Code review R1-n2 (`.dockerignore`) | **Closed.** `reports` is ignored, and `check-dockerignore.test.ts` pins a `platform.dump` path |
| Code review flag 3 (`readSecretFile`) | Ruled in §6 (accepted) |
| Code review flag 5 (implicit call sites) | `subtype_diff`: PR034-SEC-05. Domain CHECK: rule 10 sees the call by name (P7c). The privilege side of CHECK call sites: PR034-SEC-01 |

## 4. The focus areas of this round

| Area | What I found |
|---|---|
| Credential handling | `DATABASE_BOOTSTRAP_URL`, `DATABASE_MIGRATOR_URL` and `DATABASE_URL` are read from the environment and checked with `effectiveEndpoint`, which uses the same parser `pg` uses, with `host`/`hostaddr` query parameters refused. They are loopback or a Unix socket only, and never printed. Messages name variables only. The role passwords go to the server as client-side SCRAM verifiers through `00-roles.sql`. `pg_dump`/`pg_restore` run in the Compose `postgres` container over its socket, with no password in any argv. The probe pool uses `databaseConnectionSettings`, which is the same parser plus the TLS-only query allow-list. Residual: PR034-SEC-08 (the child processes inherit the whole environment) |
| File permissions on dumps | `platform.dump` (every row), `manifest.json`, `schema.sql` and `restore-report.json` are written without a `mode`, and the folder is created without one. See PR034-SEC-02. On the project's Windows host they inherit the profile ACL. The archive is never written over another (`wx`, O_EXCL refuses a planted symlink too) |
| Command and shell injection | None. `spawn`/`spawnSync` always get an argv array with `shell: false`. Every value that reaches an argument is checked: database `^[a-z_][a-z0-9_]{0,62}$` (so `--dbname` can never be read as a connection string), snapshot id, service, project and role. Timeouts are numbers. In-container `timeout -k 10 <s>` bounds the tools (R1-n7) |
| Temporary files | None. The artefacts go to `reports/rehearsal/<UTC stamp>-<kind>/`, which is git- and docker-ignored. A non-empty folder is refused. `--out`, `--report` and `--workload` are operator paths |
| Logging of connection strings and values | Nothing the tools print carries a URL or credential. Prisma's datasource banner is filtered out, and `pg_dump`/`pg_restore` errors keep their first error line with quoted fragments masked. Row data can still reach the deploy-failure detail: PR034-SEC-03 |
| Least-privilege roles | The backup and the manifest run as the bootstrap superuser. That is required, because FORCE RLS binds the owner (OI-16). The restore runs as the superuser too, which `pg_restore` needs for ownership and event triggers. Deploy and status run as the migrator on the scratch database, and the probe workload runs as `platform_app`. The superuser load is what PR034-SEC-01 is about |
| Restricted data (CLAUDE.md §5) | No archive and no fixture dump is in the diff. The tools read only a `pg_dump` custom archive that comes with its manifest (`parseManifest`). The legacy backup cannot be restored with them |
| Database guardrail (CLAUDE.md §5) | Rule R makes a fresh, passed rehearsal record a lint condition for every `data-changing: yes` migration. This is the guardrail's first enforcement. Residuals: PR034-SEC-05 (a hidden writer evades the header), PR034-SEC-07 (records are claims), R2-m1 and R2-n2 |

## 4a. A note on the lane-B evidence

The run `20261121T1443Z_3ee36f0` carries JUnit, coverage and summary files only. The orchestrator commits it. The int cases print only random per-run passwords, and those are asserted absent from every captured line.

## 5. Findings

| ID | Severity | CWE / OWASP 2021 | File:line | Title |
|---|---|---|---|---|
| PR034-SEC-01 | **MEDIUM** | CWE-250, CWE-269 / A04 | `tools/db/verify-restore.ts:187-241` (restore on the bootstrap cluster), `:334` (`reapplyDatabaseLevel`); `tools/db/pg-archive.ts:256-259` (`pg_restore --username <superuser>`); brief scope note vs data-model §8.6 step 4 | The superuser restore runs routines that migrations wrote, on the live cluster |
| PR034-SEC-02 | LOW | CWE-276, CWE-732 / A05 | `tools/db/pg-archive.ts:82`; `tools/db/backup.ts:87`, `:102-103`; `tools/db/verify-restore.ts:379` | Backup artefacts with default modes |
| PR034-SEC-03 | LOW | CWE-532 / A09 | `tools/db/prisma-outcome.ts:77-90`, `:99-103`; `tools/db/verify-restore.ts:386-388`; `tools/db/pg-archive.ts:46-54`; `tools/db/zero-downtime-probe.ts:118-124` | Row data in the failure detail (stderr, `restore-report.json`) |
| PR034-SEC-04 | LOW | CWE-354, CWE-697 / A08 | `tools/db/rehearsal-manifest.ts:122-125` | The fingerprint's alias `t` turns into a column reference |
| PR034-SEC-05 | LOW | CWE-184 / A04 | `tools/db/lint-migrations.ts:562` (`REFUSED_OBJECTS`) | A range type's `subtype_diff` hides a writer from rule 10 |
| PR034-SEC-06 | INFO | CWE-184 / A04 | `tools/db/lint-migrations.ts:724`, `:819-821`; `tools/db/sql-text.ts:44`, `:605` | The R1-M2 E-string decoding is unreachable in the lint path |
| PR034-SEC-07 | INFO | CWE-345 / A08 | `tools/db/rehearsal-record.ts`, `lintRehearsals` (`lint-migrations.ts:1733`) | Rule R records are unsigned claims |
| PR034-SEC-08 | INFO | CWE-526 / A05 | `tools/db/verify-restore.ts:363`; `tools/db/zero-downtime-probe.ts:377` | The Prisma child processes inherit the superuser URL and the role passwords |

### PR034-SEC-01 (MEDIUM): the superuser restore runs routines that migrations wrote, on the live cluster

**Description.** `db:verify-restore` restores with `pg_restore --username postgres`, the cluster superuser over the container socket. OI-16 requires that for the data, because FORCE RLS binds the owner, and ownership and event triggers need it too. `pg_restore` loads rows with COPY. PostgreSQL then evaluates, as the session user:

- every table CHECK, because `pg_dump` places a validated CHECK inside `CREATE TABLE` (P4 b);
- every domain CHECK on input coercion;
- every STORED generated-column expression.

A migration can therefore ship a routine that does nothing for the migrator and runs a privileged statement once `current_user` is a superuser, and reference it from one of these expressions. The migrator adds and validates the constraint harmlessly (P4 a1). The next rehearsal's superuser load runs the privileged branch: `ALTER ROLE platform_migrator SUPERUSER`, `GRANT pg_execute_server_program`, `COPY … TO PROGRAM`, or a read of `pg_authid` (P4 a2, P4c). No current rule refuses the shape: P1b is clean on base and head. Rule 10 sees CHECK call sites, but only of writing routines (P7c), and rule 14 does not scan routine bodies. The catalog suite has no check of this class.

The implementation also restores into a scratch database on **the same cluster** as `DATABASE_BOOTSTRAP_URL`, which is the developer's live Compose cluster. That follows the brief's scope note. Data-model §8.6 step 4 instead says a fresh stack (`docker compose -p restore-<run>`), and no D-TASK034 entry records the change. On the same cluster:

- the privileged branch acts on the live cluster;
- `00-roles.sql` re-sets the cluster-wide LOGIN passwords and role attributes from the operator's environment (`reapplyDatabaseLevel`);
- a `--keep` copy of every row stays connectable by `platform_app` and the migrator.

**Exploitability and impact.**

- **Impact: High.** The migrator-to-superuser boundary is the one that SEC-P3-03, SEC-P3-34 and rules 12 to 16 exist to hold. Superuser on PostgreSQL means every tenant's rows, the role verifiers and the audit store, and with `COPY … TO PROGRAM` a shell in the database container.
- **Likelihood: Low.** It needs a malicious migration that passes the security review that every `/prisma/migrations/` change triggers. Alternatively, a stolen migrator credential can add the constraint directly to a database that is later backed up and rehearsed. Either way, a rehearsal has to run afterwards, and rule R makes rehearsals routine: before every data-changing migration, and weekly once `restore-rehearsal` is active.
- **Today** the tools run only on a developer's own Compose stack, whose operator already holds the superuser.
- The same mechanism applies to any disaster-recovery `pg_restore` by a superuser, so the fix also protects those restores.
- Matrix: High impact × Low likelihood = **MEDIUM**.

**Remediation (code level).**

1. **Source control: a lint rule plus a catalog outcome control.** CHECK constraints, domain CHECKs and STORED generated-column expressions may call built-in routines only. Rule 10's call-site recognition already finds the CHECK call site; extend it so that a call to *any* routine created in `prisma/migrations` (the `RoutineRegistry`) is refused as rule 14. Also refuse `CREATE DOMAIN … CHECK` that calls one. The robust half is a catalog case, proven on PGlite (P8: 3 planted hits, 0 on the built-in control):

   ```sql
   -- C15 (proposed): CHECK, domain CHECK and STORED generated expressions call built-in routines only; expected 0 rows
   SELECT 'constraint' AS kind, c.conname::text AS name, p.oid::pg_catalog.regprocedure::text AS routine
     FROM pg_catalog.pg_constraint c
     JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_constraint'::pg_catalog.regclass AND d.objid = c.oid
                                AND d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
     JOIN pg_catalog.pg_proc p ON p.oid = d.refobjid
    WHERE c.contype = 'c' AND p.pronamespace <> 'pg_catalog'::pg_catalog.regnamespace
   UNION ALL
   SELECT 'generated', a.attname::text, p.oid::pg_catalog.regprocedure::text
     FROM pg_catalog.pg_attrdef ad
     JOIN pg_catalog.pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum AND a.attgenerated = 's'
     JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_attrdef'::pg_catalog.regclass AND d.objid = ad.oid
                                AND d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
     JOIN pg_catalog.pg_proc p ON p.oid = d.refobjid
    WHERE p.pronamespace <> 'pg_catalog'::pg_catalog.regnamespace;
   ```

   No migration needs an exception today (P10). If one ever does, allow-list a reviewed routine by `regprocedure` and definition digest, as `DYNAMIC_SQL_ALLOW_LIST` does.
2. **Isolation, the design of §8.6 step 4.** Restore into a disposable cluster, never the live one: a `docker compose -p restore-<stamp>` PostgreSQL with no secrets mounted, or `docker run --rm --network none` with the pinned image. `pg_restore` and the verification sessions then target that container. If principal-architect keeps the same-cluster form for this run instead, record the deviation and the residual: role passwords re-set on the live cluster, superuser code on the live cluster, and a kept copy that `platform_app` can connect to.
3. At M5, the CD pipeline's restore into a temporary instance inherits item 1. Add the class to T-81 / RR-05.

**Verification test.**

- A lint fixture `refused-objects/<ts>_check_calls_routine` (a table CHECK, a domain CHECK and a generated column, each calling a migration-defined routine) fails rule 14.
- The C15 catalog case passes on the migrated schema and fails with a planted control (a public routine in a CHECK).
- With isolation: an int case in `backup-restore.int.test.ts` plants a CHECK routine that records `current_user` and `pg_catalog.inet_server_port()` into a side table, runs `db:verify-restore` and asserts that the live cluster's side table and role attributes are unchanged.

### PR034-SEC-02 (LOW): backup artefacts with default modes

**Description.** `createWriteStream(path, { flags: 'wx' })` (`pg-archive.ts:82`) creates `platform.dump` with mode `0o666 & ~umask`. `mkdirSync(outDir, { recursive: true })` (`backup.ts:87`) creates the folder `0o777 & ~umask`. The `manifest.json`, `schema.sql` and `restore-report.json` writes pass no `mode` either. On a POSIX host with umask 022 (a Linux or macOS workstation, a self-hosted runner, the future M5 job), the archive holds every row and is readable by every local user who can traverse the path.

**Exploitability and impact.** Another local account reads the archive. Today's data is synthetic, but T-81 classes backups as all-tenant PII. On the project's Windows host the files inherit the user-profile ACL. Medium impact × Low likelihood = LOW.

**Remediation.**

```ts
// pg-archive.ts
const newFileSink: SinkFactory = (path) => createWriteStream(path, { flags: 'wx', mode: 0o600 });
// backup.ts
mkdirSync(options.outDir, { recursive: true, mode: 0o700 });
if (process.platform !== 'win32') chmodSync(options.outDir, 0o700); // an existing empty folder keeps its old mode otherwise
writeFileSync(join(options.outDir, BACKUP_FILES.schema), schema, { flag: 'wx', mode: 0o600 });
writeFileSync(join(options.outDir, BACKUP_FILES.manifest), text, { flag: 'wx', mode: 0o600 });
// verify-restore.ts
writeFileSync(join(backupDir, REPORT_FILE), text, { mode: 0o600 });
```

Apply the same to `defaultRunDir`'s parents (`reports/rehearsal`, created `0o700`).

**Verification test.**

- A platform-independent unit test that the sink factory and the writes receive `mode: 0o600` and the folder `0o700`.
- A POSIX-only case (skipped on win32, like the `packages/config` file-provider cases) that `statSync(archive).mode & 0o077` is 0 after `runBackup`.

### PR034-SEC-03 (LOW): row data in the failure detail

**Description.** `maskValues` masks only `"…"`, `'…'` and `=(…)`. With a data-changing migration that fails on the restored data, which is the case the rehearsal exists for, `prisma migrate deploy` prints PostgreSQL's error lines. `outputTail` keeps the last 3. P3 shows a random row sentinel surviving into `detail` for:

- `DETAIL: Failing row contains (…)` (23514 check and 23502 not-null);
- a `RAISE` message that carries a value;
- a debug line whose value holds an escaped quote.

`detail` goes to `restore-report.json` and, on FAIL, to the CLI's stderr line (`verify-restore.ts:386-388`). Two other paths behave the same way:

- `errorSummary` (`pg-archive.ts:46-54`) keeps the first `error:` line. A `RAISE` during `pg_restore`'s COPY passes it unmasked.
- `failureOf` in the probe (`zero-downtime-probe.ts:118-124`) stores raw messages in the report samples.

**Exploitability and impact.** No attacker is needed. The failure output carries the failing row. Locally the data is synthetic. Once a rehearsal runs on non-synthetic data and its log is archived (NFR-REC-003 "report archived as an artifact", M5), this breaks the guardrail "0 PII in logs". Medium impact × Low likelihood today = LOW.

**Remediation.** Turn the deny-list into an allow-list. Keep only:

- the parsed names (`pending`, `failed`);
- Prisma's code (`P3018`/`P3009`);
- the SQLSTATE (`Database error code: NNNNN`);
- the first `ERROR:` line, with quoted fragments **and parenthesised groups** masked.

Drop every `DETAIL:`, `CONTEXT:`, `HINT:`, `QUERY:` and `DbError {` line. For SQLSTATE `P0001` (raise_exception) keep the code only.

```ts
const DROPPED = /^(?:DETAIL|CONTEXT|HINT|QUERY|WHERE):|^DbError \{/;
export const maskValues = (line: string): string =>
  line.replace(/"(?:[^"\\]|\\.)*"/g, '"…"').replace(/'(?:[^'\\]|\\.)*'/g, "'…'").replace(/\([^()]*\)/g, '(…)');
// outputTail: .filter((line) => line !== '' && !DROPPED.test(line) && !BANNER.some(…))
```

Apply the same `DROPPED`/parenthesis rule in `errorSummary`. In `failureOf`, keep `code` and a masked message.

**Verification test.** The five P3 shapes with random sentinels: no sentinel in `detail`, in the FAIL line or in the report. The `Key (…)=(…)` control is still masked. The pending and failed names are still parsed from the same texts.

### PR034-SEC-04 (LOW): the fingerprint's alias `t` turns into a column reference

**Description.** `tableFingerprintSql` hashes `t::pg_catalog.text` over `FROM ONLY <table> AS t`. PostgreSQL resolves a bare name as a column before it resolves it as a whole-row reference. So on a table with a column named `t`, the expression is that column, and the checksum ignores every other column. P4 (c) shows it: a changed `secret` column leaves the checksum unchanged, while the control table's checksum changes.

**Exploitability and impact.** No such column exists today (P10). A future one silently weakens the restore-fidelity control to row counts for that table: a corrupted or truncated restore of the other columns passes. Integrity impact Medium × Low likelihood = LOW.

**Remediation.** Use an unambiguous whole-row reference. Both forms were checked on PGlite (P7): they give the whole row with or without a column `t`, and the same text as today on other tables.

```ts
pg_catalog.convert_to((t.*)::pg_catalog.text, 'UTF8')
```

**Verification test.** A `rehearsal-manifest` int (or PGlite) case: a table `(id int, t text, secret text)` whose checksum must change when `secret` changes.

### PR034-SEC-05 (LOW): a range type's `subtype_diff` hides a writer from rule 10

**Description.** This is the sibling of D-ARCH-172. `CREATE TYPE … AS RANGE (subtype = …, subtype_diff = w)` names a routine without a call, and PostgreSQL calls it at every GiST build and insert. `subtype_diff` must be IMMUTABLE, but an IMMUTABLE PL/pgSQL wrapper may `PERFORM` a volatile writer. P7 shows it: PostgreSQL wrote 51 times during the index build. The same DDL, split into two migrations, lints clean on base and head (P7b). The migration can then be declared `data-changing: no` while it changes data in `migrate deploy`, which bypasses rule R.

**Exploitability and impact.** This needs a deliberately disguised migration that passes the security review. The consequence is a data-changing migration without a rehearsal, which is the guardrail rule R enforces. Low × Medium = LOW.

**Remediation.** Add the range form to rule 14's refused objects. No range type exists in the data model.

```ts
const REFUSED_OBJECTS = [/^create operator\b/, /^create (?:or replace )?rule\b/, /^create cast\b/,
  /^create (?:or replace )?aggregate\b/, /^create type\b[^;]*\bas range\b/];
```

List it in the rule-14 message and in the stated limits.

**Verification test.** A `refused-objects/<ts>_create_range_type` fixture fails rule 14. The 81 existing fixture outcomes stay unchanged.

### PR034-SEC-06 (INFO): the R1-M2 E-string decoding is unreachable in the lint path

**Description.** `nestedSql` decodes an E-string's line-break escapes only when `token.escape` is true. `doBlockChangesData` and `writingRoutineCall` pass `sqlText(statement, true)`, which writes `ESCAPE_STRING_MARK` directly before the `E'`. The mark ends in U+2063, and `isIdentifierChar` (`sql-text.ts:44`) counts every non-ASCII character as an identifier character. So the tokenizer reads the `E` as part of an identifier, and the literal as a standard string. P6 shows the raw body is rule 10, but the text the linter passes is not.

Rule 10 also never decodes `\x3b`, `\x27` or `\x2a\x2f`, which PostgreSQL turns into `;`, `'` and `*/` (P1 X1 to X3). Every such shape still carries rule 16, which refuses every E-string token, so the migration fails the lint overall. That is why this is INFO.

**Remediation.** Strip `ESCAPE_STRING_MARK` from the text before `bodyDataChanging` tokenizes it, or emit the mark with a separating space. Add a `lintMigrations`-level test for X4. The current test calls the body function on raw text. Correct the D-TASK034-13 wording: rule 16 is the control for escape strings.

### PR034-SEC-07 (INFO): rule R records are unsigned claims

**Description.** This is code review flag 2. A record is JSON that anyone can write with the right SHA-256 values.

**Ruling: accepted until M5, as D-TASK034-01 states.** `/prisma/migrations/` is security-owned, so every PR that adds a data-changing migration gets a security round. That round checks the evidence: the `restore-report.json` totals and `source.manifestSha256` quoted in the developer's hand-off must equal the record. At M5, the CD pipeline's snapshot-restore-verify step is the outcome control (§8.6).

### PR034-SEC-08 (INFO): the Prisma child processes inherit the superuser URL and the role passwords

**Description.** `scratchMigrator = { ...env, DATABASE_MIGRATOR_URL: … }` (`verify-restore.ts:363`) and `deployEnv = { ...env }` (`zero-downtime-probe.ts:377`) pass `DATABASE_BOOTSTRAP_URL` and `BOOTSTRAP_*_PASSWORD` to `prisma-cli.mjs`, which loads the repository's `prisma.config.ts`. Everything in that chain is pinned repository code, so this is least-privilege hygiene only.

**Remediation.** Build the child environment from an allow-list:

- the OS and runtime basics (`PATH`, `SystemRoot`, `HOME`/`USERPROFILE`, `TEMP`/`TMP`, `NODE_*` from the wrapper's list);
- `DATABASE_MIGRATOR_URL`;
- the Prisma variables the wrapper already pins.

## 6. Rulings on the developer decisions and the code review's flags

| Item | Ruling |
|---|---|
| D-TASK034-01 (rule R) | **Accepted**, with PR034-SEC-07 as the stated residual and the review step above. The rule's blind spots are rule 10's: PR034-SEC-05 (open) and PR034-SEC-06 (fail closed through rule 16) |
| D-TASK034-03 (manifest) | **Accepted**, except PR034-SEC-04. The code review's analysis of collisions, snapshots and sequences holds. The scheme is not tamper-resistant, which is right for a fidelity check |
| D-TASK034-06 (Compose exec, no password on a command line, loopback only) | **Accepted.** Verified in §4. A Compose project or Docker context that differs from the URL's server fails closed (unknown snapshot, missing scratch database) |
| D-TASK034-07 | **Accepted** (PR5-SEC-14 and the harness URL) |
| D-TASK034-09, -10, -13, -14 | **Accepted.** -10 relies on the merge base: I concur with code review R2-n2. -13: see PR034-SEC-06 |
| D-TASK034-12 (`readSecretFile`, code review flag 3) | **Accepted. PR11-SEC-11 d is closed.** A directory swapped between `realpath` and `open` is now caught: the re-resolved path must lie under the root and name the descriptor's device and inode. A residual race remains between the second `realpath` and `statSync`, which needs a third precisely timed swap. Every swap needs write access inside `/run/secrets`, a root-owned read-only mount whose writer could replace the secret itself. Node offers no `openat2(RESOLVE_BENEATH)`. No further change |
| D-ORCH-160 (C4 as a harness-only proof) | **Concur.** It keeps raw secrets out of agent shells (CLAUDE.md §5). The proof runs both CLIs' `main` with the production runner and dependencies, and only the transport differs. What it leaves unproven, Compose's project and service lookup, fails closed |
| Code review R2-m1 (the record binds re-read bytes) | **Concur** with the fix. From the security side it adds nothing to the hand-written-record residual (PR034-SEC-07), because only the operator running the rehearsal can edit the file in that window. No separate ID |
| Code review R2-n2 | **Concur.** The project's merge-only rounds close it in practice. `lintRepository` turns main red (fail closed) if it slips |

## 7. Conditions

None of this round's findings holds the merge by itself (0 Critical, 0 High). The conditions:

- **C1 (tracked, PR034-SEC-01).**
  - principal-architect rules on the restore isolation: the §8.6 step 4 fresh stack, or a recorded same-cluster deviation with its residuals.
  - The source control (the lint rule and the C15 catalog case) lands **before the `restore-rehearsal` suite is activated (qa-lead) or any rehearsal runs on non-synthetic data, and at the latest before G3**. Preferred carrier: this PR's next fix cycle, since TASK-034 holds the `tools/db` linter. Otherwise, the next linter holder.
- **C2 (binding).** R2-m1 is to be fixed in this PR (D-ORCH-169), so the head will change. Every later owned change needs a security delta round on the fix head, which re-runs P1, P5 and P6 and the probes of any finding fixed.
- **C3.** Before merge:
  - commit the lane-B evidence;
  - the merge with main, with a merge-only security round, because `package.json` is owned and changed on both sides. That round checks: the `scripts` union keeps the three `db:*` entries and main's changes; rule R and the out-of-order rule pass with main's 4 new migrations; and P1 is re-run on the merged `tools/db`;
  - lane B on the merge with main;
  - hosted `security-integration` and `migration-lint` once billing allows (D-ORCH-146);
  - the rename of this record once the PR exists, and the merge-ref check.
- **Follow-ups.** PR034-SEC-02 to -05 belong in the same fix cycle as R2-m1 (recommended; each is a few lines with one test). Otherwise they go to the next `tools/db` holder, before G3. PR034-SEC-03 must be fixed before any rehearsal on non-synthetic data. PR034-SEC-06 and -08 go with them, and -07 is a security-round checklist item.

## 8. Routing

- **principal-architect:** the C1 ruling (isolation versus a recorded same-cluster deviation, and the C15 catalog case). PR034-SEC-05 as the D-ARCH-172 follow-up. The T-81 / RR-05 text for the superuser-restore class.
- **senior-developer (TASK-034 fix cycle 3, with R2-m1):** PR034-SEC-01 item 1 if the architect so rules, PR034-SEC-02 to -06, and -08.
- **qa-lead:** the `restore-rehearsal` activation waits for C1.
- **orchestrator:** C2, C3, the carrier choice for C1, and the security-round checklist item of PR034-SEC-07 for data-changing migration PRs.

| Verdict | **PASS_WITH_CONDITIONS.** Round 1, bound to `3ee36f01` (diff `530629f4..3ee36f01`, 39 owned paths).<br>**Findings:** 0 Critical, 0 High. **PR034-SEC-01 MEDIUM**: the superuser restore runs routines that migrations wrote (CHECK, domain CHECK, STORED generated column), on the live cluster; lint clean; proven on PostgreSQL. LOW: PR034-SEC-02 (artefact modes), -03 (row data in the failure detail), -04 (fingerprint alias `t`), -05 (range `subtype_diff`). INFO: -06 (R1-M2 decoding unreachable, fail closed through rule 16), -07 (unsigned records, accepted until M5), -08 (child-process environment).<br>**Closed:** PR5-SEC-14, PR11-SEC-11 d (D-TASK034-12 accepted), PR293-SEC-04 (a) for rule 10 (fuzz 0 misses, mutant control 646) and (b) kept fail closed, D-ARCH-172 rule 14, R1-n2. Also closed: a live rule-10 bypass on main that needs no E-string.<br>**Conditions:** C1 the architect's ruling and the source control for PR034-SEC-01 before `restore-rehearsal` activation, any non-synthetic rehearsal, and at the latest G3; C2 a delta round on the fix head (R2-m1); C3 the evidence, a merge-only round (owned `package.json` on both sides), lane B on the merge, hosted CI, the rename |

## Round 2: delta round on fix cycle 3 (condition C2), head `1bac00b1`

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-034-backup-restore-rehearsal-zero-downtime`, not pushed. New since round 1: `447e23fd` (lane-B evidence of `3ee36f01`), `1a0cdeaf` (merge of origin/main `88fd7360`, #80 to #84), `e17f1d6d` (merge of the docs-only local main `3b807c24`) and `1bac00b1` (fix cycle 3: D-ARCH-238 F1 to F15, with D-TASK034-15 to -23 in its body) |
| Head | 1bac00b1335182af584a41919733126e88a0da99 |
| What was reviewed | The fix diff `e17f1d6d..1bac00b1` in full (45 files, 2,064+/178-) and both merges (§R2.6). Also the code paths of the round-1 findings at the head. Binding text: data-model §4.6 C17, §8.3 rules 14 and 21, §8.6 (second amendment) and A43; threat model v1.3 (T-81, RR-05, RR-19, §10.4 I); D-ARCH-235 to D-ARCH-238. The code review record, round 3 (D-CRPR034-02, APPROVED_WITH_NITS at `1bac00b1`), was read before this round was finalised |
| Base and main | Merge base with main: `88fd7360` (via `1a0cdeaf`). The origin/main tip when this round was written was `392bd8af`, and main has changed only `docs/` and `.claude/` since `88fd7360`. This round is committed on the local main |
| Lane B | `run-live78` = run `20261121T1743Z_1bac00b`, verdict **FAIL**. I read it from the queue log and the run's JUnit files; it is not committed yet.<br>**Passed:** `catalog-c1-c14` 134 of 134, all 13 C17 cases included; api 240; rls-cross-tenant 162.<br>**Integration: 9 failures in 536.** 2 are the main-wide gitleaks-full cases (D-ORCH-170). **7 are TASK-034's own `backup-restore.int.test.ts` cases, each with "schema: the normalised schema dump differs from the source":** the restore, the negative controls, the tampered manifest, the R1-M1 / R2-m1 record case, concurrent writes, `db:verify-restore` main, and the second-cluster CLI case. The gate case, the refused same-cluster case and the `(t.*)` case pass.<br>**Unit:** 1 failure in 8,755, the main-wide compose Valkey digest case (D-ORCH-170).<br>Lane B passed at `3ee36f01` (`20261121T1443Z_3ee36f0`), before the merges. The cause of the difference is not printed; the report's `schemaDiff` holds it |
| Lane A | None: not pushed, and hosted CI is billing-blocked (D-ORCH-146) |
| Reviewer / date | security-analyst, 2026-11-21, round 2 (condition C2 of D-SECPR034-01).<br>**Host rule:** no Docker and no npm suites. No command ran in the worktree, and nothing was written there; I only read the lane-B run files under its `docs/05-quality/tests/runs/`. `.env*` was not opened.<br>**Method:** single-process Node 24.22.3 probes on `git archive` extracts of `1bac00b1` (head), of `3ee36f01` (r1, the positive control) and of a mutant. A load hook strips the types. PGlite 0.4.3 (PostgreSQL 17.5) answers the PostgreSQL questions. Probes are in the session scratch `t034r2/probes/` and may vanish; the results are kept here |

### R2.1 Summary

**No Critical or High finding.** Round 2 adds 2 MEDIUM and 1 INFO.

What is now verified:

- **All five checks of D-ARCH-238 ("How security-analyst checks C1") hold at the head.**
  - Check 1: the four P1b escalation shapes are rule-21 findings, and P7b is a rule-14 finding.
  - Check 2: C17 is green on PostgreSQL 18 in lane B, with the `query_to_xml` probe planted.
  - Check 3: the gate int case passes in lane B.
  - Check 4: `--same-cluster` is refused when it is missing on the same cluster and when it is given for another cluster, and `target.sameCluster` is in the report.
  - Check 5: the residuals equal RR-19.
- **Lane B is red on TASK-034's own restore cases.** Seven `backup-restore` int cases fail with a schema difference between the source and the restored database. That is a functional failure, and the verification fails closed. It holds the merge (C4) until it is explained and fixed.
- **Closed:** PR034-SEC-02, -03, -04, -05, -06 and -08 (§R2.4).
- **The merges are pure.** Every control of main is kept (§R2.6).

Two new paths still let code written by the migrator run as the superuser:

- **PR034-SEC-09 (MEDIUM).** The gate and C17 trust an operator when the routine behind it is in `pg_catalog`. A planted operator `public.@@@` over `pg_catalog.ts_rewrite(tsquery, text)` runs any query text as the loading role. That routine is VOLATILE and PUBLIC may execute it. C17 reports 0 rows, and the migrator becomes SUPERUSER at the superuser load. Rule 14 does not read DO or routine bodies, and rule 21 cannot see an unqualified operator, so the whole chain lints clean as one migration. The catalog case of PR24-SEC-02 (no operator in `public`) is the only control that meets a migration in lane B. Nothing meets a holder of the migrator credential.
- **PR034-SEC-10 (MEDIUM).** `db:backup` and `db:verify-restore` read `public._prisma_migrations` as the superuser by name. The migrator owns that table and can replace it with a view. The read then runs the view's routine as the superuser, on the source cluster, during the backup, so the isolation of D-ARCH-235 does not apply. Data-model §8.6 says these sessions "never read a view".
- **PR034-SEC-11 (INFO).** Two narrow residuals of the failure-detail allow-list.

**C1 is kept open and narrowed to PR034-SEC-09 and PR034-SEC-10** (§R2.8). C2 is discharged by this round. C4 binds the merge to a green lane B, which `1bac00b1` does not have.

### R2.2 What I verified

| # | Probe | Result |
|---|---|---|
| P1 | Round 1's 21 shapes through `lintMigrations`, r1 against head | Identical, with two changes. X4 (an E-string `\n` in `EXECUTE`) is now rule 10 + 16; it was 16 only (PR034-SEC-06 fixed in the real lint path). T1 to T4 gain rule 21 |
| P1b | The four escalation shapes of PR034-SEC-01, each with `SET lock_timeout` first and `NOT VALID` plus `VALIDATE`: `ALTER ROLE … SUPERUSER`, `GRANT pg_execute_server_program`, `COPY … TO PROGRAM`, a `pg_authid` read | r1: clean under every rule. Head: **rule 21** on all four ("calls public.fixture_ok, a routine of this or an earlier migration") |
| P7b | `CREATE TYPE … AS RANGE (subtype_diff = …)` alone in a migration | r1 clean, head **rule 14** |
| P2 | 33 rule-21 and rule-14 edge shapes, r1 against head | Rule 21 reports 14 forms:<br>- an unqualified registry call; quoted schema and name; spaces or a comment around the dot;<br>- `ALTER TABLE ONLY … ADD CHECK`; a domain CHECK; `ALTER DOMAIN`; a generated column; a partition key; `SET EXPRESSION AS`;<br>- `query_to_xml`; a quoted `"ts_rewrite"`; a `)` inside a dollar string; `CREATE TABLE IF NOT EXISTS`.<br>Not seen by rule 21: `table_to_xml` over a view (= R3-n5), attribute notation (`(t).f`), and a CHECK inside a DO block or a routine body (= R3-n4). C17 reports all three through the call (`table_to_xml` is STABLE).<br>Rule 14: a newline or a comment before `RANGE` is caught. A quoted name with `;` is missed (= R3-m1). The same regex on masked text also over-reports `CREATE TYPE "x (as range)" AS ENUM` (fail closed). Not caught: a range type or `CREATE OPERATOR` inside a DO block or a routine body, on r1 and head |
| P5 | Differential fuzz of the rule-10 body reader (60,000 lexing bodies), head against r1. Mutant control: `tolerantRead` without `--` comment blanking | Head = r1: 20,562 write-bearing, **0 fallback misses**, 396 over-approximations (`sql-text.ts` is unchanged since round 1). Mutant: **646 misses** in 30,000 |
| P6 | Round 1's mark probe | Unchanged at function level. The fix strips `ESCAPE_STRING_MARK` in `bodyText` before rule 10 reads the body, so the decoding is reached in the lint path (P1 X4) |
| P3b | `deployOutcome`, `errorSummary` and `failureOf` with random sentinels; r1 against head | Deploy detail leaks in 7 of 11 shapes at r1 and 2 at the head. The head masks:<br>- `DETAIL: Failing row contains (…)` (23514, 23502) and a P0001 RAISE;<br>- the `DbError` line with an escaped quote and nested parentheses;<br>- quoted values, the cut at 2,000 characters and the banner.<br>Left: a RAISE with a non-P0 SQLSTATE and an unquoted value (stated by D-TASK034-19), and a row token shaped like a Prisma code (PR034-SEC-11).<br>`errorSummary`: 2 of 4 leak at r1, 1 at the head (a lower-case `error:` server prefix, PR034-SEC-11).<br>`failureOf`: P0 messages withheld, quoted values masked, a non-P0 unquoted RAISE value kept (same residual) |
| P4c | `tableFingerprintSql` on PGlite, table `(id, t, secret)`, edit `secret` | r1: checksum unchanged (the defect). Head: changed. Control table without a column `t`: changed on both |
| P8 | `prismaChildEnvironment` with 29 variable names | Kept: `DATABASE_MIGRATOR_URL` (replaced by the scratch URL), `PATH`/`Path`, `HOME`, `TEMP`/`tmp`, `SystemRoot`, `NODE_ENV`, `CI`, `LC_ALL`, `TZ`, `NODE_EXTRA_CA_CERTS`. Dropped:<br>- `DATABASE_BOOTSTRAP_URL`, `DATABASE_URL`, `SHADOW_DATABASE_URL`;<br>- every `BOOTSTRAP_*` password and `*_FILE`;<br>- `NODE_OPTIONS`, `NODE_AUTH_TOKEN`, `PRISMA_*`, `npm_config_*`;<br>- `PGPASSWORD`, `PGPASSFILE`, `PGSERVICEFILE`, `LD_PRELOAD`, `BASH_ENV`, token-like names |
| P9 | `runVerifyRestore` with fake sessions, and `parseManifest` | A manifest with a finding is refused before the admin session opens. Same cluster without the switch: refused, and so is the switch on another cluster; no `CREATE DATABASE` either way. Same cluster with the switch, and another cluster without it: `CREATE DATABASE`, then `DROP DATABASE` in `finally`. A non-numeric or empty target identifier is refused. `parseManifest` refuses 8 malformed `loadTimeCode`/`cluster` shapes and accepts the valid control |
| P10 | `lintRepository` on the head extract: 11 migrations, bootstrap lane and records | **0 findings** (rule R and the out-of-order rule pass with main's 4 new migrations). Control: one committed CHECK rewritten to call a migration routine gives 1 rule-21 finding |
| P11 | PGlite: a non-superuser `mig` plants `public.@@@ (LEFTARG = tsquery, RIGHTARG = text, FUNCTION = pg_catalog.ts_rewrite)` and a CHECK `('a'::tsquery @@@ 'select public.w(), public.w()') IS NOT NULL`. As a table CHECK (B1), a domain CHECK (B2), and `NOT VALID` + `VALIDATE` (B3). Then `mig` writes a row, and the superuser writes one. Then C17 at the head, and a candidate fix | B1 to B3: `mig`'s own write leaves it NOSUPERUSER, and the superuser write makes **`mig` SUPERUSER**. The side table names `postgres`. **C17 at the head: 0 rows.** The candidate fix (an operator outside `pg_catalog` is a finding) reports 1 row each.<br>Controls:<br>- the D-ARCH-236 planted operator over a public routine (K1) and a direct `ts_rewrite` call (K2) are reported by the head;<br>- the committed built-in operator shapes (IN list, `IS DISTINCT FROM`, `NULLIF`, `timestamptz + interval`, `~`, `= ANY`, a row comparison, a `COALESCE` generated column) give 0 rows under the fix.<br>Facts on 17.5: `ts_rewrite(tsquery,text)` is VOLATILE with PUBLIC EXECUTE; `lo_export` has no PUBLIC EXECUTE (CREATE OPERATOR needs EXECUTE); no built-in operator has a VOLATILE routine; the `table_to_xml` family is STABLE |
| P11b | P11 as one migration through `lintMigrations` (S9): `CREATE OPERATOR` inside `DO $$ … $$`, a migration routine, and a CHECK with the unqualified `@@@` and a query text built with `chr(40)` | **Clean under every rule** on r1 and head. Control S9c, the same with a top-level `CREATE OPERATOR`: rule 14 |
| P12 | `SELECT … FROM ONLY <view>` | Accepted on PGlite: `FROM ONLY` does not exclude a view |
| P13 | PGlite: `mig` owns a Prisma-shaped `_prisma_migrations`, renames it, and creates a view of that name that calls `public.w2()`: in the WHERE clause (V1) or in the select list only (V2). Then the superuser runs `MIGRATION_TABLE_SQL`, `MIGRATION_HEAD_SQL` and `APPLIED_CHECKSUM_SQL` of the head | V1 and V2: `present` is true, the head is returned, and **`mig` is SUPERUSER after the superuser's read**. Control K0 (base table): nothing runs. A `relkind = 'r'` check reports the view as not a table |
| P13b | P13 inside `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, the transaction of `runBackup` | `ALTER ROLE` is refused (25006). **`COPY (SELECT current_user) TO '<file>'` succeeds:** the file holds `postgres`. PostgreSQL treats COPY TO as read-only, so `COPY … TO PROGRAM` is the same statement in that transaction (not run here: PGlite starts no programs) |
| P13c | P13 as a migration (S10) | A top-level rename gives rule 3. Inside a DO block: **clean** |
| P14 | Fake file system through `privateFiles` | Linux: `mkdir` recursive `0700` and then `chmod 0700`; exclusive writes `wx 0600`; the report `w 0600` and then `chmod 0600`; the archive sink `wx 0600`. win32: the same modes, without `chmod`. Real POSIX modes ran nowhere this round: lane B runs on Windows and skips the POSIX-only cases |
| P15 | gitleaks v8.30.1 git-mode emulation (round 1's `gl-emu.mjs`) | See §R2.10 |

### R2.3 Condition C1: the checks of D-ARCH-238

| Check (D-ARCH-238) | Status at `1bac00b1` |
|---|---|
| 1. The P1b shapes are rule-21 findings, and P7b is rule 14 | **Holds** (P1b, P7b). Forms around them: P2 |
| 2. C17 is green in lane B on PostgreSQL 18, with the `query_to_xml` probe planted | **Holds.** All 13 C17 cases pass in `run-live78`: the committed state, 10 planted probes (`query_to_xml` among them), the controls, and the VIRTUAL case. Which VIRTUAL outcome was taken is not in the JUnit (R3-n2). C17 has no probe for PR034-SEC-09 |
| 3. The gate case of F13 | **Holds.** The unit halves pass (P9; the backup returns 1 with its three files, read in the commit's unit test). The int case passes in `run-live78`: NOT VALID + VALIDATE; `main` of both CLIs returns 1; no scratch database; no bootstrap-role row in the side table; the migrator is not a superuser |
| 4. `--same-cluster`: refused when missing, refused when wrong, `target.sameCluster` reported | **Holds** (P9; the report field is set from the comparison; the PASS line names the form). Code review R3-n1: the identity is read on the admin URL's cluster, while `pg_restore` runs in the Compose service. If the two differ, the restore fails closed, unless that cluster already has a database with the scratch name. Concur, routed to TASK-119 |
| 5. The residuals I listed are RR-19, and §8.6 carries the rule, the exception and its end | **Holds.** RR-19 (a) holds round 1's three residuals: superuser code on the live local cluster, `00-roles.sql` re-setting the passwords and attributes, and a `--keep` copy. (b) and (c) add unlisted call sites and trusted IMMUTABLE built-ins. §8.6 states the rule, the exception with its conditions, the end of the exception ("first non-synthetic row, or a superuser that is not the operator's own"), and that CI never uses the exception. PR034-SEC-09 and -10 are not residuals: they are defects against §4.6 C17 and §8.6 (§R2.5) |

### R2.4 Round-1 findings

| ID | Status at `1bac00b1` |
|---|---|
| PR034-SEC-01 | **Open, narrowed (C1).** Done:<br>- the rule and the exception (D-ARCH-235), with the cluster check;<br>- rule 21 and the rule-14 range form;<br>- C17 and the gate, with refusals before any database work.<br>Remaining: the lane-B cases, PR034-SEC-09 and PR034-SEC-10 |
| PR034-SEC-02 | **Closed.** `private-files.ts`: folders `0o700`, with `chmod` on POSIX (it also tightens an existing empty folder); files `0o600` (archive sink `wx`, manifest and schema `wx`, report `w` plus `chmod`) (P14). The real POSIX modes are proven by the POSIX-only cases on the first Linux run (hosted lane A or the TASK-119 job) |
| PR034-SEC-03 | **Closed** for the round-1 shapes (P3b). Residuals: D-TASK034-19 (accepted, §R2.7) and PR034-SEC-11 (INFO) |
| PR034-SEC-04 | **Closed** (P4c). `(t.*)::pg_catalog.text`, with an int case |
| PR034-SEC-05 | **Closed** for the shape of the finding (P7b). The regex misses a quoted name holding `;` (R3-m1, concur). Rule 14 does not read DO bodies: part (b) of PR034-SEC-09. C17 (b) reports any range type outside an extension, and the gate does too |
| PR034-SEC-06 | **Closed** (P1 X4, P6). D-TASK034-16 corrects -13 |
| PR034-SEC-07 | INFO, accepted until M5. The security-round checklist for data-changing migrations gains the two lines of D-ARCH-238: the hand-off quotes `target.sameCluster` (false) from the report and an empty `loadTimeCode` from the manifest |
| PR034-SEC-08 | **Closed** (P8) |

### R2.5 New findings

| ID | Severity | CWE / OWASP 2021 | File:line | Title |
|---|---|---|---|---|
| PR034-SEC-09 | **MEDIUM** | CWE-250, CWE-184 / A04 | `tools/db/load-time-code.ts:44-65` (the `:opno` and `:opfuncid` arms check only the routine's schema, and volatility only for `call`); data-model §4.6 C17 (a) "Every operator it uses is implemented by a `pg_catalog` routine"; `tools/db/lint-migrations.ts:579-585` (`REFUSED_OBJECTS`, tested on top-level statements only) | A planted operator over a `pg_catalog` routine passes C17, the gate and the linter |
| PR034-SEC-10 | **MEDIUM** | CWE-250, CWE-706 / A04 | `tools/db/rehearsal-manifest.ts:101-105` (`MIGRATION_TABLE_SQL`, `MIGRATION_HEAD_SQL`, read by `captureManifest` in `db:backup` and on the restored database); `tools/db/verify-restore.ts:113-115` (`APPLIED_CHECKSUM_SQL`, new in this cycle) | The superuser sessions read `public._prisma_migrations` whatever relation it is |
| PR034-SEC-11 | INFO | CWE-532 / A09 | `tools/db/prisma-outcome.ts:102`, `:117`; `tools/db/pg-archive.ts:49` | Two residuals of the failure-detail allow-list |

#### PR034-SEC-09 (MEDIUM): a planted operator over a `pg_catalog` routine passes C17, the gate and the linter

**Description.** For operators, C17 asks only whether the implementing routine lives in `pg_catalog`. Data-model §4.6 C17 (a) says the same: "Every operator it uses is implemented by a `pg_catalog` routine". The schema of the operator itself is never read, and volatility is checked only for direct calls. `pg_catalog.ts_rewrite(tsquery, text)` runs its second argument as a query, as the calling role. It is VOLATILE, and PUBLIC may execute it, so any role with CREATE on a schema can make it an operator. A table CHECK or a domain CHECK through that operator runs any routine the query text names, as the role that writes the row. P11 shows it: the migrator's own write leaves it NOSUPERUSER, the superuser's write makes it SUPERUSER, and C17 at the head returns 0 rows. A generated column and a partition key are not affected: PostgreSQL requires IMMUTABLE there.

Who meets it:

- **A holder of the migrator credential**, acting on a database that is backed up later. The gate is the only control that meets this actor (data-model §8.6: "it also covers an object that a holder of the migrator credential created outside the migrations"), and the gate runs the C17 query. So the backup records `loadTimeCode: []`, `db:verify-restore` restores, and `pg_restore`'s COPY runs the planted routine as the superuser.
- **A migration.** Rule 14 tests `REFUSED_OBJECTS` on top-level statements, so `DO $$ BEGIN CREATE OPERATOR … END $$` is clean (on r1 too; this is the lint half of PR24-SEC-02, and it applies equally to CREATE RULE, CAST, AGGREGATE and TYPE … AS RANGE). Rule 21 sees an operator only as `OPERATOR(schema.op)`, and reads names in the query text only where they are spelled `name(`. The whole chain lints clean as one migration (P11b). C17 in lane B reports nothing. The catalog case of PR24-SEC-02 ("public and platform hold no operator outside an extension", `c01-c12.int.test.ts`) would turn lane B red, and it is the only control left for this actor.

**Exploitability and impact.**

- **Impact: High.** The result is superuser on the cluster that runs the restore. With the default form of D-ARCH-235 that is a second, fresh stack: in CI it holds the job's copy, and `COPY … TO PROGRAM` gives a shell in its database container. With `--same-cluster` it is the developer's live local cluster.
- **Likelihood: Low.** It needs the migrator credential, a later backup and a rehearsal. The migration path is caught by the PR24-SEC-02 catalog case in lane B.
- Matrix: High × Low = **MEDIUM**, as for PR034-SEC-01, whose closure this finding holds open.

**Remediation (code level).**

1. **C17: an operator must itself be a `pg_catalog` operator**, whatever routine implements it. In the `:opno` arm, read `o.oprnamespace`, and report every operator outside `pg_catalog` (and any unknown operator). P11 proves this form: B1 to B3 are reported, and the committed operator shapes still give 0 rows.

   ```sql
   SELECT s.kind, s.object,
          CASE WHEN o.oprnamespace = 'pg_catalog'::pg_catalog.regnamespace THEN 'operator' ELSE 'planted operator' END,
          o.oprcode::pg_catalog.oid
     FROM site s CROSS JOIN LATERAL pg_catalog.regexp_matches(s.tree, ':opno ([0-9]+)', 'g') AS m (found)
     LEFT JOIN pg_catalog.pg_operator o ON o.oid = m.found[1]::pg_catalog.oid
   -- and in the outer WHERE:
   --    OR r.via = 'planted operator'     -- reason: 'operator outside pg_catalog'
   ```

   Also refuse an operator whose routine is VOLATILE (no built-in operator has one on 17.5, so nothing legitimate is lost). The fence of data-model §8.6 and `LOAD_TIME_CODE_SQL` change together, because the unit test pins them equal. Principal-architect amends §4.6 C17 (a) and the §8.6 sentence "A privileged load therefore runs IMMUTABLE built-in routines only". Operators may be STABLE, so that sentence is not true as written.
2. **C17 planted probes:** a table CHECK and a domain CHECK through `public.@@@` over `pg_catalog.ts_rewrite`, each reported with kind and reason.
3. **Rule 14 in bodies:** apply `REFUSED_OBJECTS` at the statement starts that rule 10 already recognises inside DO and routine bodies (`begin|then|else|loop|execute|;` and string starts). A planted `DO $$ BEGIN CREATE OPERATOR … END $$` then fails, as does the S9 chain. The rule-14 header states what stays dynamic.
4. **Rule-21 limits:** the header and §8.3 add "an unqualified operator" and "attribute notation (`(t).f`)", next to R3-n4 and R3-n5. C17 and the catalog operator case are the boundary for them.

**Verification test.** P11 B1 to B3 as C17 planted cases (int, PostgreSQL 18), with the committed state still at 0 findings. S9 fails rule 14 as a lint fixture under `refused-objects/`. A `loadTimeCodeFindings` unit row with reason `operator outside pg_catalog` that the reviewed list cannot excuse.

#### PR034-SEC-10 (MEDIUM): the superuser sessions read `public._prisma_migrations` whatever relation it is

**Description.** `captureManifest` reads `public._prisma_migrations`:

- `MIGRATION_TABLE_SQL` checks only that the name resolves (`to_regclass … IS NOT NULL`);
- `MIGRATION_HEAD_SQL` then selects from it;
- `APPLIED_CHECKSUM_SQL` (fix cycle 3, R2-m1) does the same on the restored database.

All three run as the bootstrap superuser. The table is created by Prisma as the migrator, and the migrator owns it. So a holder of the migrator credential can rename the table and create a view with the old name. Prisma's own writes still pass through it, because a simple view is auto-updatable. A view runs the routines in its query as the reader. P13 shows it: the superuser's head read makes the migrator SUPERUSER, with the routine in the WHERE clause or only in the select list.

**This read happens in `db:backup`, on the source cluster,** in both forms of D-ARCH-235, so the separate restore target bounds nothing here. Inside the backup's `REPEATABLE READ READ ONLY` transaction, `ALTER ROLE` is refused, but `COPY … TO` a server file succeeds as `postgres` (P13b). `COPY … TO PROGRAM` is the same statement class, which gives a shell as the server's OS user, the owner of the data directory. `db:verify-restore` repeats the read on the restored database in autocommit mode, where `ALTER ROLE` works too.

Data-model §8.6 (normative) says these sessions "read the system catalogs and base tables (`relkind = 'r'`, `FROM ONLY`) … They never read a view". The runbook and the `verify-restore.ts` header say the same. The code does not enforce it. `FROM ONLY` would not have helped either: PostgreSQL accepts it on a view (P12).

Who meets it:

- **A holder of the migrator credential:** not the gate, C17 or the linter.
- **A migration:** a top-level rename is rule 3, but the same DDL inside a DO block is clean (P13c). The catalog classification cases would probably flag the renamed table in lane B; that was read, not run.

**Exploitability and impact.** High impact: superuser, or OS-level code, on the live source cluster. Low likelihood: the migrator credential and a later backup are both needed. Matrix: **MEDIUM**. Round 1 missed this read: `MIGRATION_HEAD_SQL` was already there at `3ee36f01`.

**Remediation (code level).**

1. Before any read of `_prisma_migrations` in a privileged session:
   - lock it (`LOCK TABLE public._prisma_migrations IN ACCESS SHARE MODE`), so that a rename waits until the transaction ends;
   - then require `relkind = 'r'` for the locked relation by OID. Refuse with a `RehearsalError` if it exists but is not an ordinary table. Never treat it as absent.

   ```ts
   export const MIGRATION_TABLE_SQL = `SELECT c.relkind::pg_catalog.text AS relkind FROM pg_catalog.pg_class c
     WHERE c.oid = pg_catalog.to_regclass('public._prisma_migrations')`;
   // captureManifest: none -> migrationHead null; relkind 'r' -> LOCK TABLE …, re-check, then MIGRATION_HEAD_SQL;
   // anything else -> throw new RehearsalError('public._prisma_migrations is not a table (relkind …): refused (data-model 8.6)')
   ```

   Apply the same before `APPLIED_CHECKSUM_SQL`.
2. **Same race for the fingerprinted tables.** `TABLES_SQL` lists the tables under the transaction snapshot, but each `FROM ONLY <name>` resolves the name under the latest catalog. A table swapped for a view after `pg_dump` released its locks would be read as a view. Take `ACCESS SHARE` locks on the listed tables in the manifest session before `pg_dump` starts, or re-check `relkind` by OID after locking. This was reasoned, not probed.
3. Principal-architect: in §8.6, replace "`relkind = 'r'`, `FROM ONLY`" with the relkind check under a lock. `FROM ONLY` does not exclude views.

**Verification test.**

- A PGlite or PostgreSQL 18 case: the migrator replaces `_prisma_migrations` with a view that calls a routine recording `current_user`. Then `runBackup` refuses, the routine never ran as the superuser, and the migrator is not a superuser.
- The same case for the restored database: `verifyRestoredDatabase` and `APPLIED_CHECKSUM_SQL`.
- A unit case: a view `relkind` is refused, not treated as absent.

#### PR034-SEC-11 (INFO): two residuals of the failure-detail allow-list

**Description.**

- `PRISMA_CODE` is matched on every output line, `DETAIL:` and `DbError` included. A row value shaped like a Prisma code (`P1000` to `P5999`) therefore reaches the detail as a "code" (P3b).
- `errorSummary` drops the server message only after an upper-case `ERROR:`/`FATAL:`/`PANIC:`. A server in another `lc_messages` locale keeps its message, with only the quoted parts masked.

Both are narrow: a five-character token, and a locale the Compose image does not set.

**Remediation.**

- Collect Prisma codes only from Prisma's own lines: the `Error: P…` header, and lines before `Database error:`.
- Cut the server part at the first severity word after the tool's `error:` prefix, whatever its case or language, or set `lc_messages=C` in the tool's session.

### R2.6 The merges (the merge-only part of C3)

- **Both merges are pure.** `git merge-tree --write-tree 447e23fd 88fd7360` gives `ae7b792b`, which is the tree of `1a0cdeaf`. `git merge-tree --write-tree 1a0cdeaf 3b807c24` gives `473c956f`, which is the tree of `e17f1d6d`.
- **One path is changed on both sides: `package.json`.** The branch's delta is unchanged on the main side, and main's delta is unchanged on the branch side (hunks compared both ways). The union keeps the three `db:*` scripts and every main change.
- `git diff --raw 88fd7360 1a0cdeaf` equals `git diff --raw 530629f4 447e23fd`, path for path, apart from the `package.json` blob. So **every control of main is kept** in `1bac00b1`'s parents.
- **Linter on the merged tree:**
  - `lintRepository` gives 0 findings over the 11 migrations (P10). Rule R and the out-of-order rule pass with main's four new migrations, all `data-changing: no`.
  - P1 and P5 were re-run on the merged `tools/db`.
  - No committed load-time clause is a rule-21 finding. The commit counts 112 clauses. My plain keyword count, which includes mentions in comments, is 62 in the `migration.sql` files and 56 in the bootstrap lane, 118 in all. The control fires (P10).
- Main has changed only `docs/` and `.claude/` since `88fd7360`. A later merge of main needs no new merge-only round unless it brings an owned path that the branch also changes.

### R2.7 Rulings on D-TASK034-15 to -23

| Item | Ruling |
|---|---|
| D-TASK034-15 (the merges) | **Accepted.** Verified in §R2.6 |
| D-TASK034-16 (corrects -13) | **Accepted.** P1: X4 is rule 10 at the lint level, and X1 to X3 stay rule 16 only |
| D-TASK034-17 (VIRTUAL, two outcomes) | **Accepted for this head.** Concur with R3-n2: pin the outcome lane B shows |
| D-TASK034-18 (second-cluster case without a harness change) | **Accepted.** It is the shape of the TASK-119 job. Concur with R3-n1 for the Compose binding |
| D-TASK034-19 (`errorSummary` drops the server message; a non-P0 RAISE keeps its masked line) | **Accepted.** The kept words are the migration author's text, inside a security-reviewed migration. PR034-SEC-11 lists two more residuals |
| D-TASK034-20 (injectable file system; POSIX-only cases) | **Accepted.** The real modes are proven on the first Linux run (§R2.4) |
| D-TASK034-21 (child allow-list) | **Accepted** (P8). Excluding `NODE_OPTIONS` and `NODE_AUTH_TOKEN` is right |
| D-TASK034-22 (rule-21 limits) | **Accepted**, with the limits of PR034-SEC-09 item 4 added: an unqualified operator and attribute notation, next to R3-n4 and R3-n5 |
| D-TASK034-23 (`compareManifests` reports load-time code; the CLI lists 5) | **Accepted** |
| Code review R3-m1, R3-n1, R3-n4, R3-n5 | **Concur.** R3-m1 is my P2 shape. R3-n4 and R3-n5 rely on "C17 and the gate are the boundary". PR034-SEC-09 shows that boundary has a gap for operators. Once it is fixed, R3-n4 and R3-n5 stay NITs |

### R2.8 Conditions after round 2

The verdict is PASS_WITH_CONDITIONS: there is no Critical or High finding, and none of this round's findings holds the merge by itself.

- **C1 (tracked; kept open, narrowed).** Closed by this round: the ruling (D-ARCH-235) and all five checks of D-ARCH-238. What remains:
  - (b) PR034-SEC-09 items 1 to 3, with the architect's text for C17 (a) and §8.6.
  - (c) PR034-SEC-10 items 1 and 2, with the architect's text for §8.6.

  (Item (a), the lane-B checks, is closed by `run-live78`.)

  The due point is unchanged: before qa-lead activates `restore-rehearsal`, before any rehearsal on non-synthetic data, and at the latest G3. TASK-034 has used its three fix cycles. The split rule of D-ARCH-238 fits (b) and (c): one follow-up card on the lock `db-tools-backup` and the `tools/db` linter, carrying PR034-SEC-09, -10 and -11 and code review R3-m1, R3-n3 and R3-n4. Until that card merges, every rehearsal is a same-cluster run on synthetic data on the developer's own stack, as D-ARCH-238 already says. The orchestrator decides the carrier and records it.
- **C2: discharged** by this round.
- **C3 (remaining).** Before merge:
  - commit the lane-B evidence of `run-live78`;
  - hosted `security-integration` and `migration-lint`, once billing allows;
  - rename this record when the PR exists, then the merge-ref check.

  The merge-only part is done (§R2.6). A further merge of main needs a merge-only round only if it brings an owned path that the branch also changes.
- **C4 (binding): NOT MET at `1bac00b1`.** `run-live78` is red on 7 of TASK-034's own `backup-restore.int.test.ts` cases (schema difference after restore; Lane B row), the second-cluster CLI case of D-ARCH-235 among them. The head goes back to senior-developer:
  - Report the `schemaDiff` lines. If any of them is a grant, a policy, an owner, an RLS flag, a trigger or an event trigger, the restore loses or changes an access control, and security reviews it.
  - Fix the cause, and run lane B on the new head.
  - Any change to an owned path needs a security delta round on that head: the probes of this round for the touched files, and P1, P5 and P10.

  The main-wide reds of D-ORCH-170 (gitleaks-full, the compose Valkey digest) do not count against TASK-034. TASK-034 has used MAX_FIX_CYCLES, so the orchestrator applies CLAUDE.md §7 to this failure.

### R2.9 Threat model v1.3 and SEC-TC-85

- **Confirmed** (I own the document), with one correction for PR034-SEC-09:
  - the T-81 row, RR-05 and RR-19 as written;
  - §10.4 I items 1 to 6, with item 3(a) corrected.
- **Accuracy notes on §10.4 I:**
  - Item 5 holds: foreign-key checks and index builds run as the table owner.
  - Item 3(a) says the gate records "every load-time expression that calls anything but an IMMUTABLE `pg_catalog` routine". The query lets operators pass by the routine behind them; the operator itself is never checked. I added that qualification in the text, pointing to item 8.
- **SEC-TC-85 assigned** to §10.4 I item 7. It is free on origin/main (the highest in use is 84). Its scope:
  - C17 with its planted controls, including the `query_to_xml` probe, and, once PR034-SEC-09 is fixed, the planted operator over `ts_rewrite`;
  - the fixtures of rules 21 and 14;
  - the gate case;
  - the `--same-cluster` refusals;
  - once PR034-SEC-10 is fixed, a `_prisma_migrations` view refused before any read.

  qa-lead adds it to `catalog-c1-c14.required_cases` (and to the `migrations` suite) after the merge.
- **New §10.4 I item 8:** PR034-SEC-09 and -10, open, MEDIUM. They are not residuals of RR-19. A row for SEC-TC-85 is added to the §10.4 F table.

### R2.10 Secrets scan and record binding

**Record simulation.** I simulated the merge ref that ci-gate reads: a sparse shared clone, main at `392bd8af` plus this record as `PR-9999-…`, merged with `1bac00b1`. Main's `check-security-owned-paths.mjs --base 3b807c24 --head 1bac00b1` passes with 64 owned paths. The controls fail as they should:

- no record;
- a round-2 verdict FAIL;
- a round-2 Head row naming `e17f1d6d`;
- round 1 alone.

**Secrets scan.**

The gitleaks v8.30.1 git-mode emulation (round 1's `gl-emu.mjs`: default rules plus main's `.gitleaks.toml`) was run over:

- `e17f1d6d..1bac00b1`: 1 commit, 2,064 added lines in 228 fragments, **0 findings**;
- this round's text and the threat-model and DECISIONS additions, each scanned as one fragment: **0 findings**.

Runtime-built controls (a GitHub PAT, an AWS key id and a generic key) give 4 findings: `github-pat`, `aws-access-token`, and `generic-api-key` twice. The two merges bring only main's own commits, which main's gitleaks-full already covers. The test passwords of the new int cases are random per run.

### R2.11 Routing

- **principal-architect:**
  - PR034-SEC-09: the text of §4.6 C17 (a) (an operator must be a `pg_catalog` operator), the §8.6 fence and the sentence "A privileged load therefore runs IMMUTABLE built-in routines only";
  - whether rule 14 reads DO and routine bodies (PR034-SEC-09 item 3);
  - PR034-SEC-10: the §8.6 wording "`relkind = 'r'`, `FROM ONLY`";
  - code review R3-n5.
- **senior-developer** (the follow-up card of §R2.8 C1, or the next `tools/db` holder): PR034-SEC-09 items 1 to 4, PR034-SEC-10 items 1 and 2, PR034-SEC-11, and code review R3-m1, R3-n3 and R3-n4.
- **qa-lead:**
  - `restore-rehearsal` activation still waits for C1;
  - SEC-TC-85 joins `catalog-c1-c14.required_cases` after the merge;
  - a same-cluster run is never evidence for that suite.
- **senior-developer, now (C4):** the `schemaDiff` of the 7 red restore cases, and its cause and fix on a new head.
- **orchestrator:**
  - C4: the red `run-live78`, the §7 step for a task past MAX_FIX_CYCLES, and lane B on the new head;
  - C3;
  - the carrier decision for C1 (b) and (c);
  - the PR034-SEC-07 checklist lines.

| Verdict | **PASS_WITH_CONDITIONS.** Round 2 (C2 delta round), bound to `1bac00b1` (fix cycle 3, D-ARCH-238 F1 to F15, on the pure merges `1a0cdeaf` and `e17f1d6d`).<br>**Findings:** 0 Critical, 0 High. New: **PR034-SEC-09 MEDIUM** (a planted operator over `pg_catalog.ts_rewrite` passes C17 and the gate; rule 14 does not read DO bodies) and **PR034-SEC-10 MEDIUM** (the superuser sessions read `_prisma_migrations` even when it is a view, during `db:backup` on the source cluster). PR034-SEC-11 INFO.<br>**Closed:** PR034-SEC-02, -03, -04, -05, -06 and -08. D-ARCH-238 checks 1, 4 and 5 hold, and C2 is discharged.<br>**C1** is kept open and narrowed to PR034-SEC-09 and PR034-SEC-10, due before `restore-rehearsal` activation, before any non-synthetic rehearsal, and at the latest G3. All five checks of D-ARCH-238 hold, C17 and the gate case are green in lane B.<br>**C3** remaining: evidence, hosted CI, rename.<br>**C4 (binding) NOT MET:** `run-live78` (`20261121T1743Z_1bac00b`) is red on 7 TASK-034 restore cases (schema difference after restore). The head goes back to senior-developer, and a fixed head needs lane B and a security delta round. This verdict does not clear `1bac00b1` for merge.<br>Threat model v1.3 confirmed, SEC-TC-85 assigned, and §10.4 I item 8 added |
