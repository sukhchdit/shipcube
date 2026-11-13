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

---

## Round 2 (head 9647907)

- **Reviewer:** code-reviewer
- **Date:** 2026-11-13
- **Round:** 2 (delta review after fix cycle 1 and two merges of main)
- **Head:** `964790786d69790819569c1423d34ab96c931f98`. Previous head was `dae1f96`.
- **Commits since r1:**
  - Merge `ce95d37`: origin/main `e82902d`.
  - Fixes: `36f19fc` (M1 lint), `93d1e11` (free text), `dcdbf44` (walker and budget), `75f3d4b` (stack and Joi), `67f8faa` (security allow-list, levels, brand, n2/n4), `182066f` (process handlers, api wiring, n3/n5/n6/n7/n9), `508c1f3` (`apiKey :` fix).
  - Merge `9647907`: origin/main `6ac9836`, which includes TASK-004 `f38e6b9`.
- **Rulings applied:**
  - D-062: US-008 split. PR #20 now "partially completes" US-008, and TASK-092 completes it.
  - D-ORCH-022: this PR may edit `eslint.config.mjs`.
  - D-SEC-PR20-01.
  - D-ORCH-024: the PR #20/#21 union rule.
  - D-ORCH-025: all 5 runtime DB events stay at `error`.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Every round-1 finding is closed: M1, M2 (via D-062), m1-m5 and n1-n9 (n8 routed). 22 of 22 mutations
         against the new guards were killed: 6 for the lint arms, 16 for the redaction, security, process and stack
         code. Both merges are pure unions and the lock delta is unchanged (one entry).
         Two new MINORs, both cheap to fix in this PR:
         - R2-m1: the M1 guard covers direct imports only. A shared-root re-export of the logging files still
           ships Pino to web/ui/pricing with 0 lint errors.
         - R2-m2: the general-line PII key class misses the platform's own personal-data keys `display_name` and
           `receiver_name`, and also `username` and `client_ip`.
FINDINGS: R2-m1, R2-m2 (MINOR); R2-n1..R2-n7 (NIT).
GOOD: one fixture per importer x arm with the arms isolated, so each policy arm has its own failing fixture.
      Identity check against the captured V8 accessor. Budgeted walker (the r1 16.2 MB / 3.9 s case now gives
      16.6 KB / 12 ms). Sink-only brand plus a dedicated always-on security Pino. The fast-check property found
      a real bug (508c1f3). The type-level runtime-event exhaustiveness test.
SECURITY-FLAGS: R2-m1 (Pino reachable through the shared barrel); R2-m2 (PII keys on general lines);
      R2-n1 (free-text residuals: JSON array/object values, PEM blocks, full-width keys).
      The security delta round must name the final head: owned paths changed since dae1f96.
