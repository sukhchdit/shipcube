# Code review: PR #20 (TASK-010 structured, redacted logging with correlation and request IDs)

- **Reviewer:** code-reviewer
- **Date:** 2026-11-13
- **Round:** 1
- **Head:** `dae1f961bc2dd9070b58fedaca5b1f17b69a447f`. Base `origin/main` `80ff2c2` was merged in at `18d761c` and brought in TASK-016 / PR #18.
- **Commits:** `13b1017` (contract and subpath) ← `37ee7c1` (shared core) ← `f64b65e` (api and worker wiring) ← `18d761c` (merge of main) ← `dae1f96` (db security sink and `onDbError`)
- **Stories / items:** US-008 (sheet says "completes"); SEC-TC-31 (app part); PR7-SEC-03 item 3; PR6-SEC-02 item 3 / PR6-SEC-03 item 1; PR9-SEC-10; PR #9 r1 m5 (AT-US-007-03 at the sink); PR #11 R3-m1 (i) / R3.6 (D-ARCH-079); the `onDbError` hook deferred by PR #11.

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The logger core is solid. Every regex is linear: worst case is about 3 ms per 8 KiB string, so there is no
         ReDoS. Reserved keys hold, a log call never throws, the DB serializer is identifier-only, and the
         request_id / client_correlation_id design is right. Two MAJOR findings block the merge:
         M1, the "server-only" @platform/shared/logging subpath is not enforced. web, admin, ui and pricing can import
         Pino with 0 lint errors.
         M2, AT-US-008-03 is PARTIAL, but none of the named owner tasks owns the rest.
FINDINGS: M1, M2 (MAJOR); m1-m5 (MINOR); n1-n9 (NIT).
GOOD: in-house deep walker with null-prototype output; own-data-property reads everywhere; the DB error shape is pinned
      by an end-to-end P2039 test; exact key-set pin on the runtime security line; random sentinels in SEC-TC-31.
SECURITY-FLAGS: M1 (layering, Pino in browser/pure bundles); m1 (stack getter claim); m2 (deny-list PII filter on
      security events); m4 (free-text redaction gaps, including IDN e-mail masking); m5 (no per-line budget, 16 MB /
      3.9 s line). The lane A security-owned-paths record must name the final head (package-lock.json,
      tools/tsconfig.json).
