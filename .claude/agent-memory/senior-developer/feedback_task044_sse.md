---
name: task044-sse
description: TASK-044 SSE convention solo build (2026-11-21) - stream hook limits in execute.ts (20 s deadline, Cache-Control overwrite, no backpressure), Express 5 console.error only outside env=test, redaction-class false positive on origin_time_zone, AT vs contract auth mismatch
metadata:
  type: feedback
---

TASK-044 (SSE module `apps/api/src/platform/sse/**`) was built solo with no dispatch. execute.ts (TASK-040, `api-tx-execute`) and define-route.ts were read-only, so three convention gaps became D-TASK044 follow-ups instead of edits.

**Why:** these facts are invisible until a stream runs through the real slot, and they recur for TASK-091 (`streamQuoteResults`) and the booking stream.

**How to apply:**
- **The slot's `CALL_DEADLINE_MS` (20 s) also bounds a stream.** It is armed at stream start when the route has no `call`, and it `res.destroy()`s without an `error` frame. So the 30 s SSE cap is unreachable through the default slot. To observe the cap in api tests, compose `defaultPipelineSlots({ tenantTx, callDeadlineMs: 40_000 })` and pass it as `pipeline`.
- **`send()` replaces Cache-Control on a private-marked response** with `private, no-store`, so a handler's `no-cache` is lost on authenticated streams. Anonymous fixtures keep the handler value, and the contract validator requires `private, no-store` on stream ops (no anonymous alternative), so emit `private, no-cache, no-store`.
- **Express 5 `logerror` prints only when `app.get('env') !== 'test'`, and it prints the whole object (cause chain) with `console.error`.** Jest sets NODE_ENV=test, so a console.error spy test is vacuous unless the app calls `app.set('env', 'production')`.
- **`isPiiKey` flags `origin_time_zone` (QuoteOption).** A runtime guard built on the log redaction classes would refuse contract payloads. Use a closed key list at runtime, and use the redaction classes plus a reviewed exemption as the independent test oracle.
- **AT-US-042-07 (401 AUTH_REQUIRED) fits `streamBookingProgress` ([session]) but not `streamQuoteResults`.** The latter's x-error-codes has no AUTH_REQUIRED, because a missing credential on a quote-token route is 404 (D-ARCH-107 (5)).
- **Supertest buffers the body, so it cannot time "closes within 1 s".** The helper records over node:http and hands the stall-corrected `timeOperation` in as a meter, because tests/api helpers may not import apps/api.
- **Jest piped through `tail` gets moved to the background after 180 s with an empty output file.** Wait for the notification; do not start a second copy.

Related: [[task045-pagination]], [[p5-worktrees]], [[pr44-fc2]]
