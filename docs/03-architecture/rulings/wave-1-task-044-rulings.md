# Wave-1 TASK-044 — rulings on event streams in the request pipeline (2026-11-21)

Owner principal-architect. Decisions D-ARCH-217 to D-ARCH-224. ADR-0016 amendment 14, the ADR-0003 amendment of 2026-11-21 (rules (m) to (q)), ADR-0010 amendment 14, risks.md R-ARCH-41.

Inputs:

- Code review round 1 of TASK-044 (`docs/05-quality/reviews/PR-pending-TASK-044-code-review.md`, commit `7ed51854`): R1-M1, R1-m5, R1-m6, and the rulings on D-TASK044-03 and D-TASK044-05.
- Security round 1 (D-SECPR044-01, `docs/05-quality/security/PR-pending-TASK-044-security-review.md`, commit `d04731f7`).
- The branch `feat/TASK-044-server-sent-events-convention` at `dc64193f`, PR #80 at `0f0d92a0`, the TASK-041 branch at `be843ae1`, all read by SHA.

## 1. Decisions

| ID | Decision |
|---|---|
| D-ARCH-217 | R1-M1 takes route (b) in form and route (a) in content. TASK-044 is delivered in two parts. Part 044-A is the reviewed branch with its fix cycle. Part 044-B changes the tx slot and the composition and completes AT-US-042-01 and AT-US-042-05 on the default pipeline. No stream operation is mounted before part 044-B. |
| D-ARCH-218 | On a private response the tx slot writes `Cache-Control` from its own constant, chosen by the kind of result: `private, no-cache, no-store` for a stream, `private, no-store` otherwise. It reads no handler value. SEC-TC-29 is not affected by the third directive. |
| D-ARCH-219 | A stream gets its own deadline, 31 s (the 30 s cap plus 1 s). A stop ends live streams itself: at the drain every stream sends `error` with `SERVICE_UNAVAILABLE` and ends within 1 s. The 31 s deadline exists only in a composition that supplies the drain signal. `CALL_DEADLINE_MS` stays below the 25 s drain bound. |
| D-ARCH-220 | The `error` event carries no `id`, so it never moves the client's resume point. Without this rule a client that resumes after a stop loses one persisted result. |
| D-ARCH-221 | R1-m5: an end that the tx slot decides is not a failure of the request. A client disconnect writes no error line; a cut is logged once as `api.stream_cut`; after the headers the problem handler destroys the response and no longer calls `next()`. |
| D-ARCH-222 | R1-m6: a stream that loses its client releases its own subscription, timers and stream slot, and cancels nothing else. Carrier calls belong to the fan-out of `createQuote`. ADR-0016 §10 and ADR-0010 are restated; product-manager and api-designer get wording. |
| D-ARCH-223 | D-TASK044-03: the 30 s cap is accepted; its follow-up is replaced by D-ARCH-219. D-TASK044-05: no backpressure is accepted; the tx slot bounds a stream at 1 MiB of unsent bytes and cuts it above that. A sink that waits for `drain` is not built. |
| D-ARCH-224 | Observations with owners: keep-alive connections during the drain and the Compose stop grace (TASK-214), the comment in `shutdown.ts`, the T-47 row of the threat model, the dependency of TASK-120. |

## 2. What was checked

Read: the review record and the security record in full; `execute.ts`, `abortable.ts`, `after-commit.ts`, `define-route.ts`, `route-state.ts`, `authorise.ts`, `problem-handler.ts`, `request-logger.ts`, `runtime/shutdown.ts`, `start-api.ts`, `pipeline.ts`, `app.ts`, `sse/frame.ts`, `sse/event-stream.ts`, `packages/ui/src/sse/fetch-sse-parser.ts` and `tests/api/event-stream.api.test.ts` at `dc64193f`; `execute.ts` at `0f0d92a0`; the rate limiter's slot interface at `be843ae1`; the two stream operations, `CacheControl` and `SseError` in `openapi.yaml`; api/README §7, §9, §16 and §17; ADR-0003, ADR-0010, ADR-0014 and ADR-0016; platform.md §5.2, §5.3 and §10.4; `compose.yaml`; REQ-API-017, REQ-API-018, REQ-CARR-008, REQ-CARR-009, REQ-PLAT-022, REQ-SEC-015; US-042, US-045, US-126 and US-135; the cards of TASK-040, TASK-044, TASK-083, TASK-091, TASK-096, TASK-108, TASK-120, TASK-141 and TASK-173.

Probes (plain `node:http` on Node 24.22.3; no project code, no Docker):

| Probe | Result |
|---|---|
| P1: an open event stream and `server.close()` | `close()` waits for the stream. It resolves only when the bound forces the connections closed; the client sees `ECONNRESET` and no terminal event. |
| P2: a second signal on which the stream writes its terminal frame and settles | `close()` resolves in 2 ms. The client has the `error` frame and a clean end of the response. |
| P3: a stream that ignores the second signal, grace 300 ms | Cut at 313 ms. The client sees a reset and no terminal frame. |
| P4: keep-alive after `server.close()` | A connection that was busy when `close()` ran answers with `Connection: keep-alive` and serves a second request afterwards. |
| P5: one signal shared by the stream and the waiting slot | The slot stops waiting and destroys the response before the frame leaves: a reset, no terminal frame. Two signals are needed. |
| P6: a client that never reads; 64 KiB chunks | `res.write` returns `false` from the first chunk. `res.writableLength` passes 1 MiB after 20 chunks (1.31 MB written, the rest sits in the socket buffers of the host). |
| P7: the unit of `res.writableLength` | Bytes: a string of 400,000 three-byte characters adds 1,200,001. Everything written in one turn of the event loop counts in full, so a replay counts in full. |