```

### R2.1 Verification performed

The worktree was used read-only.
- **Probe copy:** `git archive 9647907` into the reviewer scratchpad. `node_modules` was junctioned to the MAIN checkout. The lock delta versus main is only the `@platform/shared` → `pino` edge, and pino is already hoisted there. `@platform/shared` and `@platform/api` were overridden with per-workspace junctions to the copy's sources.
- **Cleanup:** junctions and the copy were removed. Main `node_modules` still has 740 entries, there is no link at `C:\`, and the worktree `git status` is clean.
- **Not re-run:** Docker, integration, e2e, full coverage, build and full lint (dispatch memory cap). For those I relied on lane A run 43353973952 (head 9647907; `fast-lane` success: lint, format, typecheck, 120 suites / 2778 unit tests, build, base-ref no-weakening 146 passed / 9 skipped with 0 extras) and on the developer's gate table (integration 18 suites / 185 passed, coverage 97.81 / 96.22, logging folder 99.05 / 92.78, on `65a2eab`, which is tree-identical outside docs/.claude).

| Check | How | Result |
|---|---|---|
| Lane A | `gh pr view 20`, `gh run view 43353973952 --log` | `fast-lane` success. `scans` fails only at "Security-owned paths need a review record": 18 owned paths changed after the r1 record at `dae1f96` (eslint.config.mjs, package-lock.json, the 15 new fixtures, negative-fixtures.test.ts, tools/tsconfig.json). `ci-gate` fails as the aggregate. This is expected; the security delta round is pending |
| M1 fixtures | `negative-fixtures.test -t TASK-010` in the copy | 13 / 13 pass: 10 bad (4 importers × 2 arms, web `vite.config.ts`, web `pino`) and 3 ok (api specifier + pino, worker resolved file, web shared root) |
| M1 mutations | sed on the copy's `eslint.config.mjs`, then the same run | All killed: drop the `dependency.source` arm (5 fail); drop the `pino` arm (1); drop the resolved-file arm (4); drop the web/admin policy (6); drop the ui/pricing policy (4); narrow `{ui,pricing}` to `ui` (2) |
| M1 extra vectors | Probe root `layering/zz-probe` linted by the real `tools/lint/lint-fixtures.mjs` | **Blocked:** `import()`, `export {…} from`, `export * from`, `@platform/shared/logging/types`, `pino-pretty`, `pino/file`, `createRequire(...)('@platform/shared/logging')`, admin `vite.config.ts`, web `react-router.config.ts`, admin `.tsx`, ui `.tsx` with pino. **Clean (R2-m1):** `packages/shared/src/index.ts` with `export * from './logging/logger.js'`, plus web `import { createLogger } from '@platform/shared'` and a ui import of the shared root. (`sonic-boom` is also clean; it is out of scope) |
| No weakening of earlier boundaries rules | Diff of `eslint.config.mjs` 36f19fc; base-ref step; the merge's eslint hunk | Additive only: one file category and two policies at the end of `BOUNDARIES_POLICIES`, nothing after them. TASK-004's merged hunk only touches ignores and an `import-x` file block. Base-ref run: 0 extras |
| Targeted unit runs | Jest `--selectProjects unit -i` on `packages/shared/src/logging`, api `logging/` + `runtime/process-errors`, worker `logging` | 13 suites / 374 tests pass. One false failure, worker `job-context` through MAIN's `@platform/api` link, passes after the workspace override |
| Targeted api runs | Jest `--selectProjects api -i`, `apps/api/src/platform/(logging\|errors)` | 2 suites / 61 tests pass (`logging.api.test.ts` incl. the live SEC-TC-31 / PR20-SEC-01 case, `problem-handler.api.test.ts`) |
| Fix mutations | sed, one at a time, on the copy's sources; the same unit set | **16 / 16 killed:** getter identity → any getter (5 fail); `isLiveObject` → false (1); array pair markers off (3); `MAX_LINE_CHARS` → 1e12 (3); security allow-list → allow-all (4); security Pino → the level-gated instance (1); brand check removed (1); 508c1f3 reverted (1); drift → `warn` (3); `ip_coarse` unvalidated (1); stack header not rebuilt (4); `exiting` guard removed (1); cookie/authorization to-end-of-line off (4); NFKC off (1) |
| Free-text leak probe | `redactString` over 36 vectors with random sentinels | All r1 m4 vectors are closed: 4+ blanks, next line, second Cookie pair, `\"` JSON, `API key:`, Digest with and without `Authorization:`, NBSP, `apiKey :`, quoted values with blanks, URL userinfo / query / `:\/\/`, `X-Quote-Token`, DPoP, `x-reauth-proof`, folded `Cookie:` continuation, `otpCode`. **Leaks:** the documented gaps (3-word key, 17 blanks, scheme-less userinfo), plus R2-n1: a JSON array/object value (`{"recoveryCodes":["c1","<v>"]}`, `{"credentials":{"user":"u","key":"<v>"}}`), a PEM private-key body, and a full-width key in free text |
| E-mail masking | 11 forms | Masked: IDN (`a***@exämple.com`), quoted local part, `%40`, upper case, `+`, `<…>`, `mailto:`. Not masked: `alice@localhost`, `alice @ example.com`, `&#64;`. Acceptable |
| Walker | Direct `redactValue` | `rawHeaders`-style pairs and `Object.entries(headers)` redacted (values after `Authorization`/`Cookie`, multi-value `set-cookie`). A sensitive *value* shifts the pairing but fails closed. Map → `[Unsupported]`, EventEmitter → `[Unsupported]`, Buffer → `[Binary]`. Accessor `password` not invoked. `card.number`/`expMonth`/`cvc` → `[REDACTED]`. JWT/`sk_live_` keys → `[REDACTED_KEY]`. **Gaps (NIT):** PII-named pairs in arrays (`['name','Alice']`) are not marked; `nameCount: "Alice"` is exempt by the count suffix |
| Live HTTP | `http.createServer` + a request with cookie (`__Host-rt_*` second), `x-quote-token`, `x-api-key`, Bearer and a query sentinel; logged `req`, `res`, `{...req}`, `socket`, `headers`, `rawHeaders` | No sentinel. `req`/`res`/`socket` → `[Unsupported]`; the spread copy's `rawHeaders`/`url` are omitted |
| Budget and time | `createLogger().info` | r1 case 20 × 99 × 8 KiB: **11.7 ms, 16,619-char line** (was 3.9 s / 16.2 MB). 30 adversarial 8 KiB fields in one call: 4.3 ms. One 100k-key object: 38 ms. **R2-n3:** 100 references to one 300k-key object took 2.0 s (and 2.1 s as array items), because `Object.keys` runs before the cap and is not charged. Four 8 KiB `"` fields plus an 8 KiB `"` error message gave a **50,246-char** line, because escaping and `err` are outside the budget |
| ReDoS | 30 adversarial 8 KiB vectors (the new `KEY_SEPARATOR` two-word / NBSP / `with value` / line-break arms, `\"` runs, `digest`, `token`+blanks, `a.` for `EMAIL_DOMAIN`, `%40`, quoted local parts, URLs, `sk_`, `eyJ`, `A_`, `apikey :`) | Linear. Worst 7.9 ms per string, which is the cap. Input is capped at 8192 before any regex |
| Stack getter | `serializeThrown` with a plain, bound and Proxy-wrapped user `stack` getter | Not invoked in any case (0 calls). A message scrubbed after the first `.stack` read does not reappear (header rebuilt) |
| Security events | Sink at `APP_LOG_LEVEL` silent / fatal / info; plain `logger.warn('security.login_failed', …)`; every `SECURITY_EVENT_FIELDS` key of every event with a benign value; 8 `ip_coarse` values | Written at every level, exactly one line. `username`/`clientIp` dropped (`dropped_attributes: 2`); `ip_coarse` `1.2.3.0/24` kept. The plain `security.*` warn is a general line without `event_type`, and it wrote `username: "bob"` (R2-m2). All allow-listed fields are written except `refresh_token_reuse.session_id` → `[REDACTED]` (known, D-ORCH-025 (3)). `ip_coarse`: `1.2.3.0/24` and `2001:db8:1::/48` kept. `1.2.3.4`, `/16`, a 4-group IPv6, `::1/48`, `::ffff:` and a leading zero are dropped |
| §13 parity | `SECURITY_EVENT_FIELDS` vs api/README §13 "Extra fields", by hand | All 22 rows match. Only the 5 runtime events add `sql_state` |
| Merges | `git merge-tree --write-tree P1 P2` vs M | `ce95d37` (dae1f96 + e82902d) and `9647907` (508c1f3 + 6ac9836): `git diff --stat <tree> M` is **empty** for both, so there is no hand resolution. Both-sides files: lock and `tools/tsconfig.json` in the first; `eslint.config.mjs`, lock and `negative-fixtures.test.ts` in the second. All merged cleanly |
| Delta conservation | File sets and `^[+-]` md5 | `6ac9836..9647907` has 65 files = r1 delta (`80ff2c2..dae1f96`) ∪ fix-commit files. Every r1-only file has an identical hunk md5 |
| Lock delta | `git diff --text` (the lock is `-diff`) | Identical to r1: only `packages/shared` gains `dependencies: { pino: ^10.4.0 }`. No new package |
| Current main | `git merge-tree 9647907 origin/main` (87fcd9e, docs only) | Clean |

### R2.2 Round-1 finding closure

