---
name: wave1-d242-bootstrap-key-c17-touch
description: Context behind D-ARCH-242..246 (2026-11-22, session D) — D-TASK298-01 (the bootstrap-lane foreign key that C16 (d) reports is corrected, not exempted) and the TASK-034 C1 spec touch (operators in pg_catalog, the cast arm, restrict_nonsystem_relation_kind for privileged reads, rule 14 in bodies); what is owed and the working lessons
metadata:
  type: project
---

D-ARCH-242 to D-ARCH-246 (commit `51e1bdb4`) answered two blocked merges. The rules are in data-model §4.6 (C16 (d) note, C17), §5.7, §8.3 (amendment of 2026-11-22) and §8.6 (third amendment), in ADR-0005 item 37 (dated note) and in the rulings file `wave-1-r-arch-34-operator-rulings.md` §8.9 and §8.13. The fix list F16 to F26 for the TASK-034 re-dispatch is in D-ARCH-246. This note keeps what those do not say. Related: [[wave1-qg051-conditions]], [[wave1-task034-restore-rulings]].

**D-TASK298-01: why the key is corrected and the rule kept.**
- `fk_audit_pii_vault__subject` (bootstrap file 10) states no action, so it is `NO ACTION`. Arm (d) reports it. I chose a new bootstrap file `92-audit-vault-subject-restrict.sql` over "arm (d) reports writing actions only".
- The deciding points: the store is empty now and holds rows at M5; a rule that needs no judgment is worth more than its stated reason; narrowing would have been the second re-reading of one sentence that the gatekeeper verified twice.
- The hidden cost of a new bootstrap file is `tools/db/shadow-init.ts`: it refuses any statement form it does not know, so every new statement shape in the bootstrap lane needs a KEEP form and its tests.
- TASK-298 merges with an exact one-finding pin. The pin deletes itself: the test fails when the key becomes `RESTRICT`.

**Why:** D-ARCH-215 counted the 13 migration keys and searched the documents for referential actions. A key that states no action contains no word to search for, and I never read the bootstrap lane.

**How to apply:** before writing "every X is Y", enumerate X from every lane that creates X (migrations, bootstrap files, raw SQL in tests is out of scope), and prefer a catalog query over a text search when the defect is the absence of a clause.

**TASK-034 C1: two things that changed the design.**
- **The cast route.** While amending C17 for PR034-SEC-09 I planted shapes of my own. `JSON_OBJECT`, `JSON_ARRAY` and `JSON_SCALAR` look up a cast to `json` at run time for a type that is not built in. With an enum and `CREATE CAST … WITH FUNCTION`, a CHECK ran the function as the superuser, and its tree holds no `:funcid`. A composite type takes another path and its cast is not called, which hid the route in my first probe. C17 (b) now refuses any cast outside an extension.
- **The server setting.** The security record proposed "lock, then check relkind by OID" for PR034-SEC-10. PostgreSQL has its own control for exactly this attack (CVE-2024-7348): `restrict_nonsystem_relation_kind = 'view, foreign-table'`, in 17.0 and later. It refuses a view at statement preparation with `55000`, also inside `REPEATABLE READ READ ONLY`, and covers reads that nobody listed (the orphan checks). I ruled the setting as the boundary and kept a `relkind` check only for a readable refusal.

**Still owed (as of 2026-11-22):**
- quality-gatekeeper has not verified the amended text, and decides QG-051-C6 with the pin open (I recommended closing C6 and tracking the pin as a new condition before G3).
- security-analyst has not concurred with the setting replacing its lock, nor given the cast route an id. Its threat model §10.4 I still says "IMMUTABLE built-in routines only".
- The late task `vaultfkrestrict` (expected TASK-300) is not folded into the plan. It starts after the TASK-034 fix has a green lane B.
- From me, unchanged: data-model §8.3 as shipped after TASK-034 merges, RR-19 in `risks.md`, QG-051-C5.
- Nothing ran on PostgreSQL 18. If lane B shows other volatility counts for built-in operators, or the SQL/JSON constructors behave differently, the C17 text comes back.

**Process lessons:**
1. A security record's remediation is a proposal. Ask first whether the platform already ships a control for the attack class, and probe it.
2. When a probe says "the routine did not run", check the type category before believing it. One more type kind (enum against composite) turned a "no finding" into a finding.
3. `CREATE OPERATOR … FUNCTION = pg_catalog.f` needs the exact argument types of `f`. A planted operator over a built-in routine therefore exists only for built-in operand types. To show an operator reached without `OPERATOR()`, plant `public.=(text, text)` and create the table under `search_path = public, pg_catalog`.
4. A range type brings a cast to its multirange. A new "no cast" arm reports a planted range type twice, so say which existing test expectations change.
5. Never patch a script with `node -e` inside a double-quoted shell string when the text holds backticks: the shell ran them and corrupted the file. The Write tool then refused the changed file. Write scripts with the Write tool, and write a new file name after a failed patch.
6. PGlite ships `pg_trgm`, `btree_gin` and `btree_gist` under `dist/contrib/` (pass them in `extensions`), so the bootstrap extensions can be part of a probe.
7. When an amended document fence is pinned by a unit test on a task branch, the next merge of main turns that test red until the fix lands. Say so in the handoff.
8. Another agent committed in the same checkout between my pull and my apply. The anchored applier with a guarded DECISIONS append kept the diff to my lines only; check `git diff --numstat` against the line count of the append file.
9. The brief named another model for the commit trailer again. I used the harness attribution and said so.
