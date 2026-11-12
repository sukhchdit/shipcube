---
description: Run independent code review + security review on a branch
argument-hint: <branch-name>
---
For branch $ARGUMENTS: run code-reviewer and security-analyst (change-scoped) in parallel against `main...$ARGUMENTS`. Summarize both verdicts and all BLOCKER/MAJOR/CRITICAL/HIGH findings in one table.
