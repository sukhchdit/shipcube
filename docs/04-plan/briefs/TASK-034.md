# Dispatch brief: TASK-034, backup/restore rehearsal and zero-downtime migration probe tooling

- **Plan fold / dispatch plan:** D-SD-002 (TASK-034 owns the open `tools/db` linter items and gains `prisma-core`) and D-SD-004 (the RULE 14 line, D-ARCH-172). The card section below is copied verbatim from `docs/04-plan/tasks/WAVE-00.md`. If they differ, the generated card governs.
- **Branch:** `feat/TASK-034-backup-restore-rehearsal-zero-downtime`
- **Specialist and model:** senior-developer builds it in one agent (the card names database-engineer · sonnet; host load allows at most two build agents, so the lead takes it, D-ORCH run note). Escalate to opus from fix cycle 2.
- **Why now:** Wave 0 is still open (36/47) and batch 0.10 is the next batch. TASK-034 is the CLAUDE.md §5 Database guardrail ("before any data-changing migration: an automated backup/snapshot plus a successful restore test"). No migration so far is `data-changing: yes`, so this lands before the first one does. It also closes four routed security items on `tools/db` (PR5-SEC-14, PR11-SEC-11 d, PR293-SEC-04, D-ARCH-172 rule 14).
- **Dependencies:** TASK-003 and TASK-014 (both merged). TASK-293 (the previous `tools/db` linter holder, PR #72) is merged.
- **Locks:** `db-tools-backup`, `prisma-core`. The batch beside it (TASK-033 `tests-gen-audit`, TASK-277 `quality-trace`, TASK-278 `tests-gen-abuse`) shares no file. TASK-041 keeps its locks (working rule 7); TASK-040 holds `api-idempotency`, `api-tx-execute`.
- **Merges** are blocked by hosted-CI billing (D-ORCH-146): build to a committed local head, ready for code review, security review and lane B. No push.

## Read first

- CLAUDE.md §5 Database (expand → migrate → contract; backup and restore test before a data-changing migration).
- data-model §8.1–§8.7: §8.3 rule 10 and rule 14 (with the D-ARCH-172 amendment), §8.6 (the rehearsal steps 1–6 and the SEC-P3-03 amendment: only `00-roles.sql` runs before `pg_restore`; the dump runs as the bootstrap superuser, OI-16), §8.7 (the probe).
- `nfr-traceability.md` rows NFR-AVAIL-003 (NT-AVAIL-003-b), NFR-REC-003 (NT-REC-003-a) and NFR-DATA-004 (NT-DATA-004-c); `tools/quality/required-suites.json` `restore-rehearsal` (status `planned`; activation is qa-lead's, on main, never in this PR).
- PR-0005 security review R3.6 (PR5-SEC-14: `resetTarget` returns the validated URL; `connectPrivileged` refuses a config without a non-empty `connectionString`; the unit test).
- PR-0011 security review PR11-SEC-11 item d (`readSecret`: open once, `fstat` the descriptor, bounded read; `packages/config/src/db-tls.ts` `readRootCertificate` is the pattern).
- D-ARCH-077 (1) (SPK-08 F-01: the root `prisma.config.ts` lists the generated `tables.external` window).
- PR-0072 security review R2.4 (PR293-SEC-04 a and b), D-SECPR293-02, D-ORCH-139, D-SD-002, D-ARCH-172, D-TASK293-10.
- On main: `tools/db/{lint-migrations,sql-text,bootstrap,reset,up-down-up}.ts`, `prisma/tests/harness/postgres.ts`, `prisma/tests/migrations/**`, `compose.yaml` (`postgres` service; the superuser is `postgres` on the container socket).

## Scope notes (lead)

- **Rehearsal = backup → restore into a scratch database → verify.** Every step is an I/O-agnostic driver with injected ports (as `up-down-up.ts`): the archive tool (`pg_dump`/`pg_restore`), the query runner and the Prisma runner. The CLI adapters run `pg_dump`/`pg_restore` inside the Compose `postgres` container (`docker compose exec -T`), so the Windows host needs no PostgreSQL client, and no password goes on a command line. The Testcontainers harness runs them with `container.exec`.
- **Consistent manifest.** The manifest (per-table row count and an order-independent checksum, sequences, migration head, normalised schema digest) is taken in one `REPEATABLE READ` transaction whose exported snapshot `pg_dump --snapshot` also uses, so a live stack gives a manifest that matches the dump.
- **Verify** restores into a scratch database on the same cluster (database-level `00-roles.sql` first, then `pg_restore --exit-on-error`), compares the manifests, runs generated anti-join orphan checks for every top-level foreign key, compares the normalised schema (owners, ACLs, RLS, policies and triggers included), and runs `prisma migrate status` through the wrapper with the **root** `prisma.config.ts` (SPK-08 F-01). It writes a report and, on pass with `--migration <name>`, the rehearsal record.
- **Linter guardrail.** A `data-changing: yes` migration needs `prisma/migrations/<name>/rehearsal.json`: a passed verification bound to the sha256 of that `migration.sql` and to a backup whose migration head is the migration just before it ("fresh" without a clock). It runs in `lintRepository` (the CLI and lane A), so the fixture outcomes stay identical.
- **Zero-downtime probe.** Drives reads and writes at a fixed rate while a migration is applied (statement by statement, as `migrate deploy` does, or through `prisma migrate deploy`), with a clean warm-up phase. The default workload is one read per table that `platform_app` can read, with the column list taken before the migration (the "old code"); `--workload` adds writes. The §8.7 previous-release-image k6 run needs a release image, so it stays with the CI probe job.
- **Refusals.** Every CLI refuses a non-loopback database (the `db:reset` rule), never prints a URL or a value, and keeps artefacts under the git-ignored `reports/`.
- **Out of scope (record as `D-TASK034-nn`):** the RustFS bucket copy and document SHA-256 (no `documents` table yet), audit chain/anchor verification (TASK-116's verifier), the marker stream, the `/health/ready` smoke container, and the bootstrap-lane record.

## Acceptance (IDs in test titles)

- `[NT-REC-003-a]` / `[NT-DATA-004-c]` (integration, lane B): backup + restore into a scratch DB, row counts and checksums equal, 0 orphans, schema equal, `migrate status` up to date with the root config; negative controls (a deleted row, an orphan, a tampered manifest) fail.
- `[NT-DATA-004-c]` (unit): a data-changing migration without a fresh verified record is refused; a stale record (other sha256, other head, failed verdict, digest mismatch) is refused; a valid one passes.
- `[NT-AVAIL-003-b]` (integration, lane B): the probe runs continuous reads and writes across an expand migration with 0 errors; the negative control (a RENAME) counts errors.
- PR5-SEC-14, PR11-SEC-11 d, PR293-SEC-04 a and b, D-ARCH-172 rule 14 rows (unit).

## Tests and evidence

- Unit: every pure part and every driver with fakes; coverage on new files ≥ 85 % line / 75 % branch.
- Integration: `prisma/tests/migrations/backup-restore.int.test.ts`, `prisma/tests/migrations/zero-downtime.int.test.ts` (PostgreSQL 18 Testcontainers). Ask for an early lane B run.
- Lane A extras: `security-integration` (paths match `tools/db/**`, `prisma/**`); a delta security round on the linter change.

## `.env.example` lines this task may need

None planned: the CLIs read the existing `DATABASE_BOOTSTRAP_URL`, `DATABASE_MIGRATOR_URL`, `DATABASE_URL` and `BOOTSTRAP_*_PASSWORD` keys, and take everything else as flags with defaults.

## Working rules

Rules 1–14 of `docs/04-plan/briefs/TASK-043.md` apply unchanged. In particular: own worktree `../Shipqube-TASK-034` from `origin/main`; Node 24 PATH prefix; no Docker on the host; no new dependency and no `package-lock.json` change; do not touch TASK-041's files incl. `eslint.config.mjs`; Conventional Commits with `D-TASK034-nn` in the bodies; list the security-owned paths in the report.

## Card (generated by docs/04-plan/generator/gen.mjs, verbatim)

### TASK-034 — Backup/restore rehearsal and zero-downtime migration probe tooling (guardrail before data-changing migrations)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-AVAIL-003, NFR-DATA-004, NFR-REC-003 |
| Spikes / security / decisions | CLAUDE.md §5 Database, PR5-SEC-14, PR11-SEC-11, SPK-08, D-ARCH-079, PR293-SEC-04, D-SECPR293-02, D-ORCH-139, D-SD-002, D-ARCH-172, D-TASK293-10, D-SD-004 |
| Specialist · model | database-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-003, TASK-014 |
| Batch · locks | 0.10 · db-tools-backup, prisma-core |
| Branch | `feat/TASK-034-backup-restore-rehearsal-zero-downtime` |
| Priority | Enabler |

**Files / modules**
- tools/db/{backup.ts, verify-restore.ts, zero-downtime-probe.ts}
- docs/07-ops/runbooks/backup-restore.md
- tools/db/{lint-migrations.ts, sql-text.ts} (+ tests) (PR293-SEC-04; this task is the next holder of the tools/db linter after TASK-293, D-SD-002)

**Acceptance tests to write**
- Backup + restore into a scratch DB with row-count and checksum comparison green; a data-changing migration without a fresh verified backup is refused by the migration linter
- Zero-downtime probe runs continuous reads/writes across an expand migration with 0 errors
- PR #5 code review R3-n2 / PR5-SEC-14 (bundle with PR5-SEC-13): tools/db/reset.ts resetTarget returns the validated URL ({ database, maintenanceUrl, bootstrapUrl: string }) and main passes target.bootstrapUrl, so the db:reset guard is a type and pg can never fall back to PGHOST/PGDATABASE/PGUSER defaults; connectPrivileged refuses a config without a non-empty connectionString; unit test: DATABASE_BOOTSTRAP_URL unset -> main returns 1 and connectPrivileged is never called; SPK-08 F-01: the post-restore migrate status/deploy uses the root prisma.config.ts with the generated tables.external window; PR11-SEC-11 d FALLBACK: readSecret open-once/fstat hardening if PR #11 merged without it
- PR293-SEC-04 (INFO, CWE-184; D-SECPR293-02; routed by D-ORCH-139 to the next holder of the tools/db linter, which is this task by D-SD-002): (a) the fallback for a routine or DO body that does not lex has no ; statement start, so a quoted name holding ; hides a following data-changing statement from rule 10 - give the fallback the same code-; split as the lexed path, with the contrived shape of the record as a test; (b) string literals read as dynamic SQL make prose such as '... in update mode' a rule-10 hit - keep it fail-closed or narrow it to EXECUTE arguments, and pin the choice with a test; the 81 lint fixtures stay identical and every adversarial shape stays linear (the TASK-293 linearity tests); code review R2-n1 of PR #72 (non-ASCII routine names) is already CLOSED in PR #72 round 3 and needs nothing here; tools/db is security-owned, so the PR needs a delta security round on the linter change
- RULE 14 REFUSES CREATE CAST AND CREATE AGGREGATE (D-ARCH-172; D-TASK293-10; PR293-SEC-01 rows 4 and 5): add both statement starts to REFUSED_OBJECTS of tools/db/lint-migrations.ts with one failing fixture each; the two stated limits and their pin rows go; attribute notation stays a stated limit

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`tools/db/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
