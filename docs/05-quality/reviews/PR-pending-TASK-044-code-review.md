# Code review: TASK-044 server-sent events convention (round 1, pre-push)

| Field | Value |
| --- | --- |
| Task | TASK-044, server-sent events convention (framing, heartbeats, Last-Event-ID, close semantics) |
| Story | US-042 (DC, M0 Must); REQ-API-017, REQ-API-018; NFR-PERF-003 |
| Branch | `feat/TASK-044-server-sent-events-convention` |
| Head reviewed | `dc64193f` (3 commits on base `530629f4`: `456ee228` fix PR44-SEC-13, `4e845bdc` feat, `dc64193f` test) |
| PR | none yet (pre-push record; rename once the PR exists) |
| Reviewer | code-reviewer (Claude Opus 5.5), 2026-11-21 |
| Round | 1 |
| Developer decisions ruled | D-TASK044-01 .. D-TASK044-13 (commit bodies) |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The SSE module, the PR44-SEC-13 fix, the fetch reader and the expectEventStream helper are well built and
  well tested (101 unit tests green, 14/14 mutants killed). One MAJOR: AT-US-042-01 and -05 hold only in a test-only
  composition (anonymous route, 40 s slot deadline). In the production composition both real stream routes send
  `private, no-store`, and the slot cuts the stream at 20 s with a connection reset and no `error` frame. The fix the
  developer proposes (raise the deadline) breaks the pinned 25 s shutdown drain, so it needs an architect ruling.
  Six MINORs, four of them in this branch's own files: a producer bug crashes the process (unhandled rejection), the
  privacy guard runs before the size and serialisation checks (toJSON leak, quadratic regex), the reader resumes past
  an event it never dispatched, and the union with PR #80 fails lint.
  M1 can be closed by a ruling, without code in this branch, using the D-PM-082 part-A/part-B pattern.
