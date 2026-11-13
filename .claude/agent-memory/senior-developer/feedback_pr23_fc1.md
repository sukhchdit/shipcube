---
name: pr23-fc1-lessons
description: PR #23 fix cycle 1 (2026-11-13, TASK-011) - solo light cycle recipe; heredoc backslash loss hit regex/escape-heavy scripts; shared TEMP holds other agents' files; gitleaks commit count is a superset
metadata:
  type: feedback
---

PR #23 fix cycle 1 was done solo in about 90 calls (8 findings + 5 NITs, 3 commits + 2 docs-only merges, one push). Lane A: fast-lane green, only the security-record step red (expected).

**Why / how to apply:**
- **Scratch scripts go in the session scratchpad, written with the Write tool.** A Bash heredoc (even `<<'EOF'`) dropped every backslash in two `node` edit scripts (regex `\/`, `\s`, `'\n'`): the edits applied silently and produced broken TS that only Prettier caught. The shared `$TEMP` also contains other agents' stale `editN.mjs` files, so Write to a reused name fails with "not read yet" and Read shows someone else's script.
- **Gate Prettier right after generating code from a script**, before running Jest, to catch the corruption early.
- **`check-evidence --event push`** now exists (R1-m3). Lane A passes `--event "$GITHUB_EVENT_NAME"` (runner-set, so the step needs no `env:`). Rule 4 is "run not credited", not "check fails".
- **Mutation-proofing a CI pin:** put the predicate in a function returning findings, assert `[]` on the real text and `> 0` findings on N mutated copies (use `text.replace(a, () => b)` because the texts contain `$`).
- **Gitleaks "N commits scanned"** can exceed the first-parent count when main's commits are merged in (it walks all commits of the range). That is a superset, not a false green; a count of 0 would be.
- **docker.lock** was retaken by another holder seconds after I released it, so hold it only around the single `docker run`.
- Merge of main in the middle (docs-only twice): merge again for ancestry, prove `git diff <gated> HEAD` has no non-docs paths.

Related: [[lane-a-pr-hygiene]], [[lane-a-merge-pitfalls]], [[pr21-fc1-lessons]]
