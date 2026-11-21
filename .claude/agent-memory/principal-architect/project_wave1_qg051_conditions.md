---
name: wave1-qg051-conditions
description: Context behind D-ARCH-215..216 (2026-11-21, gatekeeper conditions QG-051-C1 and QG-051-C6 of D-QG-005 on ADR-0005 amendment 15) — why item 37 stayed a rule for every foreign key instead of being narrowed, why C16 gained arms (c) and (d), what is still owed, and the PostgreSQL 18 container probe technique
metadata:
  type: project
---

D-QG-005 verified ADR-0005 amendment 15 as PASS_WITH_CONDITIONS. Two conditions were mine: QG-051-C1 (a universal sentence in item 37 that the data model contradicted, and a card line that claimed more than C16 does) and QG-051-C6 (PostgreSQL 18 `NOT ENFORCED` keys). The rules, probe rows K1..K9 and N1..N7 and the card lines are in `docs/03-architecture/rulings/wave-1-r-arch-34-operator-rulings.md` §8.12 and §8.9. This note keeps what those do not say. Earlier context: [[wave1-task051-review-rulings]], [[wave1-r-arch34-operator-rulings]].

**What I got wrong the first time, and why:**
- Item 37 said "every foreign key of the Platform is RESTRICT on both actions". I wrote it from the merged migrations (13 keys) and did not grep the data model, which drew `fk_customs_items__declaration_currency … ON UPDATE CASCADE`. Nothing checked the sentence either: the 13 relations state both actions by convention, and Prisma's defaults are Cascade on update and SetNull on delete for an optional relation.
- The TASK-087 card line said "C16 (b) reports both" for two shapes. Only one of them is reported. I compressed two sentences of the ruling into one parenthesis.

**Why:** a universal claim in an ADR ("every", "never", "all") is a rule only if something reads the system and checks it. A card line is copied verbatim into a plan, so a shortened claim becomes the instruction.

**How to apply:**
- Before writing "every X is Y" in an ADR, grep the designed documents as well as the merged code, and name the assertion that keeps it true. If there is none, add one or say "the merged X".
- When a card line summarises a ruling, re-read each clause against the probe table of the ruling.
- The gatekeeper offered "narrow the sentence" or "note at the row". I chose a third reading (the sentence is a rule, the sketch is corrected, a catalog arm enforces it) because the probe showed that a writing referential action runs as the table owner, with row security off, exempt from the standard-columns guard. Evidence first, then pick the option.

**Still owed by me (as of 2026-11-21):**
- QG-051-C5: the pipeline seam of D-ARCH-213 (guest token hash in the transaction context for `createQuote` and the claim operations), as a note on the route descriptor of ADR-0003 with security-analyst, plus a D-QG verification, before TASK-091 is dispatched.
- QG-051-C6 is ruled (D-ARCH-216) but security-analyst had not seen it; its concurrence and the gatekeeper's closure are open.
- The M2 staff-grant amendment and the Stripe saved-500 rule (see the two earlier notes).

**Process lessons:**
1. PGlite is 17.5 and has no `pg_constraint.conenforced`. For a PostgreSQL 18 fact, run a throwaway container of the local `postgres:18` image: `MSYS_NO_PATHCONV=1 docker run -d --rm --name <unique> -e POSTGRES_HOST_AUTH_METHOD=trust <image id>` (no port, no password), wait until `docker logs` shows "ready to accept connections" twice, pipe a script with `docker exec -i <name> psql -X -U postgres -f - < file.sql`, then `docker rm -f`. `\set VERBOSITY verbose` prints the SQLSTATE. About 30 seconds end to end.
2. psql interleaves NOTICE and ERROR lines out of order with the result tables when both streams go to one file. Map results by the `psql:<stdin>:<line>` prefix, not by position.
3. A cascade or restrict probe needs each key on its own table. A `RESTRICT` key on the same parent refuses the update before the cascade of another table can be observed.
4. `grep -c $'\r'` in Git Bash counts every line. Detect CRLF in Node (`raw.includes('\r\n')`).
5. `tools/db/render-rls-dr-a14.test.ts` parses the SQL fences of data-model.md. I kept new SQL in data-model inline (no fence) and put fenced sketches in the rulings file only.
6. main moved four times in one hour (orchestrator, PM, reviews). Dry-run the anchored applier, then apply, append DECISIONS and commit in one shell step.
7. The brief again named another model for the trailer. I used the harness attribution and said so in the handoff.
