---
name: wave1-r-arch34-operator-rulings
description: Context behind D-ARCH-162..167 (2026-11-19) — ADR-0005 amendment 14: owner-bound key pair on GUEST_CAPABLE tables, one-statement claim, owner column in unique keys, one answer for 23503, operator_staff_grants, no users transition guard, PARTNER deferred to M3, outbox purge 30 days; what is still owed and the working lessons
metadata:
  type: project
---

D-ARCH-162..167 closed the two D-SD-002 dispatch gates (TASK-051 `guestclaim`, TASK-089 `seeddemo`). The rules and the exact SQL are in `docs/03-architecture/rulings/wave-1-r-arch-34-operator-rulings.md` and ADR-0005 amendment 14 (items 31 to 36). This note keeps what those do not say. Earlier context: [[wave1-pr65-r1-rulings]], [[adr0013-retention-rulings]].

**Why the designs went beyond the options on the cards:**
- The TASK-051 card offered "bind through `(guest_token_hash, quote_id)`" or "accept the existence channel". The decisive fact came from a control table in the probe: with a unique key that has no owner column, a foreign row gets `23505` for a value the other owner holds and can take a free one. That turned (a) and (b) into one design and made dropping the single-column key the point (same constraint name for foreign and unknown).
- With both composite keys no order of separate statements can claim a quote. One statement with data-modifying CTEs works even with `RESTRICT` keys (referential checks run at the end of the statement). Probed on PostgreSQL 17.5 only.
- For the operator membership the useful question was "which fact can `platform_app` not write". Only a table without a runtime write grant qualifies; a context key or a definer function does not.
- No foreign key from the grant to `users`: the Prisma back-relation would have put a line into `identity.prisma`, which another task of the same batch edits. Lock collisions are a legitimate input to a schema ruling here.
- Users transition guard refused: every writer of a `users` row acts as that user (`p_users__own`), so the database cannot tell self-service from a system flow.

**Still owed by me:**
- ~~data-model §8.3 wording for the rule-10 call sites and the lone carriage return.~~ Done 2026-11-20 (D-ARCH-172).
- M2 staff management (EPIC-B-207) needs an ADR-0005 amendment: a runtime writer of `operator_staff_grants` gated by `app_is_operator()`, and grant removal at offboarding.
- M3 partner design owns the PARTNER-organisation backstop (PR65-SEC-04 (b)).
- ~~If lane B of TASK-051 on PostgreSQL 18 differs from the probe tables (rulings §2.7, §3.5), the task comes back to me.~~ It did, 2026-11-21: C2 and C6 answer `23001` on 18. Ruled as D-ARCH-211, with five more review items; see [[wave1-task051-review-rulings]].

**How to apply:** when a later task adds a reference into `quotes` or `quote_options` it is rule T1 and costs an `(org_id, id)` index on the parent (about 30 GB on `quote_options` at Y5 without retention): ask for the expected size. A new GUEST_CAPABLE child must also join the one-statement claim.

**Process lessons:**
1. The session scratchpad is shared with earlier sessions and other agents (I found another `decisions-append.md` there). Work in a uniquely named subfolder and never `rm -rf` a generic name.
2. PGlite `exec` of a whole migration file is one transaction and fails on the TASK-037 file ("pending trigger events"). Apply statement by statement: run the probe with `node node_modules/tsx/dist/cli.mjs` and import `tools/db/sql-text.ts` `splitStatements`. Bootstrap files need the psql variables substituted and the `CREATE EXTENSION` lines dropped.
3. `tools/db/render-rls-dr-a14.test.ts` parses the SQL fences of data-model.md and takes the first one containing `-- template dr-a14-users`. Keep fences balanced and never put that string into an earlier fence; I compared the parsed block before and after the edit.
4. `lintMigrations(root, label, { tableClasses })` lints a scratch copy of `prisma/migrations` with an extra manifest entry, so a prescribed migration can be linted without touching the repository.
5. HEAD moved twice during the session (review records by other agents). Append DECISIONS.md only in the same step as the commit.
6. Edits to long table rows: a Node script with anchors that must match exactly once, written with the Write tool.
7. Plan cards were not folded (planning decisions were involved: host task, locks, size). The card lines are in the rulings file §6.

**Follow-up the same session (D-ARCH-168..170, commit `71a2d36`, 2026-11-20):** architect notes asked for by the TASK-075 and TASK-076 code reviews.
- ADR-0010 amendment 12: `getRates` returns `RateResponse { quotes, noServiceReason? }`; I added that a failed call still throws (transport and account codes are never a no-service reason), because otherwise the new field blurs the four statuses of REQ-CARR-008. The canonical vocabularies stay in `packages/carriers` until TASK-080 moves them; data-model §1.7 (single source of CHECK enums is `packages/shared`) is the reason a list is never written twice.
- ADR-0009 amendment 2: the static ISO 4217 table is the authority for computation and the `currencies` table its database copy (parity test on TASK-066); the billable-weight rule is chosen by the origin country's unit system, never by the unit of entry (same parcel: 12,701 g imperial rule, 13,000 g metric rule).
- Lessons: (8) a plan fold (D-SD-003) landed while I wrote the notes and already carried one of my card lines; grep the card before writing a card line. (9) Another agent had an uncommitted DECISIONS.md append in the shared checkout; I did the other edits first and appended only after their commit showed the file clean.

**Second follow-up (D-ARCH-171..172, commit `035299d`, 2026-11-20):**
- `job_executions` is in data-model §3.5: SYSTEM, insert-only, unique on `(queue, job_key)` because BullMQ ids are per queue. Retention 30 days after completion: the row must outlive every re-delivery path, and the longest is a replayed outbox event (30 days, D-ARCH-167). Purge owner TASK-043, so every PostgreSQL purge horizon sits in one job that exists before TASK-047 binds the accessor.
- §8.3 now describes rule 10 call sites, the lone CR and lexer parity as TASK-293 shipped them; rule 14 is to refuse `CREATE CAST` and `CREATE AGGREGATE` (TASK-034), which closes two of the stated limits.
- Lesson (10): another agent committed and pushed between my status check and my own push; my commit went out with theirs. After a commit in the shared checkout, check that my DECISIONS.md diff has no deleted line and that the entry headings are in order before reporting.