| ID | Status | Evidence |
|---|---|---|
| M1 | **Closed** (residual R2-m1) | `eslint.config.mjs:58-59,173-174,221-233,412-419`; fixtures `tests/fixtures/lint/layering/shared-logging-server-only/**`; `negative-fixtures.test.ts:139-168,701-710`. Six mutations killed. Every direct form is blocked, including the build config, `import()`, re-exports and `createRequire` |
| M2 | **Closed** (plan) | D-062; PR body "Partially completes US-008 … TASK-092"; test titles suffixed at `logging.api.test.ts:119` and `job-context.test.ts:15`; sheet lines queued under SHEET-FOLD-2 (architect, OPEN) |
| m1 | **Closed** | `serializers/error.ts:54-61,81-93`: identity vs the captured V8 accessor. Probe: bound and Proxy getters are not invoked. Mutation killed (5 tests) |
| m2 | **Closed** | Per-event allow-list `security-event.ts:94-122`, `logger.ts:97-110`; drop count; §13 parity holds |
| m3 | **Closed per D-ORCH-025** | All 5 runtime events at `error` (`security-event.ts:79-83`); type-level exhaustiveness test in `security-events.test.ts`. I accept D-ORCH-025 and found no concrete harm. `rls_write_rejected` and drift are only reachable through a code or configuration defect, not by a client, so `error` gives no alert-flooding path |
| m4 | **Closed** (residual R2-n1) | Every r1 vector is redacted (§R2.1). Accepted gaps are listed in `string-redaction.ts:8-18` |
| m5 | **Closed** (residual R2-n3) | `MAX_LINE_CHARS` (`redaction.ts:53`), keys capped at 128, raw stack cut at 16 KiB. The r1 case went from 3.9 s to 12 ms |
| n1–n7, n9 | **Closed** | `[REDACTED_KEY]`; `CORRELATION_ID_PATTERN` in `@platform/shared` (`correlation/correlation-id.ts`); problem-handler comment; fallback nulls; api sink = shared sink; n6 documented (`request-logger.ts:7-9`); health probes at `debug`; pair-only sentinel |
| n8 | **Routed** (D-ORCH-025 (2)) | Coarse-IP emission → TASK-052+. The logger accepts and validates `ip_coarse`. The counter goes to the US-013 metrics task |

### R2.3 Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `eslint.config.mjs:412-419` | **The server-only guard covers direct imports only.** web, admin, ui and pricing may import the `@platform/shared` root (by design). Nothing stops a non-logging file of `packages/shared` from importing or re-exporting `packages/shared/src/logging/**` or `pino`. `barrel-reexport-only` permits `export * from './logging/index.js'` in the root barrel. My probe: root `export * from './logging/logger.js'` plus web `import { createLogger } from '@platform/shared'` gives **0 errors**. That is the most likely accidental path for Pino into the browser bundle, and it bypasses the M1 promise ("Pino never reaches browser bundles or packages/pricing"). Today no non-logging shared file imports logging, so a guard costs no churn | Add one policy: `from` = `packages/shared` files that are neither `shared-logging` nor `test`, `disallow: [{ to: toLayer('shared-logging') }, { to: toPackage('pino', 'pino-*') }]`, with the same message. Add a bad fixture (`packages/shared/src/index.ts` re-exporting a logging file) and an ok fixture (a logging file importing `../correlation/…`). Mutation: dropping the policy fails the fixture. Preferred in this PR, because the eslint touch is already granted (D-ORCH-022) and the security delta round is due anyway. Otherwise route it to TASK-020 with a STATUS line |
| R2-m2 | MINOR | `packages/shared/src/logging/string-redaction.ts:78-111` | **The general-line PII key class misses personal-data keys of this platform's own contract.** `openapi.yaml` has `display_name` (17 occurrences) and `receiver_name` (3, the POD signer). Neither normalised key contains a listed part (`displayname`, `receivername`), so `log.info('x', { receiverName })` writes the name in clear. The same holds for `username`, `user_name`, `recipient_name`, `sender_name` and the IP keys `client_ip`, `remote_ip`, `x-forwarded-for`, `x-real-ip`: `ip` is exact-only, and only `ipaddress`/`remoteaddress` hit `address`. Probe: a plain `security.login_failed` warn wrote `username: "bob"`. PR20-SEC-02 asked for "PII-key redaction on every line", and the fix cycle advertises it | Add parts `displayname`, `receivername`, `recipientname`, `sendername`, `shippername`, `consigneename`, `username`, `legalname`, `clientip`, `remoteip`, `sourceip`, `userip`, `forwardedfor`, `realip`. Do not add a bare `ip` suffix: it would hit `relationship`/`membership`/`ship`. Extend the carrier-shaped object test with these keys, and add a negative test that `carrier_name`/`service_name`/`job_name`/`entity_name` stay readable. Security-analyst confirms the list in the delta round (`legal_name` of a sole trader is personal data) |
| R2-n1 | NIT | `string-redaction.ts:331-347` (`unquotedEnd`) | Free-text residuals beyond the documented list. (a) A JSON array/object value ends at its first `,`, so `{"recoveryCodes":["c1","<v>"]}` and `{"credentials":{"user":"u","key":"<v>"}}` keep `<v>`. Header line 11 covers this in its letter, but recovery codes are credentials. (b) A PEM block (`-----BEGIN … PRIVATE KEY-----` … `-----END`) body is kept. (c) A full-width key in free text (`ｐａｓｓｗｏｒｄ=v`) is not folded, because `KEY_SEPARATOR` is ASCII-only, while structured keys are NFKC-folded | (a) When the value starts with `[` or `{`, scan to the matching bracket with a quote-aware depth counter capped at the line end. Fail closed to the end of the line. (b) Redact `-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END[^-]*-----\|$)` (bounded by the 8 KiB cap). (c) Run `normalize('NFKC')` on the text before the pair pass, or list it as an accepted gap. Optional; the security delta round may rule them accepted |
| R2-n2 | NIT | `redaction.ts:135-152` | Array pairs use only the sensitive and omitted classes. A PII name followed by its value (`['name','Alice']`, `['email', …]` is masked anyway) is written. `COUNT_SUFFIX` exempts `nameCount: "Alice"` | Use `keyMarker(previous, undefined)` in `pairMarker`, or document it |
| R2-n3 | NIT | `redaction.ts:48-53`, `:154-171` | The JSDoc claims "one call costs milliseconds and its fields stay near 16 KiB, below the Docker json-file line split, whatever is logged". (a) `Object.keys(value)` runs before `slice(0, MAX_KEYS)` and is not charged. A huge object referenced repeatedly (siblings, not a cycle) is re-enumerated on each visit: 100 × 300k keys took **2.0 s**. Not reachable from a 1 MB JSON body (one pass, about 40 ms). (b) JSON escaping (`"` ×2, controls ×6) and the `err` value (message + stack + 3 causes) are outside the budget: a 50 KB line was produced, which Docker splits at 16 KiB | (a) Charge `Math.min(keys.length, …)` to `state.chars`, or keep a per-call `WeakSet` of visited objects that writes `[Repeated]`. (b) Reword the claim ("fields are budgeted at 16 Ki characters before escaping; `err` adds at most …"), or budget the serialised length |
| R2-n4 | NIT | `apps/api/src/platform/runtime/log.ts:7-9` | Stale: "Events named `security.<event>` are security events". After 67f8faa only sink-branded fields are (`types.ts:82`) | Update the comment |
| R2-n5 | NIT | PR #20 body | Three stale items. (a) The "PR #21 union" note still says keep `routes.use(API_PREFIX, routePrefix(API_PREFIX), api)`, which contradicts D-ORCH-024 (3). The auto-merge keeps exactly that line, so it fails PR #21's drift check. (b) The header says "Branch is up to date with main (merged at `18d761c`…)". (c) The "Gates" table is for `dae1f96`; the fix-cycle comment has the current table | Fix the union note to D-ORCH-024 and refresh the header and gate lines (the body becomes the squash message) |
| R2-n6 | NIT | `string-redaction.test.ts:266-280` | The fast-check property builds the value with `hex(6)` (outside fast-check), so a reported seed does not replay the same value. It does not matter today, because redaction does not depend on the alphanumeric content | Use `fc.stringMatching(/^[0-9a-f]{6}$/)` |
| R2-n7 | NIT | `apps/api/src/platform/runtime/process-errors.ts:28-36` | `process.exit(1)` straight after the fatal write. That is fine on Linux (pipes and files are synchronous for stdout). On a Windows dev host (pipes are asynchronous) the line can be lost. No test proves that `main.ts` wires the handlers | Optional: a comment noting the Linux assumption. The wiring is two lines in each `main.ts`; reviewed by reading |

