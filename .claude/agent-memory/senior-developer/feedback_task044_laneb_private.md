---
name: task044-laneb-private
description: TASK-044 lane B api FAIL (2026-11-21) - anonymous fixture standing in for a non-anonymous contract op loses SEC-TC-29 private on pre-handler problems; error-only private-mark slot wrapper
metadata:
  type: feedback
---

An anonymous `fixtureRoute` standing in for a contract operation with no anonymous alternative passes its 200s
(the module sets its own private Cache-Control) but every problem raised by a pipeline step (validate 400, 429...)
gets only `no-store` from the problem handler, and the api contract validator fails SEC-TC-29 "missing private".

**Why:** the problem handler decides privacy from the route's declared auth set (`declaresPrivateResponse`), not
from the contract. Marking the whole route private (signed-in authenticator stub) is not an option when the tx slot
then rewrites the success Cache-Control (D-ARCH-218 era). The test was never run on lane B before, so the latent
failure surfaced only in the first api-suite run.

**How to apply:**
- Fix in the test composition: wrap the pre-execute slots (`mfaGate`..`etag`) for that operationId only with an
  async wrapper that, on throw / rejection / `next(err)`, calls `markPrivateResponse(res)` (guard `headersSent`) then
  `next(err)`. Pipeline override via `{ ...defaults, ...Object.fromEntries(...) }` typed `PipelineSlots`.
- Prove pre-existing vs introduced with `git diff --stat <old> <new> -- <test, fixture, problem handler, slots,
  validator, openapi>` being empty.
- Run any new api test file on the host before handing off (no DB needed for createApp-only api tests, ~35 s).

Related: [[task044-sse]], [[task044-fc1]]
