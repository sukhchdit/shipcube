---
name: wave1-task047-job-context-ruling
description: Context behind D-ARCH-180 (2026-11-20, commit d1054cf6) — ADR-0013 amendment 4: platform.job_context resolves ownership not liveness, a job of a soft-deleted organisation runs in its own tenant scope, org_deleted fourth column, "queue that requires a tenant" defined; what the ADR does not say, items still owed and working lessons
metadata:
  type: project
---

D-ARCH-180 / ADR-0013 amendment 4 (items 17–23) answered the architect half of the TASK-047 dispatch gate. The rule and its reasons are in the ADR and data-model §4.5 (A34). This note keeps what they do not say. Earlier context: [[adr0013-retention-rulings]], [[wave1-r-arch34-operator-rulings]].

**How the decision was reached (not in the ADR):**
- The brief offered "refuse and dead-letter" or "run as SYSTEM". Neither was right. Going queue by queue, every queue with payload kinds settles something that outlives the organisation, so a per-queue "run or refuse" flag would have had no "refuse" user in Run 1. I dropped it as dead mechanism; the grain was also wrong (`payments` would hold both a refund and a future recurring charge).
- Facts that decided it: `organisations` has only `deleted_at` (no status column); the only path that deletes an organisation in Run 1 is the unverified-account expiry (REQ-AUTH-026, US-292), which keeps drafts that the 30-day draft expiry must still cancel; soft delete has no restore (US-079), so a refused job could never be redriven.
- Of the ten `job_context` source tables only `quotes` is soft-deletable; shipments are `SD: no` (a draft is deleted by its transition to CANCELLED).
- `org_deleted` went in now because `CREATE OR REPLACE` cannot change a function's return type, and `organisations` already has the definer-read policy.

**Why:** product-manager's US-078 scenario 4 (payload v1) expected a deleted organisation's job to fail with an audit entry FAILED. The ruling reverses that expectation, so the story wording had to come from the architect.

**How to apply:** if a later task or review asks for an `ORGANISATION_DELETED` refusal, point at amendment 4 item 21: work for a deleted organisation is stopped where it starts (candidate functions and producers that start new business filter live organisations; processors that start business read `orgDeleted` and complete without effect). The first organisation-closure design (M2 or later) owes the handling of pending work.

**Still owed by others (check before assuming done):**
- product-manager: US-078 steps, the REQ-RLS-008 note, an M2 backlog note (exact wording is in D-ARCH-180).
- senior-developer: the TASK-047 card line, per-kind `job_context` cases on the tasks that create the later source tables, and "no filter on organisations.deleted_at" on the settle-type candidate functions.

**Observed, not ruled:**
- At batch 1.4 only `outbox_events` and `organisations` exist, so the per-kind function test of data-model §4.5 can run for one kind; the plpgsql body binds late, so the migration still creates.
- TASK-043 (outbox) was not on main when I wrote this; TASK-047 needs `SELECT` on `outbox_events` for `platform_definer`.

**Process lessons:**
1. `grep -c $'\r' file` in Git Bash counted every line (false CRLF alarm). Count carriage returns with Node.
2. HEAD moved twice while I worked (gatekeeper, then api-designer, in the same checkout). Fetch, check `behind=0`, append DECISIONS and commit in one step.
3. DR-A09 has a SYSTEM audit stream for "no organisation", so "there is no stream to write to" is false. The reason a refused job writes no audit entry is that no tenant context is opened and a forged-job flood must not grow a chain.
4. Scenario titles are `gherkin-test-map.md` keys: give product-manager new steps under unchanged titles (the D-PM-072 form).
5. Run the function text extracted from the document, not the scratch copy (PGlite, stub tables), and compare the DR-A14 fence hash before and after a data-model edit.
