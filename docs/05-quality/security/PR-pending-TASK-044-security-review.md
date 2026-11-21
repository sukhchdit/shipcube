# PR-pending: TASK-044 (server-sent events convention: framing, Last-Event-ID, the payload privacy guard, the event-stream hook, the fetch reader; the PR44-SEC-13 fix), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-044-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's checker does not count a `PR-pending-*` name (simulation C2 in §8).

**Finding IDs.** `PR044-SEC-nn` are the findings of this task (TASK-044), not findings of PR #44. `PR44-SEC-13` (no zero) is the PR #44 (TASK-020 part 020-C) finding that this task closes.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-044-server-sent-events-convention` on base `530629f4`: `456ee228` (PR44-SEC-13 fix), `4e845bdc` (SSE module and fetch reader), `dc64193f` (`expectEventStream` helper and the US-042 api tests) |
| Head | dc64193fcb15e7c3e5dd94995d5f470e3880462e |
| Merge base with main | `530629f4`. Main's tip when this round was written: `74536b8e` (it carries the code review twin `7ed51854`). `530629f4..74536b8e` changes nothing outside `docs/` and `.claude/agent-memory/`; `git merge-tree --write-tree` of `74536b8e` and `dc64193f` is clean |
| Lane A evidence | None: the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs --base 530629f4 --head dc64193f`) gives `security_paths=true` (10 paths), so the hosted `security-integration` job runs on the PR |
| Lane B evidence | None yet. `tests/api/event-stream.api.test.ts` compiles (code review §1) and runs only in lane B |
| Owned paths changed | 11, as main's checker counts them (`--base 530629f4 --head dc64193f --pr 9999`, no record: `missing`): `apps/api/src/platform/errors/problem-handler{,.test}.ts`, `apps/api/src/platform/sse/{event-stream,frame,last-event-id,privacy}{,.test}.ts`, `tests/api/helpers/contract-validator.ts`. Not owned, reviewed: `packages/ui/src/sse/fetch-sse-parser{,.test}.ts`, `packages/ui/src/index.ts`, `tests/api/event-stream.api.test.ts`, `tests/api/helpers/expect-event-stream{,.test}.ts`, `tests/api/helpers/expect-contract.ts` |
| Unowned paths read | `apps/api/src/platform/tx/{execute,abortable}.ts`, `apps/api/src/platform/routing/define-route.ts`, `apps/api/src/platform/runtime/process-errors.ts`, `apps/api/src/app.ts`, `packages/shared/src/errors/app-error.ts`; Express 5.3.0 `lib/application.js` (`logerror`) and finalhandler 2.1.1; TASK-041 at `0614a90f` (`rate-limit/policy.ts` `streamSlotRule`, `rate-limit/limiter.ts` `acquire`/`release`); TASK-040 v2 at `0f0d92a0` (`problem-handler.ts` union) |
| Binding items checked | Brief `docs/04-plan/briefs/TASK-044.md` and its card; US-042 and AT-US-042-01..08; api/README §7 (stream caps), §9, §16 item 4, §17; `openapi.yaml` `streamQuoteResults`, `streamBookingProgress`, `LastEventId`, the `Sse*` schemas; ADR-0016 item 10 and amendments 3 and 9; ADR-0010 item 5; threat model T-47, AC-46, SEC-TC-26, SEC-TC-29, SEC-TC-42; PR44-SEC-13 (record `PR-0044-TASK-020C-security-review.md` R2, D-SEC-PR44-02 / D-ORCH-076); D-TASK044-01..13 (commit bodies); code review round 1 `docs/05-quality/reviews/PR-pending-TASK-044-code-review.md` (`7ed51854`, CHANGES_REQUESTED) and its security flags |
| Reviewer / date | security-analyst, 2026-11-21, round 1, pre-push. Host rule: foreground commands only, each at most 8 minutes, no Docker, nothing run in the TASK-044 worktree (git reads used the shared object store from the main checkout; every probe ran on `git archive` extracts of `dc64193f` and `530629f4` in the session scratchpad) |

## 1. Summary

The framing holds: no event name, id, comment or data value can start a field or a frame of its own, `Last-Event-ID` is parsed to its contract pattern and nothing else, the stream sends nothing after `complete` or `error`, the upstream signal aborts in the same tick as a client disconnect, and **PR44-SEC-13 is closed**: on the real `createApp` under `env=production`, a server-only cause thrown after the headers reaches the structured log line only, never Express's `console.error` (the base `530629f4` prints it, the head does not).

The payload privacy guard is the weak part, and it is weak in two directions:

- **PR044-SEC-01 (MEDIUM, CWE-1333).** The guard's e-mail value pattern is quadratic and runs on every string of an event before the 64 KiB cap. One 64 KiB string without white space blocks the API's event loop for 6 to 9 s on this host (16 KiB: 0.7 s; 128 KiB: 36 s), and a replayed event is re-scanned on every stream open. A language-equivalent linear pattern is given and proven (§4).
- **PR044-SEC-02 (LOW, CWE-359) = code review R1-m2, widened.** The guard checks the live object, not what is sent: a `toJSON` result, an e-mail used as an object key and a list of common key spellings (`address`, `surname`, `username`, `receiver_name` …) all reach the wire.
- **PR044-SEC-03 (LOW, CWE-248) = R1-m1.** A producer that resolves with no outcome, or a throwing accessor in `complete` data, becomes an unhandled rejection; the API's process handler exits the replica.
- **PR044-SEC-04 (LOW, CWE-779) = R1-m5.** Every client disconnect and every slot-deadline cut after the headers writes an ERROR line and a 17-line stack to stderr (probed: 10 disconnects, 10 ERROR lines, 10 stderr dumps).
- **PR044-SEC-05 (LOW, CWE-770).** The stream concurrency caps (T-47) have no consumer yet: the module offers no end hook, TASK-041's slot functions are unused, and the booking-stream task's card has no cap line.
- **PR044-SEC-06 (INFO, CWE-770).** The fetch reader caps a line but not an event: 100,000 `data:` lines made one 100-million-character event; plus the rescan, `retry` and cancel items of R1-n8 and R1-n1.
- **PR044-SEC-07 (INFO, CWE-639/CWE-200).** Replay and resume conditions for the stream routes (TASK-141, TASK-173), folding R1-n3 and R1-n4.

Verdict: **PASS_WITH_CONDITIONS.** No Critical or High finding; one MEDIUM. Merge conditions C1 to C3 (§6): PR044-SEC-01, -02 and -03 are fixed on this branch (all three are in this task's own files and are the code review's merge condition 2), checked in a security delta round on the fix head, and lane B is green there.

## 2. Method and evidence

All probes are single-process Node 24.22.3 scripts on `git archive` extracts (`dc64193f`; `530629f4` for the positive controls) with a `node_modules` junction to the main checkout, run through `tsx` with the `@platform/source` condition. Main's code equals the base (`530629f4..74536b8e` is docs only), so `@platform/*` resolve to the base sources the PR builds on.

| Probe | What | Result |
|---|---|---|
| P1, real app | `createApp` + `defaultPipelineSlots` with the default platform logger on stdout (captured), Express `env=production`, `console.error` captured, `unhandledRejection` recorded; fixture stream routes built with the PR's `eventStream`; slot deadline 1.5 s standing in for 20 s; raw `node:http` clients. Run on the head, and with the app of `530629f4` as the positive control (the SSE module is the head's in both) | S1 disconnect, S2 deadline, S3 undefined outcome, S4 after-headers `AppError` cause, S5 `Last-Event-ID: 9999999999`, S7 headers, S8 ten concurrent streams; §3 and §4 |
| P2, pure parts | Framing fuzz and round trip through the PR's own parser; event-name and comment refusal; `Last-Event-ID` schema and reader; 22 privacy-guard shapes; regex timing; reader bounds | §3, §4 |
| P3, regex fix | Exhaustive and random equivalence of the proposed linear e-mail pattern with the head's pattern; timing of both on five adversarial families | §4 PR044-SEC-01 |
| P4, reader | One event built from 100,000 `data:` lines; control: one line above a 4,096 cap is refused | §4 PR044-SEC-06 |
| Gitleaks | Faithful v8.30.1 emulation (no generic digit check, per-hunk fragments, repo allow-lists from main), `git log -p -U0 --diff-merges=first-parent 530629f4..dc64193f`, runtime positive controls `1,1,0` | 2,152 added lines, **0 findings** |
| Unions | `git merge-tree --write-tree` of the head with `74536b8e`, TASK-040 v2 `0f0d92a0` (PR #80) and TASK-042 `b8ba7788` | All clean. The PR #80 union (tree `5eac837a`) keeps `next(new AppError(code))` on the after-headers path; it needs the R1-m4 lint edit |
| Record binding | Main's real `check-security-owned-paths.mjs` in a sparse shared clone, plumbing scenarios in merge-ref form | §8 |

Not run: Docker, the api suite (lane B), lint, typecheck and the unit suites (the code review ran the unit suites, 101/101, typecheck and ESLint on the same head, and killed 14 of 14 mutants including the PR44-SEC-13 revert).

## 3. What holds

- **PR44-SEC-13 closed** (`problem-handler.ts:138-143`). P1 S4: a replayed event whose data getter throws `AppError('INTERNAL_ERROR', { cause })`, the cause text holding a random e-mail address and a random token. On the head, Express's `console.error` receives `AppError: INTERNAL_ERROR` and its stack only: no e-mail, no token, no `[cause]`. On `530629f4` all three are printed (positive control). The structured `http.request_failed` line keeps the cause through the platform logger, with the e-mail redacted and the plain token kept, which is the intended "redacted cause in the server log". The new `AppError(code)` carries the catalogue title as detail and no `errors`, `cause` or `retryAfterSeconds`. The unit test asserts the same through `util.inspect` and an `env=production` Express app; the code review killed the revert mutant. The PR #80 union keeps the line.
- **Framing** (`frame.ts:44-66`). P2 A1: 20,000 random events whose keys and values mix CR, LF, U+2028, U+2029, U+0000, lone surrogates, BOM, NEL, tab, `data:`, `event: x`, `id: 9` and quotes: every frame matches `id: <n>\nevent: <name>\ndata: <one line>\n\n`, and all 20,000 round-trip exactly (id, name, JSON data) through the PR's parser under random chunking. Control: a raw CR inside a data line does split the event in the same parser. A2: of 196,497 event names with one non-`[a-z0-9_]` code unit (every BMP unit, appended, prepended, inside), 0 are accepted; `complete\n`, `a\nid: 5`, `a\r`, `a b` are refused. A3: comments with CR or LF are refused. The `error` frame is built from a pattern-checked code and the JSON-encoded correlation ID, so it cannot be refused or injected.
- **`Last-Event-ID`** (`last-event-id.ts`). P2 B1: `0`, `1`, `0000000001` and `9999999999` are accepted (as 0, 1, 1, 9999999999); empty, 11 digits, ` 1`, `1 `, `+1`, `1e3`, `0x10`, the full-width digit, `1,2` (a repeated header as Node joins it), `1` + NUL and an Arabic-Indic digit are 400 at the schema. `lastEventIdOf` re-checks the pattern, so a route that forgets the schema gets no resume point rather than a number. The module refuses a resume point outside 0..9999999999 when the route builds the stream (inside the handler transaction, so it rolls back).
- **Ordering and termination** (`event-stream.ts`). Ids strictly increase; an id at or below the resume point or the last sent id is dropped, so overlapping replay and live events cannot repeat; producers cannot send `complete` or `error` as live events; nothing is written after the terminal frame (`ended` guards the heartbeat and `send`); `finish` aborts the producer's signal. P1 S1: the client's disconnect aborted the upstream signal (`upstreamAborted=1`).
- **Headers.** P1 S7 on an anonymous fixture: `Cache-Control: private, no-cache, no-store`, `Content-Type: text/event-stream; charset=utf-8`, `X-Accel-Buffering: no`. On a private response `send()` re-asserts `private, no-store` (code review R1-M1): still `no-store`, so nothing becomes cacheable either way. The API mounts no response compression. (`X-Content-Type-Options` is absent on every route response; platform-wide and pre-existing, not this PR.)
- **Containment of the producer.** A producer rejection or throw, a refused event and a failing `onFailure` end the stream with `error` and never throw into the slot (except PR044-SEC-03). Refused data is never echoed: `SseFrameError` texts carry no value, and `SsePrivacyError` names the pointer, not the value.
- **The test helper.** `expectEventStream` validates status and headers through the contract validator (`recordContract`) and every event against its `x-sse-events` schema; its personal-data oracle uses the log redaction classes, which are stricter than the runtime guard. The `contract-validator.ts` change only exports `OPENAPI_SCHEMA_KEYWORDS` (no behaviour change).
- **No secrets.** Gitleaks emulation 0 findings in 2,152 added lines; the canaries in the tests are plain words, not secret-shaped.

## 4. Findings

| ID | Title | Severity | CWE | OWASP | Where | Owner and due |
|---|---|---|---|---|---|---|
| PR044-SEC-01 | Quadratic e-mail value pattern in the privacy guard, run before the size cap | MEDIUM | CWE-1333 | A04 | `apps/api/src/platform/sse/privacy.ts:37, 51, 57-71`; `event-stream.ts:157-165` | senior-developer; this PR (C1) |
| PR044-SEC-02 | The guard checks the live object, not the wire; keys never value-checked; key gaps (= R1-m2 items 1 and 3, widened) | LOW | CWE-359 | A04 | `privacy.ts:12-34, 64-66`; `event-stream.ts:157-165`; `frame.ts:52` | senior-developer; this PR (C1) |
| PR044-SEC-03 | A malformed outcome or a throwing accessor in `complete` data exits the API process (= R1-m1) | LOW | CWE-248 | A04 | `event-stream.ts:188-197, 219-221`; `runtime/process-errors.ts:99` | senior-developer; this PR (C2) |
| PR044-SEC-04 | ERROR line and stderr stack for every client disconnect and deadline cut after the headers (= R1-m5) | LOW | CWE-779 | A09 | `tx/execute.ts:162-170`; `errors/problem-handler.ts:124-143` | `execute.ts` lock holder; before the first stream route merges (F1) |
| PR044-SEC-05 | Stream concurrency caps (T-47) have no consumer and no end hook | LOW | CWE-770 | A04 | `event-stream.ts:70-79`; TASK-041 `rate-limit/policy.ts:162-166`, `limiter.ts:51-57` (branch `0614a90f`) | TASK-141; TASK-173 card (F2) |
| PR044-SEC-06 | Fetch reader: no cap on one event's data; rescan, `retry`, no cancel on throw | INFO | CWE-770 | A04 | `packages/ui/src/sse/fetch-sse-parser.ts:70-72, 80-81, 118-131, 156-167` | senior-developer; this PR or before the first web consumer (F3) |
| PR044-SEC-07 | Replay and resume conditions for the stream routes | INFO | CWE-639, CWE-200 | A01 | `event-stream.ts:37-42, 106-111, 217`; future `modules/quotes/stream/**`, `modules/orders/progress/**` | orchestrator into the TASK-141 and TASK-173 briefs (F4) |

### PR044-SEC-01 (MEDIUM, CWE-1333, A04): quadratic e-mail value pattern in the privacy guard

**What.** `EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/` (`privacy.ts:37`) is tested against every string of every event (`personalDataPointer`, `privacy.ts:57-71`), from `frameOf` (`event-stream.ts:157-165`) before `formatSseEvent` serialises and applies the 64 KiB cap. For a string with a long run of characters that are neither white space nor `@`, V8 retries the leading `[^\s@]+` from every start position and backtracks to the end of the run each time: O(n²).

**Evidence (P2, D1/D2).** One call, this host:

| Length | No `@` | `a@` + run, no dot |
|---|---|---|
| 1 KiB | 1.5 ms | 1.6 ms |
| 4 KiB | 35 ms | 45 ms |
| 16 KiB | 676 ms | 684 ms |
| 64 KiB | 9.5 s | 9.0 s |
| 128 KiB | 35.8 s | 34.1 s |

`personalDataPointer({ note: <65,500 x 'a'> })`, a payload that passes the 64 KiB cap and is sent: 6.2 s. The code review measured 4.1 s at 64 Ki and 63.8 s at 256 Ki on the same host. The phone pattern is linear (1.6 ms at 64 KiB).

**Exploitability and impact.**
- The guard runs synchronously on the event loop of the API replica: while one event is scanned, every request on the replica, health checks included, waits.
- A replayed event is scanned again on every stream open, so one persisted long string becomes a stall that any reader of that stream repeats by reconnecting (the stream caps of PR044-SEC-05 bound concurrency, not reopens).
- Likelihood is low today: api/README §9 says events carry "only canonical codes" and no raw carrier text, and no event field is client-controlled. But the contract gives `carrier_name`, `service_name`, `explanation`, `badges[]` and `ServiceExclusion.reason`/`limit` no `maxLength`, and their producers (TASK-141, the carrier adapters) are not written yet; a carrier-derived or mis-mapped string is the realistic path. The guard exists precisely for producer deviations, and on such a deviation it stalls the replica instead of refusing the event.
- Impact high (replica-wide availability), likelihood low: MEDIUM.

**Remediation (code-level).**
1. Replace the pattern with `/[^\s@]@[^\s@]+\.[^\s@]/`. It matches exactly the strings that contain a match of the old one: P3 compared both over every string of up to 7 characters from `a`, `b`, `.`, `@`, space, tab, NBSP and U+2028 (2,396,745 strings, 6,669 positives, 0 differences) and over 200,000 random strings of up to 40 characters (3,487 positives, 0 differences). It is linear: 1 MiB inputs of five adversarial families (no `@`; `a@` + run; `a@` repeated; dots around `@`; trailing dot) take at most 3.7 ms, where the old pattern needs about 210 ms at 16 KiB.
2. Scan after serialising (PR044-SEC-02 item 1), so the scanned strings are bounded by the 64 KiB cap as well.
3. Use the same pattern in `tests/api/helpers/expect-event-stream.ts:31` (test only, but lane B runs it over recorded streams).

**Verification.** A unit test that pins the scaling, not an absolute time: `time(64 KiB) / time(4 KiB) < 32` for the no-`@` and `a@`-run inputs (the old pattern gives about 270), plus the existing positive cases (`mail a.b@example.com`, a lone address) and the language-equivalence cases above as a table. The security delta round re-runs P2 D1/D2 and P3 on the fix head.

### PR044-SEC-02 (LOW, CWE-359, A04): the guard checks the live object, not what is sent

**What.** Three gaps (P2 C1; 22 shapes, each with a random sentinel; `guard` is `personalDataPointer`, `wire` is the head's `formatSseEvent` output):

1. **Check versus use.** The guard walks `Object.entries` of the live value; `JSON.stringify` sends what `toJSON` returns and calls getters a second time. `{ toJSON: () => ({ email }) }`, a nested `toJSON` returning an address and a class instance whose `toJSON` returns `{ contact_email }` all pass the guard and are written (code review P3 found the first).
2. **Keys are never value-checked.** `{ "<address>@example.org": 1 }` passes and is written. When a finding sits under such a key, `SsePrivacyError` carries the key in its pointer and message; the platform logger redacts e-mail addresses in message text (P1 S4 showed the redaction on the cause line), but other personal keys would be logged as text.
3. **Key list gaps.** Pass and are written: `address` (string), `address1`, `street_line`, `surname`, `recipient` and `contact` as strings, `username`, `mail`, `tel`, `ip`, a Cyrillic-`е` `еmail`; values with a national phone number (`(555) 010-0000`), a `00`-prefixed number and a full-width `＠`. The code review adds `receiver_name` (a key of this project's own contract), `personName`, `streetLines`. Controls refused as expected: `email`, `first_name`, an e-mail value, `+91 98765 43210`.

**Exploitability and impact.** The contract `Sse*` schemas are closed and hold no personal fields, and the api tests validate every recorded event, so a leak needs a producer that deviates from the contract on a path no test covers. The guard is the only runtime control for that case (no runtime schema validation of outgoing events). Impact medium (personal data on a stream, US-042 AT-08), likelihood low: LOW.

**Remediation (code-level).**
- In `formatSseEvent` (or in `frameOf` around it): serialise first (the existing `try` already catches cycles and BigInt), apply the 64 KiB cap, then `personalDataPointer(JSON.parse(json))`. The walk then sees exactly the wire value, getters and `toJSON` run once, and the walk is bounded by the cap. This also puts the walk inside the `try` that PR044-SEC-03 needs.
- In `personalDataPointer`, test each object key with `isPersonalValue` as well as `isPersonalKey`; when the key itself is the finding, report the parent pointer plus `/*`, never the key text.
- Complete the closed key list with the shapes above that name a person, a street address or contact data (`address`, `address1..3`, `streetlines`, `surname`, `receivername`, `personname`, `username`, `mail`, `tel`), keeping `carrier_name` / `service_name` / `origin_time_zone` passing (the code review's point on suffix rules stands). `recipient` and `contact` as string values are a judgement for the developer: refuse them unless a contract key uses them.
- National phone formats, names in free text and homoglyph keys stay residual: a value pattern cannot catch them. Say so in the module comment; the closed contract schemas are the primary control.

**Verification.** Unit rows for each shape above (refused, pointer without the key text when the key is the datum), the contract example payloads still pass, and an api row in `event-stream.api.test.ts`: a `complete` whose data has a `toJSON` returning an e-mail ends with `error` and the address is not on the wire.

### PR044-SEC-03 (LOW, CWE-248, A04): a malformed outcome exits the API process

**What.** `Promise.resolve().then(() => produce(...)).then(end, onRejected)` (`event-stream.ts:219-221`) does not catch a throw inside `end`. `end` throws when the outcome is `undefined` or `null`, and when `personalDataPointer` (outside `frameOf`'s `try`, line 158) reads a throwing getter or a revoked Proxy in `complete` data. The rejection is unhandled; `process-errors.ts:99` turns it into `process.unhandled_rejection` and exit 1.

**Evidence (P1 S3).** A producer resolving `undefined` on the real app: one `unhandledRejection` (`TypeError`), the stream body stays empty until the slot deadline cuts it (`ECONNRESET`), then an ERROR line and a stderr stack. In production the replica exits first. Same on `530629f4` (the module is new, the slot is unchanged).

**Exploitability and impact.** Not attacker-reachable: TypeScript's `SseOutcome` type rules out the plain forms, so it needs a producer defect (a cast, an `any`, or a data object with accessors). When it happens, every in-flight request of the replica is dropped. LOW.

**Remediation.** As R1-m1: one guarded continuation, `.then((outcome) => { try { end(outcome); } catch (error) { fail({ reason: 'producer_failed', cause: error }); } }, (error) => fail(...))`, with a shape check on `outcome` (`typeof outcome === 'object' && outcome !== null && (outcome.event === 'complete' || outcome.event === 'error')`, else `producer_failed`); the PR044-SEC-02 move puts the walk inside a `try`.

**Verification.** Unit: outcomes `undefined`, `null`, `{}`, `{ event: 'complete', data: <throwing getter> }`, a revoked Proxy as data: each ends with `error` `INTERNAL_ERROR`, `onFailure` hears `producer_failed` or `event_refused`, and a `process.on('unhandledRejection')` spy stays empty.

### PR044-SEC-04 (LOW, CWE-779, A09): log flooding from normal stream ends

**What.** `completeStream` (`execute.ts:162-170`, unchanged) rethrows the slot's own abort after `res.destroy()`. The problem handler then logs `http.request_failed` at ERROR (status 503, `headers_sent: true`) and, since PR44-SEC-13, passes `new AppError(code)` to `next()`; Express's final handler prints it with `console.error` (17 lines with the stack) and destroys the socket.

**Evidence (P1).** S1, one client disconnect: 1 access line, 1 ERROR line, 1 stderr dump. S2, the slot deadline (1.5 s here, 20 s in production) before the module's 30 s cap: the client gets a reset without an `error` frame, plus the same two lines. S8, ten streams opened and closed by one client: 10 ERROR lines and 10 stderr dumps (170 lines).

**Exploitability and impact.** A browser leaving a page is the normal end of a stream, and every booking-progress stream longer than 20 s ends at the deadline (R1-M1), so ERROR volume tracks normal traffic and drives the error-rate signal behind ROLLBACK_TRIGGERS; a client can raise it at the anonymous step-0 budget (120 requests per minute per IP, TASK-041), about 18 lines per stream. The stderr dump is unstructured (no correlation ID, multi-line). No personal data or secret is in either line (S4). LOW.

**Remediation.** Concur with R1-m5 (owner: the `execute.ts` lock holder, today TASK-040 / PR #80; due before the first stream route merges: TASK-091, TASK-141 or TASK-173): in `completeStream`, a disconnect abort (`lifetime.isDisconnect(error)`) destroys the response, logs once at info (`http.stream_client_gone`) and does not rethrow; a deadline cut becomes an `error` frame (R1-M1 (a) item 2). Optional, in this PR's line or with R1-m5: after the headers are sent the problem handler can call `res.destroy()` and return instead of `next(new AppError(code))`. finalhandler 2.1.1 does nothing else in that case (`req.socket.destroy()` plus the `console.error`), so the outcome is the same without the unstructured stderr dump, and PR44-SEC-13 stays closed by construction (nothing reaches `console.error`).

**Verification.** An api or unit case: a client disconnect after the first event writes no ERROR line and nothing to `console.error` (spy, `env=production`); a producer failure after the headers still writes one ERROR line.

### PR044-SEC-05 (LOW, CWE-770, A04): stream concurrency caps have no consumer and no end hook

**What.** README §7 and ADR-0016 amendment 9 cap concurrent streams at 2 per IP (/64) and 5 per user "counted across both stream routes and all replicas … released on close, refused before the stream opens" (T-47, AC-46, SEC-TC-26, SEC-TC-42). On this head nothing does that, which the brief assigns to the route tasks. On the TASK-041 branch (`0614a90f`, not merged) `streamSlotRule` (`policy.ts:162-166`) and `RateLimiter.acquire` / `release` (`limiter.ts:51-57`, slots expire by TTL) exist with no consumer. `EventStreamOptions` has no hook that runs exactly once when the stream ends (only `onFailure`). TASK-141's card carries SEC-TC-42 and AT-US-040-15/16; TASK-173's card (booking progress) has no cap line, although the per-user cap counts both routes.

**Evidence (P1 S8).** Ten concurrent streams from one client on the fixture: ten 200s (expected: no route wires a cap yet).

**Exploitability and impact.** Without the caps, open streams are bounded only by the step-0 request budget and the 20 s deadline: per IP about 120 opens per minute, so about 40 concurrent sockets and stream closures per IP on a replica, and unbounded across IPs. The booking stream is session-only, which limits who can do it. LOW now (no route), MEDIUM if a stream route merges without its cap.

**Remediation.**
- Acquire the slot in the pipeline step that already runs before `execute` (the TASK-041 rate-limit slot, a stream class) and register `res.once('close', release)` there. `close` fires exactly once however the response ends (`end`, `destroy`, client gone, deadline), so no module hook is needed and a slot is never released twice; the TTL (at least the stream cap plus the deadline margin) covers a replica crash.
- Alternatively an `onClose` option on `eventStream`, called once from `finish` and from the already-aborted path; but a slot acquired in the handler is then leaked to the TTL when `send()` fails before the hook runs.
- One counter for both routes: TASK-173 consumes the same `sse:ip` / `sse:user` rules.

**Verification.** SEC-TC-42 and AT-US-040-15/16 at the quote stream (TASK-141); at the booking stream (TASK-173), the 6th concurrent stream of a user across both routes is 429 and closing one frees a slot.

### PR044-SEC-06 (INFO, CWE-770, A04): fetch reader bounds

**What and evidence.**
- (a) `data` lines accumulate without a cap (`fetch-sse-parser.ts:70-72`); `SSE_MAX_LINE_LENGTH` bounds one line only. P4: 100,000 lines of `data: <1,000 chars>` and a blank line dispatched one event of 100,099,999 characters, no refusal (control: one 5,006-character line with a 4,096 cap is refused).
- (b) Every `push` rescans the whole pending line (`:118-131`): one line in 8,192 one-character chunks took 0.75 s, in 32,768 chunks 11.1 s (= R1-n8).
- (c) `retry:` with 400 digits reaches `onRetry` as `Infinity` (`:80-81`); a caller that feeds it to `setTimeout` gets an immediate timer (values above 2³¹ − 1 ms fire at once), so a hostile `retry` turns into a reconnect loop.
- (d) A throw from the parser or a handler releases the lock without cancelling the body (= R1-n1).

**Impact.** The reader talks only to the platform's own API over TLS, so each item needs a compromised origin or edge. INFO.

**Remediation.** Cap the accumulated `data` of one event (refuse past the line cap, 1 MiB, with `SseParseError`); keep a scan offset across pushes; clamp `retry` to a sane range (for example 1,000..60,000 ms) or drop it, since the reader does not reconnect itself; cancel the body in a `catch` (R1-n1). Unit tests for each.

### PR044-SEC-07 (INFO, CWE-639 and CWE-200, A01): replay and resume conditions for the stream routes

The module cannot see what it replays; these hold only if the routes do them. For the TASK-141 (quote stream) and TASK-173 (booking progress) briefs:

1. The replay read is keyed by the stream resource the route has authorised (`quoteId` under the quote token or tenant context, `orderId` under the tenant), runs under RLS, and never selects by `Last-Event-ID` alone.
2. The event id is the per-stream sequence (ADR-0016 amendment 3: "the option sequence number" of one quote), never a table-wide sequence: a global counter in `id` would tell every reader how many results other tenants produced (CWE-200).
3. The replay read is bounded (`LIMIT`): the sink has no backpressure (D-TASK044-05) and `options.replay` is written synchronously into the response buffer.
4. A resume point above the persisted maximum is treated as absent (= R1-n3). P1 S5: `Last-Event-ID: 9999999999` today ends the stream with `error` `INTERNAL_ERROR` and `onFailure` hears `event_refused`, so a client can write that failure into the route's log at will.
5. Live events of a resumable stream carry their persisted id (= R1-n4); `streamBookingProgress` has no resume (README §9) and declares no `Last-Event-ID`.

## 5. Concurrence with the code review twin

Code review round 1 (`7ed51854`, CHANGES_REQUESTED) found most of this independently; the probes here reproduce its P1 to P4 and the deadline/disconnect probe.

| Code review | This record |
|---|---|
| R1-M1 (Cache-Control and the 20 s deadline in production) | Concur. Security sign-off asked for in (a) item 1, below |
| R1-m1 | = PR044-SEC-03 (LOW) |
| R1-m2 | = PR044-SEC-01 (MEDIUM; the regex part, rated separately because it is an availability defect of the replica) and PR044-SEC-02 (LOW; widened by the key-as-value and class `toJSON` shapes) |
| R1-m3 (reader resumes past an undispatched event) | Concur; integrity, not a security finding |
| R1-m4 (PR #80 union lint) | Concur; the union keeps the PR44-SEC-13 line (§2) |
| R1-m5 | = PR044-SEC-04 (LOW), plus the optional problem-handler form |
| R1-m6 (AT-06 versus amendment 9) | Concur: a stream's signal must never reach the `createQuote` fan-out |
| R1-n1, R1-n8 | Folded into PR044-SEC-06 |
| R1-n2 (`SseError.code` from the catalogue) | Concur |
| R1-n3, R1-n4 | Folded into PR044-SEC-07 |
| Security flags (1) to (5) | (1) PR044-SEC-01/-02; (2) PR044-SEC-03; (3) PR044-SEC-04; (4) PR44-SEC-13 closed (§3); (5) the ruling below |

**Ruling on R1-M1 (a) item 1 (SEC-TC-29).** `send()` may keep a handler's `Cache-Control` on a private response only when the value is one of an exact allow-list: `private, no-store` or `private, no-cache, no-store` (compare the token set after splitting on commas and trimming, case-insensitive; no other directive allowed). Any other handler value is replaced with `private, no-store` as today. A substring or "contains `private` and `no-store`" test is not acceptable: `private, no-store, max-age=60, public` or `no-store-x, private` would pass it. With that rule SEC-TC-29 holds.

**Rulings on the developer decisions (security view).** D-TASK044-02 accepted. -03: the cap is accepted; whatever lands for R1-M1 must keep a stream's deadline below the 25 s drain and end it with an `error` frame. -04 accepted with PR044-SEC-07. -05 accepted for M1: memory per stream is bounded by 64 KiB per event, the deadline and small producers, provided the replay read is bounded (PR044-SEC-07 item 3). -06: approach accepted; implementation PR044-SEC-01/-02. -07 accepted, plus R1-n2. -08 accepted; PR044-SEC-03 is a separate path. -09: PR44-SEC-13 closed; R1-m4 on the union. -12 accepted (the helper still validates through `recordContract`).

## 6. Conditions, follow-ups and routing

| ID | Condition or follow-up | Owner | Due |
|---|---|---|---|
| C1 | PR044-SEC-01 and PR044-SEC-02 fixed: serialise, cap, then scan the parsed value; the linear e-mail pattern (also in the helper); keys value-checked; key list completed; tests as in §4 | senior-developer | This PR's fix cycle; security delta round on the fix head |
| C2 | PR044-SEC-03 fixed with the outcome shape check and the unit cases of §4 | senior-developer | This PR's fix cycle |
| C3 | Lane B green on the fix head (§7) | orchestrator (lane B) | Before merge |
| F1 | PR044-SEC-04 (= R1-m5) | `execute.ts` lock holder (TASK-040 / PR #80 today) | Before the first stream route merges (TASK-091, TASK-141 or TASK-173) |
| F2 | PR044-SEC-05: TASK-141 acquires and releases the stream slot (pipeline step, `res.once('close')`); a TASK-173 card line for the same counter | TASK-141 developer; orchestrator (TASK-173 card) | TASK-141 and TASK-173 merges |
| F3 | PR044-SEC-06 (a) to (d) | senior-developer | This PR, or before the first web consumer of `readEventStream` |
| F4 | PR044-SEC-07 items 1 to 5 into the TASK-141 and TASK-173 briefs (and TASK-091 where it builds the quote stream's replay) | orchestrator | At their dispatch |
| F5 | The R1-M1 (a) item 1 allow-list (§5), if route (a) is taken | `execute.ts` lock holder; principal-architect | With R1-M1 |

**SEC-TC proposal** (for qa-lead's next manifest commit after merge, D-SEC-PR47-01; the next free ID on main is 84): **SEC-TC-84**, event payloads are refused, never written, when they carry personal data in any form the guard covers (an e-mail value, a personal key, an e-mail as a key, a `toJSON` result), and a 64 KiB space-free string is scanned in linear time. `api.required_cases` (the api rows of C1) plus the unit pins.

## 7. Lane B cases

On the fix head (C3), `tests/api/event-stream.api.test.ts` (no database):

- the 9 existing tests: AT-US-042-01 to -08 (AT-04 and AT-05 in one test, about 30 s), the resume test and the malformed `Last-Event-ID` 400;
- the new C1 rows: a `complete` with a `toJSON` e-mail and an e-mail key each end with `error`, the address absent from the body;
- the code review's lane B items (re-run after TASK-041 and PR #80 merge, and AT-01/AT-05 on the default composition if R1-M1 takes route (a)).

The PR44-SEC-13 tests and the C1/C2 unit pins run in lane A (unit).

## 8. Record binding

Main's real checker (`tools/ci/check-security-owned-paths.mjs` from main `74536b8e`) in a sparse shared clone, merge-ref form (the record committed on a main commit, then `git merge-tree` with the head and `commit-tree`), `--pr 9999`, record content = this file under the name `PR-9999-TASK-044-security-review.md`:

| Scenario | Expected | Result |
|---|---|---|
| S1 the record on main merged with the head (`--base` = merge base `530629f4`) | pass | pass, 11 owned, satisfied by `dc64193f` |
| S1b the same with `--base` = the main commit carrying the record | pass | pass |
| S2 a docs-only lane-B evidence commit after the head | pass | pass (the binding is kept) |
| S3 an unowned edit after the head (`packages/ui/src/sse/fetch-sse-parser.ts`) | pass | pass |
| S4 the branch merges a docs-only main | pass | pass |
| S5 the branch merges a main that changed an owned path this PR does not change (`tx/execute.ts`) | pass | pass |
| C1 no record | missing | missing (exit 1) |
| C2 the record only under this `PR-pending` name | missing | missing: the orchestrator must rename it once the PR exists |
| C3 a later FAIL verdict row | missing | missing |
| C4 the Head row naming the base commit | missing | missing |
| C5 an owned edit after the head (`sse/privacy.ts`, the fix cycle) | missing | missing: the fix head needs its own round (planned: the delta round for C1 and C2) |
| C6 the branch merges a main that also changed `problem-handler.ts` (PR #80 merged first) | missing | missing: whichever of PR #80 and this PR merges second needs a merge-only round |

12 of 12 as expected (main tip `74536b8e` for the simulation; the record contains exactly one Head row and one Verdict row). Not binding-relevant but noted: TASK-042 (`b8ba7788`) also edits `packages/ui/src/index.ts` (unowned); its union with this head is clean.

## 9. Verdict

| Verdict | PASS_WITH_CONDITIONS. No Critical or High finding. MEDIUM PR044-SEC-01 (C1); LOW PR044-SEC-02 (C1, = R1-m2), PR044-SEC-03 (C2, = R1-m1), PR044-SEC-04 (F1, = R1-m5), PR044-SEC-05 (F2); INFO PR044-SEC-06 (F3), PR044-SEC-07 (F4). PR44-SEC-13 closed at `dc64193f`. Conditions C1 to C3 in §6; a security delta round on the fix head checks C1 and C2 |

---

# Round 2: delta review of fix cycle 1 (part 044-A)

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-044-server-sent-events-convention`, one fix commit `3b56ab54` on round 1's head `dc64193f` (`fix(api): task-044 fix cycle 1, sse privacy guard, outcome guard, error without id`; D-TASK044-14..18 in its body; D-ORCH-153). Not pushed. Since D-ARCH-217 this branch is part 044-A of TASK-044 |
| Head | 3b56ab54e06038d6e9d722755371322a3bb5b782 |
| Delta | `dc64193f..3b56ab54`: 12 files, +796 / -155. Owned: `apps/api/src/platform/sse/{event-stream,frame,privacy}{,.test}.ts`. Not owned: `packages/ui/src/sse/fetch-sse-parser{,.test}.ts`, `packages/ui/src/index.ts` (two constants exported), `tests/api/event-stream.api.test.ts`, `tests/api/helpers/expect-event-stream{,.test}.ts`. `problem-handler.ts` is unchanged (blob `b1850807` at both heads). No dependency, lockfile, configuration key or migration. `execute.ts`, `define-route.ts`, `route-state.ts`, `app.ts` and `start-api.ts` are untouched, as D-ARCH-217 requires of part 044-A |
| Merge base with main | Still `530629f4`. `530629f4..190b3954` (main's tip when this round was committed; the probes and simulations ran at `a3c0b1af`, and `a3c0b1af..190b3954` is the plan fold D-SD-012, D-QG-008 and agent memory) changes nothing outside `docs/` and `.claude/agent-memory/`; `git merge-tree --write-tree 190b3954 3b56ab54` is clean. Main's checker (`--base 530629f4 --head 3b56ab54 --pr 9999`, no record) counts the same 11 owned paths as round 1 (`missing`); main's classifier gives `security_paths=true` (10 paths) |
| Lane A evidence | None: the branch is not pushed |
| Lane B evidence | None yet. The orchestrator has queued lane B on `3b56ab54` (C3; R2.7) |
| Binding items checked | Round 1 (§1 to §9 above); D-TASK044-14..18 (commit body); D-SD-012 (the TASK-044, TASK-141 and TASK-173 lines); D-ARCH-217 to D-ARCH-224 and `docs/03-architecture/rulings/wave-1-task-044-rulings.md` (§1 to §5, proofs (a) to (i)); the ADR-0003 amendment of 2026-11-21 (rules (m) to (q)); D-QG-007 (QG-044-C1 to QG-044-C7; ADR-0016 amendment 14 item 2 VERIFIED); D-ORCH-153; the heading of D-PM-089. Code review round 2 of this head was not on main when this round was written |
| Reviewer / date | security-analyst, 2026-11-21, round 2 (delta), pre-push. Host rules: foreground commands only, each at most 8 minutes, no Docker, nothing run in the TASK-044 worktree (git reads through the shared object store from the main checkout; every probe ran on `git archive` extracts of `3b56ab54` and, as the positive control, `dc64193f`, in the session scratchpad, with a `node_modules` junction to the main checkout) |

## R2.1 Summary

Both conditions this fix cycle owned are met, and each closure was probed, not read:

- **PR044-SEC-01 (MEDIUM) is closed.** The guard's e-mail pattern is now `/[^\s@]@[^\s@]+\.[^\s@]/`, in the module and in the api helper. Round 1's equivalence probe, re-run against the module's own export, finds 0 differences over 2,396,745 exhaustive strings and 300,000 random ones. The round-1 payload (`{ note: 65,500 x 'a' }`) now takes 0.10 ms (round 1: 6.2 s). The worst 1 MiB input of seven adversarial families takes 4.6 ms. The scan also runs only after the 64 KiB cap.
- **PR044-SEC-02 (LOW) is closed.** The guard scans `JSON.parse` of the serialised, capped wire text, so `toJSON` results and getters are checked as sent. Keys are value-checked and reported as `<parent>/*`. The key list is complete. Over 45 shapes, each sent as a live event and as `complete` data (90 runs), no sentinel of a refused shape reaches the wire, and no refusal names an e-mail address or a phone number. Both api rows exist, and on the real app both end with `error`, with no address on the wire.
- **PR044-SEC-03 (LOW) is closed.** There is one guarded continuation, an outcome shape check, and `send()` never throws. On the real `createApp`, with the real process error handlers installed and a recording `exit`, all 10 scenarios end with a clean end of the response: 6 malformed or failing outcomes (each with an id-less `error` frame), the 2 C1 rows, a code outside the catalogue and the resume. The probe saw no unhandled rejection, no exit request, no `console.error` call and no ERROR line. Round 1's head, run as the control, gives 4 unhandled rejections, an exit request, 4 resets at 20 s, and both C1 shapes on the wire.
- **PR044-SEC-06 (INFO) is closed.** The reader caps one event's data, scans each chunk once, clamps `retry` to 1,000 to 60,000 ms, and cancels the body on a throw.
- **D-ARCH-220 holds.** The `error` frame carries no id. Over real HTTP, a stream that ends with `error` after event 1, reopened from the reader's resume point 1, delivers 2, 3 and `complete`. On round 1's head the same probe loses result 2. **R1-n2 holds:** a code outside the catalogue is sent as `INTERNAL_ERROR` (`Object.hasOwn`, so `constructor` does not pass).
- **Mutants:** all 15 security mutants of the fix, run against the PR's own unit suites, are killed. On the extract, the 7 touched suites pass (163 tests).

Two new INFO findings, both residuals of round-1 classes, neither reachable by a client today:

- **PR044-SEC-08 (INFO, CWE-532).** A refusal's pointer still carries ancestor key text that the value patterns cannot recognise, such as a name used as a key. A party key that holds an array of strings passes.
- **PR044-SEC-09 (INFO, CWE-755).** The replay loop runs outside the guards. A replay array whose element accessor throws makes the hook reject after the headers, and 30 s later the route hears `max_duration` for a stream that has already ended.

**QG-044-C3: concurrence given** with D-ARCH-218, D-ARCH-219 (including the reading of round 1's drain condition and the cut without a frame at 31 s), D-ARCH-221 and D-ARCH-223, with conditions for the security round of part 044-B (R2.5).

Verdict: **PASS_WITH_CONDITIONS.** No Critical, High or Medium finding is open at `3b56ab54`. The merge conditions are lane B green on `3b56ab54` (C3) and the merge-only round with PR #80 (C4).

## R2.2 Method and evidence

| Probe | What | Result |
|---|---|---|
| R1, regex | The pattern text in `privacy.ts` and `expect-event-stream.ts`. Round 1's P3: the module's `containsEmailAddress` against round 1's pattern, exhaustively over `a`, `b`, `.`, `@`, space, tab, NBSP and U+2028 up to length 7, then over 300,000 random strings of up to 40 code units from 19 symbols (CR, LF, U+FEFF, full-width `＠`, `+`, `é` added). Round 1's D1/D2 timing table on `isPersonalValue` and `personalDataPointer`, best of 3, with 1 KiB to 1 MiB inputs | Same pattern text in both files. Exhaustive: 2,396,745 strings, 6,669 positives, 0 differences. Random: 300,000 strings, 15,990 positives, 0 differences. Timing: table under R2.3 |
| R2, wire | The head's `sseStream` with a recording sink: 45 data shapes, each with a random sentinel, as a live event and as `complete` data; 22 outcome and producer-defect cases; a throwing `onFailure`; replay holding `null`; a throwing replay iterator; the D-ARCH-220 frames. `process.on('unhandledRejection')` and `('uncaughtException')` recorded | R2.3 and R2.4; 0 unhandled rejections, 0 uncaught exceptions |
| R3, real app | `createApp` with `defaultPipelineSlots` and the default platform logger on stdout (captured). Express `env=production`, `console.error` captured, and the real `installProcessErrorHandlers` with a recording `exit`. A fixture `streamQuoteResults` route on the PR's `eventStream` runs 10 scenarios over raw `node:http`. Run on `3b56ab54` and on `dc64193f` (control) | R2.3 |
| R4, reader | The head's `createSseParser` and `readEventStream`. Round 1's P4 event (100,000 `data:` lines of 1,000 characters), 1,100,000 empty `data:` lines, one line in 32,768, 262,144 and 1,000,000 one-character chunks, 12 `retry` values, a throwing handler and a parser refusal over a `ReadableStream` with a recording `cancel`, and resume points | R2.3 |
| R5, residuals | `personalDataPointer` on name-like ancestor keys, party keys holding arrays, and look-alike keys; a real-app scenario whose replay array has a throwing element accessor, observed for 32 s | R2.4 |
| Mutants | 15 security mutants of the fix (listed in R2.3), each run against the touched unit suite of the head | 15 of 15 killed; files restored byte for byte (checked against the commit) |
| Unit suites | `jest --selectProjects unit` on the extract, run on the 4 sse suites, the reader, `problem-handler.test.ts` and `expect-event-stream.test.ts` | 7 suites, 163 tests, all pass |
| Secrets | `gitleaks` is not installed on this host. Instead, a scan of the 796 added lines (`git diff -U0 dc64193f 3b56ab54`) for the gitleaks default families that can match TypeScript (AWS, private key, JWT, GitHub, Slack, Stripe, generic assignment, credentials in a URL), plus Shannon entropy above 4.3 on quoted tokens of 20 characters or more. Positive controls (an AWS key shape, a password assignment) fire | 0 hits. The canaries in the tests are plain words and `example.org` addresses |
| Unions | `git merge-tree --write-tree` of the head with main `a3c0b1af`, PR #80 `0f0d92a0`, TASK-040 part 040-B PR 1 `a4aadd2e` (stacked on `0f0d92a0`) and TASK-042 `b8ba7788`, the branches that touch a path of this PR | R2.8 |
| Record binding | Main's real checker in a sparse shared clone, merge-ref form | R2.9 |

Not run: Docker, the api suite (lane B), lint and typecheck (D-ORCH-153 reports 242 unit tests passing and 6 of 6 developer mutants killed; the code review twin runs lint and typecheck).

## R2.3 Closure of round 1's findings and conditions

| Item | Status at `3b56ab54` | Evidence |
|---|---|---|
| PR044-SEC-01 (MEDIUM) | **Closed** | `privacy.ts:67` and `expect-event-stream.ts:32` hold `/[^\s@]@[^\s@]+\.[^\s@]/`. Same language (R1). `frameOf` serialises with the cap, then scans `JSON.parse(json)` (`event-stream.ts:190-198`). A 66,000-character string is refused by the cap and never scanned. Unit pins: the fast-check oracle against the former pattern, and the 64 KiB / 4 KiB work ratio below 32 for four families, which kills mutant M1 |
| PR044-SEC-02 (LOW) | **Closed** (residual: PR044-SEC-08) | Wire value: `toJSON` returning `{email}`, a nested `toJSON` returning an address string, a class instance with `toJSON` returning `{contact_email}`, and a getter returning an address on its first call are all refused. A getter that returns an address only on a second call sends its first value, because the guard and the wire see one serialisation. An own enumerable `__proto__` key is walked (`/__proto__/email`). Keys: an e-mail or a phone number as a key, at the root or nested in arrays, is reported as `/*` or `/a/b/0/*`, and neither the refusal message nor its pointer contains the sentinel. Key list: `address`, `address1`, `address3`, `Address_2`, `street_line`, `streetLines`, `surname`, `username`, `mail`, `tel`, `ip`, `ip_address`, `receiver_name` and `personName` are refused, and so are `recipient`, `receiver`, `sender` and `contact` when they hold a string. `recipient` holding an object is walked field by field. `carrier_name`, `service_name` and `origin_time_zone` pass. The documented residuals pass as stated: a national phone number, a `00` prefix, the full-width `＠`, a name in free text. The module comment's example of a look-alike key, Cyrillic `е` in `email`, is in fact refused: the normaliser drops non-ASCII letters, leaving `mail` (R2.4). Api rows: `toJson` and `emailKey` in `event-stream.api.test.ts`. On the real app (R3) both end with `error` `INTERNAL_ERROR` and no `example.org` on the wire. On `dc64193f` both addresses are written |
| PR044-SEC-03 (LOW) | **Closed** (residual: PR044-SEC-09) | `settle` wraps `end`, `outcomeOf` checks the shape and `send` catches. R2 cases, each ending with the `error` frame, `INTERNAL_ERROR`, no id: `undefined`, `null`, `{}`, `42` and `"complete"` give `producer_failed` with `SseOutcomeError`. A throwing getter in `complete` data and a revoked Proxy as data give `event_refused`. A revoked Proxy outcome, a throwing `event` accessor and a throwing `data` accessor give `producer_failed`. So do a synchronous throw, a rejection and a thenable that throws. `send()` with a throwing `event` accessor, `send(null)` and a terminal name sent live give `event_refused`. A producer that resolves after the slot signal aborted writes nothing. A throwing `onFailure` leaves no trace. 0 unhandled rejections. Real app (R3, head): 6 malformed or failing outcomes end with `end` in 13 to 58 ms. The process handlers request no exit, write no fatal line, make no `console.error` call and write no ERROR line. Control `dc64193f`: `undefined`, `null`, the throwing getter and the throwing `onFailure` case each leave an unhandled rejection; 4 `process.unhandled_rejection` fatal lines; exit requested with 1; each stream is reset at 20 s |
| PR044-SEC-04 (LOW) | **Open, re-routed** | Unchanged in part 044-A by design. D-ARCH-221 / ADR-0003 rule (p) assigns it to part 044-B (B5, proof (g)), before TASK-141 is dispatched. R5 shows the current path at this head: a hook that rejects after the headers gives one `http.request_failed` ERROR line and one `console.error` call (no personal data) |
| PR044-SEC-05 (LOW) | **Open** (F2) | No change expected here. The plan fold D-SD-012 (`2f6a89d5`, QG-044-C1 (c)) put STREAM SLOT ACQUIRE AND RELEASE on the TASK-141 and TASK-173 cards: acquire before `execute`, release on close, TTL as the backstop, one per-user counter for both operations. D-ARCH-219 adds the 31 s slot TTL line |
| PR044-SEC-06 (INFO) | **Closed** | (a) round 1's 100,000-line event is refused after 1,047 lines (1 MiB); cap 10 accepts 10 characters and refuses 11; 1,100,000 empty `data:` lines are refused. (b) one line in 32,768 one-character chunks: 7 ms (round 1: 11.1 s); 262,144: 27 ms; 1,000,000: 116 ms; a pending line above the cap across chunks is refused. (c) `0`, `1` and `999` give 1,000; `1000` and `5000` pass; `60001` and 400 digits give 60,000; `-5`, `1e3`, a doubled leading space and a trailing space are ignored. (d) a throwing handler and a parser refusal each cancel the body with the error and release the lock |
| PR044-SEC-07 (INFO) | **Open** (F4) | Items 4 and 5 (= R1-n3, R1-n4) are now guidance in the module comment (`event-stream.ts:26-28`). D-SD-012 (QG-044-C1 (c)) put items 1, 2 and 4 on the TASK-141 card (REPLAY AND RESUME CONDITIONS) and the no-resume rule on TASK-173 (REPLAY CONDITIONS); item 3 (a bounded replay read) is TASK-141 card line 14 (D-QG-007 observation 3); QG-044-C7 gives the per-quote sequence of item 2 a place in the data model |
| R1-n2 | **Closed** | `errorCodeOf`: syntax plus `isErrorCode` (`Object.hasOwn` on the merged catalogue). `NOT_FOUND` is kept; `BOGUS_CODE`, `constructor`, `not_found` and an object with a `toString` are sent as `INTERNAL_ERROR`. On `dc64193f`, `BOGUS_CODE` is sent as is |
| D-ARCH-220 (A1) | **Holds** | Frame: `event: error\ndata: {...}` with no `id:` line; `complete` keeps the last id plus one. Real app: after event 1 then `error`, the reopened stream with `Last-Event-ID: 1` delivers ids 2, 3 and `complete` 4. On `dc64193f` the `error` frame has id 2, and the reopened stream delivers 3 and `complete`, so result 2 is lost. Reader: after `id: 1` and an id-less `error`, `lastEventId` is `1`; a block lost mid-stream does not move it (R1-m3). A resume at the maximum still ends with an id-less `error` and `event_refused` (PR044-SEC-07 item 4, the route's to handle) |
| D-ARCH-222 (A2) | Wording only | Module comment item 7 and the AT-US-042-06 fixture now say "subscription". No security effect |
| C1 | **Met** | PR044-SEC-01 and -02 above, with the unit pins and both api rows |
| C2 | **Met** | PR044-SEC-03 above, with the unit cases (`event-stream.test.ts`, "a malformed outcome ends the stream instead of rejecting unobserved", 8 rows). The developer notes that an `unhandledRejection` spy sees nothing inside Jest (D-TASK044-18). The settled-hook assertion plus R2 and R3 here cover the process-level proof |
| C3 | **Open** | Lane B on `3b56ab54` (R2.7) |
| F1 | Re-routed | To part 044-B by D-ARCH-221 (accepted in R2.5) |
| F3 | **Met** | PR044-SEC-06 closed in this PR |
| F5 | Superseded | By D-ARCH-218 (accepted in R2.5) |

Timing of the head's guard (R1, best of 3, one call, ms):

| Family | 1 KiB | 4 KiB | 16 KiB | 64 KiB | 128 KiB | 1 MiB |
|---|---|---|---|---|---|---|
| no `@` | 0.00 | 0.00 | 0.01 | 0.05 | 0.10 | 0.90 |
| `a@` + run, no dot | 0.00 | 0.01 | 0.04 | 0.19 | 0.40 | 2.33 |
| `a@` repeated | 0.00 | 0.02 | 0.06 | 0.21 | 0.39 | 3.55 |
| `a@` + run + trailing dot | 0.00 | 0.01 | 0.04 | 0.14 | 0.28 | 2.72 |
| `+1` + spaces (phone pattern) | 0.01 | 0.02 | 0.09 | 0.23 | 0.43 | 3.97 |
| `+1 ` repeated | 0.00 | 0.02 | 0.06 | 0.26 | 0.50 | 4.60 |

`personalDataPointer({ note: 65,500 x 'a' })` 0.10 ms. A 65,000-character key: 0.20 ms. 8,000 keys: 6.2 ms. Control, the round-1 module, at 16 KiB: 245 ms.

Mutants (each run against the touched suite; all killed): M1 quadratic pattern restored; M2 guard scans the live object; M3 keys not value-checked; M3b a key finding names the key; M4 `.then(end, …)` restored; M4b no outcome shape check; M5 `error` framed with an id; M6 code kept without the catalogue check; M7 `send()` unguarded; M8 reader without the data cap; M9 reader without the `retry` clamp; M10 reader without the cancel on throw; M11 reader applies `id:` at once (R1-m3); M12 helper accepts an `error` with an id; M13 helper misses an e-mail key.

## R2.4 New findings

| ID | Title | Severity | CWE | OWASP | Where | Owner and due |
|---|---|---|---|---|---|---|
| PR044-SEC-08 | Guard residuals: name-like key text in the refusal pointer; party keys holding arrays; the look-alike example | INFO | CWE-532, CWE-359 | A09 | `privacy.ts:94-113`; `event-stream.ts:100-108` | part 044-B (holds `api-sse`); before TASK-141 merges (F6) |
| PR044-SEC-09 | Replay iteration runs outside the guards | INFO | CWE-755 | A04 | `event-stream.ts:276` | part 044-B (B4 rewrites the replay start); before TASK-141 merges (F7) |

### PR044-SEC-08 (INFO, CWE-532 and CWE-359, A09): guard residuals

**What (R5).**
- (a) Only keys that the value patterns recognise are masked (`/*`). Ancestor keys go into the pointer as text. `{ "Ravi Example": { "email": "x" } }` is refused with the pointer `/Ravi Example/email`, and at the depth stop with `/Ravi Example/k/k/…`. The pointer is in `SsePrivacyError.message`, which reaches the route's `onFailure` and so its log line. The platform logger redacts e-mail addresses in message text but not names.
- (b) A party key is refused only when it holds a string. `{ "recipient": ["Ravi Example"] }` passes and is sent.
- (c) The module comment names "a Cyrillic `е` in `email`" as a residual, but the head refuses it: `normalise` drops non-ASCII letters, giving `mail`. Other look-alikes still pass, for example `emaіl` (Ukrainian `і`) and `ﬁrst_name` (ligature). The residual stands; the example is wrong in the guard's favour.

**Exploitability and impact.** No event field is client-controlled. A producer would have to deviate from the closed `Sse*` schemas, and the api tests validate every recorded event. Item (a) needs personal data used as a key with a second finding under it, and it reaches a server log, not the client. INFO.

**Remediation (code-level).**
- (a) Build the pointer from masked segments. A segment that is not an array index and does not match the contract key syntax `^[a-z][a-z0-9_]*$` is written as `*`. Contract keys stay readable for the operator, and nothing else reaches the message.
- (b) Refuse a party key that holds a string or an array: `PARTY_KEYS.has(normalise(key)) && (typeof value === 'string' || Array.isArray(value))`. An object is still searched field by field.
- (c) Correct the example in the comment.

**Verification.** Unit rows: `{ "Ravi Example": { email: "x" } }` gives `/*/email`; `{ recipient: ["Ravi Example"] }` is refused; the contract example payloads still pass.

### PR044-SEC-09 (INFO, CWE-755, A04): replay iteration runs outside the guards

**What (R2, R5).** `for (const event of options.replay ?? []) send(event)` runs in the Promise executor. `send` catches what one event throws, but not what the iteration throws: an iterator that throws, or an array element accessor that throws. On the real app at this head, with a replay array whose element 1 has a throwing accessor:
- the hook rejects, and the slot destroys the response (client: reset);
- per round 1's path, one `http.request_failed` ERROR line and one `console.error` call;
- the heartbeat interval and the 30 s cap timer stay armed, so 30 s later the route's `onFailure` hears `max_duration` for a stream that ended 30 s earlier.

The module comment says that no step throws into the slot. That holds for plain arrays, which is what a route passes (its replay read comes from Prisma), but not for every value of the declared type `readonly SseEvent[]`.

**Exploitability and impact.** No client path reaches it; a producer defect does. The effect is one misleading log line and 30 s of timers. INFO.

**Remediation (code-level).** Wrap the loop: `try { for (const event of options.replay ?? []) send(event); } catch (error) { fail({ reason: 'producer_failed', cause: error }); }`. Part 044-B rewrites this start anyway (B4: "a stream that starts with `ending` aborted writes its replay first").

**Verification.** A unit row: a replay whose second element throws on access gives frames `[event 1, error INTERNAL_ERROR]`, `onFailure` hears `producer_failed` once, and after advancing the fake timers past 30 s nothing more is heard.

## R2.5 QG-044-C3: concurrence with D-ARCH-218, D-ARCH-219, D-ARCH-221 and D-ARCH-223

Read: the four entries, the rulings file §3 to §5 with proofs (a) to (i), ADR-0003 rules (m) to (q), and D-QG-007 (its reading of round 1's drain condition, observations 2 to 4, QG-044-C4). Nothing of part 044-B exists yet. This is a design concurrence, and the security round of part 044-B checks the code against it.

| Decision | Security position |
|---|---|
| D-ARCH-218 (rule (o)): two slot constants, chosen by the kind of result; no handler value is read | **Concur.** It is stricter than round 1's allow-list: no parser, and no handler text reaches the header. Both values contain `no-store`, so SEC-TC-29 holds whichever constant the result kind selects. The handler controls the result kind, and both choices are safe. A response that is not private is left alone. No stream operation of the contract is anonymous (D-QG-007 checked both), so only a test fixture is a public stream, and there `SSE_HEADERS` carries the stream constant. The token-set fallback of the alternatives is not needed |
| D-ARCH-219 (rules (m), (n)): a 31 s stream deadline only with the drain signal; the drain ends streams with `error` within 1 s | **Concur with the reading.** Round 1's condition had a purpose. A stream must not hold a stopping process up to the forced close; a normal stop must end streams with a terminal frame, not a reset; and the error-rate signal behind ROLLBACK_TRIGGERS must not track normal traffic. The design meets all three. After the drain starts, a stream holds the process for at most 1 s plus the cut, and it ends with the frame. A composition without the drain signal keeps 20 s. The 31 s deadline applies only where the drain ends streams. The cut at 31 s without a frame happens only to a stream that ignored its own 30 s cap, which is a defect logged once at ERROR (`api.stream_cut`, `deadline`). The literal "below 25 s" would cost a contract change and give a worse stop |
| D-ARCH-221 (rule (p)): no ERROR line for a client that goes away; `api.stream_cut` once per cut; after the headers the problem handler logs, destroys and returns | **Concur.** This is round 1's optional remediation of PR044-SEC-04. PR44-SEC-13 stays closed by construction: no path reaches `console.error`. The access line (`aborted: true`, route template, status, duration, correlation ID) is enough for detection; I withdraw the second info line round 1 proposed. A client can no longer inflate the ERROR rate by opening and dropping streams. A disconnect during a `call` (the scope note) changes only logging. A client that leaves before the response learns nothing, so dropping the ERROR line adds no oracle. The failed-authentication budget (D-TASK041-12) is unaffected |
| D-ARCH-223 (rule (q)): no backpressure; cut above 1 MiB of unsent bytes, WARN `buffer_limit` | **Concur.** It bounds the T-47 slow-reader case. Per stream, memory stays at most 1 MiB plus one frame (at most 192 KiB in UTF-8) plus socket buffers, for at most 31 s. With the stream caps (2 per IP, 5 per user; PR044-SEC-05), that is a few MiB per principal. A client that never reads and receives only heartbeats is ended by the deadline. D-QG-007 observation 3 stands: a replay counted in full must stay below the bound with room for a live event (TASK-141 card line 14), or every open is cut. TASK-142's "reopen once, then poll" bounds that loop |

Conditions for the security round of part 044-B (they become C-items of that round, not of this PR):
1. Proofs (a) to (i) and the `deadline` proof of QG-044-C4, each with its log assertion. `api.stream_cut` carries only the operation id, the route template, the correlation ID and the reason: no value, no cause text.
2. Proof (f): a slot without the drain signal never gives a stream more than the call deadline. Proof (e): `startApi` aborts the signal it handed to `createApp` before `server.close()`.
3. Proof (g) under `env=production` with a `console.error` spy, including a hook that rejects after the headers (PR044-SEC-09's shape is a good fixture).
4. The stream slot of T-47 (TASK-041 `streamSlotRule`, consumed by TASK-141 and TASK-173): TTL at least 31 s plus margin, and released on `res.once('close')`. Also, release must run before the drain closes the Valkey client. Otherwise a stream ended by the drain keeps its user's slot until the TTL expires, and the resume on another replica is refused with 429. That is an availability edge for the user's own slot, checked at TASK-141.
5. The threat model's T-47 mitigation cell and AC-46 cell follow ADR-0016 amendment 14 item 5 (D-ARCH-224 O-4; QG-044-C3 last bullet): mine, at the latest in that round.

## R2.6 Conditions, follow-ups and routing

| ID | Condition or follow-up | Owner | Due |
|---|---|---|---|
| C1, C2 | Met (R2.3) | - | - |
| C3 | Lane B green on `3b56ab54` (R2.7) | orchestrator (lane B) | Before merge |
| C4 | Whichever of PR #80 (`0f0d92a0`, with part 040-B PR 1 `a4aadd2e` stacked on it) and this PR merges second: the union, the R1-m4 edit (delete the unused `appError` of `problem-handler.ts`), lint on the union, and a security merge-only round (R2.8; simulation C6 in R2.9) | the second merger's developer; security-analyst | Before that merge |
| F1 | PR044-SEC-04 | part 044-B (D-ARCH-221, B5, proof (g)) | Before TASK-141 is dispatched |
| F2, F4 | Unchanged (round 1 §6); on the TASK-141 and TASK-173 cards since D-SD-012 | TASK-141, TASK-173 | As round 1 |
| F6 | PR044-SEC-08 (a) to (c) | part 044-B developer | Before TASK-141 merges |
| F7 | PR044-SEC-09 | part 044-B developer | Before TASK-141 merges |
| G1 | The five conditions of R2.5 for the security round of part 044-B | part 044-B developer; security-analyst | That round |

SEC-TC-84 (round 1 §6) stands. Its unit pins and api rows exist at this head.

## R2.7 Lane B cases for C3

`tests/api/event-stream.api.test.ts` on `3b56ab54`, 12 tests, no database:
- round 1's 9: AT-US-042-01 to -08 (AT-04 and AT-05 in one test, about 30 s), the resume test and the malformed `Last-Event-ID` 400. The `error` rows now expect no id;
- the two C1 rows: "a "complete" whose data has a toJSON returning an e-mail address" and "a live event with an e-mail address as a key". Each ends with `error` `INTERNAL_ERROR` after the two replayed events, with no `example.org` on the wire, and `onFailure` hears `event_refused` once;
- the D-ARCH-220 resume test (event 1, then `error` without an id, then a reopen from 1 delivers 2, 3 and `complete` 4).

Each must be in the JUnit by title. AT-US-042-01 and -05 stay proven in a test composition only until part 044-B (the header comment says so; D-QG-007 G3 list).

## R2.8 Unions and the merge-only round

| Union with | Tree | Result |
|---|---|---|
| main `a3c0b1af` | `f009f660` | Clean |
| PR #80, TASK-040 v2 `0f0d92a0` | `d00a9a7e` | Clean. `problem-handler.ts` keeps `next(new AppError(code))` after the headers (PR44-SEC-13 holds); `appError` is declared and no longer used (R1-m4) |
| TASK-040 part 040-B PR 1 `a4aadd2e` (stacked on `0f0d92a0`) | `0b3b8f37` | Clean; the same two observations |
| TASK-042 `b8ba7788` | `5e1bf6a8` | Clean (`packages/ui/src/index.ts`, unowned) |

Both PR #80 and this PR change the owned `problem-handler.ts`. Whichever merges second brings an owned change in through main, and that voids this binding (R2.9 C6). Hence C4.

## R2.9 Record binding

Main's real checker (`tools/ci/check-security-owned-paths.mjs` at `a3c0b1af`) in a sparse shared clone, merge-ref form: the record committed on main's tip, `git merge-tree` with the head, then `commit-tree` with both parents, `--pr 9999`. Record content: this file with round 2 appended, under the name `PR-9999-TASK-044-security-review.md`.

| Scenario | Expected | Result |
|---|---|---|
| S1 the record on main merged with the head (`--base` = merge base `530629f4`) | pass | pass, 11 owned, satisfied by `3b56ab54` (the note on round 1's `dc64193f`, with 6 owned paths changed after it, is expected) |
| S1b the same with `--base` = the main commit that carries the record | pass | pass, satisfied by `3b56ab54` |
| S2 a docs-only lane-B evidence commit after the head | pass | pass |
| S3 an unowned edit after the head (`packages/ui/src/sse/fetch-sse-parser.ts`) | pass | pass |
| S4 the branch merges a docs-only main | pass | pass |
| C1 no record | missing | missing |
| C2 the record only under this `PR-pending` name | missing | missing: the orchestrator renames it once the PR exists |
| C3 a later FAIL verdict row | missing | missing (verdict FAIL) |
| C4 round 1 alone (the record before this section) | missing | missing: `dc64193f` has 6 owned changes after it |
| C5 an owned edit after the head (`sse/privacy.ts`) | missing | missing: "names 3b56ab5, but …privacy.ts changed after it" |
| C6 the branch merges a main that also changed `problem-handler.ts` (PR #80 squash-merged first; `--base` = the new merge base) | missing | missing: "names 3b56ab5, but …problem-handler.ts changed after it" (C4 of R2.6) |
| C7 round 2's Head row naming a main commit (round 1's `dc64193f` row stays) | missing | missing |

12 of 12 as expected (main tip `a3c0b1af`). The combined record has two `Head` rows (`dc64193f`, `3b56ab54`) and two `Verdict` rows; the last one is this round's.

## R2.10 Verdict

| Field | Value |
|---|---|
| Verdict | PASS_WITH_CONDITIONS. No Critical, High or Medium finding open at `3b56ab54`. Closed: PR044-SEC-01 (MEDIUM), PR044-SEC-02, PR044-SEC-03, PR044-SEC-06; R1-n2; conditions C1 and C2 met; D-ARCH-220 holds. Open: LOW PR044-SEC-04 (F1, part 044-B), LOW PR044-SEC-05 (F2), INFO PR044-SEC-07 (F4), new INFO PR044-SEC-08 (F6) and PR044-SEC-09 (F7). Merge conditions: C3 lane B green on `3b56ab54`; C4 the merge-only round with PR #80. QG-044-C3: concurrence given with D-ARCH-218, -219, -221 and -223 (R2.5), with conditions G1 for the security round of part 044-B |
