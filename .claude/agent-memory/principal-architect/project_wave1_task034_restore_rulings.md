---
name: wave1-task034-restore-rulings
description: Context behind D-ARCH-235..238 (2026-11-21) — condition C1 of the TASK-034 security round (PR034-SEC-01): restore into another cluster by default, `--same-cluster` as the stated exception, the load-time gate, catalog C17 and lint rule 21, rule 14 range types; why the reviewer's catalog query was not enough, what is owed, and the working lessons
metadata:
  type: project
---

D-ARCH-235..238 answered condition C1 of D-SECPR034-01 (TASK-034 at `3ee36f01`, pre-push). The rules are in data-model §4.6 (C17), §8.3 (rule 14 range, rule 21) and §8.6 (second amendment, with the query), platform.md §10.3 and threat model v1.3 (T-81, RR-05, RR-19, §10.4 I). The fix-cycle list F1 to F15 is in D-ARCH-238. This note keeps what those do not say. Related: [[wave1-r-arch34-operator-rulings]] (D-ARCH-172, the rule-14 precedent), [[wave1-qg051-conditions]] (C16 arms without an exception map).

**Why the ruling went beyond the two options offered (fresh stack, or a recorded deviation):**
- The useful question was "which control meets a holder of the migrator credential who changes the database directly". The linter and the catalog suite never see that actor. Only a check of the database that is backed up does, so the gate reads the catalog in the snapshot of the dump and the restore refuses before it creates a database.
- A gate between the `pre-data` and `data` sections of `pg_restore` looked better and is wrong: a CHECK that `pg_dump` emits separately is created and validated in `post-data`.
- The same-cluster form is not a boundary problem on a developer's own stack (the operator holds the superuser, and `db:reset` already re-sets the role passwords there). It becomes one in a shared environment. So the rule stays "another cluster", the tool checks it by `system_identifier`, and the weaker form must be asked for by name. The CI job that needs the fresh form (TASK-119) was already planned with a second stack.
- TASK-034 was at its last fix cycle (MAX_FIX_CYCLES 3) and no agent can prove a Compose path (D-ORCH-160). That decided against tool-managed stack lifecycle now.

**The fact that changed the catalog check:** PostgreSQL records no `pg_depend` row for a built-in object. The security record's query (join `pg_depend` to `pg_proc`, keep non-`pg_catalog`) found its three planted shapes and missed `CHECK (pg_catalog.query_to_xml('select w()', …) IS NOT NULL)`, through which `w` ran as the superuser in my probe. C17 therefore reads `conbin`, `adbin` and `partexprs` as text and joins `:funcid`, `:opfuncid` and `:opno` to `pg_proc`, and the property is IMMUTABLE, not "built in": every built-in that acts with the caller's authority is VOLATILE. Partition-key expressions are a fourth call site (a direct write to a leaf checks the partition constraint as the writer).

**Still owed by me:**
- RR-19 mirrored in `risks.md` at its next revision (not touched: two other architect runs were in the register).
- data-model §8.3 as shipped for rule R and rule 21 after TASK-034 merges (as D-ARCH-172 did for TASK-293).
- A ruling when a migration first needs a non-immutable built-in (an entry on `REVIEWED_NON_IMMUTABLE_BUILTINS`) or any routine in a load-time expression.
- If lane B on PostgreSQL 18 shows other node-tree field names than `:funcid`, `:opfuncid`, `:opno`, or accepts a VIRTUAL generated column with a user routine, the C17 text comes back.
- quality-gatekeeper was not asked: no Accepted ADR names the restore target. If it wants to verify amended G2 text, D-ARCH-235 lists why none is superseded.

**How to apply:** a task that adds a CHECK, a generated column, a domain or a partition key writes it with IMMUTABLE built-ins only. A column `DEFAULT` may call a helper (`platform.app_org_id()`), because a restore lists every column. Any new superuser procedure on application data (a data-only restore, a superuser write) is outside what §8.6 allows and needs a ruling: triggers, defaults and index expressions run as the loader there.

**Process lessons:**
1. A reviewer's "PGlite-tested query" proves its planted shapes, not its completeness. Before adopting a catalog query, plant shapes of my own that the query's join cannot reach (here: a built-in). The first version of my own query was also `pg_depend`-based and failed the same way.
2. A case number proposed in a record may be taken ("C15" was the standard-columns guard): read the catalog table before adopting a name.
3. Three Edit calls on one file in one block all landed this time. The rule stays one Edit per file per block; I checked each change with grep afterwards.
4. Extract a SQL fence from the document and run that text, not the scratch copy it was pasted from.
5. `git show <sha>:<path> > "$TEMP/…"` works from Git Bash; the session scratch already held other agents' files, so my files went into a named subfolder.
6. When a ruling adds work to a task at its last fix cycle, give the orchestrator a split rule (which items the condition names, which may move to a follow-up card and what that card gates), so that no further question is needed.
