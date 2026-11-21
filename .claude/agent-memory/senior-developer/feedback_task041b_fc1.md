---
name: task041b-fc1
description: TASK-041 part B fc1 lessons - in-flight hold for read-then-spend gates (atomic admit in the limiter), abort-skip trap, wiring-pin api rows, Bash heredoc with quotes fails whole command
metadata:
  type: feedback
---

A gate that is READ at step 0 and SPENT after a later slot is bypassed by a parallel burst (all read the same count).
Fix pattern (R1-M1, D-TASK041-18): a per-instance in-flight ledger, `settled + held < limit`, with the check+hold done
synchronously inside the limiter right after the store reply (an `admit` hook), NOT in the caller's `.then` (other
microtasks interleave between the limiter's resume and the caller's callback). Release after the spend lands, and on
`res 'close'` as a safety net; refuse admission when the response already closed, else an aborting client skips the hold.
**Why:** reviewer probe P2 (60 parallel junk bearers = 60 authenticator calls). **How to apply:** any read-gate +
deferred-spend design (rate limits, budgets, quotas); state the residual as replicas x limit.

Reviewers mutate wiring (kit built without breaker, budget without breaker, wrapper skipped for a replaced pipeline);
pin each with one api row through createApp/startApi using FakeValkey `hang` + `calls` counts, not unit pairs.
**How to apply:** every composition-only branch in app.ts gets an api row in the same task.

Bash tool: one heredoc `cat >> file <<'EOF'` holding TS with quotes, followed by a `node -e "..."` in the same command,
failed to parse ("unexpected EOF") and ran NOTHING. Append test code with the Edit tool instead (see [[task041b-stacked]]).
"Jest did not exit" after parallel api rows: rate-limit/tests/serve.ts `baseOf` was lazy and racy, so N parallel
first requests each listened on a new server (N-1 leaked TCPServerWrap; the run passed in 18 s but the process lived
minutes). `--detectOpenHandles` showed NOTHING; an afterAll printing `process.getActiveResourcesInfo()` found it at once.
Fixed by recording the listening promise synchronously. **How to apply:** any lazy per-app test server used by bursts;
diagnose lingering Jest with getActiveResourcesInfo, and bisect with `-t` plus wall-clock timing.
