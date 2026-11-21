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
