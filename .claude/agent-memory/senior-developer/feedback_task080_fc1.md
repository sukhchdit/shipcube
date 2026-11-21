---
name: task080-fc1
description: TASK-080 fix cycle 1 lessons - lane B log location after run dir moves, background lock wait, canonical-JSON oracle trap, escapes in heredoc node scripts
metadata:
  type: feedback
---

- Waiting on `../.orch/docker.lock`: foreground `sleep` is blocked; run a `run_in_background` until-loop (`until ! grep -q <worktree> owner; do sleep 60; done`) and end the turn; it re-invokes you. The orchestrator may move `docs/05-quality/tests/runs/<stamp>_<sha>/` out before you look: read `../.orch/laneb-queue/<worktree>.log` (verdict line at the end, failures above).
- A new IN-list CHECK with 2+ values needs a C9 `ENUM_CHECKS` entry (`prisma/tests/catalog/c01-c12.int.test.ts`); 1-value lists deparse to `=` and escape C9.
- Canonical JSON property tests: never use `JSON.stringify(sortedCopy)` as the oracle - integer-like keys always serialise first. Use round-trip + reversed-insertion invariance.
- Heredoc node scripts still turn `\\n` / `\r?\n` inside replacement strings into real newlines; and the Write tool decodes ` ` in source to a literal. Use `String.fromCharCode` / `.join('\n')` written via the Edit tool, then grep/od the result.

**Why:** each cost a re-run or a manual repair in this cycle.
**How to apply:** any fix cycle that waits on lane B or edits regex/escape-heavy test code. Related: [[pr23-fc1]], [[pr33-fc1]].