```

## 1. What I verified myself

Everything below ran in a `git archive` extract of `dc64193f` under the session scratchpad, with `node_modules`
junctioned to the worktree (its `@platform/*` links resolve to the same SHA). Node 24.22.3. The worktree stayed
clean at `dc64193f`.

- **Read in full:** the diff (18 files, +2152/-3), the brief `docs/04-plan/briefs/TASK-044.md`, the WAVE-01 card,
  US-042 Gherkin, the gherkin-test-map rows AT-US-042-01..08, api/README §9, §16 and §17, `openapi.yaml`
  `streamQuoteResults` / `streamBookingProgress` / `LastEventId` / `CacheControl` / `SseError`, ADR-0016 item 10 and
  amendment 9, A-078, and D-SEC-PR44-02 / D-ORCH-076. Read but not changed (locked): `execute.ts` (`send`,
  `completeStream`, `requestLifetime`), `abortable.ts`, `authorise.ts:102`, `runtime/shutdown.ts`,
  `runtime/process-errors.ts`.
- **Unit tests (targeted, `--maxWorkers=2`):** `platform/sse/*`, `fetch-sse-parser`, `expect-event-stream`,
  `errors/problem-handler.test`. 7 suites, **101/101 pass**.
- **Coverage of the new files** (same run): `event-stream.ts` 100 % lines / 96.7 % branches; `frame.ts`,
  `privacy.ts`, `last-event-id.ts` and `fetch-sse-parser.ts` 100/100; `expect-event-stream.ts` 94.3/94.1. The changed
  line of `problem-handler.ts` (142) is covered.
- **Typecheck:** `tsc -b apps/api packages/ui tests/api`, with the tests/api buildinfo redirected out of the junction.
  Exit 0. This includes compiling `event-stream.api.test.ts`.
- **ESLint `--max-warnings 0` on the 18 changed files:** clean, apart from 3 copy artefacts.
  - They are `import-x/no-extraneous-dependencies` on `@platform/shared`, which resolves outside the archive copy.
  - The unchanged base lines 5-6 of `contract-validator.ts` report the same error.
- **Prettier `--check`:** clean.
- **Mutants: 14/14 killed**, each against its own test file:

  | Mutant | Tests failed |
  | --- | --- |
  | no upstream abort in `finish` | 4 |
  | no duplicate-id drop | 1 |
  | no heartbeat write | 2 |
  | no privacy check | 3 |
  | no `clearInterval` | 3 |
  | no slot-abort listener | 2 |
  | terminal names allowed as live events | 1 |
  | PR44-SEC-13 reverted to `next(appError ?? …)` | 3 |
  | parser: CR at chunk end | 1 |
  | parser: NUL id accepted | 1 |
  | parser: line cap | 1 |
  | privacy depth cap | 1 |
  | helper accepts equal ids | 1 |
  | helper close timing | 1 |

- **Probes** (tsx, in the extract):
  - **P1/P2:** the producer resolves `complete` with a throwing getter, or resolves `undefined`. Result: an
    unhandled rejection, and the hook never settles.
  - **P3:** `complete` data containing `{ toJSON: () => ({ email }) }`. The e-mail is written to the client.
  - **P3b:** `personName`, `companyName`, `receiver_name`, `streetLines`, `address`, `address1`, `username` all pass
    the guard.
  - **P4:** the guard's e-mail regex on one string with no `@`. 16 Ki chars: 256 ms; 64 Ki: 4.1 s; 256 Ki: 63.8 s.
    `'a@' + 'a'.repeat(65536)`: 3.7 s.
  - **P5:** the parser after `id: 2` without the blank line reports `lastEventId = 2`, but only event 1 was dispatched.
  - **Deadline/disconnect probe** over real HTTP: `createApp` plus `defaultPipelineSlots`, `env=production`, slot
    deadline 1.5 s standing in for 20 s, a producer that never completes.
    - At the deadline: the client gets `ECONNRESET` with an empty body (no `error` frame). The server logs
      `http.request_failed` at ERROR and Express writes `console.error("AppError: SERVICE_UNAVAILABLE…")`.
    - A client disconnect at 300 ms gives the same two log lines.
- **Unions** (`git merge-tree`, textual): all clean.
  - `origin/main` 4090d892 has no code drift since the base (docs only).
  - The other branches: TASK-040 v2 (PR #80) 0f0d92a0, TASK-041 be843ae1, TASK-043 3ba1eb53, TASK-045 3168c194.
  - ESLint on the PR #80 union `problem-handler.ts` (tree 5eac837a) fails: see R1-m4.
- **Not run, per the dispatch:**
  - the api suite (`tests/api/event-stream.api.test.ts`, lane B);
  - full `npm run lint` / `typecheck` / `test:unit` / `build`;
  - coverage merge.

  Those come from lane A on the PR head and from lane B.

## 2. Findings

### MAJOR

**R1-M1: AT-US-042-01 and AT-US-042-05 are proven only in a composition production does not have.**

Where:
- `tests/api/event-stream.api.test.ts:5-7, 100-122, 148`
- `apps/api/src/platform/tx/execute.ts:56, 148, 162-170`
- `apps/api/src/platform/authz/authorise.ts:102`
- `apps/api/src/platform/runtime/shutdown.ts:11`
- `apps/api/src/platform/tx/execute-phases.test.ts:383`

What happens:
- **AT-01 (`Cache-Control no-cache`).** `send()` re-asserts `private, no-store` on every private response.
  `authorise.ts:102` marks a response private for any principal that is not anonymous, which covers both the bearer
  and the `X-Quote-Token` principal. So both contract stream operations send `private, no-store`. The test passes
  only because the fixture quote route is `auth: 'anonymous'`, a shape no contract stream has.
- **AT-05 (`error` and close at 30 s).** The slot's 20 s `CALL_DEADLINE_MS` aborts first. The module then ends without
  a frame, `abortable` rejects, `completeStream` calls `res.destroy()`, and the client sees a reset with no terminal
  event (probe above). The test passes only because it raises `callDeadlineMs` to 40 s.
  - Booking-progress streams routinely run to the cap, so this is the normal path for them, not an edge case.

Why it matters:
- The task "completes" a demo-critical story. Its acceptance tests are green, yet the real routes of TASK-091 and the
  booking task will fail two of the eight scenarios.
- The developer's follow-up for AT-05 ("the stream deadline lands in execute.ts") cannot simply raise the deadline:
  - `CALL_DEADLINE_MS < DRAIN_TIMEOUT_MS` (25 s) is a pinned invariant (`execute-phases.test.ts:383`);
  - the ECS stop timeout is 30 s.

  A 30 s stream therefore outlives graceful shutdown, unless the drain ends streams itself.

This is not a developer defect: the brief told the developer not to touch `execute.ts` and to record follow-ups. But
the follow-ups have no owner and no due date, and one of them is not implementable as stated.

Fix, either (a) or (b):
- **(a) Code.** After PR #80 merges, the `execute.ts` lock holder makes the change, or the lock moves to this task.
  1. `send()` keeps a handler `Cache-Control` that already contains both `private` and `no-store`. It is at least as
     private, so SEC-TC-29 still holds; security-analyst to confirm.
  2. A stream gets its own deadline, the SSE cap plus about 1 s, and principal-architect rules how a drain ends live
     streams. Recommended: combine the server's draining signal with the stream signal, so that a drain sends
     `error` `SERVICE_UNAVAILABLE` and the client resumes on another replica with `Last-Event-ID`.
  3. AT-01 runs on an authenticated fixture (a bearer on the `streamBookingProgress` fixture, or the quote-token
     authenticator once TASK-091 adds it). AT-05 runs on the default pipeline deadline, with no `callDeadlineMs`
     override.
- **(b) Ruling.** Same pattern as D-PM-082 for TASK-040:
  - the orchestrator and product-manager record TASK-044 as US-042 part A (the convention proven in a test
    composition);
  - they name the part-B owner for items 1-3 of (a), due before TASK-091 merges;
  - traceability and STATUS show US-042 as partially met until then.

  This closes R1-M1 for this branch without code.

### MINOR

**R1-m1: a producer bug crashes the API process.**

Where: `apps/api/src/platform/sse/event-stream.ts:188-197, 219-221`.

What happens:
- `.then(end, onRejected)` does not catch a throw from `end` itself. `end` throws when the outcome is
  `undefined`/`null`, or when `personalDataPointer` reads a throwing getter: it runs outside `frameOf`'s `try`, at
  line 158.
- The result is an unhandled rejection. In the API, `process-errors.ts:99` turns it into `process.unhandled_rejection`
  and `exit(1)`, which drops every request on the replica. Meanwhile the stream hangs until the slot deadline (probes
  P1/P2).
- The module comment promises "No step throws into the slot", and the module is the convention's safety net.

Fix:
- Route both outcomes of the producer promise through one guarded continuation. For example,
  `.then((o) => { try { end(o); } catch (e) { fail({ reason: 'producer_failed', cause: e }); } }, …)`, plus a type
  guard on `outcome`.
- Move the privacy walk inside the `try` (see R1-m2).
- Add two unit tests: an `undefined` outcome, and a throwing getter in `complete` data.

**R1-m2: the privacy guard runs before the serialisation and size checks, on values that are not what gets sent.**

Where:
- `apps/api/src/platform/sse/event-stream.ts:157-165`
- `apps/api/src/platform/sse/privacy.ts:12-37, 57-71`

Three defects (probes P3, P3b, P4):
1. **toJSON bypass (CWE-359).** The guard walks the live object, but `JSON.stringify` sends what `toJSON` returns. A
   nested `toJSON` that returns `{ email }` was written to the client.
2. **Quadratic e-mail regex on unbounded input (CWE-1333).** The regex runs before the 64 KiB cap, so string length
   is unbounded. 64 Ki characters block the event loop for 4.1 s, 256 Ki for 64 s. Even after the cap, 64 Ki costs
   4 s.
3. **Key gaps.** The closed list misses `receiver_name`, a key of this project's own contract that holds a person's
   name (`Ravi Example`). It also misses carrier-shaped keys: `personName`, `streetLines`, `address`, `address1`,
   `username`.

   The developer is right that a `*name` suffix rule would hit the contract's `carrier_name` / `service_name`; keep
   the list closed but complete it.

Fix:
- Serialise first inside `formatSseEvent`, which already catches cycles and BigInt and enforces the 64 KiB cap. Then
  `JSON.parse` the bounded text and scan the plain value. That fixes 1 and 2 and the getter path of R1-m1.
- Replace `EMAIL_VALUE` with a linear check, for example: for each `@`, look at the non-space run on each side and
  require a `.` in the right-hand run. Pin it with a timing-free test that uses a counted scan, or a 64 Ki case under
  a tight budget.
- Add the missing keys, each with a test.
- Flagged for security-analyst.

**R1-m3: the fetch reader resumes past an event it never dispatched.**

Where: `packages/ui/src/sse/fetch-sse-parser.ts:77-78, 133-135, 163`.

What happens:
- The `id` field writes straight into the exported `lastEventId`, so a connection that drops between `id: 2` and the
  blank line reports `2` (probe P5).
- A reconnect with `Last-Event-ID: 2` then skips event 2: a lost carrier result.
- WHATWG keeps a last-event-ID *buffer* and copies it to the source's last event ID string only when it dispatches.

Fix: keep `idBuffer` and `lastEventId` separate, copy at every blank line (also when `data` is empty, per the spec),
and add a test for a truncated final event.

**R1-m4: the union with PR #80 is textually clean but fails lint.**

Where: `apps/api/src/platform/errors/problem-handler.ts:142` (union line 109).

What happens:
- TASK-040 v2 (0f0d92a0) moves classification into `renderProblem` and keeps
  `const appError = classified.kind === 'app' ? … : undefined;`, used only in the line this branch replaces.
- On the union `appError` is never used, and ESLint reports `@typescript-eslint/no-unused-vars` (verified on
  merge-tree 5eac837a).
- D-TASK044-09's "trivial union" therefore needs one hand edit.

Fix: whichever PR merges second deletes the unused `appError` line and runs lint on the union. That is a merge
condition, not a change on this branch.

**R1-m5 (routed: the `execute.ts` lock holder): every client disconnect and every deadline cut after the headers logs
an ERROR and a stderr stack.**

Where: `apps/api/src/platform/tx/execute.ts:162-170`, together with `problem-handler.ts:124-143`.

What happens:
- `completeStream` rethrows the slot's own disconnect abort. The problem handler then logs `http.request_failed` at
  ERROR, and the Express final handler writes `console.error("AppError: SERVICE_UNAVAILABLE…")` outside `env=test`.
  The probe confirmed both lines.
- With streams, a client navigating away is normal traffic. This floods error logs and error-rate alerting
  (ROLLBACK_TRIGGERS), and every open/close of a stream writes a stack to stderr.
- It is not this diff's code, but this diff makes it reachable.

Fix: in `completeStream`, when `lifetime.isDisconnect(error)`, call `res.destroy()`, log at info
(`http.stream_client_gone`) and do not rethrow. A deadline cut should reach the client as an `error` frame (see
R1-M1 (a) item 2). Due before TASK-091 merges.

**R1-m6 (routed: product-manager and principal-architect): AT-US-042-06 contradicts ADR-0016 amendment 9.**

Where: US-042 AT-06; api/README §9 "Termination"; ADR-0016 item 10; `tests/api/event-stream.api.test.ts:88-92`.

What happens:
- Amendment 9 makes streams subscribe-only: carrier fan-out happens once in `createQuote`. A stream disconnect
  therefore must NOT cancel carrier calls; other clients and reconnects depend on the persisted results.
- AT-06 still says "in-flight Mock carrier calls are cancelled within 1 s". §9 "Termination" and item 10 still say
  "disconnect cancels upstream work". The api fixture models a carrier call inside the stream producer.
- The module's behaviour (the producer signal aborts on disconnect) is right for a subscription. The risk is that
  TASK-091 reads AT-06 literally and passes the stream signal into the fan-out.

Fix:
- Product-manager rewords AT-06: the stream's subscription is released within 1 s, and carrier calls started by
  `createQuote` continue.
- api-designer and principal-architect align §9 "Termination" and ADR-0016 item 10 with amendment 9.
- No code change in this branch; the fixture title can say "subscription".

### NIT

**R1-n1: `readEventStream` does not cancel the body when the parser or a handler throws.**
- Where: `packages/ui/src/sse/fetch-sse-parser.ts:156-167`.
- `SseParseError`, or a throwing `onEvent`, releases the lock but leaves the fetch body open. The server stream keeps
  running until its cap.
- Fix: `catch (e) { void reader.cancel(e).catch(() => undefined); throw e; }`.

**R1-n2: an error outcome's code is checked only against the `SseError` syntax.**
- Where: `apps/api/src/platform/sse/event-stream.ts:142`.
- A producer can put a carrier-namespace code (`CARRIER_BUSY`) or an arbitrary word into `SseError.code`.
- Fix: also require `isErrorCode` (from `@platform/shared`); otherwise send `INTERNAL_ERROR`.

**R1-n3: a client-chosen `Last-Event-ID` reaches the producer-bug path.**
- Where: `apps/api/src/platform/sse/event-stream.ts:107-111, 194-196`.
- `Last-Event-ID: 9999999999` makes `complete` overflow, so the route's `onFailure` hears `event_refused`, which
  `frame.ts` documents as "a programming error of the producer, never client input".
- A resume point above the persisted sequence also yields `complete` with nothing replayed.
- Guidance for TASK-091: treat a resume point above the persisted maximum as absent.

**R1-n4: implicit live ids are unsafe on a resumable stream.**
- Where: `apps/api/src/platform/sse/event-stream.ts:41-42`.
- When `id` is omitted, the next id after the last one sent is used. Across replicas that does not match the persisted
  per-quote sequence (ADR-0016 amendment 3), so a resume can skip or repeat events.
- Fix: say in the module comment that `streamQuoteResults` live events must carry their persisted `id`, or add a
  `requireIds` option.

**R1-n5: AT ids in unit test titles, and the -07 suite mismatch (qa-lead).**
- The unit suites title tests `[AT-US-042-01]`, `-02`, `-04`, `-05`, `-06` and `-08`, so `quality:trace` sees those
  ids in lane A. The binding evidence is the lane B api suite.
- The test map lists AT-US-042-07 under `rbac-matrix`; the test lives in `api`.
- qa-lead: confirm which suite the trace treats as binding, and align the map row.

**R1-n6: the `as Parameters<typeof fixtureRoute>[0]` cast hides a spec type mismatch.**
- Where: `tests/api/event-stream.api.test.ts:135` (`permissionJustification: undefined`).
- Fix: build the spec with its declared type.

**R1-n7: api/README §17 still names `packages/shared/src/api/sse.ts`.**
- The card puts the reader in `packages/ui` (D-TASK044-11).
- api-designer updates §17 at the next fold.

**R1-n8: the parser rescans the whole buffer on every push.**
- Where: `packages/ui/src/sse/fetch-sse-parser.ts:118-130`.
- A long line arriving in small chunks costs O(n²). It is bounded by the 1 MiB line cap (and the server's 64 KiB);
  keep a scan offset.

## 3. Rulings on D-TASK044-01 .. 13

| ID | Ruling |
| --- | --- |
| 01 Self-contained module, no slot edits | Accepted under the locks; the cost is R1-M1. |
| 02 `private, no-cache, no-store` | Accepted. The value is right and satisfies both AT-01 and SEC-TC-29. The follow-up (keep it through `send()`) is R1-M1 (a) item 1 and needs an owner. |
| 03 30 s cap, the 20 s slot deadline first | The cap is accepted. The follow-up as worded is **not accepted**: raising the deadline collides with `CALL_DEADLINE_MS < DRAIN_TIMEOUT_MS`. It needs the R1-M1 (a) item 2 architect ruling. |
| 04 Ids 1..9999999999, drop at or below the last id | Accepted (overlap-safe replay is good). See R1-n3 and R1-n4. |
| 05 No backpressure | Accepted for M1. Memory is bounded by the 30 s cap, 64 KiB per event and small producers (three carriers; step updates). Name an owner (the `execute.ts` lock holder) for the drain-aware sink before any high-rate producer. |
| 06 Closed key list plus value patterns | The approach is accepted (a suffix rule would refuse `carrier_name` / `service_name`). The implementation needs R1-m2. |
| 07 Catalogue codes `SERVICE_UNAVAILABLE` / `INTERNAL_ERROR` | Accepted, plus R1-n2. See open question 3. |
| 08 Required `onFailure`, a throw in it contained | Accepted. R1-m1 is a separate escape path. |
| 09 One hunk in `problem-handler.ts` | PR44-SEC-13 is closed on this branch: the new AppError carries no cause, detail, errors or retry hint; the revert mutant is killed; the `env=production` `console.error` spy test is good. The union claim needs the R1-m4 hand edit. |
| 10 AT-07 on the `streamBookingProgress` fixture | Accepted. It is the only test consistent with the contract and A-078. See open question 2. |
| 11 Reader in `packages/ui`, exported | Accepted (the card governs); R1-n7. |
| 12 `node:http` instead of Supertest in the helper | Accepted. The helper still validates through `recordContract`, so nothing escapes contract validation. The 1 s close is stall-corrected and pinned by mutant. |
| 13 Fixed 15 s heartbeat from the stream start | Accepted. It satisfies "at least every 15 s"; the unit test pins 15 000 ms exactly. |

## 4. The developer's open questions and the other items

1. **`send()` overwrites the stream `Cache-Control`.**
   - Confirmed by code: `execute.ts:148` and `authorise.ts:102`. It applies to both real stream routes; see R1-M1.
   - Owners: principal-architect and the `execute.ts` lock holder (TASK-040, PR #80), with a security-analyst
     sign-off that "keep a handler value containing `private` and `no-store`" preserves SEC-TC-29.
   - product-manager and api-designer are involved only if option (b) is chosen instead: amend AT-01 and the
     `CacheControl` header text to `no-store`. Not recommended, because the developer's value satisfies both.
2. **AT-US-042-07 expects 401 `AUTH_REQUIRED`, but `streamQuoteResults` answers 404.**
   - The developer's test is correct. The contract gives `streamQuoteResults` no `AUTH_REQUIRED` in `x-error-codes`,
     and A-078 plus §9 "Auth" make a missing or wrong token a 404.
   - product-manager rewords AT-07 into two parts:
     - a session stream without a bearer is 401 `AUTH_REQUIRED` problem+json, not a stream;
     - a quote stream without a token, or with a wrong one, is 404 `NOT_FOUND`, not a stream (A-078).
   - qa-lead aligns the map row (R1-n5). The real `streamBookingProgress` gets its 401 row from the generated RBAC
     matrix once it is mounted.
3. **Catalogue codes vs stream codes.**
   - Reuse is accepted; no new catalogue row is needed (`SseError.code` is syntax-only in the contract).
   - api-designer adds a short closed list to §9: `SERVICE_UNAVAILABLE` (retryable: cap, drain or deadline; resume
     or fall back to `getQuote`) and `INTERNAL_ERROR` (not retryable). Plus R1-n2.
4. **The 20 s slot deadline ends a stream before the 30 s cap, without an error frame.** R1-M1; principal-architect.
5. **No backpressure.** D-TASK044-05 is accepted with an owner.
6. **An error log on every client disconnect after the headers.** Confirmed; R1-m5, owned by the `execute.ts` lock
   holder, due before TASK-091.

## 5. Merge conditions

1. R1-M1 is closed by (a) or (b) in section 2, recorded in `docs/sdlc/DECISIONS.md` with owners and due points.
2. R1-m1, R1-m2 and R1-m3 are fixed on this branch with their regression tests. All three are in TASK-044's own
   files; R1-m1 and R1-m2 are availability and privacy defects.
3. R1-m4: whichever of PR #80 and this PR merges second removes the unused `appError` line and runs lint on the union.
4. R1-m5 and R1-m6 are routed with named owners: the `execute.ts` lock holder; product-manager, api-designer and
   principal-architect.
5. **Lane B: the api suite on the PR head.**
   - Scope: `tests/api/event-stream.api.test.ts`, 9 tests: AT-01..08, with AT-04 and AT-05 in one test, plus the
     resume test and the 400 test. The AT-04/-05 test takes about 30 s; no database is involved.
   - Re-run it on the union after TASK-041 merges: the rate-limit slot, and whether the contract validator then
     requires `RateLimit-*` on the 200 stream.
   - Re-run it after PR #80 merges: the problem-handler union.
   - If R1-M1 takes route (a), lane B re-runs AT-01 and AT-05 on the default composition.
6. **Security record on the head.** The CODEOWNED paths touched are `apps/api/src/platform/sse/**` and
   `apps/api/src/platform/errors/problem-handler.ts` (with its test). The record covers the PR44-SEC-13 closure and
   the security flags below.
7. **Lane A on the PR head:** full lint, format, typecheck, unit, build and diff coverage. I ran targeted gates only.

GOOD: the stream contract is unusually rigorous for a first cut.
- It sends replay before live events, with an overlap-safe id drop.
- Upstream is aborted in the same tick as a client disconnect (the unit test proves it synchronously).
- Refused events are never written.
- `expectEventStream` validates against the real `x-sse-events` schemas with seeded-defect tests and a stall-corrected
  1 s close.
- The PR44-SEC-13 test uses an `env=production` Express app with a `console.error` spy and a revert that turns red.
- Every mutant I tried was killed. Keep the "pure helper plus recorder" split, and the fake-timer tests that pin 15 s
  and 30 s exactly while the HTTP tests only tell "fired" from "hung".

SECURITY-FLAGS (for security-analyst):
- (1) R1-m2: toJSON bypass of the event privacy guard (CWE-359) and a quadratic regex on unbounded input before the
  size cap (CWE-1333, a 64 s event-loop block at 256 Ki characters); key gaps, including the contract's own
  `receiver_name`.
- (2) R1-m1: producer-reachable unhandled rejection becomes a process exit (CWE-248, availability).
- (3) R1-m5: disconnect-driven ERROR logging plus a stderr stack per stream open/close. This is log flooding
  (CWE-779): the concurrency caps do not bound it per unit of time.
- (4) PR44-SEC-13: closure verified on this branch. The PR #80 union needs the R1-m4 edit.
- (5) R1-M1 (a) item 1: a `send()` change that keeps a handler `Cache-Control` must be checked against SEC-TC-29.
