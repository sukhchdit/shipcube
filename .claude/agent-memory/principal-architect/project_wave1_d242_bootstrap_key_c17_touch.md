---
name: wave1-d242-bootstrap-key-c17-touch
description: Context behind D-ARCH-242..247 (2026-11-22, session D) — D-TASK298-01 (the bootstrap-lane foreign key that C16 (d) reports is corrected, not exempted), the TASK-034 C1 spec touch (operators in pg_catalog, the cast arm, restrict_nonsystem_relation_kind for privileged reads, rule 14 in bodies) and its follow-up (row_security = off, row text through record_out, the §5.7 repair); what is owed and the working lessons
metadata:
  type: project
---

D-ARCH-242 to D-ARCH-246 (commit `51e1bdb4`) answered two blocked merges, and D-ARCH-247 (commit `82c85c12`) answered the conditions that the gatekeeper (D-QG-012) and security (D-SECARCH-01) set on them. The rules are in data-model §4.6 (C16 (d) note, C17), §5.7, §8.3 (amendment of 2026-11-22) and §8.6 (third and fourth amendments), in ADR-0005 item 37 (dated note) and in the rulings file `wave-1-r-arch-34-operator-rulings.md` §8.9 and §8.13. The fix list of the TASK-034 re-dispatch is F16 to F27: D-ARCH-246, as D-ARCH-247 replaces F21 and F22 and extends F18, F23, F24 and adds F27. This note keeps what those do not say. Related: [[wave1-qg051-conditions]], [[wave1-task034-restore-rulings]].

**D-TASK298-01: why the key is corrected and the rule kept.**
- `fk_audit_pii_vault__subject` (bootstrap file 10) states no action, so it is `NO ACTION`. Arm (d) reports it. I chose a new bootstrap file `92-audit-vault-subject-restrict.sql` over "arm (d) reports writing actions only".
- The deciding points: the store is empty now and holds rows at M5; a rule that needs no judgment is worth more than its stated reason; narrowing would have been the second re-reading of one sentence that the gatekeeper verified twice.
- The hidden cost of a new bootstrap file is `tools/db/shadow-init.ts`: it refuses any statement form it does not know, so every new statement shape in the bootstrap lane needs a KEEP form and its tests.
- TASK-298 merges with an exact one-finding pin. The pin deletes itself: the test fails when the key becomes `RESTRICT`.

**Why:** D-ARCH-215 counted the 13 migration keys and searched the documents for referential actions. A key that states no action contains no word to search for, and I never read the bootstrap lane.

**How to apply:** before writing "every X is Y", enumerate X from every lane that creates X (migrations, bootstrap files, raw SQL in tests is out of scope), and prefer a catalog query over a text search when the defect is the absence of a clause.

**TASK-034 C1: what changed the design.**
- **The cast route.** While amending C17 for PR034-SEC-09 I planted shapes of my own. `JSON_OBJECT`, `JSON_ARRAY` and `JSON_SCALAR` look up a cast to `json` at run time for a type that is not built in. With an enum and `CREATE CAST … WITH FUNCTION`, a CHECK ran the function as the superuser, and its tree holds no `:funcid`. A composite type takes another path and its cast is not called, which hid the route in my first probe. C17 (b) now refuses any cast outside an extension. Security numbered it PR034-SEC-12.
- **The server setting.** The security record proposed "lock, then check relkind by OID" for PR034-SEC-10. PostgreSQL has its own control for exactly this attack (CVE-2024-7348): `restrict_nonsystem_relation_kind = 'view, foreign-table'`, in 17.0 and later. It refuses a view at statement preparation with `55000`, also inside `REPEATABLE READ READ ONLY`, and covers reads that nobody listed (the orphan checks). I ruled the setting as the boundary and kept a `relkind` check only for a readable refusal. Security concurred, with no lock (D-SECARCH-01).
- **The read side has its own lanes (D-ARCH-247).** A read of a table can run code of its owner through four things: a view (the setting), a policy (`row_security = off`, which makes a reader that does not bypass row security fail with `42501`), the statement's own casts and operators (row text through `record_out`, never `(t.*)::text`; `_prisma_migrations` only with `pg_catalog` column types), and on PostgreSQL 18 a VIRTUAL generated column (built-in functions and types only, by its documentation). Both settings have the context `user`, so they are read back again before each `_prisma_migrations` read.
- **A universal sentence met its counter-example.** Security proposed "a privileged session applies no cast, operator or function to a value of an application type except its output function". The orphan checks apply the constraint's equality operator and an implicit cast. Item 9 of the fourth amendment states that case and its bound (the cast arm of C17 (b)).

