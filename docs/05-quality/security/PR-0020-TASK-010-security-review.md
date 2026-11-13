# PR-0020 / TASK-010: security review (structured, redacted logging with correlation and request ids)

| Field | Value |
|---|---|
| PR | #20 `feat(shared): structured redacted logging with correlation and request ids (TASK-010)`, https://github.com/sukhchdit/shipcube/pull/20, branch `feat/TASK-010-structured-redacted-logging-correlation-ids`. Five commits on merge base `80ff2c2`: `13b1017`, `37ee7c1`, `f64b65e`, merge of main `18d761c`, `dae1f96`. 40 files, +3,104 / −47 |
| Head | dae1f961bc2dd9070b58fedaca5b1f17b69a447f |
| Lane A evidence | Run [43336647930](https://github.com/sukhchdit/shipcube/actions/runs/43336647930) on `dae1f96` (`pull_request`). **fast-lane `success`.** **scans:** "Gitleaks (PR commit range)" `success` ("no leaks found"); Semgrep `success` ("0 finding(s), 0 error(s) in 156 file(s)", rules and scope from the base ref, `--disable-nosem`). Only "Security-owned paths need a review record" failed, because no `PR-0020-*` record existed; this record is that record. ci-gate failed as a consequence |
| Owned paths changed | 2, per lane A: `package-lock.json`, `tools/tsconfig.json`. Main moved to `cdbeabf` after the merge base with docs and agent-memory changes only, so there is no owned-path overlap with main |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. Every git command ran in the main checkout against commit SHAs; **no command ran in the PR worktree** (`Shipqube-TASK-010`). No install, build, Docker or suite run. Probes ran in scratch on `git archive dae1f96` sources, type-stripped with Node 24.22.3, with a scratch junction to the worktree's `node_modules` (removed afterwards). The record was validated in a scratch `git clone --shared` (§9), removed afterwards |
| Inputs | `gh pr view 20`, `git diff 80ff2c2 dae1f96`; WAVE-00 TASK-010; US-008; ADR-0016 §15 and amendment 2; threat-model L-13, L-14, L-21; P3 review SEC-P3-17, SEC-P3-23; SEC-TC-31, SEC-TC-63; api/README.md §13; D-TASK010-01; PR-0006, PR-0007, PR-0009, PR-0011, PR-0013 |

## 1. Summary

PR #20 adds the platform logger (`@platform/shared/logging`, Pino 10.4.0): mandatory line keys, a bounded deep key-and-value redactor, an identifier-only database-error serializer, an outbound-call field allow-list, the §13 security-event catalogue and sink, a method/route-template/status/duration access log, a server-generated `request_id` beside the validated `client_correlation_id`, a worker job-context seam, and the re-pointing of the TASK-016 runtime security events to the sink.

**What holds (probe-confirmed):**
- **Database errors** are written as `{ name, code, originalCode, kind }` only, for the real Prisma 7.10 classes (P2039, P2010, P2002, validation, initialization, unknown, panic), `DriverAdapterError` and pg's `DatabaseError`, also as a `cause` and as a field value. No message, `meta`, `originalMessage`, `detail`, `hint` or rendered query reaches the line (PR7-SEC-03 item 3 closed).
- **Keyed redaction** catches the US-008 key list and SEC-P3-23's header names at any depth, including the `req.headers` object of a real Express request. `Secret` config values are written as `{}` (private field). Maps, Sets, Buffers, URLs, `URLSearchParams`, getters and hostile Proxies never leak.
- **Log injection:** CR, LF, ESC and NUL are JSON-escaped everywhere (event name, keys, values, context, error message and stack). The inbound correlation value is pattern-checked and kept apart from the server `request_id` (PR9-SEC-10 closed).
- **No ReDoS:** every string regex is linear (measured to 128k characters); the worst 8 KiB value costs about 3.4 ms.
- **Security events** from the database runtime carry exactly `{ event, correlationId, sqlState }` and no PostgreSQL text (PR #11 R3-m1 (i) closed). A security line survives hostile attributes, a throwing context provider and a throwing destination; no log call throws.
- **Supply chain:** the lock delta is one path (`packages/shared` declares `pino ^10.4.0`, already locked, MIT). gitleaks and Semgrep are clean.

**What does not hold:**
- **PR20-SEC-01 (MEDIUM).** The raw header forms bypass the keyed redaction. Logging `req`, `res`, `req.socket`, `req.rawHeaders` or `Object.entries(req.headers)` writes the `__Host-rt_*` refresh cookie, `X-Reauth-Proof`, `X-Quote-Token` and `X-Api-Key` values, plus the query string. In free text, only the first cookie of a `Cookie:` value is redacted.
- **Six LOW findings** (02–07): no PII-key redaction on general lines; URL queries and connection-URI userinfo kept in free text; security events dropped by `APP_LOG_LEVEL`; a narrow security-event PII filter; Node's default uncaught-error output bypasses the logger; no per-line cost or size budget.
- **Five INFO findings** (08–12).

**Verdict: PASS_WITH_FOLLOW-UPS** (no Critical or High). PR20-SEC-01 is inside this task's own acceptance (SEC-TC-31, SEC-P3-23). Fix it in this PR's fix cycle if one runs; otherwise it is due before the first refresh cookie is issued (TASK-052 / TASK-055).

## 2. Scope and method

**Reviewed:** all 40 changed files. In depth: `packages/shared/src/logging/{logger,redaction,string-redaction,own-property,outbound,security-event,types,index}.ts`, `serializers/{error,prisma-error}.ts`, `apps/api/src/platform/{logging/*,context/request-context.ts,db/runtime.ts,db/with-tenant-tx.ts,runtime/log.ts}`, `apps/api/src/{app,main}.ts`, `apps/worker/src/{main.ts,platform/logging/job-context.ts}`, the lock delta and `tools/tsconfig.json`. Unchanged context: `errors/problem-handler.ts`, `db/map-db-error.ts`, `http/json-body.ts`, `packages/config/src/{schema,secret}.ts`, `eslint.config.mjs`.

**Probes** (scratch, Node 24.22.3, real `pino` 10.4.0, `express`, `@prisma/client` runtime, `@prisma/driver-adapter-utils`, `pg`, `joi` from the worktree's `node_modules`). Each has positive controls. Random non-secret-shaped sentinels; none is quoted here.

| Probe | What it does | Outcome |
|---|---|---|
| P1 redaction corpus | 6 controls, then 55 candidate bypasses: raw header arrays, entries pairs, multi-cookie text, auth schemes, encoded and escaped forms, separators, URI userinfo, URL queries, nested card data, 19 key names, Unicode keys, e-mail forms, error shapes, collections | Controls redacted. Leaks: §4 PR20-SEC-01, -02, -03, -12 |
| P2 real request | A live Express request carrying the refresh cookie (second position), `Authorization`, `X-Reauth-Proof`, `X-Quote-Token`, `X-Api-Key` and a query string. Logs `{req}`, `{rawHeaders}`, `{res}`, `{socket}`, `{entries}`, `{headers: res.getHeaders()}`, and `{res}` after `finish` | Every object except `res.getHeaders()` leaks the cookie, proof, quote token, API key and (via `req._parsedUrl.path`/`_raw`) the query. Bearer and Set-Cookie are redacted (PR20-SEC-01) |
| P3 line shape | CR/LF/ESC/NUL/DEL/NEL/U+2028/U+2029/U+009B in the event name, key, value, context and error; reserved-key overrides; `__proto__` fields; security-event shaping; level filtering; hostile Proxy fields and thrown values; a throwing context and destination; non-string event names; `%s` format specifiers | Escapes hold; C1 and line separators pass raw (PR20-SEC-08). Reserved keys hold (exact match). Level filter drops security events (PR20-SEC-04). Never-throw holds |
| P4 database errors | The real Prisma 7.10 error classes with `DriverAdapterError` metadata, pg `DatabaseError`, wrapped and nested forms, and Joi `ValidationError` | Identifier-only shape in every database case. Joi's message echoes the value (PR20-SEC-12) |
| P5 cost | 18 input families at n = 2k/8k/32k through `redactString`; intrinsic growth of each regex to 128k uncapped; `toSnakeCase`; 1 MiB keys; 1–32 MiB stacks; a 2,000 × 8 KiB structure | Linear everywhere. Worst capped value 3.4 ms. Line bound 4.5 s / about 16 MiB (PR20-SEC-07) |
| P6 process output | A child process with an unhandled rejection of a P2039 carrying sentinels in its message and `detail` | Node's default printer writes both to stderr (PR20-SEC-06) |
| P7 misc | Bound and Proxy-wrapped `stack` getters; `outboundCallFields` through the logger without context; a concrete path as a template; IDN, quoted and dotless e-mails; the `*count` exemption | PR20-SEC-09, -10, -05; e-mail residuals in PR20-SEC-03 |

## 3. Analysis by focus area

### 3.1 Redaction completeness and bypass

- **Keys** (`string-redaction.ts:18-71`). The lower-cased, alphanumeric-only key is matched by substring against 15 parts, plus six exact short keys. It covers every US-008 AT-04 key and SEC-P3-23's `x-csrf-token`, `x-quote-token`, `x-reauth-proof`, `cookie`, `set-cookie` and `authorization` (all as object keys). Zero-width characters inside a key are stripped, so they do not bypass. Homoglyph and full-width keys normalise to something else and are not matched; that matters only for externally sourced keys (PR20-SEC-02 note).
  - **Misses** (P1): `pass`, `pwd`, `session`, `sid`, `jwt`, `privateJwk`, `auth`, `dsn`, `connectionString`, `proof`, `code_verifier`, `mfaCode`, `securityCode`, tax-identifier keys (`taxId`, `ein`, `gstin`, `iban`), and the nested `card.number` (only the flat `cardNumber` matches).
- **Bodies and URLs** are omitted by **exact** normalised key only (`string-redaction.ts:40-55`). `labelUrl`, `redirectUri`, `response`, `data` and `result` are walked and logged.
- **Values** (`string-redaction.ts:183-187`): `Bearer`/`Basic` schemes, `key=value` / `key: value` / `"key":"value"` pairs with sensitive keys, JWT and gateway-key shapes, and words containing a sensitive keyword. E-mail addresses are masked.
  - **Residuals:** multi-cookie values and the raw header arrays (PR20-SEC-01); PII in general lines (02); URL queries, `*Url` keys, URI userinfo and `%40` e-mails (03); escaped-quote pairs, more than three blanks or NBSP before the separator, unquoted multi-word values, `Digest`/`DPoP` schemes (01, 12).
- **Structures** (`redaction.ts`): own enumerable data properties only. Getters are never invoked. Map, Set, Weak*, `ArrayBuffer` views and Buffer become markers. Dates are normalised. Errors (any realm, or error-like) go to the error serializer. A thrown inspection becomes `[Unreadable]`. Depth 8, 100 keys, 50 items and 2,000 nodes are capped.
  - **Gap:** live HTTP objects are walked like plain objects (PR20-SEC-01).
- **Errors** (`serializers/error.ts`): an allow-list of `name`, redacted `message`, redacted frame-capped `stack`, a short `code`, and `cause` to depth 3. Other own properties (an HTTP client's `config` or `response`) are dropped (P1 control).
  - **Residuals:** the stack header can carry a message scrubbed after the first `.stack` read, and the "native getter" check accepts bound and Proxy functions (PR20-SEC-09).

### 3.2 ReDoS (P5)

| Regex | Shape | Uncapped growth, worst family (ms at 8k / 32k / 128k) |
|---|---|---|
| `AUTH_SCHEME` | literal alternation, then two disjoint classes | 0.23 / 0.41 / 1.92 |
| `KEY_SEPARATOR` | `{1,64}` run, optional quote, `{0,3}` blanks; at most about 512 steps per start | 5.5 / 16.8 / 60.8 (linear, constant about 64) |
| `WORD` | one negated class run | 0.28 / 0.98 / 4.3 |
| `EMAIL_DOMAIN` | anchored, dot-separated `{1,63}` groups | about 0 |
| `CATALOGUE_IDENTIFIER` | anchored, `_`-separated groups (unambiguous) | 0.06 / 0.23 / 1.0 |
| `SECRET_SHAPE` | anchored prefixes | 0.02 / 0.05 / 0.21 |

- **`redactString` at the 8 KiB cap:** at most 3.4 ms over the 18 families. The `key: value` scan advances monotonically (`lastIndex = end`), and a quoted value stops at its quote or at LF.
- **`toSnakeCase` is quadratic** (0.02 / 0.69 / 58 ms at 128 / 1k / 8k uppercase characters). It is reached only for security-event keys, which `sanitiseKey` has already cut to 128 characters. This is not reachable today; an exported-API note is in PR20-SEC-07.
- **No ReDoS finding.** The cost findings are about volume (PR20-SEC-07), not about backtracking.

### 3.3 Log injection

- Pino writes one JSON object per line. CR, LF, ESC (ANSI), NUL and every other C0 control are escaped in the event name (which is also `message`), keys, values, context values, error messages and stacks (P3: one physical line per call; `JSON.parse` succeeds). Format specifiers in the event name are not interpolated.
- `X-Correlation-Id` is accepted only if it matches `^[A-Za-z0-9-]{8,64}$`. `request_id` is a server UUID. The worker refuses a malformed job correlation id.
- **Residual (INFO):** DEL, the C1 range (including CSI U+009B) and U+2028/U+2029 pass raw. This is valid JSON, but some terminals and viewers act on these characters (PR20-SEC-08).

### 3.4 Database errors, stacks and the `onDbError` hook

- `serializeDatabaseError` reads own data properties only and validates each output: `P\d{4}` or SQLSTATE for `code`, SQLSTATE for `originalCode`, an identifier for `kind`, and an identifier class name.
- Detection uses the name, the constructor name, the `DriverAdapterError`/`DatabaseError`/`DbError` names, the Prisma keys (`clientVersion`, `meta`, `originalCode`, `originalMessage`, `sqlState`) and pg's `severity` + `routine`.
- P4 confirmed the shape for every real class. A non-database error that wraps a database error as `cause` keeps the wrapper's message and serialises the cause in database shape.
- **Residual:** a plain `Error` whose own message embeds driver text (`Key (email)=(…)`) is redacted by pattern only (PR20-SEC-12 note).
- **`onDbError`** (`with-tenant-tx.ts`, `runtime.ts:207-211`) receives the original error. It logs `db.error_mapped` at `error` (status ≥ 500) or `warn`, through the serializer. A throwing hook is swallowed before the security event is raised, so a logging failure cannot mask the mapped `DbError` or suppress the event.
- **Stacks are logged in every environment** (AT-US-007-03 asks for the full error in the server log). That is acceptable: the stack goes to the server log only (never to clients, TASK-006), its header is redacted with the message rules, and database errors carry no stack. Hardening is in PR20-SEC-09.

### 3.5 Security-event sink

- `createSecurityEventSink` validates the name (`^[a-z][a-z0-9_]{0,63}$`) and picks the level from `SECURITY_EVENT_LEVEL`.
- The logger turns every `security.<name>` line into `event_type: "security"` with snake_case scalar attributes. It drops PII-named keys and reserved keys, and lifts a valid `correlationId` only when the context has none.
- The 22 exported names equal README §13 in both directions (SEC-TC-63 test reads the README).
- **Runtime events** (`runtime.ts:188-189, 202-205`): `db_session_default_tampered`, `db_role_setting_drift`, `db_session_context_leak`, `rls_write_rejected` and `db_privilege_denied` go through `securityEventSinkFrom` with `{ correlationId?, sqlState? }` only. P3 confirmed no `component` key and no PostgreSQL text.
- **Never-throw (P3):**
  - hostile Proxy attributes become `[Unreadable]`, and the line, with its event name, is still written;
  - a throwing context provider gives null context keys;
  - a throwing destination gets one fallback attempt and no throw.
  - Security events are therefore not swallowed by the never-throw path. They **are** dropped by the level filter (PR20-SEC-04), and the attribute filter is narrow (PR20-SEC-05).

### 3.6 Server-only boundary

`@platform/shared/logging` is a separate `exports` subpath, and the package root does not re-export it (`index.test.ts`). However, the boundaries rule's `toPackage('@platform/shared')` also allows `@platform/shared/**`, and there is no restricted-import pattern for `pino`. The "never in browser bundles or pricing" property is therefore a convention, not a control (PR20-SEC-11).

### 3.7 Supply chain and configuration

- **Lock delta:** a deep JSON diff of `80ff2c2` against `dae1f96` gives exactly **one** differing path, `packages["packages/shared"].dependencies = { pino: "^10.4.0" }`. A positive control was included. `node_modules/pino` is unchanged: 10.4.0, MIT, same integrity. No new tuple and no install script.
- **`tools/tsconfig.json`:** one `files` entry, `apps/api/src/platform/logging/security-events.ts`. Compile scope only, no weakening.
- **Inline-disable scan** of the added lines: `eslint-disable`, `nosemgrep`, `gitleaks:allow`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore` → **0**.

## 4. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR20-SEC-01 | Raw header forms (`req`, `res`, `socket`, `rawHeaders`, header entries, multi-cookie text) bypass keyed redaction: refresh cookie, step-up proof, quote token, API key and query string reach the log | MEDIUM | CWE-532 | A09 | `packages/shared/src/logging/redaction.ts:61-105`; `string-redaction.ts:76,85,141-171` | senior-developer: TASK-010 fix cycle; else due before TASK-052/055 merge | Open |
| PR20-SEC-02 | General lines have no PII-key redaction (carrier and party objects under non-body keys are logged in clear); secret-key list gaps | LOW | CWE-359, CWE-532 | A09 | `string-redaction.ts:18-55`; `logger.ts:29-30` (security-only list) | TASK-010 fix cycle; TASK-135/139/140/188 lists; SEC-TC-52/AC-45 | Open |
| PR20-SEC-03 | Free-text URLs keep query strings; `*Url`/`*Uri` keys are not omitted; connection-URI userinfo passwords kept; `%40` e-mails unmasked | LOW | CWE-532, CWE-598 | A09 | `string-redaction.ts:40-55,82,95,183-187` | TASK-010 fix cycle or TASK-113 | Open |
| PR20-SEC-04 | Security events obey `APP_LOG_LEVEL` (`error` drops 22 of the 27 known events, `fatal`/`silent` all); runtime integrity events default to `warn` | LOW | CWE-778 | A09 | `logger.ts:180`; `packages/config/src/schema.ts:221`; `security-event.ts:35,41-65` | TASK-010 fix cycle; config clamp in TASK-014 | Open |
| PR20-SEC-05 | Security-event PII filter is a narrow deny-list (`username`, `*_ip`, `remote_addr`, `user_agent`, `recipient`, `tenant_id` pass; `*count` exempts every `*account` key) | LOW | CWE-359 | A09 | `logger.ts:29-46,83-96` | TASK-113 (catalogue owner) or TASK-010 | Open |
| PR20-SEC-06 | No process-level error handlers: Node's default uncaught-exception and unhandled-rejection output writes full error text (Prisma message, `detail`) to stderr, bypassing the redactor | LOW | CWE-532 | A09 | `apps/api/src/main.ts`, `apps/worker/src/main.ts` (absence) | TASK-010 fix cycle or TASK-214 (graceful shutdown) | Open |
| PR20-SEC-07 | No per-line cost or size budget: about 16 MiB / 4.5 s worst line; about 0.4 ms per KiB of logged request-derived strings; raw keys normalised before the cap; stack split before the cap | LOW | CWE-400, CWE-779 | A04 | `redaction.ts:24-30,72-87`; `serializers/error.ts:74-90,124` | TASK-010 fix cycle or TASK-020 | Open |
| PR20-SEC-08 | Line integrity details: raw C1/U+2028/U+2029; any caller can emit `security.*` at any level; the api sink does not validate names; the fallback line drops the event name; reserved keys match exactly | INFO | CWE-117 | A09 | `logger.ts:117-130,178-206`; `apps/api/src/platform/logging/security-events.ts:19-26` | TASK-010 / TASK-113 | Open |
| PR20-SEC-09 | `readStack` accepts bound and Proxy getters as "native"; the stack header can carry a pre-scrub message | INFO | CWE-532 | A09 | `serializers/error.ts:47-71,124` | TASK-010 | Open |
| PR20-SEC-10 | Outbound `correlation_id` is a reserved key and is dropped (null without context); `route_template` accepts concrete paths | INFO | CWE-778 | A09 | `outbound.ts:28-31,52`; `logger.ts:15-22` | TASK-113 | Open |
| PR20-SEC-11 | The server-only boundary of `@platform/shared/logging` (Pino, `node:util`) is not enforced by lint for web, admin, ui or pricing | INFO | CWE-1164 | A05 | `eslint.config.mjs:192,332,388` | TASK-002 follow-up / TASK-022 bundle scan | Open |
| PR20-SEC-12 | Free-text pair detection residuals: escaped quotes (double-encoded JSON), more than 3 blanks or NBSP, unquoted multi-word values, Joi `"<key>" with value "<v>"`; driver text inside plain `Error` messages | INFO | CWE-532 | A09 | `string-redaction.ts:79,85,141-171`; `serializers/error.ts:115-128` | TASK-010; Joi messages TASK-020 (L-13) | Open |

### PR20-SEC-01 (MEDIUM): raw header forms bypass keyed redaction

- **Description.** Redaction of credentials in headers depends on the header **name being an object key** (`req.headers.cookie`). Node and Express also hold headers in forms without that key.
  - `req.rawHeaders` is an alternating `[name, value, …]` string array. It is an own data property of every `IncomingMessage`, and `req`, `res` (`res.req`) and `req.socket` (`socket.parser.incoming` / `_httpMessage`) reach it. `Object.entries(req.headers)` gives `[name, value]` pairs.
  - `walkArray` redacts each item as free text, so a cookie or token value without a keyword is written as it is.
  - `req._parsedUrl.path` and `._raw` hold the path **with the query string**. Only `url`, `href`, `search`, `query` and `originalUrl` are omitted keys.
  - In free text, a sensitive pair's unquoted value ends at the first `;` (`VALUE_END`). So `Cookie: theme=…; __Host-rt_…=…` redacts only the first cookie, and the refresh cookie (never first by design) stays.
  - `AUTH_SCHEME` knows only `Bearer` and `Basic`, so a `DPoP` or `Digest` credential in a raw value is kept.
  - P2 (a live Express request) leaked the refresh-cookie, `X-Reauth-Proof`, `X-Quote-Token` and `X-Api-Key` sentinels and the query sentinel through `{req}`, `{res}`, `{socket}`, `{rawHeaders}` and `{entries}`. `res.getHeaders()` and `Set-Cookie` in `res._header` were redacted.
  - SEC-TC-31 in `logging.api.test.ts` logs `req.headers` only.
- **Exploitability and impact.**
  - It needs a code path that logs a request, response, socket or raw headers. That is a common debugging and error-context pattern, but no current call site does it. **Likelihood L.**
  - Anyone with log read access (operators, the log pipeline, a SIEM) then gets a live refresh token. The refresh cookie is 30-day and rotating (ADR-0006), so this is an account takeover until rotation or reuse detection. They also get a step-up proof, a guest quote token and API keys, against the CLAUDE.md "secrets in logs = 0" guardrail and SEC-P3-23. **Impact H.**
  - H × L = **MEDIUM**.
- **Remediation (code-level, in `redaction.ts` / `string-redaction.ts`):**
  1. In `walkObjectLike`, before `walkObject`, return `UNSUPPORTED` (or a fixed safe summary `{ method, route }`) for streams and HTTP objects. In other words, `value instanceof Stream` (`node:stream`) or `value instanceof EventEmitter` (`node:events`). This covers `IncomingMessage`, `ServerResponse`, `ClientRequest`, `Socket` and `TLSSocket`.
  2. In `walkArray`, add pair awareness: when item `i` is a string with `isSensitiveKey(item)` and item `i + 1` is a string, write `REDACTED` for item `i + 1`. This covers `rawHeaders`, `rawTrailers`, `Object.entries(headers)` and `[k, v]` tuples.
  3. Add `rawheaders`, `rawtrailers` and `parsedurl` (the normalised `_parsedUrl`) to the omitted set.
  4. In `redactPairs`, for keys whose normalised form contains `cookie` or `authorization`, the value ends at CR/LF (end of the header line), not at `;`, `,` or whitespace.
  5. Extend `AUTH_SCHEME` to `bearer|basic|digest|dpop|token|negotiate|ntlm|hoba|apikey|aws4-hmac-sha256` (still one alternation followed by disjoint classes, so linear).
- **Verification.**
  - Extend `[SEC-TC-31]` in `apps/api/src/platform/logging/logging.api.test.ts`. A handler logs `{ req }`, `{ socket: req.socket }`, `{ raw: req.rawHeaders }`, `{ entries: Object.entries(req.headers) }`, and `{ res }` from a `finish` listener. The request carries a `Cookie` header with a harmless first cookie and a `__Host-rt_*` sentinel second, plus `X-Reauth-Proof`, `X-Quote-Token`, `X-Api-Key` and `Authorization: DPoP` sentinels and a query sentinel. Assert that no sentinel appears in any line.
  - Unit tests in `redaction.test.ts` for the pair rule and the multi-cookie line.

### PR20-SEC-02 (LOW): no PII-key redaction on general lines; secret-key list gaps

- **Description.**
  - Only security-event lines filter PII-named keys (`logger.ts:29-30`). A general line deep-walks any object not under an exact body or URL key. P7 logged a DHL-shaped object under `response`: `fullName`, `phone`, `addressLine1`, `postalCode` and a `registrationNumbers[].number` tax identifier were all written in clear. Only the e-mail was masked.
  - PR6-SEC-02 item 3 avoids depending on deny-list completeness by never logging bodies. That holds only when the body sits under one of 14 exact key names.
  - Secret-key misses (P1): `pass` (nodemailer `auth.pass`; nodemailer is an ADR-0016 am. 10 egress exception), `pwd`, `session`, `sid`, `jwt`, `privateJwk`, `auth`, `dsn`, `connectionString`, `proof`, `code_verifier`, `mfaCode`, `securityCode`, and the nested `card.number` (the key is `number`).
  - Keys are compared after ASCII folding, so full-width and homoglyph keys are not matched. Relevant only for externally sourced keys.
- **Exploitability and impact.** It needs a log call with a party, shipment, customs or carrier object under a generic key, which is a plausible adapter debugging line. The result is PII and `SPER` tax identifiers in logs, against NFR-PRIV-001, REQ-BOOK-008 "never logged" and L-21. M × L = **LOW**.
- **Remediation.**
  1. Move `PII_KEY_PARTS` / `PII_EXACT_KEYS` from `logger.ts` into `string-redaction.ts` as a second class, and apply it in `walkObject` to **every** line as `REDACTED`. Over-redaction is accepted per D-TASK010-01 (2). Extend the parts:
     - names: `fullname`, `personname`, `attentionname`, `contactname`, `firstname`, `lastname`, `companyname`, `requestorname`;
     - phones: `phone`, `mobile`, `fax`;
     - addresses: `address`, `addressline`, `streetlines`, `postalcode`, `postcode`, `zip`;
     - tax and identity: `taxid`, `tin`, `tins`, `vat`, `ein`, `gstin`, `iec`, `registrationnumber`;
     - `dateofbirth`.
     Keep the exact `name` and `ip`.
  2. Add secret parts and exact keys: `pass` (exact), `pwd`, `sid` (exact), `session` (exact and `sessionid`), `jwt`, `jwk`, `dsn`, `connectionstring`, `proof`, `verifier`, `mfacode`, `securitycode`, `cvv2`, `cvc2`.
  3. Add a parent-aware rule: under a key normalising to `card` or `paymentmethod`, redact `number`, `exp*` and `cvc*`.
  4. Optionally fold keys with `normalize('NFKC')` before lower-casing.
  5. When TASK-135/139/140/188 land the per-carrier `sensitive-fields` modules, let the logger load them as extra parts.
- **Verification.**
  - A unit test in `redaction.test.ts`: a carrier-shaped object under `response`/`data` with a sentinel on every PR6-SEC-02 path, and no sentinel in the output.
  - The SEC-TC-52/AC-45 extension (PR6-SEC-02 verification) asserts the Pino capture as well.

### PR20-SEC-03 (LOW): URLs, URI userinfo and encoded e-mails in free text

- **Description** (P1, P7).
  - The string redactor removes sensitive *pairs* from a URL query but keeps every other query value, such as a `recipientPhone` or postcode parameter.
  - Keys like `labelUrl`, `redirectUri` and `documentUrl` are not omitted, because the omitted set is matched exactly.
  - A connection URI with a userinfo password is kept in full when the host has no dot. Compose service names (`db`, `cache`) are dotless. With a dotted host, the password is reduced to its first character (it is masked like an e-mail local part).
  - `%40`-encoded e-mail addresses, IDN domains, dotless domains and quoted local parts are not masked.
  - ADR-0016 am. 2, ADR-0010 am. 11 item 8 and PR6-SEC-03 rule out query strings in logs, and HTTP-client and driver error messages routinely embed URLs.
- **Exploitability and impact.**
  - Query strings: PII in logs. M × L.
  - Userinfo: the impact would be high, but configuration secrets are `Secret`-wrapped (P7: `{}`) and the drivers do not echo URIs, so no current or planned emitter exists.
  - **LOW.**
- **Remediation.**
  1. In `redactString`, run a linear URL pass before the pair pass: `/\b[a-z][a-z0-9+.-]{0,15}:\/\/[^\s"'<>]*/gi`. For each match:
     - replace userinfo with `[REDACTED]@`;
     - replace `?…` and `#…` with `?[OMITTED]`.
  2. Omit keys whose normalised form ends with `url`, `uri`, `href` or `link`, or strip their query.
  3. Treat `%40` as `@` in e-mail detection.
  4. ReDoS-probe the new expression (one class run after a bounded scheme).
- **Verification.** Unit cases for each form in `redaction.test.ts`, plus a family in the timing test (`a://` repeated, 8 KiB, < 5 ms).

### PR20-SEC-04 (LOW): security events obey `APP_LOG_LEVEL`

- **Description.**
  - `PlatformPinoLogger.write` returns early when `!isLevelEnabled(level)` (`logger.ts:180`). Security events are `warn` or `error`.
  - `APP_LOG_LEVEL` accepts `fatal`, `error`, `warn`, `info`, `debug`, `trace` and `silent` in every `APP_ENV` (`schema.ts:221`).
  - P3:
    - `error` writes only the five `error`-level events (`audit_write_failed`, `audit_chain_broken`, `live_key_forbidden`, `audit_anchor_missing`, `db_session_context_leak`). It drops the 18 `warn` entries of `SECURITY_EVENT_LEVEL` (among them `login_failed`, `permission_denied`, `cross_tenant_probe`, `refresh_token_reuse`, `csrf_rejected`) and the four runtime events that are not in the table: 22 of 27.
    - `fatal` and `silent` write none.
  - Of the runtime events, only `db_session_context_leak` is in `SECURITY_EVENT_LEVEL`. `db_session_default_tampered` (which latches readiness), `db_role_setting_drift`, `db_privilege_denied` and `rls_write_rejected` default to `warn`, and `RUNTIME_SECURITY_EVENTS` lists one name.
- **Exploitability and impact.** One configuration value silences detection (REQ-SEC-012, A09), whether by mistake or through a compromised deployment parameter. M × L = **LOW**.
- **Remediation.**
  1. Security lines bypass the level gate. Build the security path with its own Pino instance or child at a fixed `level: 'warn'`, or skip the `isLevelEnabled` check when the sink writes.
  2. Clamp or refuse `APP_LOG_LEVEL ∈ {error, fatal, silent}` outside `local`/`test` (config schema, TASK-014).
  3. Add the four runtime events to `RUNTIME_SECURITY_EVENTS` and `SECURITY_EVENT_LEVEL`, at `error` for `db_session_default_tampered`, `db_role_setting_drift` and `db_privilege_denied`.
- **Verification.**
  - A logger created with `level: 'silent'` still writes `security.login_failed`.
  - A config test refuses `APP_LOG_LEVEL=silent` with `APP_ENV=production`.

### PR20-SEC-05 (LOW): narrow security-event PII filter

- **Description.** The filter drops keys that contain `email`, `phone`, `firstname`, `lastname`, `fullname`, `address`, `postcode` or `zip`, and the exact keys `ip` and `name`.
  - P3 kept `username`, `identifier` (an e-mail, masked only), `client_ip`, `remote_addr`, `user_agent`, `recipient` and `tenant_id`.
  - The `endsWith('count')` exemption meant for `distinct_address_count` also exempts every key ending in `account` (P7 kept `email_account` and `phone_account`).
  - README §13 says the events carry a "coarse IP", and that "secrets, tokens and raw identifiers never appear".
- **Exploitability and impact.** Attributes are chosen by code, and the first emitters (authentication, TASK-052 onwards) can pass a raw IP or username under an unlisted key. M × L = **LOW**.
- **Remediation.** Preferred: a per-event attribute allow-list from README §13 "Extra fields", enforced in `createSecurityEventSink`. Unknown attributes are dropped and counted. SEC-TC-63 is extended to compare the attribute names too.
  - Minimum fix:
    - the exemption becomes the snake form ending in `_count`;
    - add `ip` as a suffix (`*ip`, `ipaddress`, `remoteaddr`, `forwardedfor`), plus `username`, `login`, `useragent`, `recipient`, `sender`, `receiver`, `tenantid`;
    - `identifier` is allowed only when it ends with `hash`.
- **Verification.** A unit test per key in `security-event.test.ts`, plus a negative test that `email_account` is dropped.

### PR20-SEC-06 (LOW): process-level error output bypasses the logger

- **Description.** Neither `apps/api/src/main.ts` nor `apps/worker/src/main.ts` registers `uncaughtException` / `unhandledRejection` handlers. Node's default handler prints `util.inspect(error)` to stderr, which includes all own properties (Prisma `meta.driverAdapterError` with `originalMessage` and `detail`). The container log driver ships stderr next to stdout. P6: an unhandled P2039 rejection wrote both sentinels to stderr, exit 1.
- **Exploitability and impact.** It needs an unhandled rejection or exception, for example a fire-and-forget promise in later code. The result is database text and PII in logs. M × L = **LOW**.
- **Remediation.** In both entry points:
  - `process.on('uncaughtException', (error, origin) => { log.fatal('process.uncaught_exception', { origin }, error); void shutdown('uncaughtException') /* exit 1 */ })`;
  - `process.on('unhandledRejection', (reason) => { log.fatal('process.unhandled_rejection', {}, reason); … exit 1 })`.
  - Keep crash-only semantics (`process.exitCode = 1`, then a bounded shutdown).
- **Verification.** A child-process test: an unhandled P2039 rejection with sentinels. Stdout has `process.unhandled_rejection` with `err = { name, code, originalCode, kind }`, stderr has no sentinel, and the exit code is 1.

### PR20-SEC-07 (LOW): no per-line cost or size budget

- **Description** (P5).
  - `MAX_NODES` × `MAX_STRING_LENGTH` allows about 16 MiB of strings per line. One call at that bound took 4.5 s.
  - About 0.4 ms per KiB, so a 1 MiB request body (the default limit), once logged as data (for example validation details in TASK-020), blocks the event loop for about 0.4 s.
  - `isOmittedKey(key)` / `isSensitiveKey(key)` normalise the **uncapped** key: 100 keys of 1 MiB took 2.6 s.
  - `capFrames` splits the full stack before the 8 KiB cap: 32 MiB took about 109 ms.
  - Docker's json-file driver splits lines over 16 KiB and CloudWatch caps events at 256 KiB, so oversized lines also break downstream parsing.
- **Exploitability and impact.** It needs a path that logs request-derived bulk data, and none exists today. The impact is event-loop stalls (A04) and unparseable lines. M × L = **LOW**. No backtracking issue.
- **Remediation.**
  1. Add a byte budget to `WalkState` (for example 16 KiB of string output per line; later values become `TRUNCATED`).
  2. `const key = rawKey.length > MAX_KEY_LENGTH ? rawKey.slice(0, MAX_KEY_LENGTH) : rawKey` before any key check.
  3. `stack.slice(0, 2 * MAX_STRING_LENGTH)` before `capFrames`.
  4. Keep `toSnakeCase` internal, or cap its input.
- **Verification.**
  - The line length stays within the budget for a MAX-shaped input.
  - A timing test (the PR9 `json-body.test.ts` pattern): a 1 MiB body-derived object logs in < 20 ms.

### PR20-SEC-08 (INFO): line integrity details

- **Description and fixes:**
  - (a) DEL, C1 controls (U+0080–U+009F, including CSI U+009B), U+2028 and U+2029 pass raw. Fix: escape them in a final `redactString` step and in `contextValue`.
  - (b) Any `logger.<level>('security.x')` call, including at `info`, produces a security-typed line. `securityEventSinkFrom` (api) does not apply `EVENT_NAME` (P3 wrote a name with a newline and JSON, escaped). Fix: brand sink calls (a module-private symbol in the fields) and let the logger set `event_type: "security"` only for branded calls; validate names in the api sink.
  - (c) `writeFallback` drops the event name, so a security line that fails to serialise becomes an anonymous `log.serialization_failed`. Fix: include the event name when it matches `EVENT_NAME`. P3 found no input that makes a security line fail.
  - (d) Reserved keys match exactly, so `Correlation_Id` and `correlation-id` can sit next to `correlation_id`. Fix: compare `normaliseKey(key)` against normalised reserved keys.

### PR20-SEC-09 (INFO): stack reading

- **Description.**
  - `isNativeFunction` uses `Function.prototype.toString`, which also reports bound functions and Proxy-wrapped functions as `[native code]`. P7: a user getter wrapped either way was invoked by `readStack`.
  - V8 fixes the stack header at the first `.stack` read. A message scrubbed after that (`err.message = …`) still reaches the line through the stack header, redacted by pattern only.
- **Remediation.**
  - Compare the getter's identity with the V8 accessor of a fresh error (`Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get`).
  - Rebuild the header from `${name}: ${redactedMessage}` and keep only `at` frame lines from the stack.

### PR20-SEC-10 (INFO): outbound line details

- **Description.**
  - `outboundCallFields` returns `correlation_id`, which is a reserved key. The logger drops it, so without a request or job context (a worker's scheduled token refresh) the outbound line has `correlation_id: null` (P7). PR6-SEC-02 item 3 requires the correlation id on outbound lines.
  - `route_template` accepts a concrete path (P7: a tracking-number path).
- **Remediation.**
  - The logger takes a valid `correlation_id` from the fields when the context has none (as the security path does), or the helper uses `call_correlation_id`.
  - In TASK-113 the template comes from the adapter's EGRESS/route registry, not a free string. A test asserts `{…}` placeholders for parametrised routes.
  - Note for TASK-113: its sheet names `packages/shared/src/security-events.ts`, but the catalogue landed as `packages/shared/src/logging/security-event.ts`. Keep one source.

### PR20-SEC-11 (INFO): server-only boundary not enforced

- **Description.** `eslint.config.mjs:192` `toPackage()` expands each package to `<pkg>` and `<pkg>/**`. The web/admin (`:332`) and pricing (`:388`) allow-lists therefore admit `@platform/shared/logging`, and nothing restricts `pino`.
- **Remediation.** Disallow `@platform/shared/logging` and `pino` from `IMPORTER_APP('{web,admin}')`, `packages/ui` and `packages/pricing`, with negative fixtures. TASK-022's bundle scan confirms.

### PR20-SEC-12 (INFO): free-text pair residuals and driver text in plain errors

- **Description** (P1, P4).
  - A sensitive pair is not recognised in these forms:
    - with escaped quotes (`\"password\":\"…\"`, a double-encoded upstream body inside a message);
    - with more than three blanks or an NBSP around the separator;
    - with an unquoted multi-word value (only the first word is redacted);
    - in Joi's `"<key>" with value "<v>"` form. The message of a Joi `ValidationError` keeps the rejected value (L-13). It is not logged today, because the problem handler logs only status ≥ 500.
  - A plain `Error` whose message embeds driver text keeps that text, minus patterns.
- **Remediation.**
  - `KEY_SEPARATOR` with `\\?["']?` and `[ \t\u00a0]{0,8}` (still bounded).
  - For sensitive keys, end an unquoted value at `[&,;\r\n]`, not at whitespace.
  - The serializer writes Joi errors (`isJoi === true`) as `{ name, details: [{ path, type }] }`.
  - Custom Joi messages without `{#value}` (TASK-020, L-13).
  - Repository code never interpolates a database error's message into another error's message. TASK-020 lint candidate: `.message` of a `catch` binding inside a template literal.

## 5. Routed items

| Item | Source | Status at `dae1f96` | Evidence |
|---|---|---|---|
| PR7-SEC-03 item 3 | PR-0007 (ADR-0005 am. 10 item 6) | **Closed** | §3.4. P4 used the real Prisma 7.10 classes: P2039 → `{ name: PrismaClientKnownRequestError, code: P2039, originalCode: 42501, kind: postgres }`; no message, `meta`, `originalMessage`, `detail`, `hint` or query; same as `cause` and as a field. Tests `serializers/prisma-error.test.ts`, `logging.api.test.ts` |
| PR6-SEC-02 item 3 | PR-0006 | **Closed for TASK-010's part.** Residuals PR20-SEC-02, PR20-SEC-10; TASK-113 stays bound to log through `outboundCallFields` only | Body/payload keys are omitted; the error serializer is an allow-list (drops an HTTP client's `config`/`response`, P1); `outboundCallFields` is an allow-list with no body or URL. General lines still walk carrier objects under other keys (PR20-SEC-02), and the outbound `correlation_id` is dropped (PR20-SEC-10) |
| PR6-SEC-03 item 1 | PR-0006 | **Closed for the logger part.** The client half stays with TASK-113. Residual PR20-SEC-03 | `route_template` refuses `?`, `#`, `@` and `://`; `url`/`urlfull`/`urlpath`/`urlquery`/`href`/`originalurl`/`query`/`search` are omitted; the access log writes the route template only. TASK-113 keeps: `OutboundHttpClient` records the adapter template, and error mapping drops URL-bearing `cause.message`. URLs in free text: PR20-SEC-03 |
| PR9-SEC-10 | PR-0009 | **Closed** | `request-context.ts`: a server `requestId` (UUID) on every request; `clientCorrelationId` only when it matches the pattern; both on every line through the AsyncLocalStorage context (`correlation.ts`). The SEC-P3-17 shard key stays with TASK-030 |
| PR #11 R3-m1 (i) / PR-0011 R3.6 TASK-010 row | PR-0011, D-ARCH-079 | **Closed** | `runtime.ts:188-189, 202-205`: runtime events go through the security-event sink with exactly `{ correlationId, sqlState }`, no `component`, no PostgreSQL text (P3). `onDbError` hook landed (`runtime.ts:207-211`, `with-tenant-tx.ts`). The `sessionContextLeaks()` metric stays with TASK-214 (R3-m1 (ii)). Level gaps in PR20-SEC-04 |
| SEC-P3-23, TASK-010 part | P3 review §16 / G2 | **Partly closed.** Raw forms open (PR20-SEC-01) | `req.headers.cookie`, `set-cookie`, `authorization`, `x-csrf-token`, `x-quote-token` and `x-reauth-proof` are redacted as keys at any depth (P1, P2). The raw forms leak (P2). The TASK-014 part (edge log format) is unchanged |
| SEC-TC-31 (app part) | WAVE-00 TASK-010 | **Met for the keyed forms.** Extension owed (PR20-SEC-01) | The test covers `req.headers` and `res.cookie`; the raw forms need the PR20-SEC-01 extension |
| SEC-TC-63 | WAVE-00 TASK-010 | **Met** | 22 names equal README §13 in both directions (the test reads the README). D-TASK010-01's change request to add the runtime events to §13 is noted; PR20-SEC-04 item 3 asks for the matching runtime list |

## 6. SAST, secrets and dependencies

- **gitleaks** (lane A, PR range, first-parent): no leaks. **Semgrep** (lane A, project rules from the base ref, `--disable-nosem`): 0 findings over 156 files. `semgrep --config auto` and a local gitleaks run were not possible within this review's constraints (no Docker; Semgrep is not installed on the host). Nothing needed triage.
- **Secret-shaped literals in the diff:** the tests build sentinels at run time (`randomBytes`) and contain no credentials.
- **Dependencies:** no new package (§3.7). `pino` 10.4.0 is MIT and was already locked for apps/api and apps/worker.

## 7. ASVS 4.0.3 L2, V7 (Error handling and logging) after this PR

| Req | Status | Note |
|---|---|---|
| V7.1.1 no credentials or payment details in logs | **Partial** | Keyed forms met. Raw header forms open (PR20-SEC-01); key list gaps (PR20-SEC-02) |
| V7.1.2 no other sensitive data as defined by privacy law | **Partial** | E-mail masking met. Party PII under non-body keys open (PR20-SEC-02, -03) |
| V7.1.3 security-relevant events logged | **Partial** | Catalogue and sink in place; emitters arrive with their tasks. Level gate (PR20-SEC-04) |
| V7.1.4 event context for a timeline | Met | timestamp, level, service, version, correlation_id, request_id, org_id, actor_id |
| V7.3.1 log encoding against injection | Met | JSON encoding. C1/U+2028 INFO (PR20-SEC-08) |
| V7.4.1 generic error with a support id | Met (TASK-006) | Unchanged |

## 8. Merge conditions and follow-ups

**Merge conditions (security dimension):** none beyond the standard ones.
- This record is committed on top of `dae1f96` as a docs-only commit, and lane A is green on that commit.
- The orchestrator's pre-merge workflow-lever diff (D-ORCH-021) is re-run against the final head.
- A later merge of `main` that touches `package-lock.json` or `tools/tsconfig.json` voids this record (checker rule (d)) and needs a delta round. Today there is no overlap.

**Strongly recommended in this PR's fix cycle** (small, local changes within TASK-010's own acceptance):
- PR20-SEC-01;
- the key-list parts of PR20-SEC-02;
- PR20-SEC-04 items 1 and 3;
- PR20-SEC-06.

If they are not taken here, the orchestrator records them as tracked items:
- **PR20-SEC-01** is due before TASK-052 / TASK-055 merge, because they issue the first refresh cookie;
- **PR20-SEC-05 and -10** go to TASK-113;
- **PR20-SEC-06** goes to TASK-214;
- **PR20-SEC-07 and -12** go to TASK-020;
- **PR20-SEC-11** goes to the next lint-config task or TASK-022;
- **PR20-SEC-04 item 2** goes to TASK-014.

A fix round that changes `package-lock.json` or `tools/tsconfig.json` needs a delta round on its new head. Changes limited to unowned paths keep this record valid, but they should still get a security delta round, because the fixes change the redaction behaviour.

## 9. Record check (simulated)

**Setup.**
1. `git clone --shared --no-checkout <main checkout>` into scratch.
2. `checkout --detach dae1f96`.
3. Copy this file in and commit it as a docs-only commit on top.
4. Run main's `tools/ci/check-security-owned-paths.mjs --root <clone> --base 80ff2c2 --pr 20` (head = the record commit).

Main's tool was taken from `cdbeabf` with `git archive`. The clone was removed afterwards.

**Observed: `pass`** (exit 0), satisfied by this record at `dae1f96`, with the same 2 owned paths lane A listed (`package-lock.json`, `tools/tsconfig.json`). With `--base cdbeabf` (current main) the result is also `pass`.

**Controls:**
- without the record commit (head `dae1f96`): `missing` (exit 1, "no record named …PR-0020-*.md");
- `--pr 19`: `missing`;
- rule (d): a further commit that changes `tools/tsconfig.json` after the record gives `missing` ("names dae1f96, but tools/tsconfig.json changed after it").

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open at head `dae1f96`, so the merge rule (D-ORCH-004) is met for the security dimension. Closed: PR7-SEC-03 item 3, PR9-SEC-10, PR #11 R3-m1 (i) / R3.6; PR6-SEC-02 item 3 and PR6-SEC-03 item 1 closed for TASK-010's part (client halves stay with TASK-113); SEC-TC-63 met; SEC-P3-23 TASK-010 part partly closed. Database errors are identifier-only for every real Prisma/driver class; keyed redaction, log-injection escaping and the never-throw path hold; no ReDoS; lock delta one path, gitleaks and Semgrep clean. Open: PR20-SEC-01 MEDIUM (raw header forms leak the refresh cookie, step-up proof, quote token, API key and query; fix recommended in this PR, otherwise due before TASK-052/055), LOW PR20-SEC-02..07, INFO PR20-SEC-08..12, each with an owner (§8). **This round authorises `dae1f96` for merge** once this record is committed on top of it as a docs-only commit and lane A is green on that commit |
