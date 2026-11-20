---
name: dpm068-us061-062-delivery-split
description: P5 Wave 1 batch 1.1 — D-PM-068..070 (new D-PM- prefix continuing D-067); US-061/062 M0 Must DC stories completed by former Wave-8 Should tasks TASK-224/231; R0-partial rule, rung-4 fallback, gen.mjs wave/cuttable/dc traps, US-B-NNN backlog story form, tooling-input warning for story edits
metadata:
  type: project
---

D-PM-068 (2026-11-18): third use of the delivery-split pattern, first where the completer is a cuttable Should task. US-061 → TASK-037 (AT-01, service/DB halves of AT-02/03) + TASK-224 (response halves of AT-02/03, AT-04, AT-05). US-062 → TASK-037 (AT-01..04 + `membershipChange` record of AT-06) + TASK-049 (creation clause of AT-06 at registration; my addition to the orchestrator's split) + TASK-231 (AT-05, AT-06 via member routes). TASK-224/231 not cuttable, TASK-227 too by dependency (`members` → `invite`); TASK-235 stays cuttable. Both stories are PARTIAL at `v0.1.0-m0` (PRD §7 note) and must complete before G3. Pre-agreed fallback at Wave 7 exit: rung 4, move the six route scenarios to US-082/US-085 (append-only compatible because they are the trailing scenarios). Traceability 1.7 (REQ-ORG-001/003/004 rows; REQ-ORG-002 untouched), PRD 1.12, REQUIREMENTS 1.11, BACKLOG 1.1, A-109/A-110. Counts unchanged 434/91/293/134. Next PM decision ID: D-PM-071; next assumption A-111.

D-PM-069: REQ-ORG-001 "(created by seed)" → reserved row of the organisations migration (D-ARCH-151). Scenario title of AT-US-061-01 deliberately NOT changed (map key; drift test); qa-lead may retitle with a map regeneration.

D-PM-070: first production staff user (`ops:staff-bootstrap`, D-ARCH-153, R-ARCH-33) = backlog story US-B-001 under new M5 epic EPIC-B-508 in BACKLOG.md, with Gherkin. `US-B-NNN` = backlog stories written ahead of their milestone: outside counts, map and generator (those read `stories/EPIC-*.md` only).

**Why:** A "completes" card on TASK-037 would have marked two DC Must stories Implemented with six route scenarios unowned. The routes are M1 (createOrganisation `x-milestone: M1`; member routes need TASK-187 step-up, Wave 7), so they cannot be in R0; G3 judges Must stories, so they cannot stay cuttable.

**How to apply:**
- Before accepting "task X becomes non-cuttable", read `docs/04-plan/generator/gen.mjs`: `cuttable = wave >= 8`, the wave rule allows M0 Must DC completion in waves 0-2 only (error otherwise), `dc` and `priority` are derived from the card's stories. A split whose completer is late needs a generator exception, a wave move, and a DC-label suppression — list them for senior-developer/architect, never edit generator files.
- Check the completer's dependency chain for other cuttable tasks (here TASK-227) and PLAN.md §12 cut-list tiers.
- State per release (R0 vs G3) what is proven; check whether any clause of a deferred scenario is exercisable in the earlier release (here: membership creation at registration) and give it an early owner.
- `docs/01-requirements/stories/**` is a lane-B tooling input (`tools/quality/required-suites.json`): a story edit on main makes open PRs' evidence stale. Keep story edits to Notes lines, never titles, and tell the orchestrator so it can time the commit.
- Read the PR worktree (`../Shipqube-TASK-xxx`) for existing `[AT-…]` test titles before assigning halves.

Related: [[d061-us049-delivery-split]], [[d062-us008-delivery-split]], [[d065-gherkin-append-only]], [[g1-closure-and-dc-tag]].