```

## 1. Verification performed

The worktree was used read-only. All experiments ran in a `git archive dae1f96` copy in the reviewer scratchpad, with `node_modules` junctioned to the worktree (same SHA; `@platform/*` links resolve to identical sources). Afterwards the junction and the copy were removed: no link at `C:\`, worktree `node_modules` count 740, `git status` clean. I did not run npm ci, builds, Docker or full suites, because of the memory-constrained host (dispatch CONSTRAINTS).

| Check | How | Result |
|---|---|---|
| Lane A | `gh run view 43336647930` (head `dae1f96`) | `fast-lane` success: lint, format, typecheck, unit, base-ref fixtures, build, no tree mutation. `scans` fails only at "Security-owned paths need a review record"; `ci-gate` fails as the aggregate |
| Unit tests (single files) | Jest `--selectProjects unit` per file in the copy | `logger.test` 19/19, `redaction.test` 83/83, `serializers/error.test` 15/15, `security-event.test` 10/10 |
| Regex linearity / ReDoS | tsx probe, 12 adversarial 8 KiB vectors (alnum runs for the `{1,64}` key class, `a.`×n, `bearer`+spaces, `basic `×n, `a@`+runs, `x@a.a.a…`, unterminated quotes, `token=a&`×n, `A_`×n+`a`, `pi_`+run) | 0.3–3.1 ms each, linear. No ReDoS. Inputs are capped at 8192 before any regex |
| Per-line budget | 20 × 99 keys × 8 KiB strings through `createLogger().info` | **3,921 ms synchronous, one 16.2 MB line** (m5) |
| Free-text leak probe | `redactString` over 17 vectors with a sentinel | 9 leaks (m4 table); Bearer/BEARER, `x-api-key:`, Set-Cookie, JWT, sk-shapes are redacted |
| Stack getter claim | `serializeThrown` on errors whose `stack` getter is (a) a bound user function, (b) a Proxy of one, (c) the plain function | (a) and (b) **invoked** the user getter (2 calls) and logged its output; (c) not invoked (m1) |
| V8 accessor identity | `Object.getOwnPropertyDescriptor(e,'stack').get` for Error, TypeError, a subclass and `captureStackTrace` | Same function in all four. Node 24 `stack` is an own accessor, as the PR states, so an identity check is possible (m1 fix) |
| Line integrity / reserved keys | Fields with `"`/`\n`/U+2028 in keys and values, `level`, `msg`, `time`, `pid`, `hostname`, `__proto__` (with a forged `correlation_id`), `constructor`; child bindings forging `service`/`correlation_id`; context value with `\n{"level":"fatal"}` | One line per call, JSON-escaped, no duplicate raw keys, reserved keys never overwritten, `__proto__` dropped (not lifted), context injection escaped |
| Security PII filter | `sink.emit('login_failed', {…})` with 15 PII-shaped keys | `username`, `user_name`, `display_name`, `client_ip`, `remote_ip`, `recipient_name`, `company_name`, `dob`, `passport_number`, `tax_id` are **written** (m2) |
| Layering | Light lint probe: the worktree `eslint.config.mjs` over a probe root with `import … from '@platform/shared/logging'` in `apps/web/app`, `apps/admin/app`, `packages/pricing/src`, `packages/ui/src`; positive controls `@platform/config` in web and `pino` in pricing | **0 errors in all four.** Both controls fire their boundary messages (M1) |
| Plan ownership of AT-US-008-03 | `grep` of `docs/04-plan/tasks/*.md`, `STATUS.md`, gherkin map | Only TASK-010 lists AT-US-008-03. TASK-029/035/047 have no AT-US-008-03 line; there is no ROUTED entry; WAVE-00:9 lists US-008 as completed (M2) |
| PR #21 overlap | `git merge-tree --write-tree dae1f96 b0ede35` | Textual conflicts in `app.ts`, `main.ts`, `request-context.ts` only (see §5) |
| Not re-run | — | Coverage (PR: 97.89/96.85, logging folder 99.1/95.9); `test:api` (`logging.api.test.ts` read, not run); integration (`session-scope-leak.int.test.ts` expectation change read, not run). I relied on the PR's gate table and lane A |

## 2. Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| M1 | MAJOR | `packages/shared/package.json:14-18`; `eslint.config.mjs:327-332`, `:380-388` | **The server-only subpath is not enforced.** The PR (decision 1, D-TASK010-01) says Pino "never reaches browser bundles or packages/pricing". Both the web/admin allow (`toPackage('@platform/shared')`) and the pricing allow expand to `@platform/shared/**`, so they admit `@platform/shared/logging`. My probe confirms that web, admin, ui and pricing can all import `createLogger` (Pino) with 0 lint errors, while the controls fire. Before this PR `@platform/shared` had no I/O, so those allow-lists were sound. This PR quietly breaks ADR-0003's "packages/pricing has no I/O imports" and the browser-bundle rule. ADR-0003 am. 2 is the precedent: the `@platform/config/web` subpath was encoded in lint with one fixture per arm | Add disallow policies for `@platform/shared/logging` (external-specifier arm `@platform/shared/logging` + `/**`) and for the resolved-file arm (`packages/shared/src/logging/**`) from `apps/{web,admin}` application and build-config code, `packages/ui` and `packages/pricing`. Add negative fixtures per arm plus a positive control, as in the ADR-0003 am. 2 conventions. `eslint.config.mjs` sits under the `lint` lock, so the orchestrator either grants the touch in this PR (preferred) or rules the guard to an owner. In that case the PR body and D-TASK010-01 must say "convention, not enforced" until it lands |
| M2 | MAJOR (docs/plan only) | PR body "AT-US-008-03 PARTIAL"; `docs/04-plan/tasks/WAVE-00.md:9`, `:365`, `:389` | **The partial AT has no owner.** The sheet says TASK-010 *completes* US-008 and lists "all 6 scenarios". The PR delivers AT-US-008-03 for the api and worker log lines only. It says the audit entry, outbox event, job payload and Mock carrier call "complete with TASK-029/035/047 and the saga", but none of those sheets has an AT-US-008-03 line or a correlation end-to-end acceptance test. TASK-035 only puts `correlation_id` in the payload. There is no STATUS ROUTED entry either. This is the PR #13 M1 pattern: a "completes" story with an unowned scenario is silently dropped | Orchestrator/product-manager re-scope decision (CLAUDE.md §7 step 3): either split US-008 (AT-03 end-to-end goes to a named task, normally the one that runs the M0 booking through the worker, with sheet ATs for each hop: audit, outbox, job payload, Mock carrier call), or fold AT lines into TASK-029, TASK-035, TASK-047 and the Mock-carrier/saga task. Also: update WAVE-00:9 and the plan data; relabel the PR "partially completes US-008"; add a STATUS ROUTED line. No code change |
| m1 | MINOR | `packages/shared/src/logging/serializers/error.ts:47-71`; test `serializers/error.test.ts:65` | **The "native-only stack getter" check can be bypassed.** `Function.prototype.toString` returns `function () { [native code] }` for **bound functions and Proxies**, so a user getter wrapped in either one is invoked (probe: 2 invocations; its string was logged as `stack`). The JSDoc says "never a user-defined getter". The impact is low (thrown values are code-built, and the call is inside `try`), but the claim is false, and a getter with side effects or a non-terminating getter runs inside the logger | Capture the V8 accessor once at module load: `const V8_STACK_GET = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get`. Invoke a getter only when `getter === V8_STACK_GET`; the probe shows one shared function for Error, subclasses and `captureStackTrace`. Cross-realm errors then log without a stack, which is acceptable; or check the vm realm's accessor too. Add bound-function and Proxy cases to the test |
| m2 | MINOR | `packages/shared/src/logging/logger.ts:28-46`, `:83-96` | **The security-event PII filter is a deny-list** of 8 substrings and 2 exact keys. These pass through to the security line (probe): `username`/`user_name`, `display_name`, `recipient_name`, `company_name`, `client_ip`/`remote_ip` (raw IP; §13 allows *coarse* IP only), `dob`, `passport_number`, `tax_id`. api/README §13 says "raw identifiers never appear", and the sheet AT is "never raw PII". The catalogue already declares each event's extra fields | Per-event attribute allow-list: a map from event name to permitted attribute keys, derived from the §13 "Extra fields" column (plus `correlationId`/`sqlState` for the runtime events). Drop and count anything else. Test: every README extra field is allowed, and an unlisted key is dropped. If this is not done here, name the owner (the first catalogue emitter, Wave 1 auth) in the sheet before merge |
| m3 | MINOR | `packages/shared/src/logging/security-event.ts:35-66`; `apps/api/src/platform/logging/security-events.ts:2-4` | **Runtime security events are not single-sourced.** `RUNTIME_SECURITY_EVENTS` lists only `db_session_context_leak`, but five events go through the sink. `db_session_default_tampered` (it latches readiness) and `db_privilege_denied` (a 500 grant misconfiguration) therefore fall back to `warn`. That breaks the module's own rule at :40 ("integrity … failures are errors") and lowers the alerting level of the most serious DB events | List all five in `RUNTIME_SECURITY_EVENTS` with levels: tampered `error`, privilege_denied `error`, drift `warn`, rls_write_rejected `warn`, leak `error`. Add a type-level exhaustiveness test in apps/api showing that `SessionIntegrityFinding \| DbSecurityEvent` is assignable to `RuntimeSecurityEventName`, so a new DB event cannot default silently |
| m4 | MINOR | `packages/shared/src/logging/string-redaction.ts:79`, `:85`, `:95`, `:141-171` | **Free-text redaction gaps** (defence in depth; the structured key path is the primary control). Each was proven with a sentinel: (a) `password:` followed by 4+ spaces; (b) the value on the next line (`password:\n  v`); (c) a `Cookie:` string's second and later pairs (`Cookie: theme=dark; sid=v`; this is SEC-TC-31 territory); (d) double-encoded JSON `{\"password\":\"v\"}`; (e) `API key: v` (key with a space); (f) Digest `Authorization` `response="v"`; (g) **IDN e-mail `alice@exämple.com` is not masked** (REQ-PLAT-012 masking applies to all log values); (h) a quoted local part. Also, structured keys `otpCode`/`mfaCode`/`verificationCode`/`passcode` are not sensitive: `otp` is exact-only, and a plain `otp` substring would hit "f**otp**rint" | (a)/(b): allow `[ \t]{0,16}` plus one optional line break after the separator. (c): for `cookie`/`set-cookie` keys, redact to end of line. (d): treat `\"` as a quote in `KEY_SEPARATOR` and `valueEnd`. (g): `EMAIL_DOMAIN` labels `[^\s.@"'<>()[\]{},;:]{1,63}`. (e)/(f): optional; at least record them as accepted gaps in the header comment. Add `otpcode`, `mfacode`, `verificationcode`, `passcode` as parts. One test per vector |
| m5 | MINOR | `packages/shared/src/logging/redaction.ts:24-30`, `:42-45` | **No per-line size or time budget.** The node cap (2,000) times the string cap (8 KiB) allows a **16.2 MB line**, built in **3.9 s synchronously** (probe). Redaction costs about 0.3 µs per character, so every MB of logged string data blocks the event loop for about 0.3 s. Today nothing logs body-derived data, but the logger is the seam every later task uses, and the JSON body limit is 1 MB | Add a per-call character budget to `WalkState` (for example 64 KiB of string characters, then `TRUNCATED`). Test both the bound on line length and a time bound with headroom |
| n1 | NIT | `string-redaction.ts:197-199` | Keys can be data, but only e-mails are masked in keys. A JWT- or `sk_live_`-shaped key is written verbatim (probe) | Apply `SECRET_SHAPE` to keys and write `[REDACTED_KEY]` |
| n2 | NIT | `apps/api/.../request-context.ts:15`, `apps/worker/.../job-context.ts:117`, `logger.ts:34` | The correlation pattern exists three times, and the logger's copy (`^[A-Za-z0-9._:-]{1,128}$`) differs from ADR-0016 §15 | Single-source `CORRELATION_ID_PATTERN` in `@platform/shared` and import it in all three |
| n3 | NIT | `apps/api/src/platform/errors/problem-handler.ts:16-21` | The JSDoc is stale: "Minimal logger seam until Pino arrives … the interim runtime log ignores it". The Pino logger now serialises `thrown` | Update the comment |
| n4 | NIT | `logger.ts:117-130` | The fallback line has no `correlation_id`/`org_id`/`actor_id`, so it breaks AT-US-008-05's "every line" in the degraded path | Write them as `null` |
| n5 | NIT | `apps/api/src/platform/logging/security-events.ts:18-25` | This is a second sink implementation without the `EVENT_NAME` check of `createSecurityEventSink` | Validate the name here too, or adapt `RuntimeLog` and delegate |
| n6 | NIT | `request-logger.ts:45-52` | A nested `router.use('/x', sub)` gives `/api/v1` + the leaf pattern and drops `/x`, so the template is misleading until TASK-020 | Confirm that the TASK-020 sheet sets `res.locals.routeTemplate` for every route; until then, document this in the header |
| n7 | NIT | `request-logger.ts:56-77` | `/health/*` probes produce an `info` access line every probe interval | Log health routes at `debug` (or sample them) |
| n8 | NIT | README §13 header vs `logger.ts` | §13 says every security line carries a coarse IP and increments `security_events_total{event}`. Neither exists, and the PR names no owner | Name owners: coarse IP with the first authn/rate-limit task; the counter with the metrics/telemetry task (US-013) |
| n9 | NIT | `logging.api.test.ts:169-183` | The AT-US-007-03 sentinel `secret-token-123` is redacted only by the keyword-in-word rule, so the test would not catch a regression in the pair or shape rules | Add a non-keyword secret through a `password=` pair in the message |

## 3. Reviewer-focus answers

1. **string-redaction.ts regexes:** linear. `AUTH_SCHEME` uses disjoint classes; `KEY_SEPARATOR` is bounded at `{1,64}`, so at most ×64 per start position (about 2.4 ms per 8 KiB); `WORD` is a single class run; `SECRET_SHAPE`, `CATALOGUE_IDENTIFIER` and `EMAIL_DOMAIN` are anchored, with disjoint separators. Input is capped at 8192 first. No ReDoS. The word rules behave as documented; their gaps are in m4.
2. **Native-only stack getter:** the premise holds (an own accessor in Node 24) but the check does not (m1).
3. **Reserved keys / never-throw:** both hold under my probes. Reserved keys survive fields, bindings, snake_case security attributes and `__proto__`. A throwing destination or context gives the fallback line or nothing (fallback content: n4).
4. **db/runtime.ts sink wiring:** correct. `onSecurityEvent` gets exactly `{correlationId?, sqlState?}`, and `component` is gone. `onDrift` emits without attributes. `onDbError` logs the original error through the identifier-only serializer, is `try`-guarded, and never becomes `cause`. The integration expectation (`error`, `{correlationId}`) matches the sink. Levels: m3.
5. **request_id / client_correlation_id:** `requestId` is always `randomUUID()`. `clientCorrelationId` is set only when the value matches `^[A-Za-z0-9-]{8,64}$` as a single header (Node joins repeated headers with `, `, so they fail the pattern). JSON escaping makes context values injection-safe even when unvalidated (probe). PR9-SEC-10 is closed.
6. **Layering:** not enforced (M1).
7. **AT-US-008-03 PARTIAL:** the claim is honestly labelled in the PR and in D-TASK010-01, but the named owners do not own it (M2).
8. **Test quality:** good. Random sentinels, exact key-set pins, a hostile-Proxy case, a fast-check property on e-mails, and all six levels in SEC-TC-31. Gaps: the bound/Proxy getter (m1), non-keyword secrets (n9), IDN e-mail (the fast-check generator is ASCII-only).
9. **Coverage 99.1/95.9:** not re-run (constraint). This PR is under the 85/75 global target. The logging folder is not among the 95% packages (pricing, audit, authz).

## 4. Deviation rulings

- Specialist on opus instead of sonnet: accepted (turn-limit history).
- In-house deep walker instead of Pino `redact` paths: accepted. Pino paths cannot catch sensitive keys at arbitrary depth.
- Accepted over-redaction (`token_type`, `grant_type: client_credentials`, `invalid_token`, `basic <word>` in prose): accepted. It costs diagnostic value, but it fails closed.
- Route template = mount prefix + `req.route.path` until TASK-020: accepted (n6).
- `version` from package.json (`0.0.0` today; `0.0.0-unknown` when the manifest is unreadable): accepted. TASK-014 owns the image-tag injection; there is no Dockerfile yet.
- `RuntimeLog.warn/error` take the thrown value, and DB errors log `db.error_mapped`: accepted.
- Change request to api-designer to list the runtime `db_*` / `rls_write_rejected` events in §13: agreed. Make it consistent with m3's list of five.

## 5. Follow-up closure

| Item | Status |
|---|---|
| PR7-SEC-03 item 3 (DB errors as `{name, code, originalCode, kind}`) | **Closed.** Serializer, P2039/P2010/pg unit tests, and an end-to-end P2039 through the problem handler |
| PR9-SEC-10 (server request ID + validated client ID) | **Closed** |
| PR #9 r1 m5 (AT-US-007-03 "full error in logs") | **Closed.** Class, redacted message and capped stack in `http.request_failed`; generic body |
| PR #11 R3-m1 (i) / R3.6 (D-ARCH-079) | **Closed**, with level caveat m3 |
| PR #11 DEFERRED `onDbError` redacting hook | **Closed** (2 unit tests) |
| PR6-SEC-02 item 3 / PR6-SEC-03 item 1 | **Closed at the logger** (OMITTED keys, `outboundCallFields` allow-list). Carrier adapters must use `outboundCallFields`; carrier tasks to note it |
| SEC-TC-31 (app part) | **Closed** for structured headers; the free-text Cookie gap is m4(c) |
| SEC-TC-63 | **Closed** (both directions against README §13) |
| PR9-SEC-12 | Not here (TASK-014) |

## 6. Merge conditions

1. M1 and M2 resolved. M1 needs code plus fixtures, or an orchestrator ruling with an owner and corrected PR/decision text. M2 is a plan decision plus sheet edits. m1–m5 are fixed in-PR or each routed to a named owner (m2 to the first emitter task if deferred).
2. A lane A security record naming the final head (`package-lock.json`, `tools/tsconfig.json` are security-owned).
3. Lane B integration on the final head (`prisma/tests/rls/session-scope-leak.int.test.ts` changed).
4. **PR #21 union (whichever merges second).** Conflicts are in `app.ts`, `main.ts` and `request-context.ts`. Keep:
   - `RequestContextOptions` = `{generateCorrelationId, generateRequestId, apiMode}`;
   - `RequestContext` = `{correlationId, requestId, clientCorrelationId?, apiMode}`, with `isRequestContext` checking `requestId`;
   - `app.use(requestLogger(logger))` directly after the context middleware;
   - `routes.use(API_PREFIX, routePrefix(API_PREFIX), api)`;
   - `AppLogger.info(…, AccessLogFields)`;
   - main.ts `createRuntimeLog` options plus `logger: log`.
   Make sure the docs router and OPTIONS responder lines log `route` as a template or `null`, never a raw path. Then re-run `test:api` (both suites, including PR #21's mounted-operations drift check against the extra `routePrefix` layer) and the unit suite.
5. Squash merge (the default).
