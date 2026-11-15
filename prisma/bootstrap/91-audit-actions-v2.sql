-- Bootstrap lane, file 91: audit action vocabulary v2 (D-ARCH-119; ADR-0007 amendment 11 item 4; REQ-AUDIT-002;
-- AT-US-087-07; D-TASK025-03; data-model OI-07; TASK-285).
-- @audit-ddl security-approved: security-analyst 2026-11-15
--
-- Runner:      tools/db/bootstrap.ts with the cluster-admin credential, after 90-audit-ddl-guard.sql. The name sorts
--              after every released file because the runner refuses a new file that sorts before the last applied one
--              (and check-migration-immutability refuses it in CI), so a database that already holds 10-audit.sql and
--              90-audit-ddl-guard.sql applies this file too (D-TASK285-01). The identity guard of file 90 admits the
--              ALTER because it runs under SET ROLE platform_audit_owner.
-- Variables:   none.
-- What:        ck_audit_entries__action widens from the 18 values of 10-audit.sql to the 20 REQ-AUDIT-002 actions, in
--              REQ-AUDIT-002 order: MFA_RECOVERY_USED and SESSION_REVOKED join. ONE statement (DROP + ADD in a single
--              ALTER TABLE), so no state of the table exists without the CHECK. The parent's CHECK propagates to every
--              audit_entries_YYYY_MM partition (inherited, conislocal = false), and ensure_audit_partitions copies it into
--              later partitions (LIKE ... INCLUDING CONSTRAINTS). packages/audit AUDIT_ENTRY_ACTIONS equals this list
--              (actions.test.ts reads the effective constraint across prisma/bootstrap/*.sql; catalog C9 and
--              prisma/tests/audit/audit-actions-v2.int.test.ts read pg_get_constraintdef).
-- Idempotent:  yes. The ledger applies the file once; should the file run again (a ledger row removed by hand), DROP
--              CONSTRAINT IF EXISTS + ADD re-asserts the same CHECK.
-- Immutable:   once applied, a change is a new file (NN-audit-*.sql that sorts last, with its own rule-12 marker).
-- Data:        none written. A superset CHECK validates every existing row (one scan per partition under ACCESS
--              EXCLUSIVE); the lane runs before the services start, and on a shared environment with a large store it
--              runs in the deploy window (ADR-0007 amendment 11 item 4). Classification under D-SEC-PR8-01 / linter
--              rule 10: additive widening, not data-changing. Rollback (local and CI only): npm run db:reset --yes.
SET search_path = pg_catalog, pg_temp;
SET ROLE platform_audit_owner;

ALTER TABLE public.audit_entries
  DROP CONSTRAINT IF EXISTS ck_audit_entries__action,
  ADD CONSTRAINT ck_audit_entries__action CHECK (action IN (
    'CREATE','UPDATE','DELETE','VIEW','DOWNLOAD','LOGIN','LOGOUT','LOGIN_FAILED','ACCOUNT_LOCKED',
    'TOKEN_REUSE_DETECTED','MFA_ENROLLED','MFA_FAILED','MFA_RECOVERY_USED','SESSION_REVOKED','PERMISSION_DENIED',
    'EXPORT','ON_BEHALF_ACTION','CONFIG_CHANGE','API_KEY_USE','STATE_TRANSITION'));

RESET ROLE;
