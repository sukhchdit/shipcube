---
name: task040b-fc1
description: TASK-040 040-B PR1 fc1 (D-ARCH-232 lease) - small fold recipe (replaceOnce + verbatim lines + brief sync from WAVE file), lockfile check script, lane B bg launch survives, stray run dir move
metadata:
  type: feedback
---

- **Small plan fold (1 to 4 lines) without fold.mjs:** a scratch script with `replaceOnce(from, to)` on unique substrings of
  `plan-data.mjs` (throws unless exactly 1 match; function replacer), verbatim card lines read from the D-ARCH entry by
  marker (`(lines 23, 35 and 111): "` ... `".`), array separator is `','` with no space. Then `gen.mjs .`, `--write`,
  `cmp` task-map.csv. A brief's verbatim card copy is synced by a second script that copies `- ITEM (` lines from the
  regenerated `tasks/WAVE-xx.md`. About 15 minutes in total.
- **node_modules vs lock without npm:** compare each `package-lock.json` `packages` entry with the installed
  `package.json` version (scratch `lockcheck.mjs`); 0 diffs means no `npm ci` and no docker.lock needed.
- **Lane B queue via `run_in_background`:** the bash process is reparented to PID 1, so it survives the agent's end;
  verify with `ps -ef | grep run-liveNN`.
- Before queueing lane B, move a worktree's stray untracked FAIL run dir to `../.orch/failed-runs/` (porcelain and
  check-evidence fail otherwise; see [[pr34-35-fc1]]).
- `ContractOperation`-style interfaces without an index signature need `as unknown as Record` to read `security`.

**Why:** the whole fc (code + 8 scripted mutants + fold + docs) fit in one session because nothing heavy ran locally.
**How to apply:** any fix cycle whose ruling ships card lines; reuse the mutant runner of [[task041b-fc3]].
