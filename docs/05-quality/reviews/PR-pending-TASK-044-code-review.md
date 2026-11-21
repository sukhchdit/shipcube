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

# Round 2: delta review of part 044-A (`dc64193f..cbd590db`)

| Field | Value |
| --- | --- |
| Part | TASK-044 part 044-A (D-ARCH-217; US-042 partial per D-PM-089) |
| Head reviewed | `cbd590db` (2 commits on round 1's head `dc64193f`: `3b56ab54` fix cycle 1, D-TASK044-14..18; `cbd590db` fix cycle 2, test only, D-TASK044-19) |
| Delta | 12 files, +835/-163. Source: `sse/{event-stream,frame,privacy}.ts`, `packages/ui/src/sse/fetch-sse-parser.ts`, `packages/ui/src/index.ts` (2 constants). Tests: the 4 matching unit suites, `tests/api/event-stream.api.test.ts`, `tests/api/helpers/expect-event-stream{,.test}.ts`. `problem-handler.ts`, `execute.ts`, `define-route.ts`, `route-state.ts`, `app.ts` and `start-api.ts` are unchanged, as D-ARCH-217 requires |
| Reviewer | code-reviewer (Claude Opus 5.5), 2026-11-21 |
| Round | 2 (delta) |
| Developer decisions ruled | D-TASK044-14 .. D-TASK044-19 (commit bodies) |
| Inputs | Round 1 above; D-ARCH-217 to D-ARCH-224 and the rulings file §4, §5 and §8 (TASK-044 card line 2 items (1) to (4)); D-QG-007 (QG-044-C1 closed by D-SD-012 `2f6a89d5`; amendment 14 item 2 VERIFIED); D-PM-089 (`2c913729`; story text and map rows held); security rounds 1 and 2 (D-SECPR044-01/02, `ef446899`); the lane B result on `3b56ab54` (one failure, the malformed `Last-Event-ID` 400 without `private`) |

```
VERDICT: APPROVED_WITH_NITS (conditional on the merge conditions in R2.6)
SUMMARY: Every round-1 finding owned by this branch is closed with a regression test: R1-m1 (guarded outcome
  continuation), R1-m2 (guard on the serialised wire value, linear e-mail pattern, keys completed), R1-m3 (WHATWG id
  buffer), and NITs n1-n4, n6 and n8. Card line 2 items (1)-(3) are in: the error event has no id, a resume test, the
  subscription wording and the header comment. 163/163 unit and 12/12 api tests pass in my extract. Of 14 mutant runs,
  10 are killed, 3 survive by design and 1 is a NIT.
  The cbd590db test-only fix is sound and hides no product gap: on a route with no anonymous member the problem
  handler marks every problem private, and removing that rule turns the problem-handler and declared-credentials api
  suites red. One MINOR (R2-m1): the wrapper's retirement is owned by TASK-141, which does not own the file; it belongs
  to part 044-B.
  PR #80 merged first (763800f3), so R1-m4 is now due on this branch: the union compiles and passes the SSE suites,
  and lint is red on the one unused `appError` line, as predicted.
```

## R2.1 What I verified myself

Everything ran on `git archive` extracts under the session scratchpad (`cr044r2/`). Node 24.22.3. `node_modules` was junctioned to the main checkout. I generated a Prisma client per extract, because main's git-ignored client is stale for `organisations`. A `@platform/prisma` junction points into each copy. `@platform/shared` resolved to main's working tree; its only delta since base is one additive hunk in `classification/registry.ts`. Nothing ran in the TASK-044 worktree. The tests/api buildinfo was redirected out of the junction.

**On `cbd590db`:**
- **Read in full:**
  - the delta (both commits);
  - the commit bodies D-TASK044-14..19;
  - `problem-handler.ts` `isAuthenticatedProblem` / `sendProblem`;
  - `route-state.ts` `declaresPrivateResponse`;
  - `tests/api/helpers/cache-control.ts`, the SEC-TC-29 predicate the validator applies.
- **Typecheck:** `tsc -b --force apps/api packages/ui tests/api`, exit 0. This includes compiling the test wrapper against `PipelineSlots` and `RouteSlot`.
- **ESLint `--max-warnings 0` on the 12 changed files:** clean, apart from the round-1 copy artefact. That artefact is `import-x/no-extraneous-dependencies` on `@platform/shared` in `expect-event-stream.ts:10`. The unchanged `contract-validator.ts` imports the same package. **Prettier `--check`:** clean.
- **Unit suites** (`--maxWorkers=2`): `platform/sse/*`, `fetch-sse-parser`, `expect-event-stream`, `errors/problem-handler`. **7 suites, 163/163 pass.**

  Coverage of the touched files:

  | File | Lines | Branches | Uncovered branch lines |
  | --- | --- | --- | --- |
  | `event-stream.ts` | 100 % | 97.4 % | 162, 234 |
  | `frame.ts` | 100 % | 100 % | none |
  | `privacy.ts` | 100 % | 100 % | none |
  | `fetch-sse-parser.ts` | 100 % | 98.6 % | 193 |
  | `expect-event-stream.ts` | 94.8 % | 94.3 % | not listed |
- **The api suite `tests/api/event-stream.api.test.ts`** (no database; 33.7 s): **12/12 pass.** This is my own check, not lane B evidence. It covers:
  - round 1's 9 tests;
  - the two PR044-SEC-02 rows;
  - the D-ARCH-220 resume test.
- **Mutants: 14 runs (13 mutants; PH runs against two suites), 10 killed, 3 survive by design, 1 survives as a NIT.** Each mutant ran against its own suite and every file was restored byte for byte (`cmp` against the commit). Script: `cr044r2/mutate-cr044r2.mjs`.

  | Mutant | Suite | Result |
  | --- | --- | --- |
  | P-a reader copies the id buffer only when the block has data | reader | killed (1) |
  | P-b reader drops the pending pieces of a line split across chunks | reader | killed (2) |
  | P-c reader data cap `>=` instead of `>` | reader | **survives** (R2-n1) |
  | P-d reader resets the id buffer after dispatch | reader | killed (2) |
  | E-a `outcomeOf` accepts any object | event-stream | killed (2) |
  | E-b `complete` takes the last id instead of plus one | event-stream | killed (4) |
  | E-c a terminal name is accepted as a live event | event-stream | killed (1) |
  | Pv-a party keys holding a string pass | privacy | killed (1) |
  | Pv-b arrays not searched | privacy | killed (3) |
  | PH-a problem handler ignores the route declaration | `problem-handler.test.ts` only | survives (unit suite does not pin it) |
  | PH-b the same mutant | `problem-handler.api` + `declared-credentials.api` | **killed (3)**: the product rule is pinned in the api project |
  | W-a the cbd590db wrapper does not mark the refusal private (the `3b56ab54` composition) | event-stream api, 400 test | killed (1): reproduces the lane B failure |
  | W-b the wrapper only on the `validate` step | event-stream api | survives (expected: the step list is wider than this suite needs) |
  | W-c the product rule removed, wrapper kept | event-stream api, 400 + AT-07 | survives (expected: the fixture is anonymous, so this suite cannot see the product rule) |

  The security round ran 15 further mutants against `3b56ab54`, all killed. Mine do not repeat them.

**On the union with main** (`git merge-tree --write-tree main cbd590db` = tree `8d53a3dc`; main `a47d6966` carries PR #80 as `763800f3`):
- **Overlap:** the only file changed on both sides since the merge base `530629f4` is `problem-handler.ts`. It merges cleanly as text.
- **Typecheck** of api, ui and tests/api: exit 0.
- **Unit and api suites:** the SSE unit suites, `problem-handler` (unit and api) and `event-stream.api.test.ts` give **9 suites, 237/237 pass**.
- **ESLint on the union `problem-handler.ts`:** `109:13 'appError' is assigned a value but never used`. That is R1-m4 exactly, and nothing else.

**Not run, per the dispatch and the host rule:**
- lane B;
- the full `lint`, `typecheck`, `test:unit` and `build`;
- coverage merge;
- Docker.

Lane B on `cbd590db` is queued.

## R2.2 Closure of round 1

| Finding | Status at `cbd590db` | Evidence |
| --- | --- | --- |
| R1-M1 | **Closed by ruling** | D-ARCH-217: part 044-A/044-B split with content (a) in part 044-B (D-ARCH-218/219/221/223), recorded by product-manager in D-PM-089; the header comment of the api test names AT-US-042-01 and -05 as proven in a test composition (card line 2 item (3)) |
| R1-m1 | **Closed** | `settle` wraps `end` (`event-stream.ts` `settle`); `outcomeOf` checks the shape; `send` catches an accessor throw. Unit rows: `undefined`, `null`, `{}`, `42`, a string, a throwing getter (8 rows). Mutant E-a killed; security probe R3 proved no unhandled rejection and no exit on the real `createApp` |
| R1-m2 | **Closed** (residual PR044-SEC-08, INFO, part 044-B) | `frameOf` serialises once with the 64 KiB cap, frames, then scans `JSON.parse(json)`. The e-mail pattern `/[^\s@]@[^\s@]+\.[^\s@]/` accepts the same strings as the old one (fast-check oracle) and is linear. Keys added (`receivername`, `personname`, `streetline(s)`, `address`, `address1..3`, `username`, `surname`, `mail`, `tel`, `ip`, `ipaddress`); party keys holding a string. A key that is an e-mail or phone is reported as `<parent>/*`. Api rows `toJson` and `emailKey`. Mutants Pv-a, Pv-b killed |
| R1-m3 | **Closed** | `idBuffer` copied to `lastEventId` at every blank line, also without data; truncated-block tests in the parser and in `readEventStream`. Mutants P-a, P-d killed |
| R1-m4 | **Open, now due on this branch** | PR #80 merged first (`763800f3`). This branch is the second merger: see R2.6 item 1 |
| R1-m5 | **Routed** | D-ARCH-221 / ADR-0003 rule (p): part 044-B (B5, proof (g)), before TASK-141 is dispatched. The owner is no longer "the lock holder" in general |
| R1-m6 | **Routed** | D-ARCH-222 (architecture text) and D-PM-089 (REQ-API-018, AT-US-042-06 retitled "Client abort releases the stream", new AT-US-135-13). The module comment item 7 and the AT-06 fixture now say "subscription" (card line 2 item (2)). The story text and map rows are held: R2.6 item 5 |
| R1-n1 | Closed | `readEventStream` cancels the body on a parser or handler throw (unit test with a recording `cancel`) |
| R1-n2 | Closed | `errorCodeOf`: syntax plus `isErrorCode`; see R2-n3 for the silent rewrite |
| R1-n3, R1-n4 | Closed as guidance | Module comment, "For the stream routes"; the cards of TASK-141 and TASK-173 carry them (D-SD-012) |
| R1-n5 | Routed | D-PM-089 map rows (AT-US-042-07 suite `api`), held with the story text |
| R1-n6 | Closed | The booking fixture is built with `defineRoute` and its declared type; no cast |
| R1-n7 | Open (api-designer) | api/README §17 still names `packages/shared/src/api/sse.ts`; due at the api-designer fold (rulings §6 rides part 044-B) |
| R1-n8 | Closed | Only the new chunk is scanned; pending pieces joined once per line. Security: 1,000,000 one-character chunks in 116 ms (round 1: 11 s at 32 Ki) |

Card line 2 of the rulings: (1) error without an id: done, with unit, reader, helper and api pins, and the resume test; (2) subscription wording: done; (3) header comment: done; (4) the R1-m4 union edit: due now (R2.6 item 1). The merge condition for item (1), the gatekeeper's verification of ADR-0016 amendment 14 item 2, is **met** by D-QG-007.

## R2.3 The cbd590db fix: sound test-only fix, not a masked product gap

**What failed.**
- Lane B on `3b56ab54` failed one test: the malformed `Last-Event-ID` gives a 400 whose `Cache-Control` is `no-store` without `private`.
- The contract validator applies SEC-TC-29 from the operation's effective `security`. `streamQuoteResults` is `[bearerAuth]` or `[quoteToken]`, with no anonymous alternative, so every one of its responses must carry `private, no-store` (`cache-control.ts:130`).
- The fixture route declares `auth: 'anonymous'` (D-ARCH-218 is part 044-B, so today a non-anonymous stream would get `private, no-store` from `send()`).
- The problem handler decides privacy from the route descriptor (`problem-handler.ts:95-97`; `route-state.ts:135-140`). For the anonymous fixture it answers `no-store`.

**Why it is not a product gap.**
- A real `streamQuoteResults` route carries the contract's auth set, which has no `anonymous` member.
- For such a route, `declaresPrivateResponse` returns true and every problem is `private, no-store`, whatever step refuses.
- That rule is pinned: mutant PH-b (remove it) turns `problem-handler.api.test.ts` and `declared-credentials.api.test.ts` red (3 failures).
- The divergence is the fixture's auth declaration, not the pipeline.

**Why the wrapper is acceptable.**
- It changes only error paths of six pre-execute steps, and only for `operationId === 'streamQuoteResults'`.
- The stream itself and the booking fixture keep the default slots.
- The step names are typed against `PipelineSlots`, so a rename fails `tsc`.
- A changed `operationId` silently drops the wrapper, but then the same 400 test goes red again. The failure mode is loud.
- W-a reproduces the lane B failure, so the fix addresses exactly the observed cause.

**The latent since `dc64193f` claim holds.** The test, the fixture, the problem handler, the slots and the contract are byte-identical between `dc64193f` and `3b56ab54`. In round 1 I did not run the api suite (lane B was pending) and did not catch it.

**What it costs.** See R2-m1.
- The new assertion in the 400 test (`private`, `no-store`) is produced by the test's own wrapper. In this composition it pins the wrapper, not SEC-TC-29; the comment "SEC-TC-29: a problem of an operation with no anonymous alternative is never stored" overstates it.
- The commit gives the retirement to TASK-141. TASK-141 mounts the real route in its own module and does not own `tests/api/event-stream.api.test.ts`; nothing on its card mentions the wrapper.

## R2.4 Findings (new in round 2)

### MINOR

**R2-m1: the test-only refusal wrapper has no real retirement owner, and its assertion is circular.**

Where:
- `tests/api/event-stream.api.test.ts:190-222` (`PRE_STREAM_STEPS`, `privateRefusals`);
- `:278-280` (the new assertion);
- `:1-12` (the header comment, which lists the anonymous fixture and the 40 s deadline but not this third divergence).

What happens:
- The wrapper re-implements a product rule (problem privacy from the declared auth set) inside a binding lane-B acceptance suite.
- Commit `cbd590db` says TASK-141 drops it. TASK-141 does not own the file, and no card line says so.
- The anonymous quote fixture exists only because of the `send()` gap that part 044-B closes (B1). The file is a part 044-B file (card line 4).
- Without an owner, the wrapper outlives its reason. The 400 test then keeps asserting a header the test itself sets.

Fix:
- **senior-developer** adds a part 044-B card line: once B1 is in, give the quote fixture its contract auth set (`session` + `quote-token`, with the authn test seam of proof (a)), delete `privateRefusals` and `PRE_STREAM_STEPS`, and keep the 400 test's `private, no-store` assertion. It then proves SEC-TC-29 through the product rule.
- **On this branch (optional, can ride the R1-m4 merge commit):** one sentence in the header comment naming the wrapper as the third test-composition divergence, retired by part 044-B; and reword the 400 test comment to "the test composition restores the product rule; see the wrapper".

### NIT

**R2-n1: the reader's per-event data cap boundary is unpinned.**
- Where: `packages/ui/src/sse/fetch-sse-parser.ts:89`.
- Mutant P-c (`>=` for `>`) survives. The test uses cap 8 with 9 characters.
- Fix: add a row with exactly `maxLength` accepted and one more refused.

**R2-n2: `outcomeOf` says it reads `event` once, but `end` reads `outcome.event` again.**
- Where: `apps/api/src/platform/sse/event-stream.ts` (`outcomeOf` JSDoc; `end`, `if (outcome.event === 'error')`).
- A getter that changes value between the reads lands in the other branch. Both branches are guarded, so it is harmless, but the comment is wrong.
- Fix: return the read `event` with the outcome, or drop "reads `event` once".

**R2-n3: a non-catalogue error code is rewritten silently.**
- Where: `errorCodeOf` / `end`.
- An `error` outcome whose code is not in the catalogue is sent as `INTERNAL_ERROR`, and `onFailure` hears nothing. A producer defect such as `CARRIER_BUSY` is then invisible in the route's logs.
- Fix, owner part 044-B (holds `api-sse`): report `producer_failed` with an `SseOutcomeError` naming the rejected code's syntax class, not its text, or document the rewrite in the module comment.

**R2-n4: little headroom in the linear-time pin.**
- Where: `privacy.test.ts:137-157`.
- A linear scan gives about 16 against a bound of 32 (quadratic about 256), measured on sub-millisecond timings. The best-of-7 makes a flake unlikely, but lane A runs workers in parallel.
- If it ever flakes, replace it with counted work (R1's suggestion) rather than widening the bound.

**R2-n5: the AT-US-042-07 test title still says "without a bearer token or quote token".**
- D-PM-089 makes AT-07 the bearer-only case (the 404 of the quote stream is AT-US-135-06), and the fixture is `session` only.
- product-manager accepted the tests as built, so this is optional.
- Fix: part 044-B may drop "or quote token" from the description and keep the ID.

## R2.5 Rulings on D-TASK044-14 .. 19

| ID | Ruling |
| --- | --- |
| 14 The `error` event has no id | **Accepted.** Matches D-ARCH-220 and ADR-0016 amendment 14 item 2, which D-QG-007 verified. `complete` keeps last + 1. The helper refuses an id on `error` and a missing id elsewhere. The resume test delivers 2, 3 and `complete` 4 from resume point 1. E-b killed; security M5/M12 killed |
| 15 Guard on the wire value | **Accepted.** One serialisation (the `SseJson` brand makes `formatSseFrame` take only capped text), parse, then scan. The pattern is the same language as before (security: 0 differences over 2.4 M exhaustive strings). The closed key list stays closed, which is right. Residual PR044-SEC-08 is routed to part 044-B |
| 16 One guarded continuation | **Accepted.** `settle` plus `outcomeOf` plus a non-throwing `send`. The catalogue check is R1-n2. R2-n2 and R2-n3 are NITs. The replay-iteration residual PR044-SEC-09 goes to part 044-B (B4 rewrites the replay start) |
| 17 WHATWG id buffer and reader bounds | **Accepted.** P-a, P-b and P-d killed; R2-n1 is the one boundary gap. The `retry` clamp of 1..60 s is a sensible client policy |
| 18 Test method | **Accepted.** The ratio pin has R2-n4 as a watch item. The `unhandledRejection` spy limitation in Jest is accepted: the hook-settles assertion plus security's process-level probe R3 on the real `createApp` (no exit request, no fatal line) cover it |
| 19 The test-only private-refusal wrapper | **Accepted as sound** (R2.3): it hides no product gap. The retirement owner is wrong (R2-m1) |

## R2.6 Merge conditions (replace round 1's §5)

1. **R1-m4, now on this branch.** PR #80 is on main (`763800f3`, main `a47d6966`).
   - Merge main into the branch and delete the unused `const appError = …` at the union's `problem-handler.ts:109`.
   - Run lint on the result.
   - My union tree `8d53a3dc` shows this is the only red, and that the typecheck and 237 SSE/problem-handler tests pass.
   - The merge must be a pure union except for that one line. I verify it in a merge-only round: merge-tree identity, the one-line hand edit, and file-set conservation.
2. **Lane B on the final post-merge head**, not only on `cbd590db`.
   - `tests/api/event-stream.api.test.ts`: 12 tests, each in the JUnit by title (round 1's 9, the two PR044-SEC-02 rows, the D-ARCH-220 resume).
   - The api suites that cover the union `problem-handler.ts`: `problem-handler.api`, `declared-credentials.api` and `idempotency.api`.
   - The queued run on `cbd590db` is a useful early signal. It does not replace this.
3. **Lane A on the final head:** full lint (closes R1-m4), format, typecheck, unit, build and diff coverage.
4. **Security merge-only round on the post-merge head.** `problem-handler.ts` is owned and changes through main, which voids the round-2 binding (security R2.6 C4, R2.9 C6). `cbd590db` itself changes only the unowned `tests/api/**`, so the binding to `3b56ab54` holds until that merge.
5. **D-PM-089's held text lands on main before the merge.**
   - What: the US-042 story text (a), with the qa-lead map rows of AT-US-042-06 ("Client abort releases the stream") and AT-US-042-07 (suite `api`; closes R1-n5).
   - Why: this is QG-044-C2 (f).
   - quality-gatekeeper then closes QG-044-C2. The traceability and STATUS rows (REQ-API-017/018 partial, US-042 partial) go with senior-developer's fold, per D-PM-089.
6. **R2-m1:** the part 044-B card line for the wrapper's retirement (senior-developer). The two comment edits are optional on this branch.
7. **Already met:**
   - R1-M1, by ruling (D-ARCH-217, D-PM-089);
   - the merge condition of card line 2 item (1), by D-QG-007;
   - R1-m5 and R1-m6 have owners (part 044-B B5; D-ARCH-222 with D-PM-089);
   - QG-044-C1, by D-SD-012.
8. **Carried to part 044-B (not conditions of this merge):**
   - PR044-SEC-08 and PR044-SEC-09 (security F6/F7);
   - R2-n3;
   - R1-n7 (api-designer, with the rulings §6 texts);
   - proofs (a) to (i);
   - security G1 (the five conditions).

GOOD:
- The fixes go to the root, not around the probes. One serialisation feeds both the wire and the guard, so `toJSON`, getters and size can never disagree. The `SseJson` brand makes the order a type rule.
- The guard's pattern change was proven equivalent by an oracle, not argued.
- The id-buffer fix follows WHATWG to the letter (copy at every blank line, buffer persists), with truncation tests in both the parser and `readEventStream`.
- The D-ARCH-220 change came with a real resume test over HTTP, not only a frame assertion.
- For the lane B failure, the developer:
  - located the cause precisely (fixture auth versus contract security, latent since `dc64193f`);
  - kept the product code untouched;
  - limited the shim to one operation and its error paths;
  - documented why.

SECURITY-FLAGS (for security-analyst):
- (1) R2.3: the `cbd590db` wrapper is test-only and marks responses more private, never less. No product path changes. The product rule it stands in for is pinned by api suites (PH-b killed).
- (2) Merge condition 4: the post-merge head voids the round-2 binding through `problem-handler.ts`. The R1-m4 deletion is the only hand edit expected.
- (3) R2-n3: the silent rewrite of a non-catalogue `error` code leaves no log trace of a producer defect (part 044-B, with PR044-SEC-08/09).

# Round 3 (merge-only): union head `33262314`

| Field | Value |
| --- | --- |
| Part | TASK-044 part 044-A (D-ARCH-217; US-042 partial per D-PM-089) |
| Head reviewed | `33262314` (local, unpushed): merge `c33e5e92` (parents `cbd590db` = round 2's head, `4ba683ad` = main with #80 to #84, #49 and #50) plus `33262314`, the R1-m4 one-line deletion |
| Merge base | `530629f4` |
| Reviewer | code-reviewer (Claude Opus 5.5), 2026-11-21 |
| Round | 3 (merge-only; git, grep and reads only per the dispatch, no npm, no Docker) |
| Inputs | Round 2 above (R2.6 item 1); D-ORCH-163 (union proof rule); D-ORCH-167 |

```
VERDICT: APPROVED (merge-only round; the round-2 APPROVED_WITH_NITS items are carried unchanged)
SUMMARY: The merge is a pure git union. c33e5e92's tree equals `git merge-tree --write-tree cbd590db 4ba683ad`
  (1cb6c882), and the raw diff 4ba683ad..33262314 equals the branch's own diff 530629f4..cbd590db on all 18 paths
  except the one shared file, problem-handler.ts. That file keeps main's renderProblem and pre-rendered path and the
  branch's `next(new AppError(code))`. 33262314 deletes exactly the unused `appError` binding (R1-m4), and no
  reference remains. No new findings. Lint, typecheck and the suites on 33262314 are owed to lane A/B, not claimed here.
```

## R3.1 What I verified myself

Everything ran on commits by SHA in the TASK-044 worktree's object store. Nothing was checked out, built or run.

1. **Parents and base.** `c33e5e92^1 = cbd590db` (round 2's reviewed head, unchanged) and `c33e5e92^2 = 4ba683ad` (an ancestor of `origin/main`). The merge base is `530629f4`. `33262314` has the single parent `c33e5e92`.
2. **Merge-tree identity.** `git merge-tree --write-tree cbd590db 4ba683ad` = `1cb6c8829a90` = `c33e5e92^{tree}`. Git merged without a conflict and the merge commit has no hand edit.
3. **File-set partition.** The branch side `530629f4..cbd590db` has 18 paths and the main side `530629f4..4ba683ad` 295. They overlap in one path only: `apps/api/src/platform/errors/problem-handler.ts`.
   - Branch-only, 17 paths: `git diff cbd590db c33e5e92` over them is empty. Nothing from the branch is lost.
   - Main-only, 294 paths: `git diff 4ba683ad c33e5e92` over them is empty. Nothing from main is dropped.
   - No path outside both sets differs between `4ba683ad` and `c33e5e92`.
4. **Conservation (D-ORCH-163 form).** `git diff --raw 4ba683ad 33262314` equals `git diff --raw 530629f4 cbd590db` line for line: the same 18 paths, status letters and blobs. The one exception is the `problem-handler.ts` row (`c2d503e4 -> 3305466c` against `5cc78bdb -> b1850807`), which is the listed union.
5. **The shared file, by hand.**
   - Main's side (TASK-040, #80): removes `ErrorCode`, `classifyThrown`, `Classified`, `buildProblem` and the local `codeOf`; imports `isRenderedProblem` and `renderProblem`; adds the pre-rendered 4xx branch (`isRenderedProblem(thrown) && !res.headersSent`); and replaces the inline classify-and-build with `renderProblem`. `codeOf` moved verbatim into `rendered-problem.ts`, so `code` has the same value as before.
   - The branch's side (PR44-SEC-13): the `res.headersSent` branch passes `new AppError(code)`, with the three-line comment.
   - The union (`4ba683ad..c33e5e92`) is exactly the branch's hunk applied to main's file. `problem-handler.ts` at `c33e5e92` is byte-identical to the union I linted in round 2 (tree `8d53a3dc`). There the only ESLint error was `'appError' is assigned a value but never used`.
6. **The R1-m4 deletion.** `c33e5e92..33262314` removes one line in one file: `const appError = classified.kind === 'app' ? classified.error : undefined;`. At `33262314`:
   - `appError` occurs nowhere in the file (grep).
   - `classified` is still read (`retryAfter`, the `db` and `app` arms). `code` is read by the log, by `next(new AppError(code))` and by `markErrorResponse`. `AppError` is still imported and used.
   - No import became unused, because main had already dropped `ErrorCode`, `classifyThrown` and `buildProblem`.
   - So round 2's lint result plus this deletion predicts a clean ESLint run on the file. Lane A confirms it.
7. **Behaviour through the union.**
   - An `AppError` thrown after headers are sent: main would have passed the original instance. The union passes a new code-only `AppError` with the same `code`. That is the PR44-SEC-13 rule, which the branch's unit test pins, including the `console.error` spy.
   - A `RenderedProblemError` thrown after headers are sent skips the pre-rendered branch (`!res.headersSent`), is classified as before and leaves as a code-only `AppError`. No stored body or cause reaches Express's final handler. For non-`AppError` values this is identical to main (`new AppError('INTERNAL_ERROR')` both ways).
   - No main-side test asserts the identity of the value handed to `next` after headers are sent. I grepped every main-changed `*.test.ts` for `headersSent`, `problemHandler` and `headers_sent`, with no hit. The only `problemHandler(` call site is `app.ts:218`, which the branch does not change.
8. **Semantic cross-checks against #80 to #84** (no text overlap; read by hand). The branch's files import `createApp`, `defaultPipelineSlots` and `PipelineSlots`, `RouteSlot`, `markPrivateResponse`, the routing test helpers and `@platform/shared`. Main changed `app.ts`, `pipeline.ts` and `packages/shared/src/index.ts`:
   - Every addition is optional: `AppDependencies.trustProxyHops` and `rateLimit`, `AppLogger.warn`, and `PipelineOptions.rateLimit`, `valkey`, `denial*` and `onStoreUnavailable`. The `PipelineSlots` keys are unchanged, so `PRE_STREAM_STEPS` still type-checks against them.
   - `tests/api/event-stream.api.test.ts` calls `createApp` without `apiMode: 'live'` and without `rateLimit`. So `RateLimitMissingError` cannot fire, step 0 is the pass-through `ipLimiter(undefined, …)`, and the stream suite does not meet #82's per-IP budget.
   - The shared index change is additive (carrier vocabularies, TASK-080).
   - The only ESLint config change on main is `tools/eslint-rules/pricing-purity.mjs`, which is scoped to pricing.
9. **Current `origin/main` (`23792cbd`).** It is 5 docs-only commits past `4ba683ad`: agent memory, architecture docs, security records and DECISIONS.md. None touches a branch path. `git merge-tree --write-tree 33262314 origin/main` is clean (`92ef63a2`). The review does not need a re-merge.
10. **Commit messages.** Both name the union, the shared file and R1-m4 accurately. The merge body's list (#80 to #84, #49, #50) matches `git log 530629f4..4ba683ad`.

**Not run, per the dispatch:** lint, format, typecheck, unit, api, build, coverage and Docker. Item 6 is a static prediction from round 2's measured lint of the identical union file, not a lint result.

## R3.2 Findings

None new.

Carried unchanged, because the branch's 17 other files are byte-identical to `cbd590db`:
- R2-m1, with its part 044-B card line. The two optional comment edits were not taken, which is allowed.
- R2-n1 to R2-n5 and R1-n7.
- The part 044-B carry list of R2.6 item 8.

## R3.3 Merge conditions (replace R2.6)

1. **R1-m4: closed** on `33262314`, subject to the full lint of item 2.
2. **Lane A on `33262314`:** full lint, format, typecheck, unit, build and diff coverage. The pushed head may be used instead if it differs only by a docs-only merge of `origin/main`. The typecheck matters more than usual: #84 bumped 28 packages, and round 2's typecheck ran on main `a47d6966`, before #81 to #84.
3. **Lane B on `33262314`** (D-ORCH-163, running):
   - `tests/api/event-stream.api.test.ts`, 12 tests, each by title;
   - `problem-handler.api`, `declared-credentials.api` and `idempotency.api`, because the union `problem-handler.ts` is on their paths.
4. **Security merge-only round on `33262314`.** Security R2.6 C4 and R2.9 C6 apply, because `problem-handler.ts` changed through main.
5. **D-PM-089's held US-042 text and map rows on main** (QG-044-C2 (f)), unchanged from R2.6 item 5.
6. **R2-m1's part 044-B card line** (senior-developer), unchanged.

If the pushed head is a further merge of `origin/main`, the same proof applies. Its tree must equal `merge-tree`. `git diff --raw origin/main <head>` must equal `git diff --raw 530629f4 cbd590db`, except the `problem-handler.ts` row, whose blob must stay `3305466c`.

GOOD:
- The merge commit is a pure git union, and the hand edit is a separate one-line commit. Each can be proven on its own: merge-tree identity, then a one-line diff.
- Both commit bodies say exactly what the union kept from each side and why the line goes.

SECURITY-FLAGS (for security-analyst):
- (1) `problem-handler.ts` at `33262314` (blob `3305466c`): PR44-SEC-13's code-only `AppError` and TASK-040's pre-rendered path coexist. A `RenderedProblemError` thrown after headers are sent leaves as `new AppError('INTERNAL_ERROR')`, so its stored body and cause do not reach `console.error` (R3.1 item 7).
- (2) The event-stream api suite runs without the #82 rate-limit kit (a test composition with a pass-through step 0), as do the other test compositions. Nothing in this union changes that.
