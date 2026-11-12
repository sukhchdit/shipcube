---
name: project-review-conventions
description: Where P5 code reviews are written, how PR worktrees are laid out, and how to run Node in this repo during review
metadata:
  type: project
---

P5 code reviews go to the MAIN repo at `docs/05-quality/reviews/PR-<nnnn>-TASK-<xxx>-code-review.md`, using the name the orchestrator dispatches. It is not the agent default `REVIEW-TASK-xxx-r<round>.md`. Contents: verdict, findings table (ID, severity, file:line, issue, required fix) and the DoD checklist. Return a Handoff Report (`docs/sdlc/templates/HANDOFF.md`).

PR branches are checked out as sibling worktrees `..\Shipqube-TASK-xxx` with node_modules installed. Every node/npm/npx call needs `export PATH="$APPDATA/fnm/aliases/default:$PATH";`, because the system Node 20 fails on engine-strict.

**Why:** the orchestrator's dispatch brief (PR #1, 2026-11-12) set these. Lane A/B CI did not exist yet (D-ORCH-004 bootstrap), so the reviewer must re-run the gates locally.
**How to apply:** for every PR review, re-run lint, format:check, typecheck, test:unit, build and coverage yourself. Don't modify the worktree. See [[review-watchlist]] and [[scratch-copy-technique]].