Not run: the api suite, anything in the TASK-044 worktree, Docker. The behaviour of the real `createApp` at the deadline and at a disconnect is taken from the reviewer's probe and from S1, S2 and S8 of the security record. I read the code paths they describe and they match.

Four premises of the inputs are corrected here:

1. **Which task mounts a stream.** `streamQuoteResults` is mounted by TASK-141 (Wave 4, batch 4.5, `apps/api/src/modules/quotes/stream/**`) and `streamBookingProgress` by TASK-173 (Wave 6, batch 6.2). TASK-091 (batch 2.5) builds `createQuote` and the quote-token authenticator and mounts no stream. The due point "before TASK-091 merges" of the review therefore becomes "before TASK-141 is dispatched". D-SECPR044-01 already dates F1 "before the first stream route merges".
2. **The stop timeout.** platform.md §5.2 gives the `api` task a `stopTimeout` of 35 s. The 30 s in the comment of `shutdown.ts` is the window of REQ-PLAT-022, not the stop timeout.
3. **Streams at a stop.** platform.md §10.4 has said since P3 that at SIGTERM "SSE streams get `complete`/`error` and close". The rule is not new. Nothing implements it.
4. **Compose.** `compose.yaml` sets no `stop_grace_period`, so Docker stops a container 10 s after SIGTERM.

## 3. The numbers

| Quantity | Value | Where | Rule |
|---|---|---|---|
| Call deadline `CALL_DEADLINE_MS` | 20 s | `execute.ts` | Below the drain bound. Pinned by `execute-phases.test.ts`. Unchanged. |
| `afterCommit` deadline | 20 s | `after-commit.ts` | Below the drain bound. Pinned. Unchanged. |
| Stream cap `SSE_MAX_DURATION_MS` | 30 s | `sse/event-stream.ts` | Contract (REQ-API-018, api/README §9). Counted from the start of the stream. |
| Stream deadline `STREAM_DEADLINE_MS` | 31 s | `execute.ts` (new) | The cap plus 1 s. Used only with the drain signal. |
| Stream end grace `STREAM_END_GRACE_MS` | 1 s | `execute.ts` (new) | The time a stream has to end after the drain signal. Below the drain bound. |
| Stream buffer bound `STREAM_BUFFER_LIMIT_BYTES` | 1 MiB | `execute.ts` (new) | Unsent bytes one stream may hold. |
| Drain bound `DRAIN_TIMEOUT_MS` | 25 s | `runtime/shutdown.ts` | Unchanged. |
| Resource close | 3 s | `runtime/shutdown.ts` | 25 s + 3 s = 28 s. |
| Stop window | 30 s | REQ-PLAT-022 | 28 s fits. |
| `stopTimeout` of the `api` task | 35 s | platform.md §5.2 | 7 s after the latest exit. |
| Deregistration delay of the load balancer | 30 s | platform.md §5.3 | Runs before SIGTERM. |
| Compose stop grace | 10 s (Docker default) | `compose.yaml` sets none | Observation, section 9. |

The stop sequence in AWS (M5; platform.md §5.3 and §10.4):

1. The target is deregistered. The load balancer sends no new request. Open connections continue for up to 30 s.
2. 30 s later ECS sends SIGTERM. A stream that was open at step 1 started before it and has reached its 30 s cap.
3. At SIGTERM readiness turns 503 and the drain signal aborts. Every stream still open sends `error` and ends within 1 s. The listener closes, in-flight requests finish inside the 25 s bound, `afterCommit` work is drained, and the resources close within 3 s. The process has exited after at most 28 s.
4. 35 s after SIGTERM the stop timeout would kill the task.

In Compose there is no step 1 or 2. SIGTERM arrives with streams open, and step 3 is what ends them.

Why the two changes are one unit: a stream with a 31 s deadline and no drain signal would hold `server.close()` until the 25 s bound (probe P1). The forced close would reset it without a terminal event, the process would exit with code 1, and the `afterCommit` drain would start only after the forced close. So the slot uses 31 s only when the composition supplied the drain signal. Without it a stream keeps the 20 s of the call deadline, as today.

How this answers the condition of D-SECPR044-01 ("whatever lands for R1-M1 must keep a stream's deadline below the 25 s drain and end it with an `error` frame"):

- After the drain starts a stream lives at most 1 s, not 25 s, and it ends with the frame.
- A stream can have a deadline above the drain bound only in a composition that ends streams at the drain.
- The sentence is not met literally: 31 s is not below 25 s. The literal form needs a cap below 25 s, which changes REQ-API-018, US-042 and both contract operations.
- security-analyst confirms the reading before part 044-B is dispatched (section 8, gates).

## 4. Part 044-A: the items of this ruling for the fix cycle

Beside R1-m1, R1-m2 and R1-m3 of the review and C1 and C2 of D-SECPR044-01. All in TASK-044's own files.

- **A1. `error` carries no `id` (ADR-0016 amendment 14 item 2; D-ARCH-220).**
  - The module writes `error` as `event: error` and `data: …` with no `id:` line. `complete` keeps its id (the last id plus one).
  - The case that fails today: a stream has sent event 1 and ends with `error`, id 2. The reader keeps 2 as its resume point (`readEventStream` returns `parser.lastEventId`). Results 2 and 3 are persisted meanwhile. The reopened stream replays what lies after 2, so result 2 is never delivered.
  - `expectEventStream` fails an `error` event that has an id. It still requires strictly increasing ids on every other event.
  - The api tests expect `error` without an id.
  - New test: a stream ends with `error` after event 1 while events 2 and 3 are persisted. Reopened with the reader's `lastEventId` (1), it delivers 2 and 3.
