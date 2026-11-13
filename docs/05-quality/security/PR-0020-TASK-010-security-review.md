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

## Round 2 (head 9647907)

Delta review after fix cycle 1 (D-SEC-PR20-01: every redaction change gets a security delta round). The round-1 record no longer satisfies lane A: owned paths changed after `dae1f96` (checker rule (d)).

| Field | Value |
|---|---|
| Commits since round 1 | `ce95d37` (merge of main `e82902d`), `36f19fc`, `93d1e11`, `dcdbf44`, `75f3d4b`, `67f8faa`, `182066f`, `508c1f3`, `9647907` (merge of main `6ac9836`). Fix commits: 48 files, +2,006 / −272 |
| Head | 964790786d69790819569c1423d34ab96c931f98 |
| Lane A evidence | Run [43353973952](https://github.com/sukhchdit/shipcube/actions/runs/43353973952) on `9647907` (`pull_request`, base `6ac9836`). **fast-lane `success`.** Gitleaks: 14 commits scanned, "no leaks found". Semgrep: 0 finding(s), 0 error(s) in 209 file(s), rules and scope from the base ref. Only "Security-owned paths need a review record" failed: the round-1 record names `dae1f96`, and 18 owned paths changed after it. This round is the new record |
| Owned paths changed | 18: `eslint.config.mjs`, `package-lock.json`, `tools/tsconfig.json`, `tools/lint/negative-fixtures.test.ts`, and 14 fixtures under `tests/fixtures/lint/layering/shared-logging-server-only/`. `package-lock.json` and `tools/tsconfig.json` have the same delta as in round 1 (§R2.6) |
| Reviewer / date / method | security-analyst, 2026-11-13. Read-only. Git commands ran in the main checkout only; **no command ran in the PR worktree** (scratch junctions to its `node_modules` only, removed afterwards). No install, build, Docker or test-suite run (host memory cap). For suite results this round relies on lane A run 43353973952 and the developer's gate table (unit 2,776 passed, api 61, integration 185, coverage 97.81 % lines / 96.22 % branches); none of them was re-run here. Probes ran on `git archive 9647907` sources, type-stripped with Node 24.22.3, against the real `pino`, `express`, Prisma 7.10 runtime classes and ESLint plugins |
| Inputs | Developer comment [6842231457](https://github.com/sukhchdit/shipcube/pull/20#issuecomment-6842231457); PR body "Fix cycle 1"; `git diff dae1f96 9647907`; D-SEC-PR20-01, D-062, D-ORCH-024, D-ORCH-025; api/README.md §13; ADR-0017 §1 and §7; round-1 findings above |

### R2.1 Summary

Fix cycle 1 closes **PR20-SEC-01 (MEDIUM)** and every round-1 LOW and INFO finding for TASK-010's part. Probe-confirmed:
- **Live objects are never walked.** `req`, `res`, sockets and streams are written as `[Unsupported]`. A spread or `Object.assign` copy of `req` gets its raw forms omitted by key. `[name, value]` arrays (`rawHeaders`, header entries, nested tuples) are redacted by the name.
- **Free text:** `Cookie:` and `Authorization:` values run to the end of the line. All eleven authorisation schemes are redacted.
- **Security events** are sink-only and written whatever `APP_LOG_LEVEL` says. Attributes are allow-listed per event, and the allow-list equals README §13 (independent parse: 22 rows, 0 mismatches).
- **Errors:** the stack getter is checked by identity. Process-level crashes write one identifier-only fatal line and exit 1.
- **Cost:** every call is bounded (at most about 9 ms per call). Every regex stays linear to 128k characters.
- **Lint guard:** the server-only guard stops all 22 direct import forms probed.

New this round:
- **PR20-SEC-13 (LOW):** free-text renderings of raw header lists and live requests (`JSON.stringify(req.rawHeaders)`, `util.inspect(req)`), a bare `__Host-` cookie pair, and scheme-less request targets (`/x?q=…`) still carry credential or query values.
- **PR20-SEC-14..17 (INFO):** PII-class gaps; security-event brand forgeable by a Proxy; a transitive path around the server-only guard; the line-size bound covers fields only.

**Verdict: PASS_WITH_FOLLOW-UPS.** No Critical or High finding.

### R2.2 Probes

| Probe | What it does | Outcome |
|---|---|---|
| Q1 live request | Express 5 request carrying the `__Host-rt_*` cookie second, `Authorization: DPoP`, `X-Reauth-Proof`, `X-Quote-Token`, `X-Api-Key`, `X-CSRF-Token` and a query sentinel (control: 8/8 sentinels reach the handler). 29 log calls: `req`, `res` (also after `finish`), socket, `rawHeaders` (also copied under a neutral key), `rawTrailers`, header entries (flat and nested), `{...req}`, `Object.assign({}, req)`, a Map, Set and `Array.from(Map)` of the headers, `Object.fromEntries`, upper-case keys, `res.getHeaders()`, an Error carrying `req`/headers/`config`, plus free-text renderings | **0 leaks in every structured form.** Leaks only in free text: `JSON.stringify(rawHeaders)`, `util.inspect(rawHeaders)`, `util.inspect(req)` and a message with `req.originalUrl` (PR20-SEC-13) |
| Q2 corpus | 186 cases, 2 positive controls: schemes (case, tab, NBSP, 17 blanks), Digest/HOBA/AWS4 parameter lists, cookie lines (2nd/3rd pair, `Set-Cookie`, bare pair), pairs (escaped and doubly escaped JSON, 16/17 blanks, NBSP, next-line, two- and three-word keys, Joi form, `apiKey :` from `508c1f3`), URLs (query, fragment, dotless userinfo, JSON-escaped, percent-encoded, scheme-less), e-mail forms, 33 secret keys, 23 PII keys, card children, collections (Map, Set, `Headers`, `Request`, `Response`, `URLSearchParams`, `URL`, `FormData`, `Blob`, Buffers, typed arrays), `toJSON` methods and getters, Symbol keys, Proxies, class instances, null-prototype objects, error shapes | Every documented control holds. Residuals: PR20-SEC-13 (raw lists in text, bare cookie pair, scheme-less query) and PR20-SEC-14 (PII-class gaps). Accepted or already routed: 17+ blanks, NBSP after a scheme, triply encoded JSON, `%2540`, dotless e-mail domains, and Joi `with value` text for a non-sensitive key outside a Joi error (TASK-020, D-ORCH-025 (2)) |
| Q3 security events | Sink and plain calls at `silent`/`fatal`/`error`; the api sink with all 5 runtime events and an invalid name; 20 attributes incl. forged reserved keys in mixed case, hyphens and full-width; 11 `ip_coarse` values; `session_id`; URL-bearing `origin`; an unknown valid name; child bindings; a Proxy-branded field object | Level bypass holds. Plain `security.*` calls are ordinary lines. 14 of 16 unlisted keys are dropped and counted. `ip_coarse` keeps only `x.y.z.0/24` and a `::/48` prefix. `session_id` is written `[REDACTED]` (D-ORCH-025 (3)). All 5 runtime events are at `error` (D-ORCH-025 (1)). The Proxy forges the brand (PR20-SEC-15) |
| Q4 line integrity, stacks | DEL, C1, CSI, U+2028/9, ESC, CR, LF and NUL in the event, key, value, context and error; a throwing destination; scrub after the first `.stack` read; bound, Proxy and Proxy-of-V8 getters; `captureStackTrace` objects; subclasses; another realm; the V8 getter on a non-error receiver; a hostile `name`; `structuredClone`; a 200k-frame stack | 0 raw control code points except the final LF. The fallback line keeps the event name. The header is rebuilt from the scrubbed message. Only V8's accessor is invoked (the `captureStackTrace` getter is the same function). A cross-realm error has no stack. 200k frames take 1.6 ms |
| Q5 cost | 12 string-redaction regexes × 29 hostile families at 8k/32k/128k uncapped; `redactString` at the cap; per-call budget with the round-1 shape (20 × 99 × 8 KiB), 2,000 × 8 KiB nodes, 100 × 1 MiB keys, a 1 MiB body-like object, a 4-level cause chain, two child-binding sets | Linear: 4× the input gives 3.4–5.6× the time. Worst is `KEY_SEPARATOR` at 68 ms on 128k uncapped; inputs are capped at 8 KiB first. `redactString` takes at most 4.8 ms. A call takes at most 6 ms for fields and 9 ms with `err` and two children. The line size bound covers fields only (PR20-SEC-17) |
| Q6 process handlers | 8 child processes with the head logger and `installProcessErrorHandlers` on the real `process`: control without handlers; Prisma P2039 rejection; async throw; an Error with `detail`/`config.headers`; an object rejection; a string rejection with a scheme credential; an ESM top-level throw; two throws | Control: Node's printer writes both sentinels to stderr. With handlers: one `fatal` line each, `err` identifier-only, empty stderr, exit 1. The top-level throw arrives as origin `unhandledRejection`. Two throws give one line |
| Q7 lint guard | Head `eslint.config.mjs` in a scratch mini-repo (real resolver, `node_modules/@platform/shared` linked into the root). 4 controls plus 22 candidates. **Direct forms from web/admin/ui/pricing:** dynamic `import()`, re-export, `export *`, `createRequire`, a relative path with `.ts`, `index.js` or a directory, a deep route file, `apps/web/scripts/*.mjs`, `react-router.config.ts`, `?worker`/`?raw` queries, `import type`, `pino/browser.js`, a trailing slash, `@platform/shared/{dist,src}/…`. **Transitive form:** a non-logging `packages/shared` file importing logging. Repeated on the clean PR #21 union config (`git merge-tree` of `9647907` and `e046ea2`) | Every direct form is an error: the boundaries server-only message, or `no-unresolved` for `dist`/`src`. The only clean case is the transitive one (PR20-SEC-16). Union config: same result. Method note: a first run reported the `?worker`/`?raw` forms clean. The cause was my probe junction, which used a Windows 8.3 short path and so put the resolved file outside the boundaries root. With long paths they are caught, so there is no finding |

### R2.3 Round-1 findings at `9647907`

| ID | R1 severity | Status | Evidence |
|---|---|---|---|
| PR20-SEC-01 | MEDIUM | **Closed** | `redaction.ts` `isLiveObject` (`instanceof EventEmitter`), the `walkArray` pair rule, `rawheaders`/`rawtrailers`/`parsedurl` omitted. `string-redaction.ts` line-valued `cookie`/`authorization` keys, `TOKEN68_SCHEME` and `PARAMETER_SCHEME`. Q1: 0 leaks over 22 structured forms. Q2: all schemes and cookie lines redacted. Test `[SEC-TC-31] [PR20-SEC-01]` in `logging.api.test.ts`. Free-text renderings of raw lists: new PR20-SEC-13 |
| PR20-SEC-02 | LOW | **Closed (TASK-010 part)** | PII key class on every line. Secret parts and exact keys extended. Card children under `card`, `paymentCard`, `paymentMethod`, `creditCard`. NFKC folding. Q2: 33/33 secret keys and 23/23 PII keys redacted. Residual PR20-SEC-14; the carrier lists stay with TASK-135/139/140/188 |
| PR20-SEC-03 | LOW | **Closed for scheme URLs** | `URL_PATTERN`: userinfo becomes `[REDACTED]@`, the query becomes `?[OMITTED]`, also JSON-escaped. `*url`/`*uri`/`*href`/`*link` keys omitted; `%40` e-mails masked. Scheme-less request targets: PR20-SEC-13 |
| PR20-SEC-04 | LOW | **Items 1 and 3 closed**; item 2 routed (TASK-014, D-ORCH-025 (2)) | Own `securityPino` at `trace`, sink-branded lines only. `RUNTIME_SECURITY_EVENTS` lists all 5 events, at `error` (D-ORCH-025 (1)). Q3 at `silent`/`fatal`/`error` |
| PR20-SEC-05 | LOW | **Closed** | `SECURITY_EVENT_FIELDS` allow-list plus `dropped_attributes`. The `*count` exemption is replaced by `COUNT_SUFFIX` (general lines only; `email_account` is now redacted). Q3. The README §13 match is checked independently in both directions |
| PR20-SEC-06 | LOW | **Closed** | `process-errors.ts`, wired in both `main.ts` files before services start. Q6 |
| PR20-SEC-07 | LOW | **Closed for cost** | `MAX_LINE_CHARS`; keys capped before classification; raw stack cut before the split; `toSnakeCase` capped (1 MiB input 0.3 ms). Q5. Size residual: PR20-SEC-17 |
| PR20-SEC-08 | INFO | **Closed** | (a) `escapeLineBreakers` everywhere (Q4); (b) brand plus api sink = shared sink (name-validated); (c) the fallback keeps the event name; (d) reserved keys normalised (Q3, and a general-line check: 11 forged forms dropped). Residual PR20-SEC-15 |
| PR20-SEC-09 | INFO | **Closed** | `V8_STACK_GETTER` identity; header rebuilt from the redacted message (Q4). Accepted residual: a message line shaped like an `at` frame survives a later scrub (contrived) |
| PR20-SEC-10 | INFO | **Closed for the correlation ID**; `route_template` → TASK-113 (D-ORCH-025 (2)) | `fieldCorrelationId` (pattern-checked; used only when the context has none) |
| PR20-SEC-11 | INFO | **Closed** | Q7: 22/22 direct forms rejected; negative fixtures (4 importers × 2 arms, build config, `pino`) plus 3 positive controls. Residual PR20-SEC-16 |
| PR20-SEC-12 | INFO | **Closed (TASK-010 part)** | Joi `ValidationError` → `{ name, details: [{ path, type }] }` (Q2 control). Escaped quotes, 16 blanks/NBSP and multi-word values handled. Joi custom messages → TASK-020 (routed) |

Round-1 routed items: **SEC-P3-23 (TASK-010 part) is now closed** (raw forms; the free-text residual is PR20-SEC-13). **SEC-TC-31 (app part) is met** with the raw-form extension. **SEC-TC-63 is met**, now with attribute names. The PR7-SEC-03 item 3, PR9-SEC-10, PR #11 R3-m1 (i), PR6-SEC-02 item 3 and PR6-SEC-03 item 1 statuses are unchanged (Q6 re-proves the database-error shape for the real Prisma classes).

### R2.4 Focus points

1. **PR20-SEC-01 bypass attempts** (Q1, Q2).
   - Held: mixed-case and full-width names; Map, Set and `Headers`; `[...headers]`; `Request`, `Response`, `URLSearchParams`, `URL`, `FormData`; nested pair arrays; a Buffer under a sensitive name or after one in a pair; `toJSON` methods and getters; Symbol keys; spreads of `req`.
   - The only structured gaps are contrived: a Buffer *name* in a pair, and a non-string item between a name and its value.
   - Free-text renderings: PR20-SEC-13.
2. **Free text, ReDoS, budget** (Q2, Q5).
   - No regex backtracks super-linearly.
   - Strings are capped at 8 KiB and keys at 128 characters before any regex or classification.
   - The per-call budget stops processing at 16 KiB of input characters. So a 1 MiB key, a 200k-frame stack or the round-1 16 MiB shape costs milliseconds, and a huge input cannot cause CPU DoS.
3. **Stack getter** (Q4). Identity check only. Bound, Proxy and Proxy-of-V8 getters are refused. Errors from another realm are logged without a stack (fails closed). The header is rebuilt from the redacted message.
4. **Security events** (Q3).
   - The allow-list equals README §13. `dropped_attributes` is counted.
   - `ip_coarse` accepts /24 and /48 prefixes only.
   - Security lines use a dedicated Pino instance at `trace`, independent of `APP_LOG_LEVEL`.
   - Sink branding holds, except for the Proxy residual (PR20-SEC-15).
   - Reserved keys are compared in normalised form.
   - Emitter conditions: §R2.8.
5. **`installProcessErrorHandlers`** (Q6). One redacted fatal line, exit 1, no PII. Window: errors raised before the handlers are installed (configuration loading) still go to Node's printer. That path has its own exit-78 handling (PR3-SEC-05), so this is accepted. With `APP_LOG_LEVEL=silent` the fatal line is suppressed (TASK-014 clamp).
6. **M1 lint guard** (Q7). Relative paths, `@platform/shared/dist/…`, dynamic import, re-exports, `createRequire`, query suffixes and build or script files are all caught. Transitive path: PR20-SEC-16.
7. **Workflow levers, lock, merges** (§R2.6). No `.github/**` change in the net diff, so the D-ORCH-021 levers are unchanged. The lock delta is unchanged. Both merges are clean.
8. **PR #21 union:** §R2.7.

### R2.5 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR20-SEC-13 | Free-text renderings of raw header lists and live requests, bare `__Host-`/`__Secure-` cookie pairs, and scheme-less request targets keep credential and query values | LOW | CWE-532 | A09 | `packages/shared/src/logging/string-redaction.ts:284-365` (`isSensitivePairKey`, `redactPairs`), `:427-433` | senior-developer: items 1–3 before TASK-052/TASK-055 merge (first refresh cookie), or in PR #20 if a further cycle runs; item 4 → TASK-020 | Open |
| PR20-SEC-14 | PII-class gaps on general lines: IP-bearing keys other than `ip`/`*address`, `username`/`login`, bank and carrier account numbers, the card-parent rule through arrays, PII `[name, value]` pairs in arrays | INFO | CWE-359 | A09 | `string-redaction.ts:78-111`; `redaction.ts:135-152` | TASK-113; carrier account fields → TASK-135/139/140/188 lists | Open |
| PR20-SEC-15 | The security-event brand can be forged by a Proxy whose `getOwnPropertyDescriptor` trap answers for symbol keys (the comment says hostile Proxies are refused) | INFO | CWE-345 | A09 | `packages/shared/src/logging/security-mark.ts:14-23` | TASK-113 (catalogue owner) | Open |
| PR20-SEC-16 | Server-only guard: no lint policy or test stops a non-logging `packages/shared` file from importing `src/logging` (and the root `index.ts` from re-exporting it) | INFO | CWE-1164 | A05 | `eslint.config.mjs:418-419`; `packages/shared/src/index.ts` | TASK-020 (next lint-config task) / TASK-022 bundle scan | Open |
| PR20-SEC-17 | The 16 KiB size bound covers fields only: `err` (up to 4 × (8 KiB message + 8 KiB stack)) and each `child()` binding set have their own budgets (Q5: 48 KiB and 88 KiB lines) | INFO | CWE-779 | A09 | `logger.ts:192-236`; `serializers/error.ts:161-180` | TASK-214 | Open |

#### PR20-SEC-13 (LOW): free-text raw header lists, bare cookie pairs, scheme-less queries

- **Description** (Q1, Q2).
  - The pair rule redacts a value only after `key:` / `key=` / `"key":` / `with value`. Raw header lists rendered as text put the name and the value side by side, separated by a comma:
    - `JSON.stringify(req.rawHeaders)` gives `["Cookie","…","X-Api-Key","…"]`;
    - `util.inspect(req.rawHeaders)` and `util.inspect(req)` give `[ 'Cookie', '…', … ]`;
    - `String(rawHeaders)` gives `Cookie,…`.
  - Q1 leaked the refresh cookie, step-up proof, quote token, API key and CSRF token through all three; `util.inspect(req)` also leaked the query.
  - A `Set-Cookie` value under a neutral key (`__Host-rt_x=…; Path=/; Secure`) keeps the cookie value, because `__Host-rt_x` contains no keyword.
  - A scheme-less request target in a message (`GET /api/v1/x?q=… failed`, `req.originalUrl`) keeps every non-sensitive query value. Only URLs with a scheme lose their query.
- **Exploitability and impact.** Impact is H: a live refresh token (30-day rotating family, ADR-0006), a step-up proof or an API key in the log, against the "secrets in logs = 0" guardrail. But it needs code that first turns a raw header list or a live request into a string and then logs that string. No current or planned call site does that, and the structured forms (the realistic ones) are closed. Rated **LOW** on the round-1 PR20-SEC-03 precedent (high impact, no current or planned emitter).
- **Remediation** (`string-redaction.ts`):
  1. **Cookie prefixes:** in `isSensitivePairKey`, a key that starts with `__Host-` or `__Secure-` (case-insensitive) is sensitive. These are the RFC 6265bis prefixes, and the refresh cookie uses `__Host-`. This alone closes the refresh cookie in every free-text form.
  2. **List adjacency.**
     - Add a linear pass for `"name"␠*,␠*"value"` and `'name', 'value'`: one regex `(["'])([A-Za-z0-9_.-]{1,64})\1[ \t]{0,16},[ \t]{0,16}(?=["'])`.
     - Then hand-scan the value with `quotedEnd`/`escapedQuotedEnd`, and redact it when `isSensitiveKey(name)`.
     - Optionally add a bare `Name,value` variant for comma-joined lists (the value ends at the next comma).
  3. **Scheme-less targets:** a word that starts with `/` and contains `?` keeps the part before `?` and gets `?[OMITTED]` appended. Implement it in `redactWord` or in a linear pass, `(^|[\s"'(])\/[^\s"'?#<>]*\?[^\s"'<>]*`.
  4. **TASK-020:** add a lint or Semgrep rule (`.semgrep/`) that flags `JSON.stringify`, `util.inspect`, `String()` and template literals of `req`, `res`, `request`, `response`, `rawHeaders` and `rawTrailers` inside logger call arguments.
- **Verification.**
  - Unit cases in `string-redaction.test.ts` for each form.
  - Extend `[SEC-TC-31] [PR20-SEC-01]` with `{ detail: JSON.stringify(req.rawHeaders) }`, `{ detail: util.inspect(req) }`, `{ value: <the Set-Cookie value> }` and a message containing `req.originalUrl`, and assert that no sentinel appears.
  - Add a ReDoS family for the adjacency regex (`"a",` repeated to 8 KiB, under 5 ms).

#### PR20-SEC-14 (INFO): PII-class gaps

Q2 keeps these in clear on general lines:
- `clientIp`, `x-forwarded-for`, `x-real-ip`, `username`, `login`;
- `iban` and `accountNumber` (carrier account numbers);
- `card: [{ number }]` and `cards[].number`, because `walkArray` passes no parent key;
- PII pairs in arrays: `Object.entries(party)` kept `phone` and `fullName`, because `pairMarker` classifies only sensitive and omitted names.

These need a code path that logs such objects. Security lines are allow-listed and so not affected.

**Fix:**
- an exact IP set (`clientip`, `remoteip`, `sourceip`, `userip`, `ipaddress`, `xforwardedfor`, `forwardedfor`, `forwarded`, `xrealip`, `cfconnectingip`, `trueclientip`), plus `username` and `login`, in `PII_EXACT_KEYS`;
- `iban`, `accountnumber`, `bankaccount` and `routingnumber` as parts, or let the TASK-135/139/140/188 lists decide;
- pass `parentKey` through `walkArray`;
- `pairMarker` reuses `keyMarker` (PII included).

#### PR20-SEC-15 (INFO): brand forgeable by a Proxy

- **Description.** `isSecurityEventFields` reads the brand with `Object.getOwnPropertyDescriptor`. A Proxy trap receives the module-private symbol and can answer `{ value: true }`. Q3: a `debug`-level forged `security.audit_chain_broken` line was written at `APP_LOG_LEVEL=silent`. Attributes stay allow-listed. Exploiting it needs deliberate repository code, so it is not a data path.
- **Fix:**
  - `if (types.isProxy(fields)) return false;` (`node:util`) before the descriptor read;
  - correct the comment;
  - add a unit test.

#### PR20-SEC-16 (INFO): transitive path around the server-only guard

- **Description.** The boundaries policies cover importers in web, admin, ui and pricing. A file under `packages/shared/src` outside `logging/` may import `./logging/**` (Q7: clean). Once the root `index.ts` re-exports that file, `@platform/shared` (allowed everywhere) carries Pino into browser bundles. No test pins the root export surface against logging. A Vite plugin that resolves a `virtual:*` id (ignored by `no-unresolved`) to the logging module is the build-config variant.
- **Fix:**
  - a policy `{ from: packages/shared files not in 'shared-logging', disallow: toLayer('shared-logging') }`, with a negative fixture;
  - a test that the root module graph imports no `pino`;
  - TASK-022's bundle scan asserts no `pino` in the web and admin bundles.

#### PR20-SEC-17 (INFO): line size beyond fields

- **Description.** `MAX_LINE_CHARS` bounds one `redactValue` call. Bindings are redacted when `child()` is called (16 KiB per set), and `err` is serialised outside the budget, so a line can exceed the Docker json-file 16 KiB split (Q5: 48 KiB with a 4-level cause chain, 88 KiB with two binding sets). CPU stays bounded (9 ms), so this is about log shipping only.
- **Fix:**
  - charge `err` and the merged bindings to one per-line budget, or cap `err` at `MAX_LINE_CHARS` in total and child bindings at 2 KiB;
  - document the shipper's partial-line handling in TASK-214.

### R2.6 Supply chain, workflow levers and merges

- **Lock delta.** A deep JSON diff of `6ac9836` → `9647907` (and of `87fcd9e` → `9647907`) gives exactly **one** leaf path: `packages["packages/shared"].dependencies = { pino: "^10.4.0" }`. That is round 1's delta. The positive control `80ff2c2` → `6ac9836` gives 13 paths. No new package.
- **`tools/tsconfig.json`:** the same one-entry addition as in round 1.
- **Owned-path edits are additive.** `eslint.config.mjs` (+26) and `tools/lint/negative-fixtures.test.ts` remove only the one-line `ESLINT_VIOLATIONS` list, which is rewritten to add `SHARED_LOGGING`. The 14 fixtures are new.
- **Inline suppressions** in the added lines (`eslint-disable`, `nosemgrep`, `gitleaks:allow`, `@ts-ignore`, `@ts-expect-error`, `istanbul`/`c8 ignore`): **0**.
- **D-ORCH-021 levers.** The PR's net diff against main has no `.github/**` path, so `RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, folded gate steps and `$GITHUB_ENV`/`$GITHUB_PATH` writes are unchanged.
- **Merges keep main's controls.** Both main merges are clean: the merge tree equals `git merge-tree --write-tree` of the parents (`ce95d37` = `9b2682e`, `9647907` = `bd0a4d4`). Every control that PRs #17, #18, #19 and #4 put on main is carried unchanged.
- **Main moved during this round.** PR #21 was squash-merged as `62e4961` (D-ORCH-027), and main is now `84d9299` (docs only after the squash). Main now overlaps this PR on two owned paths (`eslint.config.mjs`, `tools/lint/negative-fixtures.test.ts`) and three non-owned files that conflict. See §R2.7.

### R2.7 PR #21 union (D-ORCH-024, D-ORCH-025 (4)): what the merge-only round must check

PR #21 merged first (`62e4961`), so PR #20 must merge main before it can merge. `git merge-tree` of `9647907` with main `84d9299` (tree `893252b`):
- conflicts only in the non-owned `apps/api/src/app.ts`, `apps/api/src/main.ts` and `apps/api/src/platform/context/request-context.ts`;
- auto-merges the owned `eslint.config.mjs` and `tools/lint/negative-fixtures.test.ts`.

The owned blobs are identical to the preview made with PR #21's head `e046ea2` (tree `c1da3ee`), and the squash equals `e046ea2` on every PR #21 path.

Both owned files change on both sides, so the union voids this record under clause (d). §R2.10 case F reproduces this. **A merge-only security round on the union commit is required before PR #20 merges.**

Q7 already ran on the union config: same result as on the head, and the server-only policies remain the last two entries of `BOUNDARIES_POLICIES`. The merge-only round must check:
1. The record names the merge commit, and `git ls-remote origin` shows that commit as the PR head.
2. The paths of `diff <main parent> <merge>` equal PR #20's net-change paths.
3. Every blob equals `9647907`'s, except the union files: `eslint.config.mjs`, `tools/lint/negative-fixtures.test.ts`, `app.ts`, `main.ts`, `request-context.ts`, `problem-handler.api.test.ts` and `packages/shared/src/index.ts`.
4. `eslint.config.mjs` and `negative-fixtures.test.ts` equal the `git merge-tree` result.
   - The `shared-logging` category, `SERVER_LOGGING_TARGETS` and the two disallow policies stay after every allow-list.
   - `SHARED_LOGGING` stays in `ESLINT_VIOLATIONS` with its 3 allowed cases.
   - PR #21's `lint-fixtures.mjs` still lints the new fixture root (re-run Q7 and the negative-fixture suite).
5. **Non-owned union, security content.**
   - `requestContextMiddleware` keeps `generateRequestId`, the validated `clientCorrelationId` and `apiMode`.
   - `CORRELATION_ID_PATTERN` comes from `@platform/shared`.
   - `requestLogger(logger)` sits directly after the context middleware.
   - `routePrefix` becomes `api.use(routePrefix(API_PREFIX))`, the first layer of `api` (D-ORCH-024 (3)).
   - The docs mount stays inside `routes`, after `optionsResponder`.
   - Access lines for `/api/docs/*` and OPTIONS carry the route template only, never a query.
   - `main.ts` calls `installProcessErrorHandlers` before `createRuntimeServices`/`createApp` and passes `logger: log`.
   - `AppLogger` keeps `debug`.
   - The problem handler still logs `thrown` only at status ≥ 500, through the platform logger.
6. The lock delta is still the one path (`lockdelta-eq` against `9647907`), and `tools/tsconfig.json` is unchanged.
7. Lane A is green on the merge commit with the record on top. D-ORCH-024 also requires `test:unit`, `test:api` and drift to be re-run on the union.
8. **PR21-SEC-07 (b)** (INFO, routed to TASK-010 by D-ORCH-023 (1)): the union is the first commit that holds both redaction lists. Two options:
   - switch the failure-excerpt redaction in `tests/api/helpers/contract-validator.ts` to `isSensitiveKey`/`isPiiKey` from `@platform/shared/logging` in the union commit;
   - or the orchestrator re-routes it to TASK-020.

   The merge-only round records which option was taken.

### R2.8 Conditions for later tasks (security-event emitters, TASK-052 onwards)

- **Enumerated attribute values** (`reason`, `failure_kind`, `key_type`, `cvc_check`) must be UPPER_SNAKE catalogue identifiers (`WRONG_PASSWORD`). A lower-case value that contains a keyword is over-redacted (Q3: `bad_password` → `[REDACTED]`).
- **`identifier_hash` must be a hash.** A raw e-mail is only masked to `a***@domain`, which keeps the domain.
- **`ip_coarse`** is produced by a /24 or /48 helper only. A precise address is dropped and counted.
- **PR20-SEC-13 items 1–3** are due before the first refresh cookie (TASK-052/TASK-055), the same due point round 1 set for PR20-SEC-01.

### R2.9 SAST, secrets, ASVS

- **Scans.** Lane A: gitleaks (pinned v8.30.1, first-parent, `6ac9836..9647907`) found no leaks; Semgrep (base-ref rules, `--disable-nosem`) found 0 over 209 files. `semgrep --config auto` and a local gitleaks image run were not possible within this round's constraints (no Docker; Semgrep is not installed). A Node emulation of the gitleaks v8.30.1 default rules over this round's added lines found nothing. All probe sentinels were random and generated at run time; none is quoted here.
- **ASVS 4.0.3 L2 V7 after this round:**
  - **V7.1.1:** Met for structured fields; free-text residual PR20-SEC-13 (LOW).
  - **V7.1.2:** Met for the PII class; INFO residual PR20-SEC-14.
  - **V7.1.3:** Met at the sink: level-independent, allow-listed; emitters arrive with their tasks.
  - **V7.1.4:** Met.
  - **V7.3.1:** Met (C0, C1, U+2028 and U+2029 escaped).
  - **V7.4.1:** Met.
  - **V7.4.2:** Met for process-level errors (PR20-SEC-06).

### R2.10 Record check (simulated)

**Setup.**
1. `git clone --shared --no-checkout <main checkout>` into scratch.
2. `checkout --detach 9647907`.
3. Copy this file in and commit it as a docs-only commit.
4. Run main's `tools/ci/check-security-owned-paths.mjs` with `--root <clone> --pr 20`, head = the record commit. The checker was extracted with `git archive` from `origin/main` (`62e4961`, then `84d9299`); `tools/ci` is unchanged since `87fcd9e`.

The clone was removed afterwards.

**Observed: `pass`** (exit 0), with base `62e4961`, base `84d9299` and lane A's base `6ac9836`. 18 owned paths, satisfied by this record at `9647907`. Round 1's `dae1f96` row produces only a note.

**Controls:**
- head `9647907` without this round: `missing` (reproduces lane A's note);
- `--pr 21`: `missing`;
- `tools/tsconfig.json` edited after the record: `missing` ("names 9647907, but tools/tsconfig.json changed after it");
- an unowned edit (`app.ts`) after the record: `pass`;
- **F, the PR #21 union:** main plus `e046ea2`, merged into the record commit: `missing` ("names 9647907, but eslint.config.mjs, tools/lint/negative-fixtures.test.ts changed after it").

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open at head `9647907`, so the merge rule (D-ORCH-004) is met for the security dimension. **Closed:** PR20-SEC-01 (MEDIUM), -05, -06, -08, -09, -11. **Closed for TASK-010's part:** -02, -03 (scheme URLs), -04 (items 1 and 3), -07 (cost), -10 (correlation ID), -12. SEC-P3-23 (TASK-010 part) closed. SEC-TC-31 and SEC-TC-63 met. Lock delta one path; both merges clean; D-ORCH-021 levers untouched; gitleaks and Semgrep clean. **Open:** PR20-SEC-13 LOW (free-text raw header lists, bare cookie pairs, scheme-less queries; items 1–3 due before TASK-052/055), INFO PR20-SEC-14..17, each with an owner (§R2.5). **Routed:** -04 item 2 → TASK-014; -10 template → TASK-113; Joi messages → TASK-020 (D-ORCH-025 (2)). **This round authorises the content of `9647907`**: the record committed on top of it passes the lane A check. PR #21 merged first (`62e4961`), so PR #20 must merge main before it can merge. That union changes two owned paths (`eslint.config.mjs`, `tools/lint/negative-fixtures.test.ts`), voids this round under clause (d), and needs the merge-only round of §R2.7 on the union commit before merge |
