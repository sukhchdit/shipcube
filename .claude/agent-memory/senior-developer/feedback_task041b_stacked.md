---
name: task041b-stacked
description: TASK-041 part 041-B (stacked on an unmergeable PR) lessons - unset upstream, host api-suite limits, Bash parse failures, breaker placement, wrapper control flow
metadata:
  type: feedback
---

A part built STACKED on another task branch (D-ORCH-150 pattern): `git worktree add -b <new> <path> origin/<base>` sets the
base branch as upstream; run `git branch --unset-upstream` at once so no push can land on the base PR.
**Why:** the base PR (#82) was approved and must not move. **How to apply:** every stacked part; merge `origin/main`
only after the base merges.

Running the WHOLE `--selectProjects api` on the host was refused by the auto-mode classifier (brief: api/int run in lane
B). Targeted api files (the new and the directly affected ones, no containers) were allowed and caught two test bugs.
**How to apply:** run only the api files you wrote or touched; leave the project-wide run to lane B and say so.

Bash tool: a heredoc that holds `\"` or nested backquote/`${}` mixes failed with "unexpected EOF"; Write the node
script to the scratchpad and run it with the target path as argv (see also [[feedback_pr23_fc1]]).

Design notes worth reusing: a store breaker must wrap the bounded call AND its reply check (else timeouts and
malformed replies never open it), and a late success of a pre-opening call must not close it. A wrapper around an
Express slot must catch a synchronous throw and a rejected promise of the inner handler, or Express passes them past it.
