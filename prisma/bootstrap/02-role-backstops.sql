-- Bootstrap lane, file 02: role-level backstop settings (ADR-0005 am. 10 item 12, PR7-SEC-06, PR7-SEC-12 (c),
-- D-ARCH-064; data-model.md §4.1 "Role-level defaults", §8.1; TASK-016).
--
-- Runner:      tools/db/bootstrap.ts with the cluster-admin credential, after 01-schemas.sql.
-- Variables:   none.
-- Idempotent:  yes (ALTER ROLE ... SET replaces the value).
-- Immutable:   once applied, a change is a new file. This is a new NN file rather than an edit of 00-roles.sql because
--              applied bootstrap files are pinned by their SHA-256 in public.bootstrap_migrations.
-- Data:        changes no table data; it writes one role setting (pg_db_role_setting, cluster-wide role default).
--              Classification under D-SEC-PR8-01 / linter rule 10: not data-changing. Guardrail: data-model §8.1
--              applies the §8.6 backup/restore guardrail to every bootstrap file. Until M5 the only databases are
--              ephemeral local/CI ones rebuilt from the bootstrap lane (nothing to back up), and the restore rehearsal
--              (§8.6, TASK-034) re-applies every bootstrap file, this one included, before C13 re-asserts the rows.
--              Rollback: ALTER ROLE platform_app RESET statement_timeout (in a new file), which restores the
--              pre-TASK-016 state (no role-level statement timeout).
--
-- statement_timeout = 30s is a BACKSTOP for statements platform_app issues outside withTenantTx (the readiness probe,
-- system paths that skip the context statement); before this file such a statement had no timeout (T-83). Every
-- tenant transaction sets its own transaction-local statement_timeout, lock_timeout and
-- idle_in_transaction_session_timeout from configuration (data-model §4.1 eight-setting statement); those win. Role
-- defaults are not a security boundary (the role may ALTER ROLE itself); catalog test C13 asserts the exact
-- platform_app rows and the readiness check reports drift (TASK-006).
SET search_path = pg_catalog, pg_temp;

ALTER ROLE platform_app SET statement_timeout = '30s';
