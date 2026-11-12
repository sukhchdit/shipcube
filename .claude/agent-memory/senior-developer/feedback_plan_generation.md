---
name: plan-generation-workflow
description: How the P4 task plan is maintained (generator + validator, stable IDs) and the Bash quoting pitfall on this Windows host
metadata:
  type: feedback
---

The P4 plan (docs/04-plan) is generated, never hand-edited. Edit `docs/04-plan/generator/plan-data.mjs`, then run `node docs/04-plan/generator/gen.mjs .` to validate and add `--write` to regenerate. Prefix every node command with the Node 24 PATH from CLAUDE.md §2.

**Why:** 281 tasks, 293 stories and the cross-references (AT- IDs, REQs, deps, locks, batches) drift instantly when edited by hand. The validator caught real coverage gaps (stories with only partial owners) that manual review missed. When the qa-lead's strategy landed mid-P4, new tasks were added as "late" IDs (TASK-276+) so that the hundreds of ID references in PLAN.md stayed valid.

**How to apply:**
- New P5 tasks or story changes: update plan-data.mjs, then regenerate. Use `late:true` to append IDs without renumbering.
- Bash tool on this host: long inline `node -e` / `sed` commands with mixed quotes and backticks fail with "unexpected EOF". Write a patch script or text file to the scratchpad and run it, or append it with `cat file >> target`.
- Backslashes inside `node -e` strings (and inside JS template literals in heredoc scripts) are silently stripped, so regexes such as `/\.int\.test/` arrive broken. Write regex-bearing edits with the Edit/Write tools; a quoted `<<'EOF'` heredoc appended with `cat >>` keeps them intact. (Seen in TASK-001 fix cycle 1, 2026-11-12.)
- When splicing Markdown with JS `String.replace`, pass a function replacer (`() => text`): text that contains `` $` `` or `$'` (e.g. a regex ending in `$` inside a code span) otherwise expands to the surrounding body and corrupts it. Re-read the result (for example a PR body after `gh pr edit`).
- Re-read DECISIONS.md right before appending. Other agents append in parallel (seen: qa-lead D-QA-*, architect D-ARCH-029..034 during P4).

Related: [[p5-merge-protocol]]
