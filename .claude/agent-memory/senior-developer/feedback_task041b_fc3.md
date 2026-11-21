---
name: task041b-fc3
description: TASK-041 part B fc3 (C-4) lessons - scripted mutant runner with restore, per-wrapper throttle state vs per-route closure, counting ledger seam to prove a guard path is exercised
metadata:
  type: feedback
---

Scripted mutant runner (scratchpad `.mjs`): a map of name -> string swap on the product file (plus `git show <old sha>:file`
as the "fails on the old head" mutant), spawnSync Jest per mutant with `-t`, `finally` restores the file. Capture failed
names with `/● (.+)$/gm` (the `✕` lines only appear in verbose mode). One background run covered 7 mutants in ~4 min.
**How to apply:** every fix cycle whose ruling names mutants; check `git diff --stat` after the run.

A once-a-minute log throttle kept in the per-route closure broke as soon as a test rebuilt the wrapper per call. Keep it
in one Map per wrapper keyed by operation id (fixed key set), and cache one wrapper per slot in the test helper.

To prove a guard path is actually exercised in an api row (not just "0 entries"), pass a wrapping `inFlight` ledger via
`rateLimit` in the app options and record `enter()` results; expect all `false` and wait until N were recorded. A
gzip body inflating to 900 kB + destroy at the write callback hit the D-TASK041-20 window 10/10.

An old-head run where the request hangs costs the 60 s `fetchOnce` deadline, so budget ~2 min for that mutant.
Related: [[task041b-fc2]], [[task041b-fc1]].