### R2.4 Reviewer-focus answers

1. **M1:**
   - The `shared-logging` category plus the two final policies block the `@platform/shared/logging` specifier (and subpaths), `pino`/`pino-*`, and resolved files in `packages/shared/src/logging`. This holds for web/admin app code and build configuration (any `apps/{web,admin}/**` non-test file: vite.config, react-router.config) and for ui and pricing.
   - Every import form is covered: static, dynamic, re-export, `createRequire`.
   - The fixtures are negative and positive per arm, and arm-isolated. All six mutations are killed.
   - The base-ref no-weakening step is green with 0 extras. It enforces the *earlier* fixtures against the new config; the new fixtures are enforced by the head suite now and by later PRs' base-ref runs.
   - No earlier boundaries rule from PRs #2/#4/#17/#18/#19 is weakened. The change is additive and the policies sit last.
   - Residual: R2-m1.
2. **Redaction:**
   - EventEmitter → `[Unsupported]`. It covers req/res/socket/ioredis-style clients.
   - Raw header pairs are classified by the preceding name, failing closed on shifted pairs. `rawHeaders`/`rawTrailers`/`_parsedUrl` keys are omitted.
   - The 16 KiB budget holds for fields, but see R2-n3 for `err` and escaping.
   - Stack getter: the identity check is correct, and the header is rebuilt from the redacted message.
   - Joi `ValidationError`: written as `{name, details:[{path,type}]}` with sanitised path segments, and the type is validated against `^[A-Za-z0-9_.-]{1,64}$`.
   - The fast-check property (35 keys × 5 forms × 6 separator shapes × 4 prefixes) found a real bug, `apiKey :` (508c1f3). Reverting the fix fails the regression table.
3. **Security events:**
   - `SECURITY_EVENT_FIELDS` equals the README §13 Extra fields for all 22 events, plus `sql_state` for the 5 runtime events.
   - A dedicated `securityPino` at `trace` ignores `APP_LOG_LEVEL` (silent and fatal still write). Only sink-branded fields qualify.
   - `ip_coarse` accepts only an IPv4 `x.y.z.0/24` (no leading zeros) or an IPv6 /48 prefix with at most 3 groups.
4. **installProcessErrorHandlers:** one fatal line through the redacting logger, then `exit(1)` exactly once, even when the logger throws. The tests are sound: a P2039 with sentinels in message/meta/detail gives an identifier-only `err`, and an uncaught exception with `password=` is redacted. The api and worker `main.ts` install the handlers right after the logger. See R2-n7.
5. **Over-redaction:**
   - `refresh_token_reuse.session_id` → `[REDACTED]` is acceptable. It fails closed, `family_id` still links the event to the session family, and D-ORCH-025 (3) gives TASK-052 the ruling.
   - Free-text header names with a keyword (`X-Quote-Token: v` → `[REDACTED]: [REDACTED]`) are acceptable. Structured header objects keep the key and redact only the value.
6. **Merges:** both are pure unions (empty merge-tree diff), delta conservation holds, and the lock delta is the same single `pino` edge.
7. **PR #21 union:** see the checklist in §R2.5.

### R2.5 Merge conditions

