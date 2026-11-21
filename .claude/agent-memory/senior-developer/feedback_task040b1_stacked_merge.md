---
name: task040b1-stacked-merge
description: D-ORCH-158 stacked merge after a squash (blob-classification recipe, raw-diff proof), DbError hides constraint names in runner int tests
metadata:
  type: feedback
---

Stacked merge after the base PR was squash-merged: `git merge --no-commit origin/main`, then classify each conflicted
path by three blobs (`git rev-parse <base>:f`, `origin/main:f`, `<stacked head>:f`). main==base and head changed ->
`checkout --ours`; head==base and main changed -> `checkout --theirs`; both changed -> hand union. Prove with
`git diff --raw origin/main $(git write-tree)` vs `git diff --raw <base> <head>` BEFORE committing; `git show --cc`
is empty when no hand union was needed. 14 conflicts, 0 unions, about 10 calls in TASK-040B1.
**Why:** blob equality is decisive and cheap; it also shows the files main changed for other tasks.
**How to apply:** every D-ORCH-158 stacked part; refetch right before push (main moved docs-only in 15 min; a
`merge-tree --write-tree` check shows whether a re-merge is needed).

A CHECK violation through `withTenantTx` surfaces as `DbError { reason: 'DB_ERROR', sqlState: '23514' }` with no
driver message, so int tests can't assert the constraint name there; pin it in a raw-pg test (see [[task045-fc1]]).
The adapter-pg default branch keeps no `constraint` field for 23514 anyway (only 23505/23503/23001 map it).
