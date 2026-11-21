---
name: wave1-task051-review-rulings
description: Context behind D-ARCH-207..213 (2026-11-21, TASK-051 code review r1 and lane B on PostgreSQL 18) — ADR-0005 amendment 15: a refused RESTRICT action is 23001 on PG 18, owner columns must separate owners (NULLS DISTINCT, equality operator), T2-O entries name their CHECK; the guest-binding pipeline seam still owed before TASK-091; what a PGlite probe cannot prove
metadata:
  type: project
---

D-ARCH-207..213 answered the six architect questions of the TASK-051 code review (round 1, CHANGES_REQUESTED at `203d02eb`) plus merge condition 6. D-ARCH-214 answered the security round that landed mid-session (PR051-SEC-03: the staff grant is also required when an operator membership becomes ACTIVE by UPDATE, folded into the unmerged migration). The rules, the probe tables and the card lines are in `docs/03-architecture/rulings/wave-1-r-arch-34-operator-rulings.md` §8 and ADR-0005 amendment 15 (items 37 to 39). This note keeps what those do not say. Earlier context: [[wave1-r-arch34-operator-rulings]], [[project-wave1-pr65-r1-rulings]].

**What the first ruling got wrong, and why:**
- D-ARCH-162 pinned `23503` for cases C2 and C6 from a PGlite probe. PGlite is PostgreSQL 17.5. PostgreSQL 18 gives a refused `RESTRICT` action (the referenced side) its own SQLSTATE, `23001`; the referencing side stays `23503`. The semantics I ruled held on 18 (the one-statement claim passed with `RESTRICT` keys). Only the code moved.
- Prisma 7.10.1 already knows it: the adapter maps `23001` to `RestrictViolation` and the client reports that as `P2003`, the same code as `23503`. I found this by reading `node_modules/@prisma/adapter-pg/dist/index.js`, and it changed the review's proposal (a pin with four combinations, not three).
- D-ARCH-163 said "an owner column among the key columns". A `NULLS NOT DISTINCT` index or an exclusion operator `<>` satisfies that text and still answers across owners. I had even listed the `NULLS NOT DISTINCT` index as a rejected alternative without seeing that the gate would pass it.

**Why:** a 17.5 probe proves semantics, not SQLSTATEs or message texts. A rule phrased as "column X is in the key" needs the question "does it still do its job in every form the DDL allows".

**How to apply:**
- When a ruling pins an error code from a PGlite probe, mark the codes of referenced-side foreign-key refusals (and any deparse text) as version-sensitive, and say which lane B case proves them on 18.
- When a ruling pins an answer on probe tables, say which block answers. The `gc_` probe tables carry the class block only; the real quote tables also carry `trg_<t>__std_columns`, a BEFORE trigger that answers before `WITH CHECK` (D-ARCH-210).
- Before pre-approving a catalog rule, try to write the shape that satisfies its wording and defeats its purpose.

**Still owed by me:**
- The pipeline seam for the route-side guest binding (D-ARCH-213), before TASK-091 is dispatched: how `createQuote` by an anonymous caller and the claim operations (`claimQuote`, `saveQuote`, `createShipment`) put a guest token hash into the transaction context. Today `tenantContextOf` copies the principal's value and nothing else sets one. It is a platform change (`apps/api/src/platform/tx/**`, `define-route.ts`), needs security-analyst (a header-derived value in the context of an authenticated caller) and a gatekeeper check, and must reconcile the TASK-091 card sentence about the handler comparing the stored hash (under RLS the policy is the comparison).
- ~~quality-gatekeeper has to verify ADR-0005 amendment 15 before TASK-051 merges.~~ Verified 2026-11-21: D-QG-005, PASS_WITH_CONDITIONS. My conditions C1 and C6 are answered by D-ARCH-215 and D-ARCH-216; C5 is the seam above. See [[wave1-qg051-conditions]].
- The M2 staff-management amendment (already owed, see [[wave1-r-arch34-operator-rulings]]) now also has to tie the deletion of a grant to the membership in the database: refuse the deletion while a membership that is not REMOVED exists, or let `app_is_operator()` read the grant (D-ARCH-214). I first leaned to defer the UPDATE clause to M2 because the complete control sits at the deletion; I folded it because the migration was unmerged (four lines now, a second function replacement later), security preferred now, and it is the same gap class as PR65-SEC-04 (a).
- Observed, not changed: data-model §3.12/§6.3 `ux_saga_steps__saga_step_shipment` has no owner column. C16 (b) will report it at the creating task.

**Process lessons:**
1. The session started in an agent worktree that sat on another task's branch (`feat/TASK-041…`). The brief asked for the commit on main in the main checkout. I worked with `git -C <main>` and absolute paths, and wrote memory in the main checkout only.
2. HEAD of main moved three times during the session (orchestrator and review records). The anchored applier script (every anchor exactly once, nothing written unless all match) made that harmless. DECISIONS.md was appended in the same step as the commit.
3. A `UNIQUE NULLS NOT DISTINCT` index cannot be created on a table that already holds two rows with NULL in the key. Plant catalog shapes on an empty table.
4. PGlite ships `btree_gist` (`dist/contrib/btree_gist.js`, passed as `extensions`), which is what an exclusion constraint with `<>` on a uuid needs. A btree exclusion constraint can only use `=`.
5. The fence check of [[wave1-r-arch34-operator-rulings]] lesson 3 must use the test's own regex. A regex that wants the closing fence at column 0 pairs indented fences wrongly and reports a false difference.
6. Trailer: the brief again named another model. I used the harness attribution and said so in the handoff.
7. A parallel review can land items routed to me after my commit. Read the tail of DECISIONS.md once more before the handoff; here the security record arrived one commit before mine and needed a second commit (D-ARCH-214).
8. When I add a clause to ruled SQL, build the amended text mechanically from the committed file (`git show <sha>:<path>`, one anchored insertion), run that text, and let the applier assert that the lines written into the rulings file are the lines that ran.
