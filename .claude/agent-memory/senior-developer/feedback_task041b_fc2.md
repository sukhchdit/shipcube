---
name: task041b-fc2
description: TASK-041 part B fc2 lessons - entered-marker release rule for in-flight holds, the admission-to-slot gap, check-suppressions catches prior-cycle findings, mutation proof by temp-reverting one line
metadata:
  type: feedback
---

An in-flight hold released at `res 'close'` is bypassed by clients that disconnect after admission (Express keeps
running the request). Rule (D-ARCH-226, D-TASK041-19): mark the holder as entered just before the guarded call; close
releases only unentered holders; the outcome releases entered ones. Also close the gap between admission and entry
(a close in between frees the unit, then the call runs unheld): tombstone the holder on close-release and refuse entry
(D-TASK041-20). **Why:** review probe P4b gave 60/60 entries. **How to apply:** any hold/permit whose holder can
vanish; the api row is raw `net` sockets that leave once the seam saw their `X-Probe` id (destroy and half-close).

`node tools/lint/check-suppressions.mjs` must report 0 findings: fc1 shipped 3 (eslint-disable descriptions lacking
`TASK-xxx`), so run it every cycle; fix with `-- TASK-041 <reason>`. **How to apply:** part of every DoD check set.

Mutation proof without Docker or stashing: copy the file to the scratchpad, sed back the one old line, run the new
row with `-t`, copy the file back, confirm with `git diff --stat`. Edits via the Edit tool need a prior Read in this
session even when the file was printed with Bash `cat`.
