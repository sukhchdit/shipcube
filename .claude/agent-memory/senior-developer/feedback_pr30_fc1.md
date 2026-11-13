---
name: pr30-fc1-lessons
description: PR #30 fix cycle 1 (2026-11-13, solo ~110 calls) - scratchpad dirs wiped mid-run, Jest realm drops SDK error code, smithy requestTimeout only warns, loopback-server pins for SDK bounds, DECISIONS rebuild as post-merge docs commit
metadata:
  type: feedback
---

PR #30 fix cycle 1 (TASK-019 S3 adapter: timeouts, deadlines, checksums, presign, credential pairing, boundary) was done solo with no specialist. Gates were green on the first full run (about 25 min, most of it integration plus coverage under docker.lock).

**Why:** These were cross-cutting adapter items with exact review wording, so briefing a specialist would have cost more than doing them.

**How to apply / pitfalls:**
- **Another session can wipe scratchpad dirs mid-run**, including my script dir and `wave0/` (the docker.lock parent) and `tasks/*.output`. My background gate script then died.
  - Write gate scripts so they `mkdir -p` the lock parent inside the wait loop.
  - Keep the content you need again (DECISIONS blocks) recoverable from git objects, e.g. `git show <sha>:file | sed -n '/^### X/,$p'`.
- **The Jest VM realm changes SDK error shapes.** Node system errors are cross-realm, so smithy's `asSdkError` does `Object.assign(new Error(), err)` and drops the non-enumerable `code`. ECONNREFUSED maps to UNEXPECTED under Jest but to UNAVAILABLE in a real process. Probe outside Jest (a scratch `.mjs` with `createRequire(<wt>/apps/api/package.json)`) before pinning a class in a composition test.
- **`@smithy/node-http-handler` `requestTimeout` only `console.warn`s** unless `throwOnRequestTimeout: true`. It is a time-to-response-headers timer and is cleared on response. A body trickle is bounded only by an abort signal, and the SDK's own abort listener also destroys the response mid-body.
- **Removing `maxAttempts` cannot fail a behaviour test, because the SDK default is also 3.** Pin it by exporting the client-config builder and asserting it exactly, and read `client.config.requestHandler.configProvider` for the resolved handler config.
  - The behavioural pins use a loopback `http.createServer` with a `timeouts` test seam: silent server, trickle, 500×N, `socket.destroy()` then 412.
- **When main moves before the push,** `git reset --hard <last fix commit>` (only if unpushed), then add any new fix commit, merge again, then commit the DECISIONS rebuild ("main's file + my blocks appended") as a separate docs commit after the merge. The rebuild was a 3-line node script over `git show origin/main:docs/sdlc/DECISIONS.md`.
- **Architect rulings landing mid-cycle** (here ADR-0021 am. 2 item 5) can route small items back into the fix cycle even when the brief said "routed elsewhere". Grep the new main docs for the PR number before the push.

Related: [[pr24-fc1-lessons]], [[merge-main-pass]], [[p5-dispatch]], [[lane-a-pr-hygiene]]