- **A2. Subscription wording (D-ARCH-222).** The module comment (item 7) and the fixture of AT-US-042-06 say "subscription", not "carrier call". The producer's signal ends the work the stream started and nothing else.
- **A3. The header comment of `event-stream.api.test.ts`.** It names AT-US-042-01 and AT-US-042-05 as proven in a test composition and completed by part 044-B. The titles and IDs stay.
- **A4. The union with PR #80 (review R1-m4).** Whichever of PR #80 and part 044-A merges second deletes the unused `appError` binding of `problem-handler.ts` and runs lint on the union.

Not in part 044-A: any change to `execute.ts`, `define-route.ts`, `route-state.ts`, `app.ts` or `start-api.ts`.

A1 changes a rule of an Accepted ADR ("increasing `id`" in ADR-0016 §10). The fix cycle does not wait for the gatekeeper; its verification of amendment 14 item 2 is a merge condition of part 044-A. If it is refused, A1 is reverted on its own: the `id` line of one frame, one helper rule and the tests named above.

## 5. Part 044-B: exact changes

One pull request. Locks `api-tx-execute`, `api-routing`, `api-platform-core` and `api-sse`.

- **B1. The cache header by the kind of result.**
  - `route-state.ts` exports `PRIVATE_STREAM_CACHE_CONTROL = 'private, no-cache, no-store'` beside `PRIVATE_CACHE_CONTROL`.
  - On a private response `send()` writes `PRIVATE_STREAM_CACHE_CONTROL` when the result is a stream and `PRIVATE_CACHE_CONTROL` otherwise, after the handler's headers. It reads no handler value.
  - `sse/frame.ts` takes its `SSE_CACHE_CONTROL` from that constant, so the value has one definition.
  - A response that is not private is not touched.
- **B2. The stream deadline.**
  - `STREAM_DEADLINE_MS = 31_000`, armed when the slot starts the stream. The call deadline does not reach a stream.
  - It is used only when the slot was given the drain signal. Otherwise a stream keeps the value of the call deadline.
  - Test seam `streamDeadlineMs`, like `callDeadlineMs`.
- **B3. The drain signal.**
  - `startApi` creates an `AbortController`, hands its signal to `createApp` (`AppDependencies.draining`) and aborts it as the first statement of the `drain` callback, before `server.close()`.
  - `app.ts` forwards it to the default pipeline (`ExecuteOptions.draining`). `defaultPipelineSlots` already spreads the execute options into `executeSlot`; `pipeline.ts` is edited only if that proves wrong.
- **B4. The second signal of the stream hook.**
  - `define-route.ts`: `RouteStream.complete(sink, signal, ending)`. A hook with two parameters still satisfies the type.
  - The slot passes the drain signal as `ending`, or a signal that never aborts.
  - When `ending` aborts, and when it has aborted before the stream starts, the slot starts `STREAM_END_GRACE_MS = 1_000`. A stream that has not settled by then is cut.
  - `sse/event-stream.ts`: on `ending` the module writes `error` with `SERVICE_UNAVAILABLE`, calls `onFailure({ reason: 'draining' })` and settles. A stream that starts with `ending` aborted writes its replay first.
- **B5. Ends that the slot decides (R1-m5; PR044-SEC-04).**
  - The client went away, before or after the headers: the slot destroys the response and returns. No `http.request_failed` line. The access line `http.request` with `aborted: true` is the record (`request-logger.ts`). The return sits after `run` has settled, so the release of an idempotency claim and the decision on the FAILED entry have happened.
  - A cut (stream deadline, end grace, buffer bound): one line `api.stream_cut` with the operation id, the route template, the correlation id and the reason (`deadline`, `end_grace`, `buffer_limit`), and no value. ERROR for `deadline` and `end_grace`, WARN for `buffer_limit`. The slot destroys the response and returns.
  - A stream hook that rejects is a defect and is rethrown.
  - `problem-handler.ts`: after the headers were sent it logs `http.request_failed`, calls `res.destroy()` and returns. It no longer calls `next()`. This is the optional remediation of PR044-SEC-04; PR44-SEC-13 stays closed, because nothing reaches `console.error`.
  - `afterCommit` is scheduled as before in every case.
- **B6. The buffer bound.** `STREAM_BUFFER_LIMIT_BYTES = 1_048_576`. After each write the sink reads `res.writableLength`; above the bound the stream is cut with the reason `buffer_limit`.
- **B7. Text.** The contract descriptions and the api/README §9 rows of section 6 ride this pull request, with `npm run openapi:lint` and `npm run openapi:types`. api-designer acknowledges.
- **B8. The comment at `shutdown.ts` line 10.** It names the 30 s window of REQ-PLAT-022 and the 35 s stop timeout of platform.md §5.2.

Proofs:

- (a) `[AT-US-042-01]` on the default pipeline, with only the authentication slot replaced by the test seam of `app.ts` (the real bearer authenticator once TASK-052 is on main). A stream fixture whose authentication set has no `anonymous` member answers `Cache-Control` exactly `private, no-cache, no-store`, and the SEC-TC-29 check of the helper passes.
- (b) A handler that sets `Cache-Control: public, max-age=3600` on a private stream still gets `private, no-cache, no-store`. A private response that is not a stream gets `private, no-store` whatever the handler set, `private, no-cache, no-store` included.
- (c) `[AT-US-042-04]` `[AT-US-042-05]` on the default pipeline, with the drain signal supplied and no `callDeadlineMs` or `streamDeadlineMs` override: the heartbeat by 16 s, `error` with `SERVICE_UNAVAILABLE` at 30 s, the close within 1 s.
- (d) Drain, over real HTTP:
  - with a stream open and a producer that never completes, aborting the drain signal delivers `error` with `SERVICE_UNAVAILABLE` and no id, the response ends, and `server.close()` resolves within 1 s plus the host slack;
  - a stream opened after the signal aborted gets its replay, then `error`, and ends;
  - a hook that ignores `ending` is cut at 1 s, and `api.stream_cut` is logged with the reason `end_grace`.
