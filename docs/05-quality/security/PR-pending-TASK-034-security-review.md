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
