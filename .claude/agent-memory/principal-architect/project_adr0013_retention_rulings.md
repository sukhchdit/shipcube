---
name: adr0013-retention-rulings
description: Context behind D-ARCH-159..161 (2026-11-19, commit 7da0e50) — ADR-0013 amendment 3: queue retention under noeviction, dead-letter trimming, queue and Valkey alarms for TASK-214, -dead and dot-separated id spellings; open items still owed and working lessons
metadata:
  type: project
---

D-ARCH-159..161 / ADR-0013 amendment 3 closed the architect half of PR64-SEC-04 before TASK-039 was dispatched. The numbers and the mechanisms are in the ADR; this note keeps what the ADR does not say. Earlier context: [[wave1-batch11-rulings]], [[task291-prerender-respec]].

**Why the design went beyond the security record's sketch ("an age bound, housekeeping trims the DLQ"):**
- BullMQ evaluates an age bound only when another job of the same queue finishes, so an age alone is not a bound on a quiet queue (hence the hourly sweep) and not a bound inside a flood (hence the counts).
- An hourly count trim leaves the dead-letter queue unbounded between sweeps, so the consumer trims at each record write.
- A bounded, trimmed depth gauge cannot show "new dead letters" (one dead letter and one trimmed record cancel out), so the alarm reads a counter.
- Retention is also BullMQ's duplicate window for a deterministic job id. That turned a retention ruling into an id rule for recurring keys (tracking polls).

**Still owed by me (flagged in D-ARCH-161, not decided):**
- ~~Outbox purge horizon (30 days in ADR-0004, 7 days in the data-model).~~ Settled 2026-11-19 by D-ARCH-167: 30 days, data-model corrected. No card owns the purge yet; see [[wave1-r-arch34-operator-rulings]].
- The TASK-204 card line for the recurring job id is quoted in D-ARCH-161 and waits for senior-developer's next plan fold.

**How to apply:** before quoting a platform fact in an ADR, open the table it comes from. I first wrote that cache.t4g.micro is the launch production node; the cost table (platform.md §11.2) has it as the minimal staging node, and launch production is cache.t4g.medium. A risk-register row I had planned on that basis was dropped.

**Process lessons:**
1. HEAD moved by seven commits while I was reading (the plan fold D-SD-002 landed, TASK-293 merged). Re-run `git log --oneline <start>..HEAD` before editing anything read earlier, and re-read the cards.
2. Card edits: copy `gen.mjs` and `plan-data.mjs` to the scratchpad, apply an exact-match applier (every replacement must match once), validate the copy against the repo root, diff the generator summary with the baseline, then apply to the repo and run `--write`. Plan-data strings are single-quoted: use double quotes for quoted arguments inside card text.
3. Library behaviour for a docs-only ruling can be read from `node_modules/bullmq/dist/cjs` (the Lua scripts are exported as `.content` strings); say in the decision that it was read, not run.
4. `api/README.md` is a lane B tooling input: a spelling fix there waits for a sheet fold, so the ADR states how the old form is to be read.
5. Trailer: the harness attribution line was used again while the brief named another model; reported in the handoff.