- (e) A unit test of `startApi`: the signal handed to `createApp` is the one the drain callback aborts, and it aborts before the listener is closed.
- (f) Pins: `STREAM_DEADLINE_MS - SSE_MAX_DURATION_MS === 1_000`; `STREAM_END_GRACE_MS < DRAIN_TIMEOUT_MS`; the `[R1-n2]` pin of the call deadline unchanged; a slot without the drain signal gives a stream no more than the call deadline.
- (g) Under `env=production` with a `console.error` spy:
  - a client that disconnects after the first event, and one that disconnects during a `call` phase, leave no `http.request_failed` line and no `console.error` call, and `afterCommit` is still scheduled;
  - a stream hook that rejects after the headers leaves exactly one `http.request_failed` line and no `console.error` call.
- (h) The buffer bound: a client that never reads and a producer that keeps writing is cut once the response holds more than 1 MiB, with one `api.stream_cut` line and no `http.request_failed` line.
- (i) The resume after a drain: the reader's `lastEventId` after the `error` event is the id of the last event before it, and the reopened stream delivers every later persisted event.

## 6. Text for api-designer

`docs/03-architecture/api/**` is a lane-B tooling input, so nothing is edited here. The texts ride part 044-B (B7), because a changed description changes `types.gen.ts`.

1. **`components/headers/CacheControl`, description:** "Public reference data: `public, max-age=3600` (REQ-DATA-016). Event streams: `private, no-cache, no-store` (the `no-cache` of REQ-API-017 with the `private, no-store` of every response that is not anonymous, SEC-TC-29)."
2. **`streamQuoteResults`, description:**
   - "`Cache-Control: no-cache`" becomes "`Cache-Control: private, no-cache, no-store`".
   - "and cancels upstream work within 1 s of client disconnect" becomes "and releases its subscription within 1 s of a client disconnect. Carrier calls are started by `createQuote` and are never cancelled by a reader."
   - Added: "`error` carries no `id`, so it never moves the resume point. `error` with `SERVICE_UNAVAILABLE` means the stream reached its 30 s cap or the server is stopping: reconnect with `Last-Event-ID`, or read `getQuote`."
3. **`streamBookingProgress`, description:** "capped at 30 s, after which the client reconnects or polls" becomes "capped at 30 s. After `error` with `SERVICE_UNAVAILABLE` (the cap, or a server that is stopping) the client reconnects or polls `getBookingProgress`."
4. **api/README §9, row "Response headers":** `Cache-Control: private, no-cache, no-store`.
5. **api/README §9, row "Framing":** "Every event except `error` has a strictly increasing integer `id:`. `error` has no `id:`, so a client's resume point stays at the last result it received. Every event has a named `event:` and a single-line JSON `data:`. A comment heartbeat `: heartbeat` is sent at least every 15 s."
6. **api/README §9, row "Termination":** "The server closes within 1 s after `complete` or `error`. The hard cap is 30 s from the start of the stream; at the cap the server sends `error` with `SERVICE_UNAVAILABLE`. Rate shopping normally closes by 6 s. When the server is stopping, every open stream gets `error` with `SERVICE_UNAVAILABLE` and is closed within 1 s. When the client disconnects, the stream releases its subscription, its timers and its stream slot within 1 s. A stream starts no carrier call and no saga step and cancels none: carrier calls belong to `createQuote` and run to their own deadlines."
7. **api/README §9, new row "Stream errors":** "`SERVICE_UNAVAILABLE`: retryable (the cap, or a server that is stopping); resume with `Last-Event-ID`, reconnect, or use the non-streaming read. `INTERNAL_ERROR`: not retryable. A stream that ends without `complete` or `error` (a lost connection, a cut) is treated like `SERVICE_UNAVAILABLE`."
8. **api/README §9, row "Reconnect", added sentence:** "The resume point is the id of the last event received; `error` has none and `complete` ends the sequence."

Item 3 of the review's section 4 (the closed list of stream codes) and R1-n7 (§17 path) are api-designer's from the review; items 6 and 7 above give the architecture content for the first.

## 7. Text for product-manager

Story files are a lane-B tooling input, so nothing is edited here. The orchestrator times the commit.

1. **Delivery split of US-042 (D-PM-082 form; D-ARCH-217).** A note on US-042, for example: "Delivery split (D-ARCH-217; TASK-044 code review R1-M1): TASK-044 is delivered in two parts and does not complete this story with the first. Part 044-A proves the convention on fixture streams through the real pipeline slots: AT-US-042-02, -03, -04, -06, -07 and -08, and of AT-US-042-01 and -05 the behaviour of the stream module in a test composition (a stream that admits an anonymous caller; the request deadline raised for the test). Part 044-B completes the story: on the default pipeline, for a caller that is not anonymous, the stream answers `Cache-Control: private, no-cache, no-store` (AT-US-042-01), and an upstream that never completes gets `error` and the close at 30 s (AT-US-042-05). Until part 044-B merges no stream operation is mounted. Both parts are inside M0." product-manager decides whether the last sentence holds and whether the Wave 2 exit text names US-042 as partial.
2. **REQ-API-018.** The clause "and cancel in-flight upstream work when the client disconnects" and the note "Test: client abort stops carrier calls within 1 s" contradict REQ-CARR-009 as amended (a stream never starts a carrier call) and ADR-0016 amendments 9 and 14. Needed:
   - shall-statement: "… cap stream duration at 30 s, and release the stream's own work (its subscription and timers) within 1 s when the client disconnects."
   - note: "A stream starts no upstream work (REQ-CARR-009), so a disconnect cancels none: carrier calls started by `POST /quotes` run to their own deadlines, and their results stay available to a reconnect and to the fallback GET. Test: after a client abort the stream's subscription is released within 1 s, and a carrier call that was in flight completes and is stored. When the server is stopping, an open stream gets `error` and is closed within 1 s."