1. **Security delta round** (D-SEC-PR20-01: every redaction change gets one) with a record naming the final head. Lane A `scans` must then be green on that head.
2. **R2-m1 and R2-m2:** fixed in this PR (preferred), or each routed with a named owner and a STATUS ROUTED line. R2-n5 (a) is fixed in the PR body before the union.
3. **Lane B integration** on the final head. The developer ran 18 suites / 185 tests on a tree-identical commit; the gatekeeper confirms.
4. **Order:** PR #21 merges first (D-ORCH-024 (3), D-ORCH-025 (4)). PR #20's merge-second commit applies this **union checklist**. `git merge-tree 9647907 e046ea2` gives textual conflicts in `app.ts`, `main.ts` and `request-context.ts` only. `eslint.config.mjs`, `negative-fixtures.test.ts`, `packages/shared/src/index.ts` and `problem-handler.api.test.ts` auto-merge.
   - (a) **`app.ts` header:** use PR #21's order with "→ access log" after the request context, and drop "Pino request logging with TASK-010".
   - (b) **`app.ts` imports:** keep both sets:
     - `problemHandler, type ErrorLogFields, type ErrorLogger`;
     - `optionsResponder, routeFallback`;
     - `createDocsRouter, DOCS_PATH, type DocsOptions`;
     - `requestLogContext`;
     - `requestLogger, routePrefix, type AccessLogFields`.
   - (c) **`AppLogger`** = PR #20's `ErrorLogger & { info, debug }`. Drop PR #21's "Minimal logger seam until Pino arrives" comment.
   - (d) **Request context and access log:** `app.use(requestContextMiddleware(deps.apiMode === undefined ? {} : { apiMode: deps.apiMode }))`, then `app.use(requestLogger(logger))`.
   - (e) **Auto-merge trap: `routePrefix`.** The clean side keeps `routes.use(API_PREFIX, routePrefix(API_PREFIX), api)`. Replace it with:
     - `const api = express.Router(); api.use(routePrefix(API_PREFIX));`
     - then the module loop;
     - then `routes.use(API_PREFIX, api)`.
     Update the `routePrefix` JSDoc (`request-logger.ts:31`). Do not widen the drift walker.
   - (f) **`main.ts`:**
     - imports `requestLogContext`, `createRuntimeLog, readPackageVersion`, `installProcessErrorHandlers`, `DocsSpecError, docsOptionsFrom, type DocsOptions`;
     - `createRuntimeLog('api', process.stdout, { version, level, context })`;
     - `installProcessErrorHandlers(...)` **before** the `createApp` try block, so a non-`DocsSpecError` rethrow becomes one fatal line + exit 1;
     - keep PR #21's try/catch, `apiMode` and `docs`, and add `logger: log`.
   - (g) **`request-context.ts`:**
     - `RequestContextOptions` = `{generateCorrelationId, generateRequestId, apiMode}`;
     - `RequestContext` = `{correlationId, requestId, clientCorrelationId?, apiMode}`, with `isRequestContext` checking `requestId` (and `apiMode`);
     - the middleware sets `correlationId: clientCorrelationId ?? generateCorrelationId()`, `requestId`, the optional `clientCorrelationId` and `apiMode`;
     - keep the exported `resolveCorrelationId` (PR #21's `classify.test.ts` uses it);
     - `CORRELATION_ID_PATTERN` is imported from `@platform/shared` and re-exported.
   - (h) **Test loggers:** PR #21's `{ info, error }` loggers gain `debug`: `tests/api/contract-validation.api.test.ts:20`, `apps/api/src/platform/openapi/runtime-seams.api.test.ts:33`, `serve.api.test.ts:45` and `tools/openapi/api-mounts.ts` `silentLogger`. Typecheck catches the typed ones. Without it, a `/health/*` request crashes in the finish listener.
   - (i) **Docs routes:** they log `route` as the leaf pattern (`/openapi.json`, no `/api/docs`), and OPTIONS 204 logs `route: null`. Never a raw path, so this is acceptable until TASK-020. Optionally, make `routePrefix(DOCS_PATH)` the first layer *inside* `createDocsRouter`.
   - (j) **Re-run on the union commit:** `npm run lint` (`SHARED_LOGGING` policies still last; `negative-fixtures` incl. the base-ref step), `typecheck`, `test:unit`, `test:api` incl. the drift check. `eslint.config.mjs` and `negative-fixtures.test.ts` are owned, so a merge-only security round applies (D-ORCH-024 (3)).
5. **Squash merge**, because the intermediate fix commits are not individually gated.

_Note:_ while this round was in progress, PR #21's head moved from `e046ea2` to `c3e7f5f`, which only adds its security record (docs). `git merge-tree 9647907 c3e7f5f` gives the same three conflicts. The merged `app.ts:85` still auto-keeps `routes.use(API_PREFIX, routePrefix(API_PREFIX), api)`. The four `{ info, error }` loggers in item (h) are unchanged. The checklist stands.

## Round 3 (head fafa3b5)

Delta review of fix cycle 2: the merge of main `3153b3e` (main `9d188fd`, which includes PRs #21, #23 and #25) plus four fix commits `11a995c`, `b4fa3b8`, `6cc3f93` and `fafa3b5`. Inputs: the §R2.5 union checklist (a)–(j), R2-m1/R2-m2, PR20-SEC-13 items 1–3, PR21-SEC-07 (b), R2-n4..n7, D-ORCH-024 (3), D-ORCH-025 (4) and D-SEC-PR20-02.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The PR #21 union is correct. Its merge differs from a clean re-merge in exactly the 8 claimed files, and each
      hand edit follows §R2.5. Drift shows 0 unrecognised, and putting the old routePrefix mount back fails 4 tests.
      R2-m1 and R2-m2 are closed (3/3 lint mutants and 10/10 redaction mutants killed). PR20-SEC-13 items 1–3 and
      PR21-SEC-07 (b) are done, and the new regexes are linear. Only NITs are open.
FINDINGS: R3-n1..R3-n5 (NIT), §R3.3.
GOOD: Every fix has a mutation proof and a positive control. The contract-excerpt redactor now uses the logging key
      classes (the only change against the old regex is for i18n/flag identifiers). exitAfterFlush is crash-only:
      0 timer ticks between the fatal line and the exit, and a top-level ESM throw also reaches the handler.
SECURITY-FLAGS: R3-n2 (request-target lead set) and R3-n4 (lint `test/`-folder hop, double-escaped lists) are
      defence-in-depth residuals for the merge + delta round. Over-redaction ruling: §R3.4 item 3.
```

### R3.1 Verification performed

I used the worktree read-only. I extracted `git archive fafa3b5` into the reviewer scratchpad and junctioned `node_modules` to the MAIN checkout, overriding `@platform/shared` and `@platform/api` with per-workspace junctions under `apps/`, `packages/` and `tests/`. Cleanup: junctions removed first, then the copy. MAIN `node_modules` still has 740 entries, `C:\` has no stray link, and the worktree `git status` is clean.

**Not re-run** (dispatch constraints): Docker, integration, coverage, build, full lint and full unit. For those I relied on:
- lane A run 43384035437 on the exact head `fafa3b5`: `fast-lane` success, with lint (2 suppressions), unit 135 suites / 3051 tests, and the base-ref no-weakening step at 148 passed / 9 skipped / **0 extras**. `scans` is red only at "Security-owned paths need a review record", which is expected until the merge + delta security record lands. `ci-gate` is red as the aggregate.
- the developer's gate table: full gate on `48aaf01`, including integration 18 / 185 and coverage 97.73 / 96.19.

| Check | How | Result |
|---|---|---|
| Merge proof | `git merge-tree --write-tree 9647907 9d188fd` → `d2b162c`; `git diff --stat d2b162c 3153b3e` | **Exactly 8 files**: the 3 conflicts (`app.ts`, `main.ts`, `request-context.ts`), the `routePrefix` JSDoc (`request-logger.ts`) and the 4 test loggers. The auto-merged `eslint.config.mjs`, `negative-fixtures.test.ts`, `packages/shared/src/index.ts` and `problem-handler.api.test.ts` are byte-identical to the clean merge |
| Union checklist | The merged `app.ts`, `main.ts` and `request-context.ts`, read in full, plus the 5 small hunks | (a)–(j) all met (§R3.4 item 1) |
| Drift (AT-US-034-01) | Jest unit `tools/openapi/drift` in the copy | 18/18 pass, 0 unrecognised. **Mutation:** putting `routes.use(API_PREFIX, routePrefix(API_PREFIX), api)` back fails 4 tests (`middleware "<anonymous>" mounted under a path`) |
| Targeted unit | `--selectProjects unit -i`: `packages/shared/src/logging`, api `platform/logging` + `runtime/process-errors`, worker logging | 13 suites / 442 tests pass |
| Targeted api | `--selectProjects api -i` (the whole project: 6 suites) | 6 suites / **93 tests** pass (= developer's `48aaf01` count), including the new `[SEC-TC-31] [PR20-SEC-13]` case, `contract-validation`, `runtime-seams` and `serve` |
| R2-m1 fixtures | `negative-fixtures -t TASK-010` | 18/18 (13 from r2 plus 3 bad and 2 ok) |
| R2-m1 mutations | sed on the copy's `eslint.config.mjs` | **All killed:** drop the new policy → 3 fail; `noneOf: ['test','shared-logging']` → `['test']` → 1 fail (`ok-internal`); `pkg: 'shared'` → `'xshared'` → 3 fail |
| R2-m1 extra vectors | Mini-root `layering/zz-probe` linted by the real `tools/lint/lint-fixtures.mjs` | **Blocked** (root message): `export {…} from './logging/…'`, `import()`, `import type`, `@platform/shared/logging/redaction`, `pino-pretty`, a sibling `src/logging.ts` importing pino, `src/errors/deep.ts` → `../logging/`. **Clean:** a non-test module re-exporting `./test/helper.js` or `./__tests__/h.js`, which itself re-exports logging (R3-n4 a); `createRequire(import.meta.url)` aliased as `r('pino')` (Vite cannot bundle `node:module`, so this is not a browser path); `sonic-boom` and `thread-stream` (out of scope, as in r2) |
| Redaction mutations | sed on the copy's `string-redaction.ts`; the shared logging suite (422 tests) | **10/10 killed:** `__Host-`/`__Secure-` prefix off (5); last-word pair key off (1); quoted-list pass off (3); request-target pass off (1); free-text OMITTED marker off (1); `manualkey` dropped (1); `username` dropped (4); `startsPair` guard off (1); `=` dropped from TARGET_LEAD (1); `forwarded` exact dropped (2) |
| Contract excerpt mutations | sed on `tests/api/helpers/contract-validator.ts`; api `contract-validation` | Drop `isPiiKey` → 1 fail; drop `isOmittedKey` → 1 fail (`provisioning_uri`) |
| Leak probe | `redactString` over 41 vectors with a sentinel (tsx, scratchpad) | **Redacted:** `JSON.stringify(rawHeaders)`, `util.inspect` (one-line, per-line long, `breakLength: Infinity`), single-escaped JSON, a space before the comma, CSRF/Proxy-Authorization/`x-quote-token` lists, bare `__Host-rt_*=` / `__Secure-*=`, `set __Host-rt_x=`, `{"__Host-rt_x":…}`, `GET /x?token=… HTTP/1.1`, `{"originalUrl":"/x?q"}`, `(/x?q)`, `path=/x?q`, the hash route `/app#/track?ref=`, `util.inspect({search, query, href})`, `body:`, `querystring=`, `labelUrl:`. **Kept:** the documented bounds (65 blanks, two line breaks, unquoted `String(rawHeaders)`, relative `x?q`, `name: Alice`-style free-text PII). The R2-n1 residuals (PEM, full-width key, JSON array value). New: a double-escaped list (R3-n4 b); a target after `|`, `;`, `{` or `@` (R3-n2); `query: { page: '2', q: 'v' }` keeps the items after the first comma (R3-n3) |
| Over-redaction | 14 readable strings | `curl: (7)…` → `curl: [OMITTED]` (the `url` suffix), `invalid body: …`, `query: SELECT 1`, `payload: 42` → `[OMITTED]`; `/a?b/` in a regex message → `/a?[OMITTED]`; `["token","password","x"]` → the middle item is redacted. Readable: `docs/a?b`, `1/2?`, stack frames, `["Host","example.com",…]`, `GET /health/live 200`, `Is /x? the path`, `resource: shipment` (ruling: §R3.4 item 3) |
| ReDoS | 18 adversarial families at 1k/2k/4k/8k characters (the new `QUOTED_LIST_ITEM` with escaped/unclosed quotes and blank runs, `startsPair`, `TARGET_RUN`/`omitTargetQuery` with `/`, `(/`, `=/`, `/a?`, `__Host-` prefix, `query:`/`url=` keys, two-word keys, backslash runs) | Linear: 8k/1k ratio ≤ 8.5 for 8× the input; **worst 4.3 ms at the 8 KiB cap**. Agrees with the developer's 11-family uncapped scaling result |
| PII keys vs the contract | Every block-style property key of `openapi.yaml` (550) through the classes | `display_name`, `receiver_name`, `legal_name`, `name`, `email`, `phone`, `address*` → PII. `carrier_name`, `service_name`, `job_name`, `entity_name`, `holiday_name`, `ip_coarse` stay readable. No bare `ip` suffix |
| PR21-SEC-07 (b) parity | Old excerpt regex vs `isSensitiveKey ∨ isPiiKey ∨ isOmittedKey` over the 550 keys | No longer redacted: only `key` (the feature-flag key, `^[a-z0-9][a-z0-9_.-]{2,63}$`), `label_key`, `message_key`, `rule_key` and `description_key`. These are i18n/flag identifiers, not credentials, so nothing is weakened. Newly redacted: 19 keys (PII, URLs, `session_id`) |
| exitAfterFlush, real process | Child process (tsx) with the real `process-errors.ts`, stdout a pipe, a fake `fatal` writing a 4 MB line; parent reads, optionally paused | `flush`: the full 4 MB line arrives, exit 1, **0 timer ticks** between crash and exit, the callback path (no 1 s wait). Unhandled rejection, a top-level ESM throw after the handlers (the `createApp` rethrow path) and two queued throws each give exactly 1 fatal line and exit 1. **Control `immediate`** (bare `process.exit`): also lossless, even with the reader paused for 300 ms or 2.5 s. On this Windows 11 / Node 24 host, `process.stdout` to a pipe is synchronous (R3-n1) |
| Lock delta | `git diff --text origin/main fafa3b5 -- package-lock.json` | Unchanged: only `packages/shared` gains `dependencies: { pino: ^10.4.0 }`. `tools/tsconfig.json` and the lock did not change since `9647907` |
| Current main / open PRs | `git merge-tree` of `fafa3b5` against `origin/main` (4b1dace), #28, #24, #26 and #30 | main and #28: clean. #24: `db/runtime.ts`, `tools/tsconfig.json`. #26: `with-tenant-tx.ts`, lock, `packages/shared/package.json` (both add a `dependencies` block; #26 adds `uuid`). #30: api and worker `main.ts` (#30 adds `secrets`). See §R3.5 item 5 |
| PR body (R2-n5) | `gh pr view 20` | Fixed: the header names `3153b3e`; the gates are for `48aaf01`/`fafa3b5`; the union note follows D-ORCH-024 (3) |

### R3.2 Round-2 finding closure

| ID | Status | Evidence |
|---|---|---|
| R2-m1 (PR20-SEC-16) | **Closed** | `eslint.config.mjs:234-239,426-429`: the last policy, importer = `packages/shared` outside `test` and `shared-logging`, disallowing the logging specifier, `pino*` and resolved logging files. Fixtures `…/shared-logging-server-only/packages/shared/src/**` (3 bad, 2 ok); `negative-fixtures.test.ts:159-175,729-736`. 3 mutations killed. The r2 probe (root `export *` from logging) now errors. Residual: R3-n4 (a) |
| R2-m2 (PR20-SEC-14 part) | **Closed** | `string-redaction.ts:83-104` (15 parts), `:136` (`forwarded` exact). The bare `ip` stays exact-only. 22 positive and 11 negative key tests, the walker test and the `security.login_failed` + `username` logger test. 2 mutations killed |
| R2-n4 | **Closed** | `log.ts:7-11` |
| R2-n5 | **Closed** | PR body |
| R2-n6 | **Closed** | `string-redaction.test.ts:327` `fc.stringMatching(/^[0-9a-f]{6}$/)` |
| R2-n7 | **Closed** (R3-n1 for the comment) | `process-errors.ts:39-62`; the api and worker `main.ts`; 4 tests. Correct: it exits once, falls back to a 1 s timer, exits at once on a synchronous throw, and the fatal line comes before the exit |
| R2-n1 / n2 / n3 | **Routed** (D-SEC-PR20-02) | TASK-113 / TASK-214, with PR20-SEC-15/17. Add R3-n3 to R2-n1 (a) |
| PR20-SEC-13 items 1–3 | **Done** | §R3.1 leak probe and SEC-TC-31 api case (8 sentinels). Item 4 → TASK-020 |
| PR21-SEC-07 (b) | **Done** | `contract-validator.ts:6,24`; `manualkey` is a sensitive part (`string-redaction.ts:58`); test at `contract-validation.api.test.ts:224-236` |

### R3.3 Findings (NIT only)

| ID | Sev | Location | Issue | Suggested fix |
|---|---|---|---|---|
| R3-n1 | NIT | `apps/api/src/platform/runtime/process-errors.ts:41-45` | The JSDoc premise "a pipe is asynchronous on Windows, where `process.exit` straight after the write can drop the line" did not reproduce. On this host (Windows 11, Node 24), the bare-`process.exit` control delivered a 4 MB fatal line through a pipe even with the reader paused for 2.5 s, because the child blocked in `write`. Windows TTYs are the asynchronous case. The helper is correct and harmless; only the comment is wrong. Also, `api.docs_unavailable` and `api.listen_failed` still use a bare `process.exit` | Reword it: "stdout is synchronous for files and pipes; a Windows TTY is asynchronous …". Optionally, use the same exit for the two `main.ts` exits |
| R3-n2 | NIT | `packages/shared/src/logging/string-redaction.ts:251` (`TARGET_LEAD`) | A scheme-less target keeps its query after `|`, `;`, `{` or `@` (`{/x?q=v}`, `;/x?q=v`, `|/x?q=v`). Low reach, because a structured `url`/`originalUrl` key is OMITTED anyway | Treat any non-alphanumeric predecessor as a lead (so `docs/a?b` stays readable), or list the set in the gap header |
| R3-n3 | NIT | `string-redaction.ts:443-466` (omitted marker + `unquotedEnd`) | The R2-n1 (a) residual also hits the new free-text OMITTED keys. `util.inspect({ query: { page: '2', q: 'v' } })` → `{ query: [OMITTED], q: 'v' } }`, so later query items leak and the brace balance breaks. `util.inspect(req)` is not affected (Express 5 `req.query` is a prototype getter) | Fold it into the routed R2-n1 (a) bracket-matching fix (TASK-113/214) |
| R3-n4 | NIT | (a) `eslint.config.mjs:236`; (b) `string-redaction.ts:246` | (a) The "tests excepted" carve-out uses `TEST_FILES`, which includes `**/{test,tests,__tests__}/**`. A non-test module re-exporting `./test/helper.js`, where that file re-exports logging, gives 0 errors: a two-hop path into the root. This is the same exemption every policy uses, and it needs an obviously odd re-export. (b) A doubly JSON-escaped list (`\\\"Cookie\\\"`) is not paired | (a) Optional: a policy that non-test `packages/shared` files never import `test`-category files, or a gap note. (b) Add it to the gap header next to `%2540` |
| R3-n5 | NIT | `apps/api/src/platform/runtime/process-errors.ts:73-79` | Since the exit is deferred, `crash` can write a second fatal line if another error arrives before the flush callback. The probe showed none, because exit comes on the next tick with synchronous stdout. The old JSDoc said "after the first fatal line" | None needed. Optionally, skip `log.fatal` when `exiting` is already true, or say "at least one" in the comment |

### R3.4 Reviewer-focus answers

1. **Union checklist (a)–(j): all met.**
   - (a) The `app.ts` header has PR #21's order with "request context → access log", and the TASK-010 note is gone.
   - (b) Both import sets are present. **Deviation: dropping `ErrorLogFields` is accepted**, because PR #20's `AppLogger extends ErrorLogger` does not use it and `no-unused-vars` would fail.
   - (c) `AppLogger` is `ErrorLogger & { info, debug }`.
   - (d) `requestContextMiddleware({apiMode?})` comes before `requestLogger(logger)`.
   - (e) `const api = express.Router(); api.use(routePrefix(API_PREFIX));`, then modules, then `routes.use(API_PREFIX, api)`. The JSDoc is updated and the walker is not widened. Drift shows 0 unrecognised, and the mutant is killed.
   - (f) `installProcessErrorHandlers` runs right after the logger, before `createRuntimeServices` and the `createApp` try. The probe shows that a top-level rethrow reaches it (one fatal line, exit 1). `logger: log`, `apiMode` and `docs` are kept.
   - (g) There is now one `RequestContextOptions` (the auto-merge had two merged interface declarations). `isRequestContext` checks `correlationId`, `requestId` and `apiMode`. `resolveCorrelationId` and the `CORRELATION_ID_PATTERN` re-export are kept.
   - (h) `debug` is on all 4 loggers.
   - (i) Accepted: the leaf route template is logged for docs until TASK-020. Not coupling `serve.ts` to logging is reasonable.
   - (j) Lane A on the exact head plus my targeted unit and api runs.
2. **Merge proof:** confirmed independently (8 files, §R3.1). The lock delta is the single `pino` edge, as in r1 and r2.
3. **`[OMITTED]` for free-text body/URL/query keys, which goes beyond the brief: accepted (fail closed).** D-TASK010-01 (2) accepts over-redaction that fails closed. The structured path already omits these keys, and the cost is readability of prose such as `curl: (7)`, `query: SELECT 1` and `invalid body: …`. No message the platform logs today depends on those values, and the event name and the structured fields stay intact. Re-open it only if operations reports a concrete loss of diagnostics.
4. **ReDoS:** every new regex is linear. `QUOTED_LIST_ITEM` uses bounded runs that a mandatory comma and an optional line break separate, so there is no ambiguous adjacency. `TARGET_RUN` is a single class, and `omitTargetQuery` is one pass. `redactQuotedLists` and `redactPairs` advance `lastIndex` monotonically. The worst case is 4.3 ms at the cap.
5. **`#` reset removal:** correct, and a behaviour change for the better. `/app#/track?ref=v` → `/app#/track?[OMITTED]`, so hash-route queries no longer leak. It is pinned by a test, and `see docs/a?b`-style prose stays readable.
6. **PR21-SEC-07 (b):** a single source, with no credential weakening (§R3.1 parity row). `manual_key` is covered in logs and in excerpts.
7. **R2-n7 `exitAfterFlush`:** correct (§R3.1). R3-n1 is a comment fix, and R3-n5 is optional.

### R3.5 Merge conditions

1. **Security merge + delta round** (D-ORCH-024 (3), D-SEC-PR20-02) with a record naming the final head (`fafa3b5` or later). The owned paths changed since `9647907` are `eslint.config.mjs`, `negative-fixtures.test.ts` and 6 fixtures. Lane A `scans` must then be green on that head.
2. **Lane B evidence (D-ORCH-034):** once PR #28 merges, this non-docs PR needs a fresh `quality:heavy --profile pr` evidence commit on an ancestor of the head. Do any merge of main **before** producing the evidence: a merge that brings `.claude/agent-memory/**` or any root file makes the evidence stale, and only `docs/**` is allowed to change after it. The order is: merge main if needed → evidence → security record (docs) → merge.
3. **Lane B integration on the final head.** The developer's 18 suites / 185 tests were on `48aaf01`; the gatekeeper confirms.
4. **Squash merge** (the intermediate commits are not individually gated).
5. **Second-merger union notes** (for whichever PR merges after #20):
   - **#30 (TASK-019):** api and worker `main.ts` keep `const { config, secrets }` and `createRuntimeServices(config, '<svc>', log, secrets)`, and also keep PR #20's `createRuntimeLog(..., { version, level, context })` and `installProcessErrorHandlers({ log, exit: exitAfterFlush(...) })` before services.
   - **#26 (TASK-032):** `packages/shared/package.json` `dependencies` = `{ pino, uuid }`, with the lock regenerated, not hand-merged.
   - **#24 (TASK-021):** `db/runtime.ts` and `tools/tsconfig.json` conflicts. Its new database security events must satisfy PR #20's type-level exhaustiveness test and `SECURITY_EVENT_FIELDS` (`name`/`kind`/`reason`), and log at `error` (PR #24 m2, D-ORCH-025).
   - Run lint, typecheck, unit and api (including drift) on each union commit.
6. NITs R3-n1..n5 are optional in-PR. Otherwise: R3-n3 joins R2-n1 (TASK-113/214); R3-n2 and R3-n4 go to the security delta round to rule on (accept, or route to TASK-113).
