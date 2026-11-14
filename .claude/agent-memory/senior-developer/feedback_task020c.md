---
name: task020c-lessons
description: TASK-020 part 020-C (2026-11-14, PR #44) - lead-first contract then one lint specialist, main moving with sheet folds and story files, evidence staleness on story edits, merge-before-push loop
metadata:
  type: feedback
---

020-C (phases + D-ARCH-113/114 + T-83 residuals) took about 190 of my own calls plus one opus backend-developer for the lint area (72 tool uses, finished and reported, 15/15 mutants). Evidence PASS on the third attempt.

**Why:** the same traps will recur on any large Wave-0 platform PR while main moves every 20-30 minutes.

**How to apply:**
- **Do the small owned-config edit (eslint.config.mjs) yourself and commit it BEFORE dispatching** the lint specialist; then give it disjoint ownership (rule files, fixtures, case-table entries only). Worked cleanly.
- **Repository probes linted in memory at a real path** (`lintText` with `filePath: apps/api/src/platform/db/generated.ts`) prove a file-path boundaries selector without touching the file. boundaries 7 supports `from: { file: { path } }`.
- **Main merged a Gherkin story file (docs/01-requirements/stories/**) → check-evidence rejected the run as stale.** Only `.claude/**`, reviews, DECISIONS and similar are staleness-allowed. Re-take evidence from fresh `npm ci`. Before each push, `git fetch && git merge-base --is-ancestor origin/main HEAD && git push`; merge docs-only deltas and re-run check-evidence each time (main moved 3 times in 40 min).
- **New sheet lines land mid-task** (fold 7 added a "020-C/020-D" line after dispatch). Grep the merged rulings for the part ID before the PR; deferring with a stated decision is acceptable when the ruling offers an alternative owner.
- **Unit pre-gate under host load:** 5 s loopback timeouts in 3 files; isolated rerun green, then the evidence script with `--maxWorkers=4` for the pre-gate unit step passed.
- commitlint rejects a subject starting with an upper-case token ("T-83 ..."): sentence-case. Fix unpushed commits with soft reset + recommit.
- A `bash -c` heredoc containing a `node -e "...\"..."` line fails to parse; write test additions to a .txt file with Write and append with a small node script.
- PowerShell `Get-CimInstance` inside a Bash call was denied by the auto-mode classifier; just rerun the tests instead of probing host load.

Related: [[task020b-lessons]], [[lane-b-evidence-run]], [[p5-dispatch]]