3. **AT-US-042-06.** Needed, with or without a new title (a new title changes the map row):

   ```gherkin
   Scenario: Client abort releases the stream
     Given a test event stream whose producer holds a subscription
     When the client disconnects at 1 s
     Then the subscription is released within 1 s
     And work that the stream did not start is not cancelled
   ```

   The carrier side of the last step is proven at the quote stream (TASK-141 card line STREAM DISCIPLINE). product-manager decides whether US-135 gains a step for it, for example in "Opening, reopening and resuming a stream makes no carrier calls": "And closing a stream while a carrier call of the quote is in flight does not cancel it: its result is stored and replayed to the next open".
4. **AT-US-042-07 (review open question 2).** The architecture side is D-ARCH-107 (5) and A-078: a stream whose authentication set is `[session]` answers 401 `AUTH_REQUIRED` without a bearer, and one whose set is `[session, quote-token]` answers 404 `NOT_FOUND` without a usable credential. The two-part wording the review proposes matches both.
5. **`Cache-Control` in AT-US-042-01 and in the first scenario of US-135.** "Cache-Control no-cache" reads as "the header contains the directive `no-cache`". The value is `private, no-cache, no-store`. A note on US-042 is enough; no step changes.
6. **REQ-API-017, "a monotonically increasing `id` per event".** The stream-level `error` event carries no id (D-ARCH-220): it is not part of the sequence and must not move the client's resume point. A note is enough if product-manager reads "per event" as "per event of the sequence"; otherwise the shall-statement gains "except the stream-level `error` event".
7. **Optional, REQ-PLAT-022 note:** "An event stream open at SIGTERM gets `error` and is closed within 1 s; the client reconnects to another instance."

## 8. Card lines for the next plan fold (senior-developer)

Verbatim. No line holds an apostrophe or a backtick.

**TASK-044**

