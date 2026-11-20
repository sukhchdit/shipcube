---
name: plan-fold-dsd001
description: Plan fold mechanics added 2026-11-18 (idAt to move tasks without renumbering, waveExceptions for delivery splits, merge-prereq lines vs edges, D-SD series, pull --rebase blocked by others' dirty memory files)
metadata:
  type: feedback
---

Moving an already-numbered task to another wave: set `w`/`b` to the new slot and add `idAt:[oldWave, oldBatch]`, and leave the card at its array position. gen.mjs numbers by `idAt` and schedules by `w`/`b`, so every ID stays the same. Verify by diffing the task→branch map of task-map.csv before and after (expect 0 changed). A late:true re-add would give new TASK-29x IDs and orphan every reference.

A story that must complete outside its wave band (for example an M0 Must DC story completing in Wave 7) needs a `waveExceptions` entry in plan-data.mjs: `{through, dcBy, decision}`. The `dcBy` tasks must hold the story as `part` inside the original band, and only they print demo-critical.

**Why:** D-PM-068 (US-061/US-062 split) needed TASK-224/227/231 in Wave 7 without renumbering, and without TASK-224/231 printing "demo-critical" (D-SD-001).

**How to apply:**
- Due points that are merge points ("merge before the next migration PR") go on cards as MERGE PREREQUISITE lines, not as `d` edges. Edges gate the start, and on the 035→039→043→049→052 chain they would delay the critical path.
- If every batch of the target wave is full, a new batch number (for example 1.11) is the precedent (D-ARCH-125 created 0.11 for the same reason).
- The orchestrator asked for senior-developer decisions as `D-SD-xxx` (D-SD-001 = this fold). The P4 series D-PLAN-001..010 is closed.
- `git pull --rebase` refuses while other agents' `.claude/agent-memory/*` files are dirty. Run `git fetch` and `git log HEAD..origin/main` instead; if that is empty, a plain push is a fast-forward. Never stash other agents' files.
- `git status -s docs/sdlc docs/04-plan` before committing (D-ORCH-121), and stage only your own files by path.

- D-SD-002 (2026-11-19): plan-data lines are 1–27 k characters, so Edit is impractical. Use a scratch Node script, written with the Write tool, that finds `\n{k:'key',` and walks the top-level fields while skipping single-quoted strings. Append to `a`/`x`/`f`/`lk` before each array's closing `]`, and `esc()` (`\` and `'`) every inserted or replacement string. An unescaped `'` in the replacement text broke the module once. Verify with `gen.mjs .` (0/0), then `--write`, then a per-row diff of task-map.csv (0 branch changes).
- D-SD-005 (2026-11-20): not every card has a `dod` field (TASK-041 has none). The fold script must throw before it saves, and the line then goes into `a`. Generic decision lines ("tasks that create table X") need a who-creates-what scan over `f` (the `prisma/schema/<file> + migration (tables)` items), with the real TASK IDs named in the line. PLAN.md is hand-authored (the §3 wave table, the M0 checkpoint paragraph, the counts note), so edit it alongside the `waves` exit text. Dispatch briefs live in `docs/04-plan/briefs/TASK-xxx.md`: a lead header, the shared working rules, and the generated card copied verbatim by a script.
- D-SD-006 (2026-11-20): another agent's uncommitted edits can sit in the same shared files (DECISIONS.md, traceability.md). Do not stage the file. Build the index blob from `git show HEAD:<file>` plus your own edit only, then `git hash-object -w` and `git update-index --cacheinfo`. Rebuild it right before committing, because HEAD can move under you: product-manager committed in between. The scratchpad was wiped mid-session again, so re-create helper scripts instead of assuming they still exist.
- D-SD-007 (2026-11-20): a task delivered in parts under one ID (TASK-040 040-A/B, TASK-041 041-A/B) uses the card field `inPart: {story: part}`, which I added to gen.mjs. The story still counts as completed for validation, and task-map.csv lists it as partial. Locks a later part needs from another task in the same batch go into an acceptance line, not `lk`, because gen refuses two holders of one lock in a batch. To find which cards mount a contract operation, map openapi `x-requirements` × the task-map `req_ids` column, then read each card. Cards rarely name operationIds, and a pure fan-out over-matches. Heredoc scripts lose their backslashes: write regex-bearing scripts with the Write tool.
- D-SD-010 (2026-11-20): rulings landed three times mid-fold (D-ARCH-205/206, D-SECPR040-04, D-PM-086). Keep the fold re-runnable: a scratch `lines.json` plus `fold.mjs` applied to a saved copy of `plan-data.mjs` taken at HEAD (check it with `cmp` against `git show HEAD:`), so each new ruling is a patch to the lines followed by a clean re-run. Run `git log` for new entries in DECISIONS.md just before committing. Another agent's commit can sweep your uncommitted DECISIONS.md entry into main, because they stage the whole file. Then your commit only updates that entry.
- Commit bodies: wrap lines under 100 characters (commitlint body-max-line-length). Amend only while the commit is unpushed.

Related: [[plan-generation-workflow]]