**Still owed (as of 2026-11-22, after `82c85c12`):**
- quality-gatekeeper: the six points of D-ARCH-247 (the fourth amendment adds and replaces nothing; QG-034-C2 by its second option; §5.7 byte-equal to the parent of `51e1bdb4`; the three QG-034-C3 rows are F18 (h), F23 (i1) with (u5), F23 (i4)).
- security-analyst: the wording of item 9 against its proposed sentence; a rating for the two-statement window of item 10 (a retyped column or a new cast between a check and its read, on the restored database); threat model §10.4 I item 8 and SEC-TC-85 name `row_security = off`.
- The late task `vaultfkrestrict` (expected TASK-300) is not folded into the plan. It starts after the TASK-034 fix has a green lane B.
- From me, unchanged: data-model §8.3 as shipped after TASK-034 merges, RR-19 in `risks.md`, QG-051-C5.
- Nothing ran on PostgreSQL 18. If lane B shows other volatility counts for built-in operators, another behaviour of the SQL/JSON constructors, of `record_out` or of the two settings, or no `file_fdw` in the image, the text or the row comes back.

**Process lessons:**
1. A security record's remediation is a proposal. Ask first whether the platform already ships a control for the attack class, and probe it. Reproduce each item of a record's list before repeating it: `format('%s')` and `concat` look up no cast, `row_to_json`, `to_json`, `to_jsonb` and the SQL/JSON constructors do.
2. When a probe says "the routine did not run", check the type category before believing it. One more type kind (enum against composite) turned a "no finding" into a finding.
3. `CREATE OPERATOR … FUNCTION = pg_catalog.f` needs the exact argument types of `f`. A planted operator over a built-in routine therefore exists only for built-in operand types. To show an operator reached without `OPERATOR()`, plant `public.=(text, text)` and create the table under `search_path = public, pg_catalog`.
4. A range type brings a cast to its multirange. A new "no cast" arm reports a planted range type twice, so say which existing test expectations change.
5. Never patch a script with `node -e` inside a double-quoted shell string when the text holds backticks: the shell ran them and corrupted the file. Write scripts with the Write tool, and write a new file name after a failed patch.
6. PGlite ships `pg_trgm`, `btree_gin`, `btree_gist` and `file_fdw` under `dist/contrib/` (pass them in `extensions`), so the bootstrap extensions and a foreign table can be part of a probe.
7. When an amended document fence is pinned by a unit test on a task branch, the next merge of main turns that test red until the fix lands. Say so in the handoff. A new fence is safe when the test filters by the first line of the block (the C17 test does): extract the pinned block before and after the edit and compare the bytes.
8. Another agent may commit in the same checkout between my pull and my apply. The anchored applier with a guarded DECISIONS append keeps the diff to my lines only; check `git diff --numstat` against the line count of the append file. The "exactly one line" guard earned its place: an anchor matched two sections and the run stopped before it wrote.
9. A brief may name another model for the commit trailer, or a document structure that does not exist ("the §8.6 session-settings fence"). Use the harness attribution, check the document, and say what was created.
10. **Read an inserted note as prose.** I placed the D-ARCH-242 note by line position, between a paragraph and its last two sentences, and under an amendment that says "the statement above" (QG-051-C11). A new dated note goes after the last amendment of its section, in date order.
11. In PGlite `db.exec` with several statements is one implicit transaction: `SET …; BEGIN; ROLLBACK` in one string undoes the `SET`. Send one statement per `query` when session state is the subject. The same holds for a tool that sends a multi-statement string.
12. A planted routine that records with `INSERT` proves nothing inside a read-only transaction (it fails with `25006`). Raise an exception with a marker there, or run the "who ran it" row outside the transaction.
13. `CREATE CAST … WITHOUT FUNCTION` needs a superuser, `WITH INOUT` does not. A test row for "what the migrator can plant" uses `WITH INOUT`.