1. TWO PARTS (ADR-0016 amendment 14 item 9; D-ARCH-217; code review R1-M1; D-SECPR044-01; the story split is recorded by product-manager): part 044-A is the branch under review with its fix cycle; it changes only the files of this card and the one hunk of problem-handler.ts and proves AT-US-042-02, -03, -04, -06, -07 and -08 in full and, of AT-US-042-01 and -05, the behaviour of the module in a test composition (a fixture stream that admits an anonymous caller; the slot deadline raised to 40 s); part 044-B changes the tx slot and the composition and completes AT-US-042-01 and -05 on the default pipeline; US-042 is partial until part 044-B merges; no stream operation is mounted before part 044-B merges (TASK-141 and TASK-173 carry the precondition)
2. PART 044-A FIX CYCLE, ARCHITECT ITEMS (D-ARCH-220, D-ARCH-222; beside code review R1-m1 to R1-m3 and D-SECPR044-01 C1 and C2; rulings/wave-1-task-044-rulings.md section 4): (1) the error event carries no id line (ADR-0016 amendment 14 item 2): the module writes event and data only, complete keeps the last id plus one, expectEventStream fails an error event that has an id and still requires strictly increasing ids on every other event, the api tests expect error without an id, and a new test proves the resume: a stream that ends with error after event 1 while events 2 and 3 are persisted is reopened with the reader lastEventId (1) and delivers 2 and 3; (2) the module comment (item 7) and the AT-US-042-06 fixture say subscription, not carrier call: the producer signal ends the work the stream started and nothing else; (3) the header comment of event-stream.api.test.ts names AT-US-042-01 and -05 as proven in a test composition and completed by part 044-B, titles and IDs unchanged; (4) whichever of PR #80 and part 044-A merges second deletes the unused appError binding of problem-handler.ts and runs lint on the union (code review R1-m4); part 044-A edits neither execute.ts nor define-route.ts, route-state.ts, app.ts or start-api.ts; MERGE CONDITION of part 044-A for item (1): quality-gatekeeper has verified ADR-0016 amendment 14 item 2 (the fix cycle does not wait for it)
3. PART 044-B SCOPE (ADR-0016 amendment 14 items 1 and 3 to 8; ADR-0003 amendment 2026-11-21 rules (m) to (q); D-ARCH-218, D-ARCH-219, D-ARCH-221, D-ARCH-223; rulings/wave-1-task-044-rulings.md section 5): B1 on a private response send() writes Cache-Control from a constant of the slot chosen by the kind of result (private, no-cache, no-store for a stream; private, no-store otherwise) and reads no handler value; route-state.ts holds both constants and sse/frame.ts takes its value from there; B2 a stream has its own deadline of 31 s (the 30 s cap plus 1 s), armed when the stream starts and used only when the slot was given the drain signal, otherwise the stream keeps the 20 s of the call deadline; B3 startApi creates the drain signal, hands it to createApp and aborts it as the first step of the drain, before the listener closes; B4 the stream hook becomes complete(sink, signal, ending): when ending aborts, also when it aborted before the stream started, the event-stream module writes its replay, then error with SERVICE_UNAVAILABLE and no id, reports the failure reason draining and settles, and the slot cuts a stream that has not settled 1 s later; B5 an end that the slot decides is not a failure: a client disconnect, before or after the headers, destroys the response and returns without an error line (the access line with aborted true is the record), a cut (deadline, end grace, buffer bound) logs api.stream_cut once with its reason and returns, only a stream hook that rejects is rethrown, and after the headers the problem handler logs http.request_failed, destroys the response and no longer calls next(); B6 the sink cuts a stream when the response holds more than 1 MiB of unsent bytes (res.writableLength); B7 the contract descriptions and the api/README section 9 rows of rulings section 6 ride this pull request with openapi:lint and openapi:types, and api-designer acknowledges; B8 the comment at shutdown.ts line 10 names the 30 s window of REQ-PLAT-022 and the 35 s stop timeout of platform.md 5.2
4. PART 044-B FILES AND LOCKS (D-ARCH-217): apps/api/src/platform/tx/execute.ts with its tests, apps/api/src/platform/routing/route-state.ts and define-route.ts, apps/api/src/platform/sse/**, apps/api/src/platform/errors/problem-handler.ts with its test, apps/api/src/app.ts, apps/api/src/start-api.ts with its test, apps/api/src/platform/runtime/shutdown.ts (comment only), tests/api/event-stream.api.test.ts, docs/03-architecture/api/openapi.yaml, docs/03-architecture/api/README.md section 9 and packages/shared/src/api/types.gen.ts; locks api-tx-execute, api-routing, api-platform-core and api-sse, taken from the orchestrator at dispatch; pipeline.ts already forwards the execute options and is edited only if that proves wrong; no new dependency, no configuration key, no migration; backend-developer on opus
5. PART 044-B PROOFS (D-ARCH-217 to D-ARCH-223; rulings section 5): (a) [AT-US-042-01] on the default pipeline with only the authentication slot replaced by the test seam of app.ts (the real bearer authenticator once TASK-052 is on main): a stream fixture whose authentication set has no anonymous member answers Cache-Control exactly private, no-cache, no-store, and the SEC-TC-29 check of the helper passes; (b) on a private stream whose handler sets Cache-Control public, max-age=3600 the response still carries private, no-cache, no-store, and a private response that is not a stream carries private, no-store whatever the handler set; (c) [AT-US-042-04] [AT-US-042-05] on the default pipeline with the drain signal supplied and no callDeadlineMs or streamDeadlineMs override: the heartbeat by 16 s, error with SERVICE_UNAVAILABLE at 30 s, the close within 1 s; (d) drain over real HTTP: with a stream open and a producer that never completes, aborting the drain signal delivers error with SERVICE_UNAVAILABLE and no id, the response ends and server.close() resolves within 1 s plus the host slack; a stream opened after the signal aborted gets its replay, then error, and ends; a hook that ignores ending is cut at 1 s and api.stream_cut is logged with the reason end_grace; (e) a unit test of startApi: the signal handed to createApp is the one the drain callback aborts, and it aborts before the listener is closed; (f) pins: STREAM_DEADLINE_MS minus SSE_MAX_DURATION_MS is 1000, STREAM_END_GRACE_MS is below DRAIN_TIMEOUT_MS, the [R1-n2] pin of the call deadline is unchanged, and a slot without the drain signal gives a stream no more than the call deadline; (g) under env production with a console.error spy: a client that disconnects after the first event, and one that disconnects during a call phase, leave no http.request_failed line and no console.error call, and afterCommit is still scheduled; a stream hook that rejects after the headers leaves exactly one http.request_failed line and no console.error call; (h) a client that never reads and a producer that keeps writing is cut once the response holds more than 1 MiB, with one api.stream_cut line (reason buffer_limit) and no http.request_failed line; (i) after the error event of a drain the reader lastEventId is the id of the last event before it, and the reopened stream delivers every later persisted event
6. PART 044-B GATES (D-ARCH-217): DISPATCH when (1) quality-gatekeeper has verified ADR-0016 amendment 14, the ADR-0003 amendment of 2026-11-21 and ADR-0010 amendment 14, (2) security-analyst has confirmed D-ARCH-218 (the two cache constants as the allow-list of D-SECPR044-01), D-ARCH-219 (its condition on the drain, as read in rulings section 3), D-ARCH-221 (the problem handler after the headers) and D-ARCH-223 (the buffer bound), (3) part 044-A is on main or on its approved head, and (4) the four locks are free: api-tx-execute passes from the first pull request of TASK-040 part 040-B to part 044-B and then to TASK-096, and app.ts and start-api.ts are never in flight together with TASK-041 part 041-B or the second pull request of part 040-B; a stacked build on approved heads is allowed (D-ORCH-150); MERGE before TASK-141 is dispatched, before TASK-096 is dispatched when both are dispatchable, inside Wave 2 if the locks allow, and in any case before the v0.1.0-m0 tag; a security record is required (owned paths under apps/api/src/platform) and lane B runs event-stream.api.test.ts on the head

**TASK-040 (part 040-B)**

7. NO STREAM CHANGE IN PART 040-B (D-ARCH-217; TASK-044 code review R1-M1 and R1-m5; D-SECPR044-01 F1 and F5): send(), completeStream, the request lifetime and the disconnect path of execute.ts stay as part 040-A left them in both pull requests of part 040-B; TASK-044 part 044-B changes them after the first pull request of part 040-B has released api-tx-execute; the lease rule keeps the call deadline as D (a stream is never an idempotent route, so the stream deadline of D-ARCH-219 does not enter it); UNION WITH TASK-044 (code review R1-m4): whichever of PR #80 and TASK-044 part 044-A merges second deletes the unused appError binding of problem-handler.ts and runs lint on the union

**TASK-083**

8. FAN-OUT SIGNAL (ADR-0010 amendment 14; ADR-0016 amendment 14 item 5; D-ARCH-222): the fan-out takes one AbortSignal, the one its caller passes (the afterCommit signal of createQuote: the shutdown drain or the afterCommit deadline), and hands it to CarrierContext; the phrase AbortSignal cancels within 1 s on this card means that signal; the fan-out service has no parameter for a request signal or a stream signal, and a reader of the quote that goes away cancels nothing

**TASK-091**

9. FAN-OUT IS NOT TIED TO A READER (ADR-0010 amendment 14; ADR-0016 amendment 14 item 5; D-ARCH-222; TASK-044 code review R1-m6): createQuote starts the fan-out in afterCommit under the afterCommit signal and the rate-shopping deadlines only; no request signal and no stream signal reaches it; test with the Mock latency scenario: the caller of createQuote disconnects right after the 201 and a getQuote reader disconnects while a carrier call is in flight, every call still completes, its result is persisted and a later getQuote returns it; this task mounts no stream operation (streamQuoteResults is mounted by TASK-141), so the follow-ups that the TASK-044 review dates before TASK-091 (R1-M1, R1-m5) are due with TASK-044 part 044-B, before TASK-141 is dispatched

**TASK-096**

10. LOCK ORDER WITH TASK-044 PART 044-B (D-ARCH-217): this task and part 044-B both edit execute.ts and define-route.ts and are never in flight together; part 044-B goes first when both are dispatchable; this task leaves send(), completeStream, the stream signals and the cut logging of ADR-0003 rules (m) to (q) as it finds them; step 7b applies to no stream operation (neither takes If-Match)

**TASK-108**

11. REQUEST TIMEOUT AND EVENT STREAMS (ADR-0016 amendment 14 item 3; D-ARCH-219; US-045: an event-stream route is exempt): the 30 s request timer covers a request until its response starts; once the tx slot has started a stream, the stream deadline of the slot is its only bound, and the timer neither answers nor resets it; test: a stream fixture that started 2 s after the request arrived still gets its error event at 30 s of stream time and a clean end

**TASK-141**

12. PRECONDITION PART 044-B (ADR-0016 amendment 14 item 9; D-ARCH-217; R-ARCH-41): TASK-044 part 044-B is on main before this task is dispatched; without it the stream answers private, no-store without no-cache, is reset at 20 s without a terminal event, and every disconnect writes an error line
13. STREAM DISCIPLINE (ADR-0016 amendment 14 items 2, 4, 5 and 8; ADR-0010 amendment 14; D-ARCH-219, D-ARCH-220, D-ARCH-222): the producer passes its signal to its own subscription and timers and to nothing else; it starts no carrier call and cancels none; test with the Mock latency scenario: a reader disconnects while carrier calls of the quote fan-out are in flight, every call completes and is persisted, and the next open replays the results; the route logs the failure reasons max_duration and draining at info and producer_failed and event_refused at error; live events carry their persisted sequence id and the error event carries none, so a client that resumes after error with SERVICE_UNAVAILABLE (the cap or a stopping server) misses nothing; test over two app instances on one database: the stream on the first is ended by its drain signal after event 1, the reader reopens on the second with its lastEventId and receives every later event and complete
14. STREAM SLOT TTL AND REPLAY SIZE (D-ARCH-219, D-ARCH-223; D-SECPR044-01 PR044-SEC-05 and PR044-SEC-07 item 3): the ttlMs of the stream slot is at least the time from its acquisition to the latest end of the stream: two transactions (admission wait plus maxWait plus timeout each), the 31 s stream deadline and 5 s for clock skew; a shorter slot lets a client hold more streams than the cap; the slot is released when the response closes, however it ends; the replay read is bounded so that its frames stay under the 1 MiB buffer bound of the tx slot (a replay is written in one turn and counts in full)

**TASK-173**

15. PRECONDITION PART 044-B (ADR-0016 amendment 14 item 9; D-ARCH-217; R-ARCH-41): TASK-044 part 044-B is on main before this task is dispatched
16. STREAM DISCIPLINE (ADR-0016 amendment 14 items 4, 5 and 8; D-ARCH-219, D-ARCH-222): the producer passes its signal to its own subscription and timers only; the stream starts no saga work, and a disconnect leaves the saga untouched (test); while a saga is in progress the 30 s cap is the normal end of this stream, so the route logs max_duration and draining at info; after error with SERVICE_UNAVAILABLE, and after a stream that ends without a terminal event, the client reconnects or polls getBookingProgress
17. STREAM SLOT TTL (D-ARCH-219; D-SECPR044-01 PR044-SEC-05 and F2): as on TASK-141: at least two transactions, the 31 s stream deadline and 5 s; the slot is the counter shared by both stream operations and is released when the response closes

**TASK-214**

18. STREAM SIGNALS (ADR-0003 amendment 2026-11-21 rule (p); D-ARCH-221, D-ARCH-223): api.stream_cut is counted by reason; deadline and end_grace alert (a stream that does not end by its cap or at the drain is a defect of the stream), buffer_limit is a dashboard series; a client disconnect is not an error and is not counted in the 5xx rate behind ROLLBACK_TRIGGERS (the access line carries aborted true)
19. DRAIN, KEEP-ALIVE AND THE COMPOSE STOP GRACE (D-ARCH-224; probe P4 of rulings/wave-1-task-044-rulings.md): on Node 24.22.3 a connection that was busy when server.close() ran stays keep-alive and serves a new request afterwards, so new requests are not refused on it (US-013); after the drain starts a connection is closed when its response ends (Connection: close on responses sent while draining, or closeIdleConnections() repeated until the drain ends); test: a second request on a kept-alive connection after SIGTERM is not served; compose.yaml sets stop_grace_period 35s on api and worker (Docker stops a container 10 s after SIGTERM by default; platform.md 5.2 gives 35 s)

**TASK-142**

20. CLIENT RESUME (ADR-0016 amendment 14 items 2, 4 and 8; D-ARCH-219, D-ARCH-220; flow F01): after error with SERVICE_UNAVAILABLE (the cap or a stopping server), and after a stream that ends without a terminal event, the client reopens the stream once, after a random delay of up to 1 s, with Last-Event-ID set to the reader lastEventId (the last result received; the error event has no id), and falls back to polling getQuote when the reopened stream ends the same way; after error with INTERNAL_ERROR it goes to getQuote at once; results are keyed by carrier, so a replayed result replaces its row; test with the fetch reader: a stream that ends with error after one result is reopened with that result id, and the page shows every carrier once

**TASK-182**

21. CLIENT RECONNECT (ADR-0016 amendment 14 items 4 and 8; D-ARCH-219; flow F03): after error with SERVICE_UNAVAILABLE (while a saga runs the 30 s cap is the normal end of the stream) and after a stream that ends without a terminal event, the client reopens the stream after a random delay of up to 1 s, and polls getBookingProgress every 3 s when two reopenings in a row fail; the stream has no resume, and the first events after a reopening carry the current state

For senior-developer to place, not a card line of mine: TASK-120 (k6 rate-shopping SSE profiles, batch 3.7) depends on TASK-091 and TASK-280, but the stream it measures is mounted by TASK-141 (batch 4.5).

## 9. Routed, not edited here

- **product-manager:** section 7, items 1 to 6 (7 optional). The split of item 1 is what closes R1-M1 for the branch together with the plan fold.
- **api-designer:** section 6. Acknowledges the texts when they ride part 044-B.
- **security-analyst:**
  - concurrence on D-ARCH-218 (the slot's two constants as the allow-list of D-SECPR044-01), D-ARCH-219 (the condition on the drain as read in section 3), D-ARCH-221 (the problem handler after the headers; no second info line for a disconnect, because the access line records it) and D-ARCH-223 (the 1 MiB bound). Requested, not obtained;
  - the mitigation cell of threat-model T-47 says "disconnect cancels work". It should read "disconnect releases the stream's subscription and slot" (ADR-0016 amendment 14 item 5).
- **quality-gatekeeper:** verifies ADR-0016 amendment 14, the ADR-0003 amendment of 2026-11-21 and ADR-0010 amendment 14 (CLAUDE.md §5).
- **qa-lead:** the map row of AT-US-042-06 if product-manager retitles it; R1-n5 of the review stays with qa-lead.
- **senior-developer:** the fold of section 8; the placement of part 044-B in the lock order; TASK-120.
- **devops-engineer:** nothing now. The Compose stop grace is on the TASK-214 line.

## 10. Considered and not adopted

- **Route (a) alone: hold TASK-044 until the slot changes are in.** `execute.ts` is held by TASK-040 (PR #80 open, part 040-B next), and no pull request can merge while hosted CI is blocked (D-ORCH-146). TASK-091 depends on TASK-044 and is on the Wave 2 path.
- **The slot changes on TASK-040 part 040-B.** It holds the locks next. But part 040-B gates TASK-049, TASK-062 and TASK-092 and has its own security conditions; a finding on stream code would hold the completion of US-038. Part 044-B gates only TASK-141 and the M0 tag.
- **The slot changes on TASK-096.** It holds `api-tx-execute` in batch 3.1 but not `api-platform-core`, and its subject is `If-Match`.
- **A new late task.** The project delivers such work as a part of the task that owns the story (020-B and 020-C, 040-B, 041-B). A part keeps US-042 with one task.
- **`send()` keeps a handler value that contains `private` and `no-store`** (review R1-M1 (a) item 1). `private, no-store, max-age=60, public` and `no-store-x, private` pass that test (D-SECPR044-01). RFC 9111 §5.2.2.9 defines `public` as "may store even if it would otherwise be prohibited", and §4.2.1 only says that the most restrictive of conflicting directives should be honoured.
- **`send()` compares the token set of the handler value with the two allowed sets** (the form D-SECPR044-01 rules acceptable). It gives the same two values on the wire and needs a parser. A stream whose handler set no header would get `private, no-store`. It stays the fallback if security-analyst prefers it.
- **A stream deadline below the drain bound** (the literal form of the D-SECPR044-01 condition). It needs a cap of about 23 s: a change of REQ-API-018, US-042 AT-05, both contract operations and api/README §9. Every stop would still wait up to 23 s for open streams.
- **A drain bound above the stream deadline.** The stop window is 30 s (REQ-PLAT-022) and the stop timeout 35 s. Every stop with one open stream would take 30 s.
- **Closing the connections of open streams at the drain** (`closeAllConnections` for streams). The client gets a reset and cannot tell a stop from a network failure; platform.md §10.4 asks for a terminal event.
- **One signal with a typed abort reason** instead of a second signal. Probe P5: the slot destroys the response before the frame leaves.
- **A 503 problem instead of a stream for a request that reaches the stream after the drain started.** The handler has committed and, on the quote stream, the VIEW entry is written. The stream path delivers the replay the entry records.
- **`error` keeps an id and the client is told not to resume from it.** The server cannot tell a real resume point from the id of an `error` event. Only a reader that knows the rule would be safe.
- **`complete` without an id as well.** Harmless either way; it would change the contract example and more tests.
- **A sink that waits for `drain`.** The results are shared and persisted: a slow reader cannot slow the fan-out, and a cut reader resumes. It becomes necessary with the first stream whose events are not persisted.
- **A separate info line `http.stream_client_gone`** (review R1-m5, PR044-SEC-04). The access line `http.request` already records the request with `aborted: true`, the route template, the status and the duration.
- **A stream result that declares its own maximum duration.** There is one stream convention and one cap; a constant with a pinned relation is enough.
