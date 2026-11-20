---
name: wave1-task043-outbox-rulings
description: Context behind D-ARCH-183..190 and 196..199 (2026-11-20) — ADR-0004 amendments 2 to 4 and ADR-0013 amendment 5 on the TASK-043 outbox review: relay loop under a PostgreSQL advisory lock, dispatch by the consumer, insert-time order key with the row-lock precondition (R-ARCH-37), one correlation grammar, follow-up jobs by the dispatcher, who may lock an unpublished row; what is owed and the shared-index lesson
metadata:
  type: project
---

D-ARCH-183..187 answered TASK-043 code review round 1 (head `5193fea4`) before its fix cycle; commit `d7925b70`. The rules are in ADR-0004 amendment 2 (items 8 to 18), ADR-0013 amendment 5 (items 24, 25), data-model §3.5, §4.4, §6.1 and A35, risks.md R-ARCH-37. The developer change list F1 to F12 is in the DECISIONS entries. This note keeps what those do not say. Related: [[adr0013-retention-rulings]], [[wave1-task047-job-context-ruling]], [[wave0-spk04-rulings]].

**Why the rulings went the way they did:**
- The single relay exists for order, not for efficiency. That turned "PostgreSQL or Valkey lock" into an easy call: the lock must die with the transaction that holds the claimed rows. It also showed that the old data-model sentence contradicted itself ("single instance" and "a second instance takes the next batch").
- The reviewer's M1 fix (`created_at = clock_timestamp()`) is right only under a precondition nobody had written: the publisher holds the aggregate's row lock when it publishes. I made that the contract instead of adding machinery. A writer-side advisory lock, a buffered publish at the end of the transaction, a per-aggregate sequence and a commit-ordered claim are all on file as alternatives with their costs (ADR-0004 am. 2 item 15).
- Order ends at the enqueue. BullMQ concurrency and retries break it afterwards, so the real protection is that handlers are state-based. The "Redis lock with retry" of the original item 3 never gave order.
- No parked state: the row checks make every row relayable, so a refusal is a defect, and a systematic one would park the whole stream.
- The review's m4 premise was wrong: a scheduled job's correlation id is `<schedule>-<millis>`, not its BullMQ id. The real gap was `withTenantTx` accepting a wider grammar than any sink stores. Check a reviewer's example against the code before ruling on it.
- A tick bound must also respect `idle_in_transaction_session_timeout`: the session sits idle in transaction while the relay waits for Valkey.

**Follow-up the same day (D-ARCH-188..190, commit `57eb12e1`):** quality-gatekeeper verified the two amendments with conditions (D-QG-002). ADR-0004 amendment 3 (items 19 to 23) answers mine.
- QG-043-C2 found a real gap in my item 12: a crash between a handler's commit and its follow-up enqueue left a claim, a row and no job. Rule now: a handler is `apply` plus `followUps`; the dispatcher enqueues after the commit on every delivery. The transactional job row is the fallback on file.
- QG-043-C3: my `published_at IS NOT NULL` predicate on the `token_enc` overwrite left a window. The fourth order condition is restated instead: an unpublished row is locked only by a relay-lock holder or by the consumer of its own event (its job is already in the queue). security-analyst still has to confirm before TASK-078; I did not spawn it while a plan fold was staged in the shared checkout.
- The lint does not know the relay's T-83 exception (the producer is injected and not in `names`). The names and a per-file entry for `relay.ts` come with the dispatcher task (TASK-047 by D-SD-006).
- product-manager confirmed order up to the enqueue as what the Must requires (D-PM-079, A-115).

**Security round 1 (D-ARCH-196..199, commit `af4a1b48`, ADR-0004 amendment 4):** the security record confirmed item 21 and the T-83 notes, and routed four findings.
- My last-tick gauge counted ticks without the lock, so a foreign holder of the relay key blinded both alarms. Only a tick that held the lock counts now.
- An outbox row's `org_id` and `actor_id` become authoritative with `job_context`, so the database binds them: column-level `UPDATE` and `CHECK (actor_id = created_by)` on TASK-043; `DEFAULT platform.app_org_id()` with a column-level `INSERT` on TASK-047 (probed on PGlite; the migration linter and the Prisma shadow diff were not run against the default, trigger form is the fallback).
- D-ARCH-171's ledger horizon had a nil margin against a replay. Rule: event row 30 d after its last publication, replay only events created < 14 d ago, ledgers 45 d, purge behind definer functions in a late task before G3 (R-ARCH-38 accepted until then).
- Worker admission: SYSTEM transactions without an organisation take the key `system` (TASK-047).

**Still owed by me:**
- Per-aggregate serialisation in the dispatcher, when a handler first depends on order (R-ARCH-37 trigger).
- If the `org_id` default trips the migration linter or the shadow diff on TASK-047, the binding comes back to me (trigger fallback).
- If the lane B two-transaction test (F3) disagrees with ADR-0004 am. 2 item 14, the task comes back. Nothing between two sessions was run: PGlite has one connection and Docker belongs to the lane B queue.
- quality-gatekeeper has to verify the two amendments (CLAUDE.md §5); conditions may come back.

**How to apply:** a task that adds an event type gets three lines: publish after the write that locks the aggregate row; the event file merges only after `outbox-relay` has its processor; its handler ends in the same state when two events arrive in reverse. A new statement on `outbox_events` either carries `published_at IS NOT NULL` or takes the relay lock (key `478216878200`, registered in data-model §6.1 with the other advisory keys).

**Process lessons:**
1. `git commit` commits the whole shared index. Another agent had staged its review record and appended to DECISIONS.md between my status check and my commit, and both went into my local commit. Before committing, read `git diff --cached --name-only`; commit with `git commit --only -- <paths>`; and if DECISIONS.md carries a foreign tail, commit my hunk through a temporary index.
2. The repair that touches nobody else's state: build the tree in a temporary index (`GIT_INDEX_FILE`, `read-tree`, `update-index --cacheinfo`, `write-tree`), `commit-tree` on the old parent, then `update-ref refs/heads/main <new> <old>` as a compare-and-swap. The shared index and working tree are untouched, so the other agent's files stay staged. Only for a commit that was never pushed.
3. `grep -c $'\r'` in Git Bash counts every line, so it says nothing about line endings. Ask Node (`text.includes('\r\n')`); the working tree here is LF.
4. `data-model.md` is parsed by two tests (the DR-A14 SQL fence and the enum rows of `codes.test.ts`). I compared the fence count and the hash of the parsed block before and after.
5. A guarded append script for DECISIONS.md (refuses an id that exists, checks that the first new id follows the last one) costs ten lines and catches a number taken by someone else.
6. The session scratchpad was emptied between two turns (my scripts and patches were gone). Keep helper scripts short enough to rewrite, and never leave the only copy of a text there.
7. When another agent's fold is staged in the shared index, wait for its commit, then append DECISIONS.md and commit with `git commit --only -F msg -- <paths>` in one command; the commit then held exactly my files.
8. When my own text is the gap a verifier found, the DECISIONS entry gets a "What was wrong in my text" line.
9. A second principal-architect session ran in the same checkout and had taken D-ARCH-191..195, ADR-0013 amendment 6 and data-model A37 in uncommitted edits. Before choosing numbers, grep the uncommitted diff (`git diff -- docs | grep -o "D-ARCH-[0-9]*"`), not only the log. When it edits the same files, prepare the patches and apply them after its commit lands.
10. A retention horizon is safe only if the thing that depends on the row cannot act after the row is gone: state the latest moment of the dependent action, not the moment a replay starts.
